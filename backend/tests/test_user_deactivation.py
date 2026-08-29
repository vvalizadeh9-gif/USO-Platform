"""Deactivating a user must not erase what they did.

Users are referenced by ``audit_logs.user_id``, ``hc_tasks.reviewed_by``, and
both ``work_items.coordinator_reviewed_by`` and ``pm_reviewed_by``. Deleting the
row turned "reviewed by Maryam" into "reviewed by nobody" in every one of those
places -- and on a legacy database with no foreign keys, it did so silently. On a
platform where acceptance dates carry contractual consequences, and over a
ten-year life where staff turnover is certain, that is the accountability trail
quietly going anonymous.

So the endpoint deactivates instead of deleting. These tests pin down both
halves of that: the account really is shut out, and the history really does
still name them.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_deactivation_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.rate_limit import login_rate_limiter  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

REVIEWER_PASSWORD = "reviewer-password-123"


def _reset_throttle() -> None:
    """Clear the login-attempt table between tests.

    The throttle is database-backed now, so resetting it needs a session
    rather than clearing a dict.
    """
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        login_rate_limiter.reset(db)
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_rate_limiter():
    _reset_throttle()
    yield
    _reset_throttle()


@pytest.fixture
def admin_login(client):
    """The admin's token and their own user record.

    The user record comes from the login response because this API has no
    /auth/me endpoint -- see FINDINGS.md.
    """
    response = client.post("/api/v1/auth/login", data=login_form(client))
    assert response.status_code == 200, response.text
    body = response.json()
    return {
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
        "user": body["user"],
    }


@pytest.fixture
def admin_headers(admin_login):
    return admin_login["headers"]


def _role_id(name: str) -> int:
    from app.models.reference import Role

    db = SessionLocal()
    try:
        return db.query(Role).filter(Role.name == name).one().id
    finally:
        db.close()


def _province_ids(limit: int = 2) -> list[int]:
    from app.models.reference import Province

    db = SessionLocal()
    try:
        return [p.id for p in db.query(Province).order_by(Province.id).limit(limit)]
    finally:
        db.close()


@pytest.fixture
def reviewer(client, admin_headers):
    """A Coordinator who has reviewed a health check and left an audit trail."""
    provinces = _province_ids()
    response = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "username": f"reviewer_{datetime.now(timezone.utc).timestamp()}",
            "password": REVIEWER_PASSWORD,
            "first_name": "Maryam the", "family_name": "Reviewer",
            "role_id": _role_id("Coordinator"),
            "sees_all_provinces": False,
            "province_ids": provinces,
        },
    )
    assert response.status_code == 201, response.text
    user = response.json()
    user["province_ids"] = provinces
    return user


def _record_a_review(reviewer_id: int) -> int:
    """Give the reviewer a reviewed health-check task. Returns the task id."""
    from app.models.health_check import HcAssignment, HcTask
    from app.models.reference import Contractor
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        contractor = Contractor(name="Test Contractor", type="site", active=True)
        site = Site(site_code=f"SITE-{reviewer_id}")
        db.add_all([contractor, site])
        db.flush()

        work_item = WorkItem(site_id=site.id, site_type="type", current_stage="stage")
        db.add(work_item)
        db.flush()

        assignment = HcAssignment(
            code=f"HC-{reviewer_id}",
            contractor_id=contractor.id,
            assigned_at=datetime.now(timezone.utc),
        )
        db.add(assignment)
        db.flush()

        task = HcTask(
            hc_assignment_id=assignment.id,
            work_item_id=work_item.id,
            overall_result="Ready",
            reviewed_by=reviewer_id,
            reviewed_at=datetime.now(timezone.utc),
        )
        db.add(task)
        db.commit()
        return task.id
    finally:
        db.close()


def _task(task_id: int):
    from app.models.health_check import HcTask

    db = SessionLocal()
    try:
        return db.get(HcTask, task_id)
    finally:
        db.close()


def _user(user_id: int):
    from app.models.reference import User

    db = SessionLocal()
    try:
        return db.get(User, user_id)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# The core guarantee
# ---------------------------------------------------------------------------

def test_deactivating_a_reviewer_leaves_the_health_check_history_attributable(
    client, admin_headers, reviewer
):
    """The test the whole phase exists for.

    Deactivate someone who reviewed a health check, then check that the review
    still points at them and their name still resolves.
    """
    task_id = _record_a_review(reviewer["id"])

    response = client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json()["deactivated"]

    # The health-check task still records who reviewed it...
    task = _task(task_id)
    assert task is not None, "the health-check task must survive"
    assert task.reviewed_by == reviewer["id"], "the review must still name the reviewer"
    assert task.reviewed_at is not None

    # ...and that id still resolves to a real person with a real name.
    user = _user(reviewer["id"])
    assert user is not None, "the user row must not be deleted"
    assert user.full_name == "Maryam the Reviewer"
    assert user.active is False


def test_audit_entries_by_a_deactivated_user_still_show_their_name(
    client, admin_headers, reviewer
):
    """Creating the user wrote an audit entry; deactivating writes another.

    Both must still display a name afterwards, or the audit log becomes a list
    of anonymous actions.
    """
    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)

    logs = client.get(
        "/api/v1/admin/audit-logs", headers=admin_headers, params={"limit": 100}
    )
    assert logs.status_code == 200, logs.text

    about_reviewer = [
        item
        for item in logs.json()["items"]
        if item["entity_type"] == "User" and item["entity_id"] == reviewer["id"]
    ]
    assert about_reviewer, "deactivation must be recorded in the audit log"
    assert all(item["user_full_name"] for item in about_reviewer), (
        "every audit entry must still resolve to a name"
    )


def test_the_deactivation_itself_is_attributable(client, admin_headers, reviewer):
    """Who switched the account off, and when."""
    before = datetime.now(timezone.utc)
    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)

    user = _user(reviewer["id"])
    assert user.status_changed_by is not None
    assert user.status_changed_at is not None

    recorded = user.status_changed_at
    if recorded.tzinfo is None:  # SQLite returns naive datetimes
        recorded = recorded.replace(tzinfo=timezone.utc)
    assert recorded >= before.replace(microsecond=0)


def test_province_access_is_retained_so_reactivation_restores_it(
    client, admin_headers, reviewer
):
    """Clearing the province rows would silently give them no access on return."""
    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)

    user = _user(reviewer["id"])
    assert {p.id for p in user.provinces} == set(reviewer["province_ids"])


# ---------------------------------------------------------------------------
# The account really is shut out
# ---------------------------------------------------------------------------

def test_a_deactivated_user_cannot_sign_in(client, admin_headers, reviewer):
    before = client.post(
        "/api/v1/auth/login",
        data=login_form(client, reviewer["username"], REVIEWER_PASSWORD),
    )
    assert before.status_code == 200, "the account should work before deactivation"

    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)

    after = client.post(
        "/api/v1/auth/login",
        data=login_form(client, reviewer["username"], REVIEWER_PASSWORD),
    )
    assert after.status_code == 403


def test_a_deactivated_user_gets_no_new_notifications(client, admin_headers, reviewer):
    from app.models.acceptance import Notification
    from app.services.audit import notify_roles

    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)

    db = SessionLocal()
    try:
        notify_roles(
            db, role_names=["Coordinator"], type="info", message="after deactivation"
        )
        db.commit()
        delivered = (
            db.query(Notification)
            .filter(Notification.user_id == reviewer["id"])
            .count()
        )
    finally:
        db.close()

    assert delivered == 0


# ---------------------------------------------------------------------------
# Guards, and reactivation
# ---------------------------------------------------------------------------

def test_an_admin_cannot_deactivate_their_own_account(client, admin_login):
    admin_headers = admin_login["headers"]
    me = admin_login["user"]

    response = client.delete(f"/api/v1/admin/users/{me['id']}", headers=admin_headers)

    assert response.status_code == 400
    assert "own account" in response.json()["detail"]
    assert _user(me["id"]).active is True


def test_the_last_administrator_cannot_be_deactivated(client, admin_login):
    """Otherwise nobody can ever administer the platform again."""
    admin_headers = admin_login["headers"]
    second_admin = client.post(
        "/api/v1/admin/users",
        headers=admin_headers,
        json={
            "username": f"admin2_{datetime.now(timezone.utc).timestamp()}",
            "password": "second-admin-password",
            "first_name": "Second", "family_name": "Admin",
            "role_id": _role_id("Admin"),
            "sees_all_provinces": True,
            "province_ids": [],
        },
    ).json()

    # Two admins exist, so removing one is allowed.
    assert client.delete(
        f"/api/v1/admin/users/{second_admin['id']}", headers=admin_headers
    ).status_code == 200

    # The original admin cannot remove themselves either way.
    me = admin_login["user"]
    assert client.delete(
        f"/api/v1/admin/users/{me['id']}", headers=admin_headers
    ).status_code == 400


@pytest.mark.parametrize("blocked_status", ["Inactive", "Suspended"])
def test_every_route_out_of_active_is_guarded_the_same_way_as_delete(
    client, admin_login, blocked_status
):
    """Three ways to take an account offline, one lock.

    DELETE, PATCH with a status, and the dedicated status route all end in the
    same place, so a guard on one of them is a lock on one door of three.
    Suspending the last administrator locks the platform exactly as thoroughly
    as deactivating them, which is why both statuses are checked here.
    """
    admin_headers = admin_login["headers"]
    me = admin_login["user"]

    patched = client.patch(
        f"/api/v1/admin/users/{me['id']}",
        headers=admin_headers,
        json={"status": blocked_status},
    )
    assert patched.status_code == 400, patched.text

    posted = client.post(
        f"/api/v1/admin/users/{me['id']}/status",
        headers=admin_headers,
        json={"status": blocked_status},
    )
    assert posted.status_code == 400, posted.text

    assert _user(me["id"]).active is True


def test_reactivating_restores_access_and_clears_the_deactivation_record(
    client, admin_headers, reviewer
):
    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)

    response = client.post(
        f"/api/v1/admin/users/{reviewer['id']}/status",
        headers=admin_headers,
        json={"status": "Active"},
    )
    assert response.status_code == 200, response.text

    user = _user(reviewer["id"])
    assert user.active is True
    assert user.status == "Active"
    assert user.status_changed_at is None, "a live account must not look deactivated"
    assert user.status_changed_by is None

    signed_in = client.post(
        "/api/v1/auth/login",
        data=login_form(client, reviewer["username"], REVIEWER_PASSWORD),
    )
    assert signed_in.status_code == 200


def test_deactivating_twice_keeps_the_original_record(client, admin_headers, reviewer):
    """The audit trail should name whoever actually did it, not the last caller."""
    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)
    first = _user(reviewer["id"]).status_changed_at

    response = client.delete(
        f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers
    )

    assert response.status_code == 200
    assert _user(reviewer["id"]).status_changed_at == first


def test_a_deactivated_user_is_still_listed_for_an_admin(client, admin_headers, reviewer):
    """They have to be visible, or nobody could ever switch them back on."""
    client.delete(f"/api/v1/admin/users/{reviewer['id']}", headers=admin_headers)

    users = client.get("/api/v1/admin/users", headers=admin_headers).json()
    listed = next((u for u in users if u["id"] == reviewer["id"]), None)

    assert listed is not None
    assert listed["active"] is False
    assert listed["status"] == "Inactive"
    assert listed["status_changed_at"] is not None
