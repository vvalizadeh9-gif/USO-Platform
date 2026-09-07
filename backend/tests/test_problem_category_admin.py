"""Admin CRUD for the remediation routing table.

The categories were always designed to be data: ``owner_role_id`` and
``sla_days`` are columns, permission checks ask ``Role.is_category_owner``
rather than comparing against a list of names, and seeding only fills in what
is missing so an administrator's choices survive a restart. The documentation
said an Admin could add a category and point it at a role. The API to do it
was never written, so the only way was a code change and a deploy.

The guards below are the interesting part. A category is not a label, it is a
routing rule, and the two ways to get it wrong both end with work nobody sees:
pointing it at a role that owns no queue, and switching it off while fixes are
still open against it.
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_catadmin_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import (  # noqa: E402
    CONTRACTOR,
    COORDINATOR,
    HUAWEI_CLEANUP,
    PM as PM_ROLE,
)
from app.core.security import hash_password  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_catadmin_pytest.db"):
        os.remove("/tmp/uep_catadmin_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Contractor, Role, User

    db = SessionLocal()
    try:
        if db.query(Contractor).first() is None:
            db.add(Contractor(name="Category Telecom", type="drive_test"))
        for role_name in (PM_ROLE, COORDINATOR, CONTRACTOR):
            role = db.query(Role).filter(Role.name == role_name).one()
            username = f"cat_{role_name.lower()}"
            if db.query(User).filter(User.username == username).first() is None:
                db.add(User(
                    username=username,
                    password_hash=hash_password("Owner@12345"),
                    first_name=role_name, family_name="User",
                    role_id=role.id, sees_all_provinces=True,
                    status=user_status.ACTIVE,
                ))
        db.commit()
    finally:
        db.close()


def _admin(client):
    r = client.post("/api/v1/auth/login", data=login_form(client))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _as(client, role_name):
    r = client.post(
        "/api/v1/auth/login",
        data=login_form(client, f"cat_{role_name.lower()}", "Owner@12345"),
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(name):
    from app.models.reference import Role

    db = SessionLocal()
    try:
        return db.query(Role).filter(Role.name == name).one().id
    finally:
        db.close()


def _by_name(client, headers, name):
    rows = client.get("/api/v1/admin/problem-categories", headers=headers).json()
    return next((r for r in rows if r["name"] == name), None)


# ---------------- reading ----------------
def test_lists_the_five_seeded_categories_with_their_routing(client):
    rows = client.get(
        "/api/v1/admin/problem-categories", headers=_admin(client)
    ).json()
    names = {r["name"] for r in rows}
    assert {
        "Managed Service", "CPG Project", "NWG RND",
        "Huawei Cleanup", "Temp Power",
    } <= names

    for row in rows:
        assert row["owner_role_name"], f"{row['name']} has no owning team"
        assert row["sla_days"] >= 1


def test_only_admin_may_read_the_routing_table(client):
    for role_name in (PM_ROLE, COORDINATOR, CONTRACTOR):
        r = client.get(
            "/api/v1/admin/problem-categories", headers=_as(client, role_name)
        )
        assert r.status_code == 403, f"{role_name}: {r.text}"


# ---------------- creating ----------------
def test_admin_can_add_a_category(client):
    headers = _admin(client)
    r = client.post(
        "/api/v1/admin/problem-categories",
        headers=headers,
        json={
            "name": "Fibre Backhaul",
            "owner_role_id": _role_id(HUAWEI_CLEANUP),
            "sla_days": 5,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Fibre Backhaul"
    assert body["sla_days"] == 5
    assert body["open_fixes"] == 0

    # And it is immediately routable, with no restart.
    live = client.get(
        "/api/v1/reference/problem-categories", headers=headers
    ).json()
    assert any(c["name"] == "Fibre Backhaul" for c in live)


def test_duplicate_names_are_refused(client):
    r = client.post(
        "/api/v1/admin/problem-categories",
        headers=_admin(client),
        json={"name": "Temp Power", "owner_role_id": _role_id(HUAWEI_CLEANUP)},
    )
    assert r.status_code == 409, r.text


def test_a_category_cannot_be_owned_by_a_role_with_no_queue(client):
    """Routing to a non-owner role would open fixes nobody can see.

    That role's screens do not include a fix queue and its permissions do not
    reach one, so the site would sit waiting on a team that is never shown it.
    """
    from app.models.reference import Role

    db = SessionLocal()
    try:
        staff_role_id = db.query(Role).filter(Role.name == COORDINATOR).one().id
    finally:
        db.close()

    r = client.post(
        "/api/v1/admin/problem-categories",
        headers=_admin(client),
        json={"name": "Misrouted", "owner_role_id": staff_role_id},
    )
    assert r.status_code == 400, r.text
    assert "nobody's queue" in r.json()["detail"]


# ---------------- updating ----------------
def test_renaming_keeps_the_same_row(client):
    """Renaming is the supported way to change wording, precisely because the
    id survives -- open fixes and historical rounds go on pointing at it."""
    headers = _admin(client)
    before = _by_name(client, headers, "Fibre Backhaul")

    r = client.patch(
        f"/api/v1/admin/problem-categories/{before['id']}",
        headers=headers,
        json={"name": "Fibre Transmission"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["id"] == before["id"]
    assert r.json()["name"] == "Fibre Transmission"


def test_sla_is_bounded(client):
    """Zero means every fix is late on arrival; a huge number disables the only
    pressure the remediation loop applies."""
    headers = _admin(client)
    category = _by_name(client, headers, "Fibre Transmission")
    for bad in (0, -3, 5000):
        r = client.patch(
            f"/api/v1/admin/problem-categories/{category['id']}",
            headers=headers,
            json={"sla_days": bad},
        )
        assert r.status_code == 422, f"sla_days={bad}: {r.text}"


def test_a_category_with_open_fixes_cannot_be_deactivated(client):
    """Switching it off would leave those fixes in a queue nobody looks at."""
    headers = _admin(client)
    category = _by_name(client, headers, "Temp Power")
    _open_a_fix_against(category["id"])

    r = client.patch(
        f"/api/v1/admin/problem-categories/{category['id']}",
        headers=headers,
        json={"active": False},
    )
    assert r.status_code == 409, r.text
    assert "still open" in r.json()["detail"]

    # The count is shown on the row so the refusal is not a surprise.
    assert _by_name(client, headers, "Temp Power")["open_fixes"] >= 1


def test_an_unused_category_can_be_deactivated_and_leaves_the_pickers(client):
    headers = _admin(client)
    category = _by_name(client, headers, "Fibre Transmission")

    r = client.patch(
        f"/api/v1/admin/problem-categories/{category['id']}",
        headers=headers,
        json={"active": False},
    )
    assert r.status_code == 200, r.text
    assert r.json()["active"] is False

    live = client.get(
        "/api/v1/reference/problem-categories", headers=headers
    ).json()
    assert not any(c["name"] == "Fibre Transmission" for c in live)


def test_there_is_no_delete_endpoint(client):
    """Deleting a category would delete the record of work done under it."""
    headers = _admin(client)
    category = _by_name(client, headers, "Fibre Transmission")
    r = client.delete(
        f"/api/v1/admin/problem-categories/{category['id']}", headers=headers
    )
    assert r.status_code in (404, 405), r.text


def _open_a_fix_against(category_id):
    from app.models.health_check import HcAssignment, HcRemediation, HcTask
    from app.models.reference import Contractor, ProblemCategory
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        contractor = db.query(Contractor).first()
        site = Site(site_code=f"CATADMIN-{category_id:04d}")
        db.add(site)
        db.flush()
        wi = WorkItem(site_id=site.id, site_type="Greenfield")
        db.add(wi)
        db.flush()

        now = datetime.now(timezone.utc)
        assignment = HcAssignment(
            code=f"HC-CATADMIN-{category_id}", contractor_id=contractor.id,
            assigned_at=now, status="Open",
        )
        db.add(assignment)
        db.flush()
        task = HcTask(
            hc_assignment_id=assignment.id, work_item_id=wi.id, round_no=1,
            overall_result="NotReady", completed_at=now,
        )
        db.add(task)
        db.flush()
        category = db.get(ProblemCategory, category_id)
        db.add(HcRemediation(
            hc_task_id=task.id, work_item_id=wi.id,
            problem_category_id=category_id,
            owner_role_id=category.owner_role_id,
            status=HcRemediation.STATUS_OPEN, opened_at=now,
        ))
        db.commit()
    finally:
        db.close()
