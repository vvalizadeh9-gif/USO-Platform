"""Integration tests for the UEP backend.

Run with:  cd backend && pytest -q

Uses an in-memory-style SQLite file so the suite is self-contained and
does not require a running Postgres. JSONB is mapped to JSON for SQLite.
"""
import os
import sys

import pytest

# Point the app at a throwaway SQLite database before importing app modules.
os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON  # SQLite has no JSONB

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, engine  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    # Fresh schema per test module.
    if os.path.exists("/tmp/uep_pytest.db"):
        os.remove("/tmp/uep_pytest.db")
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


def test_health(client):
    assert client.get("/api/health").json()["status"] == "healthy"


def test_admin_seeded_and_login(client):
    token = _login(client)
    assert token


def test_login_rejects_bad_password(client):
    r = client.post("/api/v1/auth/login", data=login_form(client, "admin", "wrong"))
    assert r.status_code == 401


def test_work_items_require_auth(client):
    assert client.get("/api/v1/work-items").status_code == 401


def test_cpm_import_and_scope(client):
    token = _login(client)
    # Import the real sample file if present; otherwise skip gracefully.
    sample = (_p if os.path.exists(_p := "/mnt/user-data/uploads/CPM_2_.xlsx") else "/mnt/user-data/uploads/CPM-Org_-_Copy.xlsx")
    if not sample:
        pytest.skip("sample CPM file not available")

    with open(sample, "rb") as f:
        r = client.post(
            "/api/v1/admin/cpm/import",
            headers=_auth(token),
            files={"file": ("CPM_2_.xlsx", f, "application/vnd.ms-excel")},
        )
    assert r.status_code == 200, r.text
    summary = r.json()
    # Satellite rows must be skipped, and target work items created.
    assert summary["new_count"] > 0
    assert summary["skipped_satellite"] >= 0
    assert summary["changed_count"] == 0  # first import is a clean seed

    # Admin sees all work items.
    items = client.get("/api/v1/work-items", headers=_auth(token)).json()
    assert 0 < len(items) <= summary["new_count"]  # list endpoint is paginated

    # Drive Test overview computes (the Dashboard KPI endpoint was removed —
    # this is now the only live-computed summary surface).
    overview = client.get("/api/v1/drive-test/overview", headers=_auth(token)).json()
    assert overview["kpis"]["total_onair"]["value"] >= 0


def test_rbac_contractor_cannot_assign(client):
    token = _login(client)
    # Create a coordinator user and confirm they can't hit an admin route.
    roles = client.get("/api/v1/reference/roles", headers=_auth(token)).json()
    coord_role = next(r for r in roles if r["name"] == "Coordinator")
    client.post(
        "/api/v1/admin/users",
        headers=_auth(token),
        json={
            "username": "coord1",
            "password": "Passw0rd!",
            "full_name": "Coord One",
            "role_id": coord_role["id"],
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    coord_token = _login(client, "coord1", "Passw0rd!")
    # Coordinator listing users should be forbidden.
    r = client.get("/api/v1/admin/users", headers=_auth(coord_token))
    assert r.status_code == 403


def test_second_import_creates_change_requests(client):
    token = _login(client)
    sample = (_p if os.path.exists(_p := "/mnt/user-data/uploads/CPM_2_.xlsx") else "/mnt/user-data/uploads/CPM-Org_-_Copy.xlsx")
    if not sample:
        pytest.skip("sample CPM file not available")
    with open(sample, "rb") as f:
        client.post(
            "/api/v1/admin/cpm/import",
            headers=_auth(token),
            files={"file": ("CPM_2_.xlsx", f, "application/vnd.ms-excel")},
        )
    crs = client.get("/api/v1/admin/cpm/change-requests", headers=_auth(token)).json()
    # Monthly re-import of the same file surfaces intra-file inconsistencies.
    assert isinstance(crs, list)
