"""The Ready-before-drive-test gate, and the duplicate-health-check guard.

Both rules used to live only in the interface. The lifecycle says an official
drive test follows a health check that passed *and* was confirmed by a PM or
Coordinator, but the assignment endpoints performed no readiness check at all
-- the rule was enforced by which checkbox the Work Items screen chose to
draw, so the bulk bar and the single-site form would each happily send a
Problematic or never-checked site straight to a drive test.

Similarly, nothing stopped a site already inside an open health check from
being assigned to a second subcontractor. The basket query hides such a site,
which is why it never happened by working the screen -- but a query cannot
enforce anything about a write, and two stale pages (or one retried request)
produced two live tasks for the same site.

Sites are seeded directly rather than through a CPM import so these run
everywhere, including environments without the sample spreadsheet.
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dtgate_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import PM as PM_ROLE  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

POWER = "Temp Power"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dtgate_pytest.db"):
        os.remove("/tmp/uep_dtgate_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    """One contractor, a PM who sees everything, and a pool of on-air sites."""
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        if db.query(Contractor).first() is None:
            db.add(Contractor(name="Ariana Telecom", type="drive_test"))
        province = db.query(Province).first()

        role = db.query(Role).filter(Role.name == PM_ROLE).one()
        if db.query(User).filter(User.username == "pm").first() is None:
            db.add(
                User(
                    username="pm",
                    password_hash=hash_password("Owner@12345"),
                    first_name="Gate", family_name="Tester",
                    role_id=role.id,
                    sees_all_provinces=True,
                    status=user_status.ACTIVE,
                )
            )

        for n in range(12):
            code = f"GATE-{n:04d}"
            if db.query(Site).filter(Site.site_code == code).first():
                continue
            site = Site(site_code=code, province_id=province.id if province else None)
            db.add(site)
            db.flush()
            db.add(
                WorkItem(
                    site_id=site.id,
                    site_type="Greenfield",
                    requested_technology="2G,3G",
                    last_stage=C.STAGE_PERM_ONAIR,
                    dt_status=None,
                )
            )
        db.commit()
    finally:
        db.close()


def _headers(client):
    r = client.post(
        "/api/v1/auth/login", data=login_form(client, "pm", "Owner@12345")
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _contractor_id():
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        return db.query(Contractor).first().id
    finally:
        db.close()


_taken: set[str] = set()


def _fresh_site() -> tuple[int, str]:
    """Claim an unused seeded site, returning its work item id and code."""
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        rows = (
            db.query(WorkItem, Site)
            .join(Site, WorkItem.site_id == Site.id)
            .filter(Site.site_code.like("GATE-%"))
            .order_by(Site.site_code)
            .all()
        )
        for wi, site in rows:
            if site.site_code not in _taken:
                _taken.add(site.site_code)
                return wi.id, site.site_code
    finally:
        db.close()
    raise AssertionError("seed more GATE- sites")


def _run_health_check(client, headers, wi_id, *, results, review=None):
    """Assign, submit a result, and optionally review. Returns the task id."""
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
        json={"technology_results": results},
    )
    assert r.status_code == 200, r.text

    if review is not None:
        r = client.post(
            f"/api/v1/hc/tasks/{task_id}/review",
            headers=headers,
            json={"problem_categories": review},
        )
        assert r.status_code == 200, r.text
    return task_id


_ALL_NORMAL = [
    {"technology": "2G", "result": "Normal"},
    {"technology": "3G", "result": "Normal"},
]
_ONE_FAILED = [
    {"technology": "2G", "result": "Normal"},
    {"technology": "3G", "result": "NotNormal", "comment": "No transmission"},
]


def _assign(client, headers, wi_ids, kind="official"):
    return client.post(
        "/api/v1/work-items/assign",
        headers=headers,
        json={
            "work_item_ids": wi_ids,
            "contractor_id": _contractor_id(),
            "assignment_type": kind,
        },
    )


# ---------------- the gate ----------------
def test_never_health_checked_site_cannot_be_assigned(client):
    headers = _headers(client)
    wi_id, code = _fresh_site()

    r = _assign(client, headers, [wi_id])
    assert r.status_code == 400, r.text
    assert "no completed health check" in r.json()["detail"]
    assert code in r.json()["detail"]


def test_failed_health_check_blocks_assignment(client):
    headers = _headers(client)
    wi_id, _ = _fresh_site()
    _run_health_check(client, headers, wi_id, results=_ONE_FAILED, review=[POWER])

    r = _assign(client, headers, [wi_id])
    assert r.status_code == 400, r.text
    assert "did not pass" in r.json()["detail"]


def test_ready_but_unconfirmed_site_blocks_assignment(client):
    """A contractor's Ready is a measurement, not the business decision.

    The lifecycle puts PM/Coordinator review between the health check and the
    drive test, so a passing but unreviewed round is not yet assignable.
    """
    headers = _headers(client)
    wi_id, _ = _fresh_site()
    _run_health_check(client, headers, wi_id, results=_ALL_NORMAL)  # no review

    r = _assign(client, headers, [wi_id])
    assert r.status_code == 400, r.text
    assert "has not been confirmed" in r.json()["detail"]


def test_ready_and_confirmed_site_is_assignable(client):
    headers = _headers(client)
    wi_id, _ = _fresh_site()
    _run_health_check(client, headers, wi_id, results=_ALL_NORMAL, review=[])

    r = _assign(client, headers, [wi_id])
    assert r.status_code == 200, r.text
    assert r.json()["assigned"] == 1


def test_single_site_assignment_endpoint_is_gated_too(client):
    """Both doors, not just the bulk one.

    The single-site form on the work item detail page reaches a different
    endpoint, and it was the one with no check at all.
    """
    headers = _headers(client)
    wi_id, _ = _fresh_site()

    r = client.post(
        f"/api/v1/work-items/{wi_id}/assignment",
        headers=headers,
        json={"assignment_type": "official", "contractor_id": _contractor_id()},
    )
    assert r.status_code == 400, r.text
    assert "no completed health check" in r.json()["detail"]


def test_bulk_assign_rejects_the_whole_batch(client):
    """One unready site fails the request; nothing in it is assigned.

    All-or-nothing matches how the scope check already behaves, and it is the
    safer half of the choice: a partially applied bulk assignment leaves the
    caller with no way to tell which sites went through.
    """
    headers = _headers(client)
    good_id, _ = _fresh_site()
    bad_id, _ = _fresh_site()
    _run_health_check(client, headers, good_id, results=_ALL_NORMAL, review=[])

    r = _assign(client, headers, [good_id, bad_id])
    assert r.status_code == 400, r.text

    from app.models.workitem import Assignment

    db = SessionLocal()
    try:
        assert db.query(Assignment).filter(
            Assignment.work_item_id == good_id
        ).count() == 0, "the good site must not be assigned when the batch fails"
    finally:
        db.close()


def test_first_assignment_type_is_not_gated(client):
    """Only ``official`` means a drive test.

    ``first`` predates the hc_assignments table and no longer routes anyone to
    a site; gating it would break nothing useful but would say the rule is
    about assignment rather than about drive tests.
    """
    headers = _headers(client)
    wi_id, _ = _fresh_site()

    r = _assign(client, headers, [wi_id], kind="first")
    assert r.status_code == 200, r.text


# ---------------- the duplicate-task guard ----------------
def test_site_already_in_an_open_check_cannot_be_reassigned(client):
    headers = _headers(client)
    wi_id, _ = _fresh_site()

    first = client.post(
        "/api/v1/hc/assignments",
        headers=headers,
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )
    assert first.status_code == 201, first.text

    second = client.post(
        "/api/v1/hc/assignments",
        headers=headers,
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )
    assert second.status_code == 409, second.text
    assert "already in an open" in second.json()["detail"]

    from app.models.health_check import HcTask

    db = SessionLocal()
    try:
        assert db.query(HcTask).filter(HcTask.work_item_id == wi_id).count() == 1
    finally:
        db.close()


def test_a_finished_site_can_be_checked_again(client):
    """The guard must not block the remediation loop's whole point.

    Once a round is complete the site is no longer *in* an open check, so a
    second round is allowed -- that is how a remediated site comes back.
    """
    headers = _headers(client)
    wi_id, _ = _fresh_site()
    _run_health_check(client, headers, wi_id, results=_ONE_FAILED, review=[POWER])

    r = client.post(
        "/api/v1/hc/assignments",
        headers=headers,
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )
    assert r.status_code == 201, r.text
    assert r.json()["tasks"][0]["round_no"] == 2
