"""Tests for the V2 assignment / drive-test workflow.

Covers the bug this release fixes: coordinator approval must write the DT
outcome through to the work item's ``dt_status`` / ``dt_date_gregorian``,
because those columns — not ``DriveTest.status`` — are what the Drive Test
dashboard's "DT Done" KPI reads. Also covers the terminal-stage change
(approval completes; no PM step) and the enriched list-row fields.

Run with:  cd backend && pytest tests/test_assignment_dt_flow.py -q
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_v2_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_v2_pytest.db"):
        os.remove("/tmp/uep_v2_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345") -> str:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_ROLE_USER_CREATED = set()


def _login_as_role(client, role_name: str, username: str) -> str:
    """Create (once) and log in as a user with the given role.

    Drive-test submission and coordinator approval are PM/Coordinator-only
    actions (Admin no longer has write access), so these tests need real
    role-scoped users rather than the seeded Admin account.
    """
    if username not in _ROLE_USER_CREATED:
        admin_token = _login(client)
        h = _auth(admin_token)
        roles = client.get("/api/v1/reference/roles", headers=h).json()
        role_id = next(r["id"] for r in roles if r["name"] == role_name)
        client.post(
            "/api/v1/admin/users",
            headers=h,
            json={
                "username": username,
                "password": "Test-Fixture-Passphrase",
                "full_name": username,
                "role_id": role_id,
                "sees_all_provinces": True,
                "province_ids": [],
            },
        )
        _ROLE_USER_CREATED.add(username)
    return _login(client, username, "Test-Fixture-Passphrase")


def _seed_assigned_site(db, *, days_ago: int = 5):
    """An on-air work item with an active assignment, ready for a drive test."""
    from app.models.reference import Contractor, Province
    from app.models.workitem import Assignment, Site, WorkItem

    prov = Province(name=f"V2Prov{days_ago}")
    contractor = Contractor(name=f"V2Co{days_ago}", type="drive_test")
    db.add_all([prov, contractor])
    db.flush()

    site = Site(site_code=f"V2-S{days_ago}", province_id=prov.id)
    db.add(site)
    db.flush()

    wi = WorkItem(
        site_id=site.id,
        site_type=f"T{days_ago}",
        last_stage="راه_اندازی_دائم",
        requested_technology="4G",
        dt_status=None,
        current_stage="Assigned",
    )
    db.add(wi)
    db.flush()

    wi.assignments.append(
        Assignment(
            assignment_type="official",
            contractor_id=contractor.id,
            assigned_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
            is_active=True,
        )
    )
    db.commit()
    return wi.id


def test_coordinator_approval_writes_dt_status_through(client):
    """The core V2 fix: approving a DT marks the work item DT-Done.

    Before this, dt_status was only ever written by the CPM Excel import, so
    in-app drive tests never reached the dashboard KPI.
    """
    from app.models.workitem import WorkItem

    db = SessionLocal()
    wi_id = _seed_assigned_site(db, days_ago=5)
    db.close()

    pm_token = _login_as_role(client, "PM", "v2_pm_user")
    coordinator_token = _login_as_role(client, "Coordinator", "v2_coordinator_user")
    exec_date = date.today().isoformat()

    r = client.post(
        f"/api/v1/work-items/{wi_id}/drive-test",
        headers=_auth(pm_token),
        json={"execution_date": exec_date},
    )
    assert r.status_code == 200, r.text
    dt_id = r.json()["drive_test_id"]
    assert r.json()["stage"] == "DT Submitted"

    # Before approval the work item is NOT yet DT-Done.
    db = SessionLocal()
    assert db.get(WorkItem, wi_id).dt_status is None
    db.close()

    r = client.post(
        f"/api/v1/drive-tests/{dt_id}/coordinator-review",
        headers=_auth(coordinator_token),
        json={"decision": "Approved"},
    )
    assert r.status_code == 200, r.text
    # Approval is terminal — no PM step, no "DT Completed".
    assert r.json()["stage"] == "Coordinator Approved"

    db = SessionLocal()
    wi = db.get(WorkItem, wi_id)
    assert wi.dt_status == "Done"
    assert wi.dt_date_gregorian == date.fromisoformat(exec_date)
    db.close()


def test_approved_dt_counts_toward_dashboard_kpi(client):
    """End-to-end: an approved in-app DT shows up in the DT Done KPI."""
    from app.services.drive_test_analytics import DriveTestAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    kpis = DriveTestAnalytics(db, _SystemScope()).compute_kpis()
    db.close()

    # The site approved in the previous test is on-air and now Done.
    assert kpis["total_dt_done"] >= 1


def test_rejection_does_not_mark_done(client):
    from app.models.workitem import WorkItem

    db = SessionLocal()
    wi_id = _seed_assigned_site(db, days_ago=3)
    db.close()

    pm_token = _login_as_role(client, "PM", "v2_pm_user")
    coordinator_token = _login_as_role(client, "Coordinator", "v2_coordinator_user")
    r = client.post(
        f"/api/v1/work-items/{wi_id}/drive-test",
        headers=_auth(pm_token),
        json={"execution_date": date.today().isoformat()},
    )
    dt_id = r.json()["drive_test_id"]

    r = client.post(
        f"/api/v1/drive-tests/{dt_id}/coordinator-review",
        headers=_auth(coordinator_token),
        json={"decision": "Rejected", "comment": "Bad logs"},
    )
    assert r.status_code == 200

    db = SessionLocal()
    wi = db.get(WorkItem, wi_id)
    assert wi.dt_status is None  # never marked Done
    db.close()


def test_pm_review_endpoint_is_gone(client):
    """The PM sign-off step was removed; the route must no longer exist."""
    token = _login(client)
    r = client.post(
        "/api/v1/drive-tests/1/pm-review",
        headers=_auth(token),
        json={"decision": "Approved"},
    )
    assert r.status_code == 404


def test_list_row_carries_assignment_and_aging(client):
    """Enriched list rows expose the per-stage columns the UI renders."""
    token = _login(client)
    rows = client.get(
        "/api/v1/work-items",
        headers=_auth(token),
        params={"stage": "Coordinator Approved"},
    ).json()
    assert len(rows) >= 1

    row = rows[0]
    for field in (
        "site_code",
        "assignment_date",
        "contractor_name",
        "dt_submission_date",
        "dt_approval_date",
        "dt_approval_user",
        "aging_days",
    ):
        assert field in row, f"missing {field}"

    # Assigned 5 days before a DT dated today → aging of about 5 days.
    assert row["aging_days"] is not None
    assert row["aging_days"] >= 0
    assert row["contractor_name"] is not None
    assert row["dt_approval_user"] == "System Administrator" or row["dt_approval_user"]


def test_aging_never_negative():
    """A DT dated before its assignment is bad data, not negative aging."""
    from app.services.work_item_rows import _aging_days

    class _A:
        assigned_at = datetime.now(timezone.utc)

    class _D:
        execution_date = date.today() - timedelta(days=10)

    assert _aging_days(_A(), _D()) == 0
    assert _aging_days(None, _D()) is None
    assert _aging_days(_A(), None) is None
