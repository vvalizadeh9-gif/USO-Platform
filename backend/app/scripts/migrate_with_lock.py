"""Apply migrations and seed reference data, one pod at a time (UEP-23).

    python -m app.scripts.migrate_with_lock

On Kubernetes two backend pods can start at the same moment -- on the first
deploy, after a node restart, during a rolling update. Each one runs this from
``entrypoint.sh`` before it serves anything. The namespace allows no Jobs, so
there is no separate "migrate once" step to hand this to.

A PostgreSQL advisory lock makes them take turns: the first pod takes the
lock, runs ``alembic upgrade head`` and the seeding, and releases it; the
second waits, then takes the lock and finds nothing left to do. Seeding is
idempotent, so the second pod writes no duplicate rows.

The lock is held on its own connection in autocommit mode, so the waiting pod
never sits "idle in transaction" (which a database server may cut off), and it
is released automatically if the pod dies -- PostgreSQL drops a session's
advisory locks when the connection closes.

Any failure exits non-zero. ``entrypoint.sh`` then stops before uvicorn
starts, so a half-migrated database is never served and the pods already
running keep serving.
"""
from __future__ import annotations

import hashlib
import sys
import time
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.pool import NullPool

BACKEND_DIR = Path(__file__).resolve().parents[2]

#: Fixed 64-bit key, derived from a name so it is recognisable and stable.
LOCK_KEY = int.from_bytes(hashlib.sha256(b"uep-migrations").digest()[:8], "big", signed=True)

POLL_SECONDS = 2.0
WAITING_REPEAT_SECONDS = 30.0


class LockTimeout(Exception):
    pass


def _say(message: str) -> None:
    print(f"[migrate] {message}", flush=True)


def apply_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")


def seed_reference_data() -> None:
    from app.core.bootstrap import init_db

    init_db()


def acquire(conn, timeout_seconds: float, say: Callable[[str], None] = _say,
            poll_seconds: float = POLL_SECONDS) -> None:
    """Take the advisory lock on *conn*, waiting up to *timeout_seconds*."""
    started = time.monotonic()
    last_said = None
    while True:
        if conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar():
            return
        waited = time.monotonic() - started
        if waited >= timeout_seconds:
            raise LockTimeout(
                f"Gave up after {int(timeout_seconds)} s waiting for another pod to "
                "finish migrations. If no other backend pod is starting, a stuck "
                "session may hold the lock: ask the database team to look for a "
                f"session holding advisory lock {LOCK_KEY} in pg_locks. "
                "Raise MIGRATION_LOCK_TIMEOUT_SECONDS if migrations are simply slow."
            )
        if last_said is None or time.monotonic() - last_said >= WAITING_REPEAT_SECONDS:
            say(f"Waiting for another pod to finish migrations ({int(waited)} s so far)...")
            last_said = time.monotonic()
        time.sleep(poll_seconds)


def run(
    url: URL | str,
    timeout_seconds: float,
    migrate: Callable[[], None] = apply_migrations,
    seed: Callable[[], None] = seed_reference_data,
    say: Callable[[str], None] = _say,
    poll_seconds: float = POLL_SECONDS,
) -> None:
    engine = create_engine(url, poolclass=NullPool)
    try:
        if engine.dialect.name != "postgresql":
            # SQLite (tests, a laptop experiment): one process, nothing to race.
            migrate()
            seed()
            return
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            acquire(conn, timeout_seconds, say=say, poll_seconds=poll_seconds)
            say("Migration lock taken.")
            try:
                say("Applying database migrations...")
                migrate()
                say("Migrations applied.")
                say("Seeding reference data...")
                seed()
                say("Reference data present.")
            finally:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
                say("Migration lock released.")
    finally:
        engine.dispose()


def main() -> int:
    from app.core.config import get_settings

    settings = get_settings()
    try:
        run(settings.sqlalchemy_url, settings.migration_lock_timeout_seconds)
    except LockTimeout as exc:
        print(f"[migrate] ERROR: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
