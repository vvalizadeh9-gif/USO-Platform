"""Migrations under a PostgreSQL advisory lock (UEP-23 5.3).

Two backend pods starting together must not both migrate. These tests run the
real lock against a real PostgreSQL, with the migration and seeding steps
replaced by recorders, so they show exactly who ran what and when. Skipped
unless ``UEP_TEST_POSTGRES_URL`` is set (CI sets it).
"""
import os
import threading
import time

import pytest
import sqlalchemy as sa

from app.scripts.migrate_with_lock import LOCK_KEY, LockTimeout, run

PG_URL = os.environ.get("UEP_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="UEP_TEST_POSTGRES_URL not set")


def test_two_concurrent_runs_take_turns_and_only_one_migrates():
    state = {"migrated": False, "inside": 0, "max_inside": 0, "migrations": 0, "seeds": 0}
    guard = threading.Lock()
    messages: list[str] = []
    errors: list[BaseException] = []

    def enter():
        with guard:
            state["inside"] += 1
            state["max_inside"] = max(state["max_inside"], state["inside"])

    def leave():
        with guard:
            state["inside"] -= 1

    def migrate():
        enter()
        try:
            if not state["migrated"]:  # "alembic upgrade head" finds nothing the second time
                time.sleep(1.5)
                state["migrated"] = True
                state["migrations"] += 1
        finally:
            leave()

    def seed():
        enter()
        try:
            state["seeds"] += 1
        finally:
            leave()

    def pod():
        try:
            run(PG_URL, timeout_seconds=30, migrate=migrate, seed=seed,
                say=messages.append, poll_seconds=0.1)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    pods = [threading.Thread(target=pod) for _ in range(2)]
    for p in pods:
        p.start()
    for p in pods:
        p.join(60)

    assert errors == []
    assert state["migrations"] == 1
    assert state["seeds"] == 2
    assert state["max_inside"] == 1, "the two pods overlapped inside the lock"
    assert any("Waiting for another pod to finish migrations" in m for m in messages)
    assert messages.count("Migration lock released.") == 2


def test_lock_timeout_gives_a_clear_error():
    holder = sa.create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    ran = []
    try:
        with holder.connect() as conn:
            assert conn.execute(sa.text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
            with pytest.raises(LockTimeout, match="waiting for another pod to finish migrations"):
                run(PG_URL, timeout_seconds=1, migrate=lambda: ran.append("m"),
                    seed=lambda: ran.append("s"), say=lambda m: None, poll_seconds=0.1)
            conn.execute(sa.text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
    finally:
        holder.dispose()
    assert ran == []


def test_a_failed_migration_releases_the_lock_and_propagates():
    def broken():
        raise RuntimeError("migration exploded")

    with pytest.raises(RuntimeError, match="migration exploded"):
        run(PG_URL, timeout_seconds=5, migrate=broken, seed=lambda: None, say=lambda m: None)

    engine = sa.create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            assert conn.execute(sa.text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
            conn.execute(sa.text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
    finally:
        engine.dispose()
