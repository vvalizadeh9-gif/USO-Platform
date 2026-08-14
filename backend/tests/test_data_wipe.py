"""Tests for the CPM data wipe feature and import history endpoint.

Run with:  cd backend && pytest tests/test_data_wipe.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_wipe_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, engine  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_wipe_pytest.db"):
        os.remove("/tmp/uep_wipe_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client):
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return r.json()["access_token"]


def _import_sample(client, token):
    sample = (_p if os.path.exists(_p := "/mnt/user-data/uploads/CPM_2_.xlsx") else "/mnt/user-data/uploads/CPM-Org_-_Copy.xlsx")
    if not sample:
        pytest.skip("sample CPM file not available")
    with open(sample, "rb") as f:
        return client.post(
            "/api/v1/admin/cpm/import",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("CPM_2_.xlsx", f, "application/vnd.ms-excel")},
        )


def test_wipe_requires_admin_role(client):
    token = _login(client)
    r = client.post(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "username": "coordwipe",
            "password": "Passw0rd!",
            "full_name": "Coord Wipe",
            "role_id": next(
                role["id"]
                for role in client.get(
                    "/api/v1/reference/roles",
                    headers={"Authorization": f"Bearer {token}"},
                ).json()
                if role["name"] == "Coordinator"
            ),
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    coord_token = _login_as(client, "coordwipe", "Passw0rd!")
    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {coord_token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 403


def _login_as(client, username, password):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    return r.json()["access_token"]


def test_wipe_rejects_wrong_confirmation_phrase(client):
    token = _login(client)
    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "delete everything"},
    )
    assert r.status_code == 400


def test_wipe_deletes_cpm_data_but_preserves_users(client):
    token = _login(client)
    _import_sample(client, token)

    before_items = client.get(
        "/api/v1/work-items", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert len(before_items) > 0  # sanity check the import actually seeded data

    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"]["work_items"] >= len(before_items)  # list is paginated
    assert body["total_deleted"] > 0

    after_items = client.get(
        "/api/v1/work-items", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert after_items == []

    # Users/roles/provinces must survive the wipe.
    users = client.get(
        "/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert any(u["username"] == "admin" for u in users)


def test_import_history_lists_batches(client):
    token = _login(client)
    _import_sample(client, token)  # re-seed since previous test wiped everything

    r = client.get(
        "/api/v1/admin/cpm/import-history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    history = r.json()
    assert len(history) >= 1
    assert "filename" in history[0]
    assert "created_at" in history[0]


def test_second_import_after_wipe_reseeds_cleanly(client):
    """After a wipe, the next import must go through seed mode again
    (no change requests, since there's nothing to diff against)."""
    token = _login(client)
    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 200

    resp = _import_sample(client, token)
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["changed_count"] == 0  # clean seed, not a diff
    assert summary["new_count"] > 0
