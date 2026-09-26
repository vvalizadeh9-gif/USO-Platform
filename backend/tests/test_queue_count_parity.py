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
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_count_parity_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.core import count_cache, user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import CONTRACTOR, COORDINATOR, CPG_POWER, PM  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

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
        _seed(session, random.Random(20260926))
        yield session
    finally:
        session.close()


def _seed(db, rng, sites=160):
    from app.models.health_check import (
        HcAssignment,
        HcRemediation,
        HcTask,
    )
    from app.models.reference import Contractor, ProblemCategory, Province, Role, User
    from app.models.workitem import Assignment, DriveTest, Site, WorkItem

    contractors = [Contractor(name=f"Parity Co {n}", type="drive_test") for n in range(2)]
    db.add_all(contractors)
    db.flush()

    home, away = db.query(Province).order_by(Province.id).limit(2).all()
    categories = db.query(ProblemCategory).order_by(ProblemCategory.id).all()
    roles = {r.name: r for r in db.query(Role).all()}

    def user(username, role, **kw):
        u = User(
            username=username, password_hash="x", first_name=username,
            family_name="Parity", role_id=roles[role].id,
            status=user_status.ACTIVE, **kw,
        )
        db.add(u)
        return u

    user("p_pm", PM, sees_all_provinces=True)
    scoped = user("p_coord_home", COORDINATOR, sees_all_provinces=False)
    scoped.provinces = [home]
    user("p_sc0", CONTRACTOR, sees_all_provinces=False, contractor_id=contractors[0].id)
    user("p_sc1", CONTRACTOR, sees_all_provinces=False, contractor_id=contractors[1].id)
    user("p_power", CPG_POWER, sees_all_provinces=True)
    db.flush()

    stages = [C.STAGE_PERM_ONAIR, C.STAGE_TEMP_ONAIR, "perm on air", None, "Construction"]
    dt_statuses = [None, "Done", "done ", "Ongoing", "Problematic"]
    hc_assignments = [
        HcAssignment(
            code=f"PAR-{n}", contractor_id=rng.choice(contractors).id,
            assigned_at=T0 + timedelta(days=n), status="Open",
        )
        for n in range(8)
    ]
    db.add_all(hc_assignments)
    db.flush()

    for n in range(sites):
        site = Site(site_code=f"PAR-{n:04d}", province_id=(home if n % 3 else away).id)
        db.add(site)
        db.flush()
        wi = WorkItem(
            site_id=site.id, site_type="Greenfield", requested_technology="2G/4G",
            last_stage=rng.choice(stages), dt_status=rng.choice(dt_statuses),
            dt_sc_contractor_id=rng.choice([None, contractors[0].id]),
            deleted_at=T0 if n % 23 == 0 else None,
        )
        db.add(wi)
        db.flush()

        # Health-check rounds: some completed (with repeated completion
        # times, to exercise the tie rule), maybe one still open.
        # A site is in an assignment at most once, so each round draws its
        # own assignment.
        rounds = iter(rng.sample(hc_assignments, 4))
        completed_times = [T0 + timedelta(days=rng.choice([1, 2, 2, 3])) for _ in range(rng.randint(0, 3))]
        for i, when in enumerate(completed_times):
            result = rng.choice(["Ready", "NotReady"])
            task = HcTask(
                hc_assignment_id=next(rounds).id, work_item_id=wi.id,
                round_no=i + 1, overall_result=result, completed_at=when,
                reviewed_at=when if rng.random() < 0.6 else None,
            )
            db.add(task)
            db.flush()
            if result == "NotReady" and rng.random() < 0.7:
                # One fix per category per task.
                for cat in rng.sample(categories, rng.randint(1, 2)):
                    db.add(HcRemediation(
                        hc_task_id=task.id, work_item_id=wi.id,
                        problem_category_id=cat.id, owner_role_id=cat.owner_role_id,
                        opened_at=when, due_at=when + timedelta(days=7),
                        closed_at=when if rng.random() < 0.5 else None,
                        reroute_to_category_id=(
                            rng.choice(categories).id if rng.random() < 0.3 else None
                        ),
                        reroute_at=when,
                    ))
        if rng.random() < 0.3:
            db.add(HcTask(
                hc_assignment_id=next(rounds).id, work_item_id=wi.id,
                round_no=len(completed_times) + 1,
            ))

        # Drive-test assignments: none, one, or two active at once, some
        # handed back, some inactive history.
        for _ in range(rng.choice([0, 0, 1, 1, 2])):
            db.add(Assignment(
                work_item_id=wi.id, assignment_type="official",
                contractor_id=rng.choice(contractors).id, assigned_at=T0,
                is_active=rng.random() < 0.8,
                returned_at=T0 if rng.random() < 0.25 else None,
            ))
        for _ in range(rng.choice([0, 0, 1, 2])):
            db.add(DriveTest(
                work_item_id=wi.id,
                status=rng.choice(["Submitted", "Approved", "Rejected", "Returned"]),
                submitted_at=T0, is_active=rng.random() < 0.8,
            ))
        db.flush()
    db.commit()


def _by_lists(db, user):
    from app.services import hc_queues
    from app.services.health_check import get_basket

    basket = get_basket(db, user)
    return {
        "pool": len(basket),
        "pool_assignable": sum(1 for b in basket if b["assignable"]),
        "in_progress": sum(r["sites_pending"] for r in hc_queues.in_progress(db, user)),
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
