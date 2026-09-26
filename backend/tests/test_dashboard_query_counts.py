"""The dashboards' database work must not grow with the number of sites.

The Acceptance trend once issued one query per drive-tested work item: its
villages outlived the work items they were loaded through, so reading a
village's requested technologies fetched its work item again, one at a time
-- thousands of round trips on a real programme, and most of the ten seconds
the page took. Nothing about the figures was wrong, which is why no other test
noticed.

This counts the queries each dashboard computation issues at two sizes of
programme, and requires the count to stay the same. It does not assert a
number: only that doubling the sites does not add queries.
"""
import os
import sys
from contextlib import contextmanager
from datetime import date

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dashboard_queries_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON, event  # noqa: E402

_pg.JSONB = JSON

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.deps import PM  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

_added = 0


@pytest.fixture(scope="module")
def db():
    if os.path.exists("/tmp/uep_dashboard_queries_pytest.db"):
        os.remove("/tmp/uep_dashboard_queries_pytest.db")
    create_schema()
    from app.core.bootstrap import init_db
    from app.models.reference import Role, User

    init_db()
    session = SessionLocal()
    session.add(User(
        username="q_pm", password_hash="x", first_name="Q", family_name="PM",
        role_id=session.query(Role).filter(Role.name == PM).one().id,
        sees_all_provinces=True, status=user_status.ACTIVE,
    ))
    session.commit()
    try:
        yield session
    finally:
        session.close()


def _add_sites(db, n):
    """*n* drive-tested, on-air sites, each with two approved villages."""
    global _added
    from app.models.acceptance import Acceptance
    from app.models.reference import Province
    from app.models.workitem import Site, Village, WorkItem

    province = db.query(Province).order_by(Province.id).first()
    for _ in range(n):
        _added += 1
        site = Site(site_code=f"QRY-{_added:05d}", province_id=province.id)
        db.add(site)
        db.flush()
        wi = WorkItem(
            site_id=site.id, site_type="Macro", requested_technology="2G/4G",
            last_stage=C.STAGE_PERM_ONAIR, dt_status="Done",
            dt_date_gregorian=date(2026, 3, 1),
        )
        db.add(wi)
        db.flush()
        for v in range(2):
            village = Village(
                work_item_id=wi.id, village_code=f"Q{_added}-{v}",
                village_name=f"Q {_added} {v}", target_classification="هدف",
            )
            db.add(village)
            db.flush()
            for tech in ("2G", "4G"):
                db.add(Acceptance(
                    village_id=village.id, technology=tech,
                    ict_status="Approved", ict_date=date(2026, 4, 1),
                    cra_status="Approved", cra_date=date(2026, 5, 1),
                ))
    db.commit()


@contextmanager
def _counting():
    seen = []

    def count(*_args, **_kwargs):
        seen.append(1)

    event.listen(engine, "before_cursor_execute", count)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", count)


def _queries(db, compute):
    from app.models.reference import User

    # A fresh identity map each time, so nothing is answered from objects a
    # previous call happened to leave loaded.
    db.expunge_all()
    user = db.query(User).filter(User.username == "q_pm").one()
    _ = user.role, user.provinces
    with _counting() as seen:
        compute(db, user)
    return len(seen)


def _acceptance_overview(db, user):
    from app.services.acceptance_analytics import AcceptanceAnalytics

    AcceptanceAnalytics(db, user).build()


def _acceptance_trend(db, user):
    from app.services import acceptance_plan

    acceptance_plan.monthly_approval_trend(
        db, user, province_ids=None, contractor_id=None, months=12
    )


def _dt_overview(db, user):
    from app.services.drive_test_analytics import DriveTestAnalytics

    analytics = DriveTestAnalytics(db, user)
    analytics.compute_kpis()
    analytics.breakdowns()
    analytics.chart_progress_by_province()
    analytics.monthly_flow()


@pytest.mark.parametrize(
    "compute", [_acceptance_overview, _acceptance_trend, _dt_overview]
)
def test_queries_do_not_grow_with_the_programme(db, compute):
    _add_sites(db, 10)
    small = _queries(db, compute)
    _add_sites(db, 20)
    large = _queries(db, compute)
    assert large == small, (
        f"{compute.__name__}: {small} queries for 10 sites, {large} for 30 -- "
        "something is being loaded one site at a time"
    )
