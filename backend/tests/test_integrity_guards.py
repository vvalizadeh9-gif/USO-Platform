"""Integrity: separation of duties, races, and the accountability trail.

Latent defects, mostly. Each needs a race, a year rollover, a deletion or a
second administrator before it fires, which is exactly why they survive to year
three of a deployment rather than being found in week one.

Run with:  cd backend && pytest tests/test_integrity_guards.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_integrity_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Integrity-Test-Passw0rd"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_integrity_pytest.db"):
        os.remove("/tmp/uep_integrity_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _admin(client) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(client, admin_h, name: str) -> int:
    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _make_user(client, admin_h, username: str, role: str) -> int:
    r = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": username,
            "password": PASSWORD,
            "full_name": f"Test {username}",
            "role_id": _role_id(client, admin_h, role),
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# M4 — the last administrator cannot lock everyone out
# ---------------------------------------------------------------------------
def test_the_last_admin_cannot_change_their_own_role_away(client):
    """The deactivation guard was a lock on one door of two.

    Deactivating the last admin was refused. Setting that same account's role
    to Viewer was not, and produced the same outcome: a platform nobody can
    administer, recoverable only with database access.
    """
    admin_h = _admin(client)
    me = client.get("/api/v1/admin/users", headers=admin_h).json()
    admin_row = next(u for u in me if u["username"] == "admin")

    r = client.patch(
        f"/api/v1/admin/users/{admin_row['id']}",
        headers=admin_h,
        json={"role_id": _role_id(client, admin_h, "Viewer")},
    )
    assert r.status_code == 400, r.text
    assert "last administrator" in r.json()["detail"]

    # And the account is untouched.
    after = client.get("/api/v1/admin/users", headers=admin_h).json()
    assert next(u for u in after if u["username"] == "admin")["role"]["name"] == "Admin"


def test_an_admin_can_be_demoted_once_another_admin_exists(client):
    admin_h = _admin(client)
    second_id = _make_user(client, admin_h, "ig_second_admin", "Admin")

    r = client.patch(
        f"/api/v1/admin/users/{second_id}",
        headers=admin_h,
        json={"role_id": _role_id(client, admin_h, "Viewer")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"]["name"] == "Viewer"


def test_changing_a_role_ends_that_users_sessions(client):
    """A token carries the role it was minted with, so it must not outlive it."""
    admin_h = _admin(client)
    user_id = _make_user(client, admin_h, "ig_role_change", "Viewer")

    r = client.post(
        "/api/v1/auth/login", data=login_form(client, "ig_role_change", PASSWORD)
    )
    token = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/v1/action-center", headers=token).status_code == 200

    client.patch(
        f"/api/v1/admin/users/{user_id}",
        headers=admin_h,
        json={"role_id": _role_id(client, admin_h, "PM")},
    )
    assert client.get("/api/v1/action-center", headers=token).status_code == 401


# ---------------------------------------------------------------------------
# M3 — the audit trail records where, not only who
# ---------------------------------------------------------------------------
def test_audit_entries_record_the_source_address(client):
    admin_h = _admin(client)
    _make_user(client, admin_h, "ig_audited", "Viewer")

    logs = client.get(
        "/api/v1/admin/audit-logs?limit=10", headers=admin_h
    ).json()["items"]
    user_entries = [e for e in logs if e["entity_type"] == "User"]
    assert user_entries, "creating a user should have been audited"
    assert user_entries[0]["ip_address"], (
        "ip_address has existed on the table since it was created, and until "
        "now no caller ever populated it"
    )


def test_a_forwarded_address_is_what_gets_recorded(client):
    """nginx sits in front, so the real client is in X-Forwarded-For."""
    admin_h = _admin(client)
    client.post(
        "/api/v1/admin/users",
        headers={**admin_h, "X-Forwarded-For": "203.0.113.42, 10.0.0.1"},
        json={
            "username": "ig_forwarded",
            "password": PASSWORD,
            "full_name": "Forwarded",
            "role_id": _role_id(client, admin_h, "Viewer"),
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    logs = client.get(
        "/api/v1/admin/audit-logs?limit=5", headers=admin_h
    ).json()["items"]
    assert any(e["ip_address"] == "203.0.113.42" for e in logs), (
        "the left-most forwarded address is the original client"
    )


# ---------------------------------------------------------------------------
# M2 — assignment codes come from the highest issued, not the row count
# ---------------------------------------------------------------------------
def test_assignment_codes_survive_a_deletion(client):
    """Counting rows meant a deletion reissued an existing code.

    Against a unique column that is a 500, appearing years later under
    conditions nobody tests for.
    """
    from datetime import datetime, timezone

    from app.models.health_check import HcAssignment
    from app.services.health_check import generate_assignment_code

    db = SessionLocal()
    try:
        year = datetime.now(timezone.utc).year
        for _ in range(3):
            db.add(
                HcAssignment(
                    code=generate_assignment_code(db),
                    contractor_id=1,
                    assigned_at=datetime.now(timezone.utc),
                    status="Open",
                )
            )
            db.flush()
        codes = {a.code for a in db.query(HcAssignment).all()}
        assert codes == {f"HC-{year}-0001", f"HC-{year}-0002", f"HC-{year}-0003"}

        # Remove one from the middle, as a cleanup or a correction would.
        db.delete(db.query(HcAssignment).filter_by(code=f"HC-{year}-0002").one())
        db.flush()

        # Counting rows would produce HC-<year>-0003 again, colliding.
        assert generate_assignment_code(db) == f"HC-{year}-0004"
    finally:
        db.rollback()
        db.close()


# ---------------------------------------------------------------------------
# L6 — deltas are scoped the same way the current figures are
# ---------------------------------------------------------------------------
def test_multi_province_deltas_sum_the_users_provinces(client):
    """A three-province user used to get the thirty-one-province baseline."""
    from app.api.drive_test import _previous_totals
    from app.core import jalali
    from app.models.acceptance import MonthlySnapshot
    from app.models.reference import Province, User

    db = SessionLocal()
    try:
        year, month = jalali.current_shamsi_period()
        prev_year, prev_month = jalali.previous_period(year, month)
        provinces = db.query(Province).order_by(Province.id).limit(2).all()
        assert len(provinces) == 2

        for index, province in enumerate(provinces):
            db.add(
                MonthlySnapshot(
                    shamsi_year=prev_year,
                    shamsi_month=prev_month,
                    province_id=province.id,
                    total_onair=10 * (index + 1),
                    total_dt_done=1 * (index + 1),
                    total_remaining=0,
                    total_ongoing=0,
                    total_problematic=0,
                    current_month_dt_done=0,
                )
            )
        # A global snapshot that a scoped user must NOT be handed.
        db.add(
            MonthlySnapshot(
                shamsi_year=prev_year,
                shamsi_month=prev_month,
                province_id=None,
                total_onair=99999,
                total_dt_done=99999,
                total_remaining=0,
                total_ongoing=0,
                total_problematic=0,
                current_month_dt_done=0,
            )
        )
        db.flush()

        scoped = db.query(User).filter(User.username == "admin").one()
        scoped.sees_all_provinces = False
        scoped.provinces = provinces
        db.flush()

        totals = _previous_totals(db, scoped)
        assert totals["total_onair"] == 30, totals   # 10 + 20, not 99999
        assert totals["total_dt_done"] == 3, totals  # 1 + 2
    finally:
        db.rollback()
        db.close()


def test_a_user_with_no_provinces_gets_no_baseline(client):
    """No snapshot beats a wrong one: the caller renders no delta at all."""
    from app.api.drive_test import _previous_totals
    from app.models.reference import User

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "admin").one()
        user.sees_all_provinces = False
        user.provinces = []
        db.flush()
        assert _previous_totals(db, user) == {}
    finally:
        db.rollback()
        db.close()
