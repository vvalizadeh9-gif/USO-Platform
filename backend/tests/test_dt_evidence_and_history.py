"""Drive-test evidence, the open execution date, and the full site timeline.

Three gaps on the drive-test half of the lifecycle:

* A drive test carried a date and an unused ``report_link``, so a reviewer
  approving one -- which is what writes ``dt_status = "Done"`` and moves the
  national KPI -- had nothing to approve against.
* The execution date was capped at today by the submission form. The backend
  never had that rule, so it only ever existed in the interface, and a drive
  test carried out three weeks ago could not be recorded honestly.
* ``site_history`` stopped at the health-check boundary. The chain the
  business cares about -- HC #1, problem, category, remediation, resolved,
  HC #2, ready, official DT, submitted, approved, DT Done -- was readable only
  up to "ready".
"""
import io
import os
import sys
from datetime import date, timedelta

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dtevidence_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import CONTRACTOR, COORDINATOR, PM as PM_ROLE  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

POWER = "Temp Power"

# A one-pixel PNG. The evidence store checks magic bytes, so the content has to
# really be the type its extension claims.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006"
    "00057f9d1f0000000049454e44ae426082"
)


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dtevidence_pytest.db"):
        os.remove("/tmp/uep_dtevidence_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        contractor = db.query(Contractor).first()
        if contractor is None:
            contractor = Contractor(name="Ariana Telecom", type="drive_test")
            db.add(contractor)
            db.flush()
        province = db.query(Province).first()

        for role_name, username in (
            (PM_ROLE, "pm"), (COORDINATOR, "coord"), (CONTRACTOR, "sc"),
        ):
            role = db.query(Role).filter(Role.name == role_name).one()
            if db.query(User).filter(User.username == username).first() is None:
                db.add(User(
                    username=username,
                    password_hash=hash_password("Owner@12345"),
                    first_name=role_name, family_name="User",
                    role_id=role.id, sees_all_provinces=True,
                    contractor_id=(
                        contractor.id if role_name == CONTRACTOR else None
                    ),
                    status=user_status.ACTIVE,
                ))

        for n in range(14):
            code = f"EVID-{n:04d}"
            if db.query(Site).filter(Site.site_code == code).first():
                continue
            site = Site(site_code=code, province_id=province.id if province else None)
            db.add(site)
            db.flush()
            db.add(WorkItem(
                site_id=site.id, site_type="Greenfield",
                requested_technology="2G", last_stage=C.STAGE_PERM_ONAIR,
                dt_status=None,
            ))
        db.commit()
    finally:
        db.close()


def _h(client, username):
    r = client.post(
        "/api/v1/auth/login", data=login_form(client, username, "Owner@12345")
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


def _fresh_site():
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        rows = (
            db.query(WorkItem, Site)
            .join(Site, WorkItem.site_id == Site.id)
            .filter(Site.site_code.like("EVID-%"))
            .order_by(Site.site_code)
            .all()
        )
        for wi, site in rows:
            if site.site_code not in _taken:
                _taken.add(site.site_code)
                return wi.id
    finally:
        db.close()
    raise AssertionError("seed more EVID- sites")


def _pass_health_check(client, wi_id, *, confirm=True):
    pm = _h(client, "pm")
    r = client.post(
        "/api/v1/hc/assignments", headers=pm,
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )
    task_id = r.json()["tasks"][0]["id"]
    client.post(
        f"/api/v1/hc/tasks/{task_id}/result", headers=pm,
        json={"technology_results": [{"technology": "2G", "result": "Normal"}]},
    )
    if confirm:
        client.post(
            f"/api/v1/hc/tasks/{task_id}/review", headers=pm,
            json={"problem_categories": []},
        )
    return task_id


def _assign_and_submit(client, wi_id, execution_date):
    client.post(
        "/api/v1/work-items/assign", headers=_h(client, "pm"),
        json={
            "work_item_ids": [wi_id], "contractor_id": _contractor_id(),
            "assignment_type": "official",
        },
    )
    r = client.post(
        f"/api/v1/work-items/{wi_id}/drive-test", headers=_h(client, "sc"),
        json={"execution_date": execution_date.isoformat()},
    )
    assert r.status_code == 200, r.text
    return r.json()["drive_test_id"]


# ---------------- the open date ----------------
def test_an_old_execution_date_is_accepted(client):
    """The cap only ever existed in the form; a real date is a real date."""
    wi_id = _fresh_site()
    _pass_health_check(client, wi_id)
    long_ago = date.today() - timedelta(days=45)
    dt_id = _assign_and_submit(client, wi_id, long_ago)

    from app.models.workitem import DriveTest

    db = SessionLocal()
    try:
        assert db.get(DriveTest, dt_id).execution_date == long_ago
    finally:
        db.close()


# ---------------- evidence ----------------
def test_contractor_attaches_a_report_and_a_reviewer_can_read_it(client):
    wi_id = _fresh_site()
    _pass_health_check(client, wi_id)
    dt_id = _assign_and_submit(client, wi_id, date.today())

    r = client.post(
        f"/api/v1/drive-tests/{dt_id}/evidence", headers=_h(client, "sc"),
        files={"file": ("route.png", io.BytesIO(PNG), "image/png")},
    )
    assert r.status_code == 201, r.text
    evidence_id = r.json()["id"]
    assert r.json()["original_filename"] == "route.png"
    assert r.json()["size_bytes"] == len(PNG)

    got = client.get(
        f"/api/v1/drive-tests/evidence/{evidence_id}/download",
        headers=_h(client, "coord"),
    )
    assert got.status_code == 200
    assert got.content == PNG
    # The media type comes from what the bytes are, not from what was claimed.
    assert got.headers["content-type"].startswith("image/png")
    assert got.headers["x-content-type-options"] == "nosniff"


def test_evidence_is_refused_once_the_drive_test_has_been_decided(client):
    """Approval is terminal, so the record it was approved against is closed."""
    wi_id = _fresh_site()
    _pass_health_check(client, wi_id)
    dt_id = _assign_and_submit(client, wi_id, date.today())
    client.post(
        f"/api/v1/drive-tests/{dt_id}/coordinator-review",
        headers=_h(client, "coord"), json={"decision": "Approved"},
    )

    r = client.post(
        f"/api/v1/drive-tests/{dt_id}/evidence", headers=_h(client, "sc"),
        files={"file": ("late.png", io.BytesIO(PNG), "image/png")},
    )
    assert r.status_code == 400, r.text


def test_a_file_that_is_not_what_it_claims_is_rejected(client):
    wi_id = _fresh_site()
    _pass_health_check(client, wi_id)
    dt_id = _assign_and_submit(client, wi_id, date.today())

    r = client.post(
        f"/api/v1/drive-tests/{dt_id}/evidence", headers=_h(client, "sc"),
        files={"file": ("payload.png", io.BytesIO(b"<script>x</script>"), "image/png")},
    )
    assert r.status_code == 400, r.text


# ---------------- the full timeline ----------------
def test_history_runs_from_health_check_through_dt_done(client):
    """The chain the business asks for, end to end, in one timeline."""
    wi_id = _fresh_site()
    pm = _h(client, "pm")

    # Round 1 fails and is routed.
    r = client.post(
        "/api/v1/hc/assignments", headers=pm,
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )
    task_id = r.json()["tasks"][0]["id"]
    client.post(
        f"/api/v1/hc/tasks/{task_id}/result", headers=pm,
        json={"technology_results": [
            {"technology": "2G", "result": "NotNormal", "comment": "No power"},
        ]},
    )
    client.post(
        f"/api/v1/hc/tasks/{task_id}/review", headers=pm,
        json={"problem_categories": [POWER]},
    )

    # The owning team closes the fix, which returns the site for round 2.
    from app.models.health_check import HcRemediation

    db = SessionLocal()
    try:
        rem_id = (
            db.query(HcRemediation)
            .filter(HcRemediation.work_item_id == wi_id)
            .one()
            .id
        )
    finally:
        db.close()
    client.post(
        f"/api/v1/hc/fixes/{rem_id}/close", headers=pm,
        json={"note": "Generator installed"},
    )

    # Round 2 passes and is confirmed, then the drive test runs its course.
    _pass_health_check(client, wi_id)
    dt_id = _assign_and_submit(client, wi_id, date.today())
    client.post(
        f"/api/v1/drive-tests/{dt_id}/coordinator-review",
        headers=_h(client, "coord"),
        json={"decision": "Approved", "comment": "Coverage verified"},
    )

    events = client.get(
        f"/api/v1/hc/sites/{wi_id}/history", headers=pm
    ).json()
    kinds = [e["kind"] for e in events]

    for expected in (
        "assigned", "failed", "routed", "fixed",
        "passed", "confirmed", "dt_assigned", "dt_submitted", "dt_approved",
    ):
        assert expected in kinds, f"{expected} missing from {kinds}"

    # Newest first, so approval leads and the first assignment trails.
    assert kinds[0] == "dt_approved"
    assert kinds[-1] == "assigned"

    approved = next(e for e in events if e["kind"] == "dt_approved")
    assert "DT Done" in approved["title"]
    assert approved["detail"] == "Coverage verified"

    # Both rounds are still distinguishable.
    assert {e["round_no"] for e in events} >= {1, 2}


def test_a_rejected_drive_test_shows_as_rejected_not_approved(client):
    wi_id = _fresh_site()
    _pass_health_check(client, wi_id)
    dt_id = _assign_and_submit(client, wi_id, date.today())
    client.post(
        f"/api/v1/drive-tests/{dt_id}/coordinator-review",
        headers=_h(client, "coord"),
        json={"decision": "Rejected", "comment": "Route incomplete"},
    )

    events = client.get(
        f"/api/v1/hc/sites/{wi_id}/history", headers=_h(client, "pm")
    ).json()
    kinds = [e["kind"] for e in events]
    assert "dt_rejected" in kinds
    assert "dt_approved" not in kinds


# ---------------- the two new stages ----------------
def test_a_site_being_checked_reads_as_hc_in_progress(client):
    """Between assignment and submission the site used to be visible nowhere."""
    wi_id = _fresh_site()
    client.post(
        "/api/v1/hc/assignments", headers=_h(client, "pm"),
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )

    from app.models.workitem import WorkItem

    db = SessionLocal()
    try:
        assert db.get(WorkItem, wi_id).current_stage == "HC In Progress"
    finally:
        db.close()


def test_a_submitted_result_reads_as_hc_review_until_someone_decides(client):
    wi_id = _fresh_site()
    _pass_health_check(client, wi_id, confirm=False)

    from app.models.workitem import WorkItem

    db = SessionLocal()
    try:
        assert db.get(WorkItem, wi_id).current_stage == "HC Review"
    finally:
        db.close()

    # Confirming moves it on to the queue where it can actually be assigned.
    from app.models.health_check import HcTask

    db = SessionLocal()
    try:
        task_id = (
            db.query(HcTask).filter(HcTask.work_item_id == wi_id).one().id
        )
    finally:
        db.close()
    client.post(
        f"/api/v1/hc/tasks/{task_id}/review", headers=_h(client, "pm"),
        json={"problem_categories": []},
    )

    db = SessionLocal()
    try:
        assert db.get(WorkItem, wi_id).current_stage == "Ready for Assignment"
    finally:
        db.close()
