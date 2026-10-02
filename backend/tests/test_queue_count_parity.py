"""Every queue badge equals the length of the list it summarises.

The badges used to be computed by building each list and taking its length,
which made agreement automatic and every click slow. They are now counted from
the few columns each condition reads (``hc_queues.counts``), so agreement is a
property that has to be tested -- this is that test.

It builds a deliberately untidy programme: sites in and out of the on-air
stages, drive tests done and not, several completed rounds per site, ties in
completion time, open and closed fixes, disputed categories, duplicate active
assignments, drive tests in every status, deleted sites, sites in a province
the scoped user cannot see. Then, for every kind of user whose scope rules
differ, it asks for the counts both ways and requires them to match.

If this fails after a change to one of the list functions in
``app/services/hc_queues.py`` or ``get_basket``, make the same change to the
matching count.
"""
import os
import random
import sys
from datetime import datetime, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_count_parity_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.core import count_cache  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema  # noqa: E402
from tests.programme_seed import seed_programme  # noqa: E402

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def db():
    if os.path.exists("/tmp/uep_count_parity_pytest.db"):
        os.remove("/tmp/uep_count_parity_pytest.db")
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    session = SessionLocal()
    try:
        seed_programme(session, random.Random(20260926))
        yield session
    finally:
        session.close()


def _by_lists(db, user):
    from app.services import hc_queues
    from app.services.health_check import get_basket

    basket = get_basket(db, user)
    return {
        "pool": len(basket),
        "pool_assignable": sum(1 for b in basket if b["assignable"]),
        "in_progress": sum(r["sites_pending"] for r in hc_queues.in_progress(db, user)),
        "hc_in_progress_late": sum(
            1
            for r in hc_queues.in_progress(db, user)
            if r["days_outstanding"] > hc_queues.HC_LATE_AFTER_DAYS
        ),
        "hc_review": hc_queues._hc_review_count(db, user),
        "remediation": len(hc_queues.remediations(db, user)),
        "reroutes": len(hc_queues.reroutes(db, user)),
        "dt_assignment": len(hc_queues.dt_assignment(db, user)),
        "dt_in_progress": len(hc_queues.dt_in_progress(db, user)),
        "dt_review": len(hc_queues.dt_review(db, user)),
    }


def _user(db, username):
    from app.models.reference import User

    return db.query(User).filter(User.username == username).one()


@pytest.mark.parametrize(
    "username", ["p_pm", "p_coord_home", "p_sc0", "p_sc1", "p_power"]
)
def test_queue_counts_match_the_lists(db, username):
    from app.services import hc_queues

    user = _user(db, username)
    expected = _by_lists(db, user)
    assert hc_queues.counts(db, user) == expected
    # The data must actually exercise the conditions, or equal zeros would
    # pass this test for any implementation.
    if username == "p_pm":
        assert all(v > 0 for v in expected.values()), expected


@pytest.mark.parametrize("username", ["p_sc0", "p_sc1", "p_pm"])
def test_contractor_counts_match_the_lists(db, username):
    from app.services import hc_queues

    user = _user(db, username)
    expected = {
        "todo": len(hc_queues.contractor_dt_todo(db, user)),
        "submitted": len(hc_queues.contractor_dt_submitted(db, user)),
    }
    assert hc_queues.contractor_dt_counts(db, user) == expected
    if username == "p_sc0":
        assert all(v > 0 for v in expected.values()), expected


def test_a_commit_is_seen_by_the_next_count(db):
    """The cache must never hide an action: a commit empties it."""
    from app.models.workitem import DriveTest
    from app.services import hc_queues

    user = _user(db, "p_pm")
    before = hc_queues.counts(db, user)["dt_review"]

    dt = db.query(DriveTest).filter(
        DriveTest.is_active.is_(True), DriveTest.status == "Submitted"
    ).first()
    dt.status = "Approved"
    db.commit()

    assert hc_queues.counts(db, user)["dt_review"] == before - 1
    assert hc_queues.counts(db, user) == _by_lists(db, user)


def test_the_cache_hands_out_copies():
    """The Action Center renames a key in the dict it is given; the next
    caller must not see that."""
    count_cache.clear()
    first = count_cache.get_or_compute("k", lambda: {"pool": 1})
    first.pop("pool")
    assert count_cache.get_or_compute("k", lambda: {"pool": 2}) == {"pool": 1}
