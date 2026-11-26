"""The two UEP-25 daily jobs, run inside the backend (no CronJob: prd-uep has
no quota for one).

* Take the System health snapshot (yesterday's, final; today's, so far).
* Delete expired access exceptions, logging each (they already stopped
  working at their expiry: core/access.py ignores them).

Every backend pod runs the loop, hourly. A PostgreSQL advisory lock, taken
for the transaction, lets only one pod do the work at a time; the others skip
that round. Both jobs are idempotent, so running hourly rather than once a
day only keeps today's snapshot fresh.

Turned off with ``UEP_DAILY_JOBS=off`` (the test suite, one-off scripts).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("uep.daily_jobs")

LOCK_KEY = int.from_bytes(hashlib.sha256(b"uep-daily-jobs").digest()[:8], "big", signed=True)
INTERVAL_SECONDS = 3600
FIRST_RUN_AFTER_SECONDS = 90


def enabled() -> bool:
    return os.environ.get("UEP_DAILY_JOBS", "on").lower() not in ("off", "0", "false", "no")


def _take_lock(db: Session) -> bool:
    if db.get_bind().dialect.name != "postgresql":
        return True  # SQLite: one process, nothing to coordinate.
    return bool(db.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": LOCK_KEY}).scalar())


def run_once(db: Session, now: datetime | None = None) -> dict | None:
    """Run both jobs if this pod gets the lock. Returns what was done, or None
    when another pod holds the lock."""
    from app.services import access_admin, system_health

    now = now or datetime.now(timezone.utc)
    if not _take_lock(db):
        db.rollback()
        return None
    expired = access_admin.expire_overrides(db, now)
    today = now.date()
    system_health.take_snapshot(db, today - timedelta(days=1))
    system_health.take_snapshot(db, today)
    db.commit()  # Also releases the transaction-scoped lock.
    if expired:
        log.info("expired access exceptions removed", extra={"count": expired})
    return {"expired_exceptions": expired, "snapshot": today.isoformat()}


def _run_in_thread() -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        run_once(db)
    except Exception:  # noqa: BLE001 - one bad round must not stop the loop
        db.rollback()
        log.exception("daily jobs failed; will retry next round")
    finally:
        db.close()


async def loop() -> None:
    await asyncio.sleep(FIRST_RUN_AFTER_SECONDS)
    while True:
        await asyncio.to_thread(_run_in_thread)
        await asyncio.sleep(INTERVAL_SECONDS)
