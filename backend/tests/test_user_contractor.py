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

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form, sample_cpm_path  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_user_contractor_pytest.db"):
        os.remove("/tmp/uep_user_contractor_pytest.db")
    create_schema()
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
            "password": "Test-Fixture-Passphrase",
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

    sample = sample_cpm_path()
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
            "password": "Test-Fixture-Passphrase",
            "full_name": "User A",
            "role_id": contractor_role,
            "contractor_id": cid_a,
            "sees_all_provinces": False,
            "province_ids": [],
        },
    )

    basket = client.get("/api/v1/hc/basket", headers=h).json()
    assert len(basket) >= 2

    # Assigning a health check is a Coordinator/PM job, not an Admin one -- the
    # Admin/PM separation of duties. The status codes are asserted so that a
    # future permission change fails here loudly instead of leaving this test
    # quietly checking an empty list.
    pm = login_as_role(client, token, "PM")
    for contractor_id, item in ((cid_a, basket[0]), (cid_b, basket[1])):
        created = client.post(
            "/api/v1/hc/assignments",
            headers=pm,
            json={"contractor_id": contractor_id, "work_item_ids": [item["work_item_id"]]},
        )
        assert created.status_code == 201, created.text

    token_a = _login(client, "user_a", "Test-Fixture-Passphrase")
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


def test_deleting_a_regular_user_deactivates_them(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    contractor_role = _role_id(client, h, "Contractor")
    cid = _make_contractor("DeleteMeCo")
    r = client.post(
        "/api/v1/admin/users",
        headers=h,
        json={
            "username": "delete_me",
            "password": "Test-Fixture-Passphrase",
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

    # This endpoint deactivates rather than deletes: the row stays so that audit
    # entries and health-check reviews keep naming a real person. It is still
    # listed for an Admin, marked inactive, so it can be switched back on.
    # tests/test_user_deactivation.py covers this behaviour in full.
    users = client.get("/api/v1/admin/users", headers=h).json()
    deactivated = next((u for u in users if u["id"] == uid), None)
    assert deactivated is not None, "the user row must be kept"
    assert deactivated["active"] is False
