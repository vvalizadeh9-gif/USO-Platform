"""HC Pool waiting_since / days_waiting (Commit 2, D5).

health_check.get_basket() is exercised directly against seeded records,
bypassing HTTP and role scoping -- the only thing under test is the date
math: a round-1 site waits from its CPM launch date, a returning site waits
from its last fix's closed_at, the basket sorts oldest-first, and a round-1
site with no launch date on file gets no waiting_since at all rather than a
substitute.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_hc_basket_waiting_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.jalali import format_shamsi  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from app.services import health_check as hc  # noqa: E402
from tests.conftest import create_schema  # noqa: E402


@pytest.fixture(scope="module")
def db():
    path = "/tmp/uep_hc_basket_waiting_pytest.db"
    if os.path.exists(path):
        os.remove(path)
    create_schema()
    from app.main import app

    # The province/role/problem-category seed data these fixtures rely on is
    # written by the app's startup bootstrap, not by create_schema() alone.
    with TestClient(app):
        session = SessionLocal()
        yield session
        session.close()


def _province(db):
    from app.models.reference import Province

    return db.query(Province).first()


def _site(db, code):
    from app.models.workitem import Site

    site = Site(site_code=code, province_id=_province(db).id)
    db.add(site)
    db.flush()
    return site


def _round_one_work_item(db, code, launch_date=None):
    from app.models.workitem import WorkItem

    site = _site(db, code)
    wi = WorkItem(
        site_id=site.id,
        site_type="Greenfield",
        requested_technology="2G",
        last_stage=C.STAGE_PERM_ONAIR,
        launch_date_shamsi=format_shamsi(launch_date) if launch_date else None,
    )
    db.add(wi)
    db.commit()
    return wi


def _returning_work_item(db, code, closed_at):
    """A site whose one and only fix closed at ``closed_at`` -- round 2."""
    from app.models.health_check import HcAssignment, HcRemediation, HcTask
    from app.models.reference import Contractor, ProblemCategory, Role
    from app.models.workitem import WorkItem

    site = _site(db, code)
    wi = WorkItem(
        site_id=site.id, site_type="Greenfield", requested_technology="2G",
        last_stage=C.STAGE_PERM_ONAIR,
    )
    db.add(wi)
    db.flush()

    contractor = db.query(Contractor).first()
    if contractor is None:
        contractor = Contractor(name="Ariana Telecom", type="drive_test")
        db.add(contractor)
        db.flush()

    assignment = HcAssignment(
        code=f"HCA-{code}", contractor_id=contractor.id,
        assigned_at=closed_at - timedelta(days=2),
    )
    db.add(assignment)
    db.flush()

    task = HcTask(
        hc_assignment_id=assignment.id, work_item_id=wi.id, round_no=1,
        overall_result="NotReady",
        completed_at=closed_at - timedelta(days=1),
        reviewed_at=closed_at - timedelta(days=1),
    )
    db.add(task)
    db.flush()

    category = db.query(ProblemCategory).first()
    owner_role = db.query(Role).first()
    remediation = HcRemediation(
        hc_task_id=task.id, work_item_id=wi.id,
        problem_category_id=category.id, owner_role_id=owner_role.id,
        opened_at=closed_at - timedelta(days=1), closed_at=closed_at,
    )
    db.add(remediation)
    db.commit()
    return wi


def test_round_one_site_waits_from_its_cpm_launch_date(db):
    launch = (datetime.now(timezone.utc) - timedelta(days=10)).date()
    wi = _round_one_work_item(db, "WAIT-R1", launch_date=launch)

    basket = hc.get_basket(db, None, work_items=[wi])

    assert len(basket) == 1
    row = basket[0]
    assert row["round_no"] == 1
    assert row["waiting_since"] is not None
    assert row["days_waiting"] == 10


def test_round_one_site_with_no_launch_date_has_no_waiting_since(db):
    wi = _round_one_work_item(db, "WAIT-NODATE")

    basket = hc.get_basket(db, None, work_items=[wi])

    row = basket[0]
    assert row["waiting_since"] is None
    assert row["days_waiting"] is None


def test_returning_site_waits_from_its_last_fixs_closed_at(db):
    closed = datetime.now(timezone.utc) - timedelta(days=3)
    wi = _returning_work_item(db, "WAIT-R2", closed_at=closed)

    basket = hc.get_basket(db, None, work_items=[wi])

    row = basket[0]
    assert row["round_no"] == 2
    assert row["days_waiting"] == 3


def test_basket_sorts_oldest_first(db):
    recent = _round_one_work_item(
        db, "WAIT-ORDER-RECENT",
        launch_date=(datetime.now(timezone.utc) - timedelta(days=1)).date(),
    )
    oldest = _round_one_work_item(
        db, "WAIT-ORDER-OLDEST",
        launch_date=(datetime.now(timezone.utc) - timedelta(days=20)).date(),
    )
    unknown = _round_one_work_item(db, "WAIT-ORDER-UNKNOWN")

    basket = hc.get_basket(db, None, work_items=[recent, oldest, unknown])

    assert [b["work_item_id"] for b in basket] == [oldest.id, recent.id, unknown.id]
