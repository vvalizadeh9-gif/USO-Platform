"""Action Center rows obey province scope, like every other read.

Three of its builders queried without any scope at all: health-check results
awaiting review, open remediations, and pending CPM change requests. Every
other read in the platform goes through ``visible_work_item_ids``, so this was
not a policy decision -- it was the one place row-level security was never
wired in. A coordinator granted a single province was shown the site code,
the round, the readiness and the problem category of work anywhere in the
country.

The tests below set up two provinces, put a failing health check in each, and
assert that a coordinator granted one of them sees exactly one.
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_acscope_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import COORDINATOR, PM as PM_ROLE  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

POWER = "Temp Power"
HERE = "SCOPE-HERE"     # in the coordinator's province
ELSEWHERE = "SCOPE-AWAY"  # not in it


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_acscope_pytest.db"):
        os.remove("/tmp/uep_acscope_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    """Two provinces, one site each, a global PM and a scoped coordinator."""
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        if db.query(Contractor).first() is None:
            db.add(Contractor(name="Ariana Telecom", type="drive_test"))

        provinces = db.query(Province).order_by(Province.id).limit(2).all()
        assert len(provinces) == 2, "seeding provides the 31 provinces"
        home, away = provinces

        pm_role = db.query(Role).filter(Role.name == PM_ROLE).one()
        if db.query(User).filter(User.username == "pm").first() is None:
            db.add(User(
                username="pm", password_hash=hash_password("Owner@12345"),
                first_name="Global", family_name="Pm", role_id=pm_role.id,
                sees_all_provinces=True, status=user_status.ACTIVE,
            ))

        coord_role = db.query(Role).filter(Role.name == COORDINATOR).one()
        coord = db.query(User).filter(User.username == "coord").first()
        if coord is None:
            coord = User(
                username="coord", password_hash=hash_password("Owner@12345"),
                first_name="Scoped", family_name="Coordinator",
                role_id=coord_role.id,
                sees_all_provinces=False, status=user_status.ACTIVE,
            )
            db.add(coord)
            db.flush()
        # Granted the home province only.
        coord.provinces = [home]

        for code, province in ((HERE, home), (ELSEWHERE, away)):
            if db.query(Site).filter(Site.site_code == code).first():
                continue
            site = Site(site_code=code, province_id=province.id)
            db.add(site)
            db.flush()
            db.add(WorkItem(
                site_id=site.id, site_type="Greenfield",
                requested_technology="2G",
                last_stage=C.STAGE_PERM_ONAIR, dt_status=None,
            ))
        db.commit()
    finally:
        db.close()


def _headers(client, username):
    r = client.post(
        "/api/v1/auth/login", data=login_form(client, username, "Owner@12345")
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _work_item_id(site_code):
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        return (
            db.query(WorkItem)
            .join(Site, WorkItem.site_id == Site.id)
            .filter(Site.site_code == site_code)
            .one()
            .id
        )
    finally:
        db.close()


def _contractor_id():
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        return db.query(Contractor).first().id
    finally:
        db.close()


def _fail_health_check(client, headers, site_code, *, review):
    """Run one site through a failing health check, optionally triaging it."""
    wi_id = _work_item_id(site_code)
    r = client.post(
        "/api/v1/hc/assignments",
        headers=headers,
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["tasks"][0]["id"]

    r = client.post(
        f"/api/v1/hc/tasks/{task_id}/result",
        headers=headers,
        json={"technology_results": [
            {"technology": "2G", "result": "NotNormal", "comment": "Down"},
        ]},
    )
    assert r.status_code == 200, r.text

    if review:
        r = client.post(
            f"/api/v1/hc/tasks/{task_id}/review",
            headers=headers,
            json={"problem_categories": [POWER]},
        )
        assert r.status_code == 200, r.text
    return task_id


def _labels(client, headers, category):
    rows = client.get("/api/v1/action-center", headers=headers).json()
    return [r["label"] for r in rows if r["category"] == category]


def test_review_items_are_province_scoped(client):
    """Both sites await review; the scoped coordinator sees only their own."""
    pm = _headers(client, "pm")
    _fail_health_check(client, pm, HERE, review=False)
    _fail_health_check(client, pm, ELSEWHERE, review=False)

    seen = _labels(client, _headers(client, "coord"), "health_check")
    assert HERE in seen
    assert ELSEWHERE not in seen, (
        "a coordinator granted one province must not be shown another's "
        "health check results"
    )


def test_global_pm_still_sees_everything(client):
    """The fix narrows a scoped user; it must not narrow an unscoped one."""
    seen = _labels(client, _headers(client, "pm"), "health_check")
    assert HERE in seen
    assert ELSEWHERE in seen


def test_remediation_items_are_province_scoped(client):
    """Triage both sites, then overdue/re-route nudges must respect scope."""
    pm = _headers(client, "pm")
    for code in (HERE, ELSEWHERE):
        _fail_health_check(client, pm, code, review=True)

    # Force both fixes overdue so they generate Action Center rows at all.
    from datetime import datetime, timedelta, timezone

    from app.models.health_check import HcRemediation

    db = SessionLocal()
    try:
        past = datetime.now(timezone.utc) - timedelta(days=3)
        for rem in db.query(HcRemediation).filter(
            HcRemediation.closed_at.is_(None)
        ).all():
            rem.due_at = past
        db.commit()
    finally:
        db.close()

    seen = _labels(client, _headers(client, "coord"), "health_check")
    overdue_away = [label for label in seen if label == ELSEWHERE]
    assert not overdue_away, (
        "an overdue fix outside the coordinator's provinces must not appear"
    )
    assert HERE in seen


# ---------------------------------------------------------------------------
# The stages a PM clears by hand, as counters
# ---------------------------------------------------------------------------
#
# The Action Center is counters alone now -- it no longer lists a row per site
# code underneath them. "Ready for Assignment" and "Returned by Contractor"
# only ever had rows, so without these counters the two stages a PM is
# expected to pick up would be invisible on the screen they land on. They are
# scoped like every other read, so a coordinator's province grant still
# decides what the number is counted from.
def _seed_staged_site(site_code, province_index, stage):
    from app.models.reference import Province
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        province = db.query(Province).order_by(Province.id).limit(2).all()[province_index]
        site = db.query(Site).filter(Site.site_code == site_code).first()
        if site is None:
            site = Site(site_code=site_code, province_id=province.id)
            db.add(site)
            db.flush()
            db.add(WorkItem(
                site_id=site.id, site_type="Greenfield",
                requested_technology="2G",
                last_stage=C.STAGE_PERM_ONAIR, dt_status=None,
                current_stage=stage,
            ))
        db.commit()
    finally:
        db.close()


def _counter(client, headers, key):
    summary = client.get("/api/v1/action-center/summary", headers=headers).json()
    return next((c for c in summary["counters"] if c["key"] == key), None)


def test_pm_gets_a_counter_for_each_stage_they_clear(client):
    _seed_staged_site("STAGE-READY-1", 0, "Ready for Assignment")
    _seed_staged_site("STAGE-READY-2", 1, "Ready for Assignment")
    _seed_staged_site("STAGE-RETURNED-1", 0, "Returned by Contractor")

    pm = _headers(client, "pm")

    ready = _counter(client, pm, "ready_to_assign")
    assert ready is not None, "a PM must be told how many sites await assignment"
    assert ready["count"] == 2
    assert ready["url"] == "/work-items?stage=Ready%20for%20Assignment"

    returned = _counter(client, pm, "returned")
    assert returned is not None
    assert returned["count"] == 1
    assert returned["url"] == "/work-items?stage=Returned%20by%20Contractor"


def test_these_counters_belong_to_the_pm_alone(client):
    """A coordinator does not assign work, so the number is not theirs."""
    coord = _headers(client, "coord")
    assert _counter(client, coord, "ready_to_assign") is None
    assert _counter(client, coord, "returned") is None
