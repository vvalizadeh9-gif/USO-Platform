"""Every ticket's count equals the screen its link opens, for every role.

The registry's fetches call the list functions behind each queue screen, so
agreement should hold by construction. This test is what keeps it that way.
On the untidy programme from ``programme_seed`` (plus villages in every
acceptance state, request letters, plans and CPM changes), for each kind of
user it compares each ticket with the screen's own read:

==================  ========================================================
ticket              the screen's read
==================  ========================================================
hc_assign           the HC Pool, "Ready to assign" filter
hc_review           ``GET /hc/results?reviewed=false``
hc_reroutes         the Re-routes tab
hc_submit           the legacy "Health Checks To Submit" counter
hc_fixes            My Fix Queue
dt_assign / review  the Drive Test tabs
dt_todo / redo      My Drive Tests' To Do tab, by row status
ict_* / cra_*       My Work's tab count for that authority (``limit=0``)
plans_approve       the legacy "Plans To Approve" rows
cpm_changes         the legacy CPM rows
plan_submit         the contractor's open plan gaps
==================  ========================================================

It also checks scope: a coordinator never sees another province's work, and a
contractor never sees another contractor's.
"""
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_action_board_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import COORDINATOR  # noqa: E402
from tests.conftest import create_schema  # noqa: E402
from tests.programme_seed import T0, seed_programme  # noqa: E402

STORED = ["NotFiled", "Pending", "Returned", "Rejected", "Approved"]


@pytest.fixture(scope="module")
def db():
    if os.path.exists("/tmp/uep_action_board_pytest.db"):
        os.remove("/tmp/uep_action_board_pytest.db")
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    session = SessionLocal()
    try:
        rng = random.Random(20261001)
        seed_programme(session, rng)
        _seed_acceptance_and_plans(session, rng)
        yield session
    finally:
        session.close()


def _seed_acceptance_and_plans(db, rng):
    from app.models.acceptance import CpmChangeRequest, CpmImportBatch
    from app.models.acceptance_workflow import (
        AcceptanceAuthorityRequest,
        AcceptanceSubmission,
    )
    from app.models.monthly_plan import PLAN_STREAMS, ContractorMonthlyPlan
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, Village, WorkItem

    # A coordinator for each province, so every staff item has an owner and
    # scope leaks are visible as the wrong owner.
    home, away = db.query(Province).order_by(Province.id).limit(2).all()
    coord_role = db.query(Role).filter(Role.name == COORDINATOR).one()
    away_coord = User(
        username="p_coord_away", password_hash="x", first_name="Away",
        family_name="Coordinator", role_id=coord_role.id,
        status=user_status.ACTIVE, sees_all_provinces=False,
    )
    db.add(away_coord)
    db.flush()
    away_coord.provinces = [away]
    home.coordinator_user_id = db.query(User).filter(User.username == "p_coord_home").one().id
    away.coordinator_user_id = away_coord.id

    # Villages in every pair of side states, with the rounds behind them.
    work_items = (
        db.query(WorkItem).join(Site).filter(WorkItem.deleted_at.is_(None)).all()
    )
    for wi in work_items:
        if not rng.random() < 0.5:
            continue
        # Acceptance follows a finished drive test: My Work lists only هدف
        # villages on sites whose drive test is Done.
        wi.dt_status = "Done"
        wi.dt_date_gregorian = rng.choice([None, date(2025, 3, 1), date(2026, 9, 28)])
        for n in range(rng.randint(1, 3)):
            village = Village(
                work_item_id=wi.id, village_code=f"V{wi.id}-{n}",
                village_name=f"Village {wi.id}-{n}", target_classification="هدف",
                ict_status=rng.choice(STORED), cra_status=rng.choice(STORED),
            )
            db.add(village)
            db.flush()
            for authority, status in (("ICT", village.ict_status), ("CRA", village.cra_status)):
                _seed_side(db, rng, village, authority, status, AcceptanceSubmission,
                           AcceptanceAuthorityRequest)

    # Plans: one contractor with gaps and a returned plan, PM decisions waiting.
    from app.core import jalali

    year, month = jalali.to_shamsi_date(jalali.tehran_today())[:2]
    contractors = db.query(Contractor).filter(Contractor.name.like("Parity Co%")).all()
    for stream, status in zip(PLAN_STREAMS[:3], ["Submitted", "Returned", "RevisionRequested"], strict=True):
        db.add(ContractorMonthlyPlan(
            contractor_id=contractors[0].id, stream=stream, shamsi_year=year,
            shamsi_month=month, status=status, committed_count=10,
            submitted_at=T0, is_current=True,
        ))

    batch = CpmImportBatch(filename="parity.xlsx")
    db.add(batch)
    db.flush()
    for wi in work_items[:12]:
        db.add(CpmChangeRequest(
            import_batch_id=batch.id, work_item_id=wi.id, site_code=wi.site.site_code,
            field_name="dt_status", status="Pending",
        ))
    db.commit()


def _seed_side(db, rng, village, authority, status, Submission, Request):
    sent = datetime(2026, 9, rng.randint(1, 28), tzinfo=timezone.utc)
    if status in ("NotFiled", "Rejected") and rng.random() < 0.5:
        db.add(Request(village_id=village.id, authority=authority, sent_at=sent))
        if rng.random() < 0.3:
            # Answered by a submission recorded after it: no longer open.
            db.add(Submission(
                village_id=village.id, authority=authority, round_no=9,
                letter_number="ANS", source="Contractor", review_status="Withdrawn",
                submitted_at=sent + timedelta(days=1),
            ))
            db.add(Request(village_id=village.id, authority=authority,
                           sent_at=sent - timedelta(days=30)))
    if status == "NotFiled":
        return
    review = {"Pending": "Pending", "Returned": "Returned"}.get(status, "Validated")
    db.add(Submission(
        village_id=village.id, authority=authority, round_no=1, letter_number="L-1",
        source="Contractor", review_status=review, submitted_at=sent - timedelta(days=3),
        reviewed_at=None if review == "Pending" else sent - timedelta(days=2),
    ))


# --------------------------------------------------------------------------
# What each screen shows
# --------------------------------------------------------------------------
def _user(db, username):
    from app.models.reference import User

    return db.query(User).filter(User.username == username).one()


def _my_work_count(db, user, authority, tab):
    from app.services import my_work_query as query

    result = query.list_my_work(
        db, user, query.ListRequest(scope="remaining", tab=tab, authority=authority, limit=0)
    )
    return dict(result.tabs)[tab]


def _screen_count(db, user, key):  # noqa: C901 -- one branch per screen
    from app.api.health_check import hc_results
    from app.services import action_center as legacy
    from app.services import hc_queues
    from app.services import health_check as hc
    from app.services.action_queues.sources import plans
    from app.services.action_queues.sources.lifecycle import SENT_BACK, WITH_CONTRACTOR
    from app.core import jalali

    if key == "hc_assign":
        return sum(1 for b in hc.get_basket(db, user) if b["hc_state"] in ("New", "Ready for re-check"))
    if key == "hc_review":
        return len(hc_results(reviewed=False, limit=500, offset=0, db=db, user=user))
    if key == "hc_reroutes":
        return len(hc_queues.reroutes(db, user))
    if key == "hc_submit":
        return next((c.count for c in legacy.counters(db, user) if c.key == "hc_submit"), 0)
    if key == "hc_fixes":
        return len(hc.owner_queue(db, user))
    if key == "dt_assign":
        return len(hc_queues.dt_assignment(db, user))
    if key == "dt_review":
        return len(hc_queues.dt_review(db, user))
    if key in ("dt_todo", "dt_redo"):
        status = WITH_CONTRACTOR if key == "dt_todo" else SENT_BACK
        return sum(1 for r in hc_queues.contractor_dt_todo(db, user) if r["status"] == status)
    if key[:4] in ("ict_", "cra_"):
        tab = {
            "follow_up": "with_authority", "to_file": "not_filed", "to_validate": "filled",
            "refile": "new_letter", "returned": "returned",
        }[key[4:]]
        return _my_work_count(db, user, key[:3].upper(), tab)
    if key == "plans_approve":
        return len(legacy._pm_plan_items(db, user))
    if key == "cpm_changes":
        return len(legacy._cpm_change_request_items(db, user))
    if key == "plan_submit":
        gaps = plans.contractor_plan_gaps(db, user.contractor_id, jalali.tehran_today())
        return len(gaps.missing) + len(gaps.returned)
    raise AssertionError(f"no screen known for {key}")


def _tickets(db, user):
    from app.services.action_queues import board as boards
    from app.services.action_queues.context import QueueContext, board_role
    from app.services.action_queues.registry import queues_for

    ctx = QueueContext(db, user)
    return {s.queue.key: s for s in boards.queue_summaries(ctx, queues_for(board_role(user)))}


USERS = ["p_pm", "p_coord_home", "p_sc0", "p_sc1", "p_power"]


@pytest.mark.parametrize("username", USERS)
def test_every_ticket_matches_the_screen_it_opens(db, username):
    user = _user(db, username)
    tickets = _tickets(db, user)
    assert tickets, "every one of these roles has an Action Center"
    for key, ticket in tickets.items():
        assert ticket.count == _screen_count(db, user, key), key


@pytest.mark.parametrize(
    ("username", "must_be_live"),
    [
        ("p_pm", {"hc_assign", "hc_review", "hc_reroutes", "dt_assign", "dt_review",
                  "ict_follow_up", "cra_follow_up", "plans_approve", "cpm_changes"}),
        ("p_coord_home", {"hc_review", "dt_assign", "ict_to_file", "ict_to_validate",
                          "cra_to_file", "cra_to_validate"}),
        ("p_sc0", {"hc_submit", "dt_todo", "dt_redo", "ict_to_file", "ict_refile",
                   "ict_returned", "plan_submit"}),
        ("p_power", {"hc_fixes"}),
    ],
)
def test_the_data_exercises_every_queue(db, username, must_be_live):
    """Equal zeros would pass the parity test for any implementation."""
    tickets = _tickets(db, _user(db, username))
    empty = {k for k in must_be_live if tickets[k].count == 0}
    assert not empty, empty


def test_each_role_gets_exactly_its_queues(db):
    expected = {
        "p_pm": {"hc_assign", "hc_review", "hc_reroutes", "dt_assign", "dt_review",
                 "ict_follow_up", "cra_follow_up", "plans_approve", "cpm_changes"},
        "p_coord_home": {"hc_assign", "hc_review", "hc_reroutes", "dt_assign", "dt_review",
                         "ict_to_file", "ict_to_validate", "cra_to_file", "cra_to_validate"},
        "p_sc0": {"hc_submit", "dt_todo", "dt_redo", "ict_to_file", "ict_refile",
                  "ict_returned", "cra_to_file", "cra_refile", "cra_returned", "plan_submit"},
        "p_power": {"hc_fixes"},
    }
    for username, keys in expected.items():
        assert set(_tickets(db, _user(db, username))) == keys, username


# --------------------------------------------------------------------------
# Scope
# --------------------------------------------------------------------------
def _owners(db, username):
    from app.services.action_queues.context import QueueContext, board_role
    from app.services.action_queues.registry import queues_for

    user = _user(db, username)
    ctx = QueueContext(db, user)
    return {q.key: [i.owner for i in q.fetch(ctx)] for q in queues_for(board_role(user))}


def test_a_coordinator_never_sees_another_provinces_work(db):
    away = _user(db, "p_coord_away").id
    pm_owners = _owners(db, "p_pm")
    assert any(o and o.id == away for owners in pm_owners.values() for o in owners), (
        "the PM must see the other province's work, or this test proves nothing"
    )
    for key, owners in _owners(db, "p_coord_home").items():
        assert not any(o and o.type == "coordinator" and o.id == away for o in owners), key


def test_a_coordinators_tickets_are_a_subset_of_the_pms(db):
    pm = _tickets(db, _user(db, "p_pm"))
    for key, ticket in _tickets(db, _user(db, "p_coord_home")).items():
        if key in pm:
            assert ticket.count <= pm[key].count, key


@pytest.mark.parametrize("username", ["p_sc0", "p_sc1"])
def test_a_contractor_only_ever_holds_their_own_work(db, username):
    own = _user(db, username).contractor_id
    for key, owners in _owners(db, username).items():
        for owner in owners:
            if owner is not None and owner.type == "contractor":
                assert owner.id == own, key
        if key.startswith(("hc_", "dt_", "plan_")):
            assert all(o is not None and o.id == own for o in owners), key


# --------------------------------------------------------------------------
# Board shape and the per-owner breakdown
# --------------------------------------------------------------------------
def test_the_board_hides_empty_tickets_and_keeps_stage_order(db):
    from app.services.action_queues.board import build_board
    from app.services.action_queues.context import QueueContext

    board = build_board(QueueContext(db, _user(db, "p_coord_home")))
    keys = [s.key for s in board.stages]
    assert keys == [k for k in ("hc", "dt", "ict", "cra", "plans") if k in keys]
    assert "plans" not in keys, "a coordinator has no Plans column"
    for stage in board.stages:
        assert stage.tickets and all(t.count > 0 for t in stage.tickets)
        assert stage.total == sum(t.count for t in stage.tickets)
    assert board.pending == sum(s.total for s in board.stages)


def test_the_pm_sees_every_owner_and_a_coordinator_only_contractors(db):
    from app.services.action_queues.board import owners_breakdown
    from app.services.action_queues.context import QueueContext

    pm_rows = owners_breakdown(QueueContext(db, _user(db, "p_pm")), "dt_review")
    assert {r.owner_type for r in pm_rows} == {"coordinator"}
    assert len(pm_rows) == 2

    rows = owners_breakdown(QueueContext(db, _user(db, "p_coord_home")), "dt_todo")
    assert rows and {r.owner_type for r in rows} == {"contractor"}
    pm_todo = owners_breakdown(QueueContext(db, _user(db, "p_pm")), "dt_todo")
    assert sum(r.count for r in rows) <= sum(r.count for r in pm_todo)
    assert rows == sorted(rows, key=lambda r: (-r.overdue, -r.count, r.name))


def test_the_breakdown_is_refused_to_everyone_else(db):
    from app.services.action_queues.board import NotOnBoard, owners_breakdown
    from app.services.action_queues.context import QueueContext

    for username in ("p_sc0", "p_power"):
        with pytest.raises(NotOnBoard):
            owners_breakdown(QueueContext(db, _user(db, username)), "dt_todo")


def test_overdue_follows_the_configured_sla(db):
    from app.models.action_center import ActionQueueSla
    from app.services.action_queues.board import queue_summaries
    from app.services.action_queues.context import QueueContext
    from app.services.action_queues.registry import QUEUES_BY_KEY

    user = _user(db, "p_pm")
    queue = QUEUES_BY_KEY["dt_review"]
    later = datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(days=30)
    before = queue_summaries(QueueContext(db, user, later), [queue])[0]
    assert before.overdue == before.count > 0

    db.merge(ActionQueueSla(queue_key="dt_review", sla_days=365))
    db.commit()
    try:
        after = queue_summaries(QueueContext(db, user, later), [queue])[0]
        assert after.overdue == 0
    finally:
        db.query(ActionQueueSla).delete()
        db.commit()
