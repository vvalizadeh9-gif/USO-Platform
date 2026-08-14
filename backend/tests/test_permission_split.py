"""Tests for the Admin/PM permission split and the new Admin dashboard endpoints.

Covers:
1. PM keeps the write access it had before (health-check, assignment, bulk
   assignment, drive-test, HC result submit/review/upload).
2. Admin now gets 403 on those same write/approve/assign endpoints, while
   still being able to reach read-only GET endpoints (proven separately).
3. The three new /admin endpoints (stats, system-health, audit-logs) return
   200 for Admin and 403 for a non-Admin role.
4. last_login_at is set on successful login.

Run with:  cd backend && pytest tests/test_permission_split.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_permission_split_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_permission_split_pytest.db"):
        os.remove("/tmp/uep_permission_split_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _role_id(client, h, name):
    roles = client.get("/api/v1/reference/roles", headers=h).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _make_user(client, admin_h, username, role_name, password="Passw0rd!"):
    role_id = _role_id(client, admin_h, role_name)
    r = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": username,
            "password": password,
            "full_name": username,
            "role_id": role_id,
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    assert r.status_code == 201, r.text
    return _login(client, username, password)


@pytest.fixture(scope="module")
def tokens(client):
    admin_token = _login(client)
    admin_h = _auth(admin_token)
    pm_token = _make_user(client, admin_h, "pm_user", "PM")
    coordinator_token = _make_user(client, admin_h, "coord_user", "Coordinator")
    contractor_token = _make_user(client, admin_h, "contractor_user", "Contractor")
    return {
        "Admin": admin_token,
        "PM": pm_token,
        "Coordinator": coordinator_token,
        "Contractor": contractor_token,
    }


# ---------- PM keeps its previous write access ----------
def test_pm_can_still_reach_health_check_endpoint(client, tokens):
    r = client.post(
        "/api/v1/work-items/999999/health-check",
        headers=_auth(tokens["PM"]),
        json={"status": "Ready"},
    )
    # Role gate passes; 404 (no such work item) proves the request reached
    # the business logic instead of being rejected as 403 Forbidden.
    assert r.status_code == 404, r.text


def test_pm_can_still_reach_assignment_endpoint(client, tokens):
    r = client.post(
        "/api/v1/work-items/999999/assignment",
        headers=_auth(tokens["PM"]),
        json={"assignment_type": "official", "contractor_id": 1},
    )
    assert r.status_code == 404, r.text


def test_pm_can_still_reach_bulk_assign_endpoint(client, tokens):
    r = client.post(
        "/api/v1/work-items/assign",
        headers=_auth(tokens["PM"]),
        json={"work_item_ids": [999999], "contractor_id": 1},
    )
    assert r.status_code == 404, r.text


def test_pm_can_still_reach_drive_test_endpoint(client, tokens):
    r = client.post(
        "/api/v1/work-items/999999/drive-test",
        headers=_auth(tokens["PM"]),
        json={},
    )
    assert r.status_code == 404, r.text


def test_pm_can_still_reach_hc_result_submit(client, tokens):
    r = client.post(
        "/api/v1/hc/tasks/999999/result",
        headers=_auth(tokens["PM"]),
        json={"technology_results": [{"technology": "2G", "result": "Normal"}]},
    )
    assert r.status_code == 404, r.text


def test_pm_can_still_reach_hc_review(client, tokens):
    r = client.post(
        "/api/v1/hc/tasks/999999/review",
        headers=_auth(tokens["PM"]),
        json={},
    )
    assert r.status_code == 404, r.text


def test_pm_can_still_reach_hc_upload(client, tokens):
    r = client.post(
        "/api/v1/hc/assignments/999999/upload",
        headers=_auth(tokens["PM"]),
        files={"file": ("x.xlsx", b"dummy", "application/vnd.ms-excel")},
    )
    assert r.status_code == 404, r.text


# ---------- Admin loses write/approve/assign access ----------
@pytest.mark.parametrize(
    "method,url,kwargs",
    [
        ("post", "/api/v1/work-items/1/health-check", {"json": {"status": "Ready"}}),
        (
            "post",
            "/api/v1/work-items/1/assignment",
            {"json": {"assignment_type": "official", "contractor_id": 1}},
        ),
        (
            "post",
            "/api/v1/work-items/assign",
            {"json": {"work_item_ids": [1], "contractor_id": 1}},
        ),
        ("post", "/api/v1/work-items/1/drive-test", {"json": {}}),
        (
            "post",
            "/api/v1/drive-tests/1/coordinator-review",
            {"json": {"decision": "Approved"}},
        ),
        (
            "patch",
            "/api/v1/villages/1/acceptance/2G",
            {"json": {"ict_status": "Approved"}},
        ),
        (
            "post",
            "/api/v1/hc/assignments",
            {"json": {"contractor_id": 1, "work_item_ids": [1]}},
        ),
        (
            "post",
            "/api/v1/hc/tasks/1/result",
            {"json": {"technology_results": [{"technology": "2G", "result": "Normal"}]}},
        ),
        ("post", "/api/v1/hc/tasks/1/review", {"json": {}}),
        (
            "post",
            "/api/v1/hc/assignments/1/upload",
            {"files": {"file": ("x.xlsx", b"dummy", "application/vnd.ms-excel")}},
        ),
    ],
)
def test_admin_forbidden_on_workflow_write_endpoints(client, tokens, method, url, kwargs):
    r = getattr(client, method)(url, headers=_auth(tokens["Admin"]), **kwargs)
    assert r.status_code == 403, r.text


def test_admin_still_allowed_on_read_only_endpoints(client, tokens):
    h = _auth(tokens["Admin"])
    for url in (
        "/api/v1/hc/basket",
        "/api/v1/hc/assignments",
        "/api/v1/hc/results",
    ):
        r = client.get(url, headers=h)
        assert r.status_code == 200, (url, r.text)


# ---------- New Admin dashboard endpoints ----------
@pytest.mark.parametrize(
    "url", ["/api/v1/admin/stats", "/api/v1/admin/system-health", "/api/v1/admin/audit-logs"]
)
def test_new_admin_endpoints_ok_for_admin(client, tokens, url):
    r = client.get(url, headers=_auth(tokens["Admin"]))
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    "url", ["/api/v1/admin/stats", "/api/v1/admin/system-health", "/api/v1/admin/audit-logs"]
)
@pytest.mark.parametrize("role", ["PM", "Coordinator", "Contractor"])
def test_new_admin_endpoints_forbidden_for_non_admin(client, tokens, url, role):
    r = client.get(url, headers=_auth(tokens[role]))
    assert r.status_code == 403, r.text


def test_admin_stats_shape(client, tokens):
    r = client.get("/api/v1/admin/stats", headers=_auth(tokens["Admin"]))
    body = r.json()
    assert body["active_users_count"] >= 4  # admin + pm + coordinator + contractor
    assert isinstance(body["users_by_role"], dict)
    assert body["users_by_role"].get("PM") == 1
    assert body["dormant_users"] >= 0
    assert body["users_without_province_access"] >= 0


def test_system_health_shape(client, tokens):
    r = client.get("/api/v1/admin/system-health", headers=_auth(tokens["Admin"]))
    body = r.json()
    assert body["db_status"] == "ok"
    assert "alembic_mismatch" in body
    assert "pending_change_requests_count" in body


def test_audit_logs_pagination(client, tokens):
    r = client.get(
        "/api/v1/admin/audit-logs", headers=_auth(tokens["Admin"]), params={"limit": 2}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "total_count" in body
    assert len(body["items"]) <= 2
    # User creation above wrote audit entries; the acting admin's name resolves.
    if body["items"]:
        assert "user_full_name" in body["items"][0]


# ---------- last_login_at ----------
def test_last_login_at_set_on_login(client, tokens):
    from app.models.reference import User

    admin_h = _auth(tokens["Admin"])
    # Fresh user, never logged in before this test.
    _make_user(client, admin_h, "login_probe_user", "Viewer")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "login_probe_user").one()
        assert user.last_login_at is not None
        first_login = user.last_login_at
    finally:
        db.close()

    _login(client, "login_probe_user", "Passw0rd!")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "login_probe_user").one()
        assert user.last_login_at is not None
        assert user.last_login_at >= first_login
    finally:
        db.close()
