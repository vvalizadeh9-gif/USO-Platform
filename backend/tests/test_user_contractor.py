"""Tests for linking users to a contractor (subcontractor login scoping).

Covers two real bugs found during manual testing:
1. UserOut previously omitted contractor_id entirely from API responses.
2. UserUpdate's "if contractor_id is not None" check silently ignored an
   explicit null, so clearing a contractor on role change never worked.

Run with:  cd backend && pytest tests/test_user_contractor.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_user_contractor_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from tests.conftest import login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_user_contractor_pytest.db"):
        os.remove("/tmp/uep_user_contractor_pytest.db")
    Base.metadata.drop_all(bind=engine)
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    return r.json()["access_token"]


def _role_id(client, h, name):
    roles = client.get("/api/v1/reference/roles", headers=h).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _make_contractor(name="Infinitel"):
    from app.models.reference import Contractor

    db = SessionLocal()
    c = Contractor(name=name, type="drive_test", active=True)
    db.add(c)
    db.commit()
    cid = c.id
    db.close()
    return cid


def test_create_user_returns_contractor_id(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    cid = _make_contractor("SFO")
    contractor_role = _role_id(client, h, "Contractor")

    r = client.post(
        "/api/v1/admin/users",
        headers=h,
        json={
            "username": "sfo_user",
            "password": "Passw0rd!",
            "full_name": "SFO Field User",
            "role_id": contractor_role,
            "contractor_id": cid,
            "sees_all_provinces": False,
            "province_ids": [],
        },
    )
    assert r.status_code == 201
    # Regression: contractor_id must be present in the response, not silently
    # dropped by the output schema.
    assert r.json()["contractor_id"] == cid


def test_list_users_includes_contractor_id(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/v1/admin/users", headers=h)
    assert r.status_code == 200
    sfo_user = next(u for u in r.json() if u["username"] == "sfo_user")
    assert "contractor_id" in sfo_user
    assert sfo_user["contractor_id"] is not None


def test_edit_user_can_clear_contractor_id(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    users = client.get("/api/v1/admin/users", headers=h).json()
    sfo_user = next(u for u in users if u["username"] == "sfo_user")
    pm_role = _role_id(client, h, "PM")

    r = client.patch(
        f"/api/v1/admin/users/{sfo_user['id']}",
        headers=h,
        json={"role_id": pm_role, "contractor_id": None},
    )
    assert r.status_code == 200
    # Regression: explicitly sending null must actually clear the field,
    # not be silently ignored because "None is not None" is False.
    assert r.json()["contractor_id"] is None


def test_contractor_user_only_sees_their_own_hc_assignments(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}

    sample = (_p if os.path.exists(_p := "/mnt/user-data/uploads/CPM_2_.xlsx") else "/mnt/user-data/uploads/CPM-Org_-_Copy.xlsx")
    if not sample:
        pytest.skip("sample CPM file not available")
    with open(sample, "rb") as f:
        client.post(
            "/api/v1/admin/cpm/import",
            headers=h,
            files={"file": ("CPM_2_.xlsx", f, "application/vnd.ms-excel")},
        )

    cid_a = _make_contractor("ContractorA")
    cid_b = _make_contractor("ContractorB")
    contractor_role = _role_id(client, h, "Contractor")

    client.post(
        "/api/v1/admin/users",
        headers=h,
        json={
            "username": "user_a",
            "password": "Passw0rd!",
            "full_name": "User A",
            "role_id": contractor_role,
            "contractor_id": cid_a,
            "sees_all_provinces": False,
            "province_ids": [],
        },
    )

    basket = client.get("/api/v1/hc/basket", headers=h).json()
    assert len(basket) >= 2
    client.post(
        "/api/v1/hc/assignments",
        headers=h,
        json={"contractor_id": cid_a, "work_item_ids": [basket[0]["work_item_id"]]},
    )
    client.post(
        "/api/v1/hc/assignments",
        headers=h,
        json={"contractor_id": cid_b, "work_item_ids": [basket[1]["work_item_id"]]},
    )

    token_a = _login(client, "user_a", "Passw0rd!")
    h_a = {"Authorization": f"Bearer {token_a}"}
    r = client.get("/api/v1/hc/my/assignments", headers=h_a)
    assert r.status_code == 200
    assignments = r.json()
    assert len(assignments) == 1
    assert all(a["contractor_id"] == cid_a for a in assignments)


def test_cannot_delete_self(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    users = client.get("/api/v1/admin/users", headers=h).json()
    admin_user = next(u for u in users if u["username"] == "admin")
    r = client.delete(f"/api/v1/admin/users/{admin_user['id']}", headers=h)
    assert r.status_code == 400  # can't delete own account


def test_delete_regular_user_succeeds(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    contractor_role = _role_id(client, h, "Contractor")
    cid = _make_contractor("DeleteMeCo")
    r = client.post(
        "/api/v1/admin/users",
        headers=h,
        json={
            "username": "delete_me",
            "password": "Passw0rd!",
            "full_name": "Delete Me",
            "role_id": contractor_role,
            "contractor_id": cid,
            "sees_all_provinces": False,
            "province_ids": [],
        },
    )
    uid = r.json()["id"]
    r = client.delete(f"/api/v1/admin/users/{uid}", headers=h)
    assert r.status_code == 200
    # Confirm gone.
    users = client.get("/api/v1/admin/users", headers=h).json()
    assert all(u["id"] != uid for u in users)
