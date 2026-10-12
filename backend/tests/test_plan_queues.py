"""The monthly plan (PIP) queues, as Home and the digest count them.

The rules being checked (``action_queues/sources/plans.py``):

* PM: a Submitted plan and a RevisionRequested one wait on the PM; each goes
  away once decided.
* Contractor: a returned plan waits on them until they resubmit or the window
  closes (the covered month ends; for a revision, day 15); and a stream with
  no plan filed is missing once the running month's deadline (day 3) has
  passed.
* Each queue reaches only its role and, for a contractor, only its own
  company. Admin and Coordinator own neither queue.

These rules were tested through the Action Center's summary feed until that
feed was removed; they are tested here against the services that remain.

The clock is ``jalali.tehran_today``; the running month is 1407/5.

Run with:  cd backend && pytest tests/test_plan_queues.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_plan_queues_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

RUNNING = (1407, 5)
PLANNING = (1407, 6)


@pytest.fixture(scope="module")
def db():
    if os.path.exists("/tmp/uep_plan_queues_pytest.db"):
        os.remove("/tmp/uep_plan_queues_pytest.db")
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _day(day, period=RUNNING):
    return jalali.from_shamsi_date(*period, day)


@pytest.fixture(scope="module")
def world(db):
    from app.models.monthly_plan import ContractorMonthlyPlan
    from app.models.reference import Contractor

    a = Contractor(name="Alpha PQ", type="drive_test", active=True)
    b = Contractor(name="Beta PQ", type="drive_test", active=True)
    db.add_all([a, b])
    db.flush()

    def _plan(c, stream, period, version, status, count, current=True, comment=None):
        p = ContractorMonthlyPlan(
            contractor_id=c.id, stream=stream, shamsi_year=period[0], shamsi_month=period[1],
            version=version, is_current=current, committed_count=count, status=status,
            return_comment=comment,
        )
        db.add(p)
        db.flush()
        return p.id

    ids = {
        # Waiting on the PM.
        "a_dt_planning": _plan(a, "DT", PLANNING, 1, "Submitted", 40),
        "b_dt_revision": _plan(b, "DT", RUNNING, 2, "RevisionRequested", 30),
        # Already decided: never waiting.
        "a_dt_running": _plan(a, "DT", RUNNING, 1, "Approved", 38),
        # Alpha's Acceptance revision was returned in the running month.
        "a_acc_running": _plan(a, "ACCEPTANCE", RUNNING, 2, "RevisionReturned", 12, comment="Keep 15."),
        # Beta's Acceptance for next month was returned.
        "b_acc_planning": _plan(b, "ACCEPTANCE", PLANNING, 1, "Returned", 9, comment="Too low."),
        # A returned plan for a month long gone: its window has closed.
        "a_dt_old": _plan(a, "DT", (1407, 2), 1, "Returned", 5, comment="Old news."),
    }
    _plan(b, "DT", RUNNING, 1, "Approved", 35, current=False)
    db.commit()
    return {"ids": ids, "a": a.id, "b": b.id}


def _awaiting_pm(db):
    from app.services.action_queues.sources import plans

    return {plan.id for plan, _name in plans.plans_awaiting_pm(db)}


def _gaps(db, contractor_id, today):
    from app.services.action_queues.sources import plans

    return plans.contractor_plan_gaps(db, contractor_id, today)


# ---------------------------------------------------------------------------
# PM
# ---------------------------------------------------------------------------
def test_pm_sees_plans_and_revisions_waiting(db, world):
    ids = world["ids"]
    assert _awaiting_pm(db) == {ids["a_dt_planning"], ids["b_dt_revision"]}


def test_a_decided_plan_leaves_the_pm_list(db, world):
    from app.models.monthly_plan import ContractorMonthlyPlan

    plan = db.get(ContractorMonthlyPlan, world["ids"]["a_dt_planning"])
    plan.status = "Approved"
    db.commit()
    try:
        assert world["ids"]["a_dt_planning"] not in _awaiting_pm(db)
    finally:
        plan.status = "Submitted"
        db.commit()


@pytest.mark.parametrize(
    ("role", "owns"),
    [("PM", {"plans_approve"}), ("Contractor", {"plan_submit"}), ("Coordinator", set())],
)
def test_each_plan_queue_belongs_to_one_role(role, owns):
    from app.services.action_queues.registry import queues_for

    keys = {q.key for q in queues_for(role)}
    assert keys & {"plans_approve", "plan_submit"} == owns


# ---------------------------------------------------------------------------
# Contractor
# ---------------------------------------------------------------------------
def test_contractor_sees_its_own_returned_plan(db, world):
    gaps = _gaps(db, world["a"], _day(10))
    # The running month's returned revision; not the long-gone month, and
    # never Beta's.
    assert {p.id for p in gaps.returned} == {world["ids"]["a_acc_running"]}
    assert gaps.returned[0].return_comment == "Keep 15."


def test_a_returned_revision_clears_when_the_window_closes(db, world):
    assert _gaps(db, world["a"], _day(16)).returned == []


def test_other_contractor_sees_only_its_own(db, world):
    gaps = _gaps(db, world["b"], _day(10))
    assert {p.id for p in gaps.returned} == {world["ids"]["b_acc_planning"]}


def test_missing_streams_are_per_stream(db, world):
    # Alpha filed DT for the running month (approved) and Acceptance (a
    # returned revision is still a plan); only ICT and CRA are missing.
    assert _gaps(db, world["a"], _day(4)).missing == ["ICT", "CRA"]
    # Beta filed DT (a pending revision) but no Acceptance plan this month.
    assert _gaps(db, world["b"], _day(4)).missing == ["ACCEPTANCE", "ICT", "CRA"]


def test_the_queue_waits_for_the_deadline(db, world):
    """Before day 3 is over a missing stream is pending but not late."""
    from datetime import datetime, timezone

    from app.services.action_queues.board import queue_summaries
    from app.services.action_queues.context import QueueContext
    from app.services.action_queues.registry import QUEUES_BY_KEY
    from app.models.reference import User

    pm = db.query(User).filter(User.username == "admin").one()
    queue = QUEUES_BY_KEY["plan_submit"]
    on_day_2 = datetime.combine(_day(2), datetime.min.time(), tzinfo=timezone.utc)
    summary = queue_summaries(QueueContext(db, pm, on_day_2), [queue])[0]
    assert summary.count > 0
    assert summary.overdue == 0


def test_filing_clears_missing(db, world):
    from app.models.monthly_plan import ContractorMonthlyPlan

    filed = [
        ContractorMonthlyPlan(
            contractor_id=world["b"], stream=stream, shamsi_year=RUNNING[0],
            shamsi_month=RUNNING[1], version=1, is_current=True, committed_count=4,
            status="Submitted",
        )
        for stream in ("ACCEPTANCE", "ICT", "CRA")
    ]
    db.add_all(filed)
    db.commit()
    try:
        assert _gaps(db, world["b"], _day(4)).missing == []
    finally:
        for plan in filed:
            db.delete(plan)
        db.commit()
