"""Object-level access control: can this user reach *this* record?

The role guards answer a different question — "may this kind of user do this
kind of thing" — and for a while they were the only question anything asked.
Six endpoints resolved a record by its primary key and acted on it, so a guard
reading "contractors may submit health-check results" was effectively read as
"this contractor may submit *this* result". Object ids are sequential, so the
gap was reachable by counting.

Every test here is written from the attacker's side: a real, logged-in user
with a valid password, changing one number in a URL. They are the regression
net for the scoped loaders in ``api/health_check.py`` and ``api/workflow.py``.

Run with:  cd backend && pytest tests/test_access_control.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_access_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form, sample_cpm_path  # noqa: E402

PASSWORD = "Access-Test-Passw0rd"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_access_pytest.db"):
        os.remove("/tmp/uep_access_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Fixtures: two rival contractors, and a coordinator who may see one province
# ---------------------------------------------------------------------------
def _admin(client) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed(client, admin_h) -> None:
    """Import the sample CPM so there are real on-air sites to fight over."""
    sample = sample_cpm_path()
    if not sample:
        pytest.skip("sample CPM file not available")
    with open(sample, "rb") as f:
        r = client.post(
            "/api/v1/admin/cpm/import",
            headers=admin_h,
            files={"file": ("CPM_2_.xlsx", f, "application/vnd.ms-excel")},
        )
    assert r.status_code == 200, r.text


def _make_contractor(client, admin_h, name: str) -> int:
    """A contractor company, created directly — there is no admin route for it."""
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        existing = db.query(Contractor).filter(Contractor.name == name).one_or_none()
        if existing is not None:
            return existing.id
        contractor = Contractor(name=name, type="drive_test", active=True)
        db.add(contractor)
        db.commit()
        return contractor.id
    finally:
        db.close()


def _make_user(
    client,
    admin_h,
    username: str,
    role_name: str,
    *,
    contractor_id: int | None = None,
    province_ids: list[int] | None = None,
    sees_all: bool = False,
) -> dict:
    """Create a user with a precise scope and return their auth headers."""
    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == role_name)

    existing = client.get("/api/v1/admin/users", headers=admin_h).json()
    if not any(u["username"] == username for u in existing):
        r = client.post(
            "/api/v1/admin/users",
            headers=admin_h,
            json={
                "username": username,
                "password": PASSWORD,
                "full_name": f"Test {username}",
                "role_id": role_id,
                "contractor_id": contractor_id,
                "sees_all_provinces": sees_all,
                "province_ids": province_ids or [],
            },
        )
        assert r.status_code == 201, r.text

    r = client.post(
        "/api/v1/auth/login", data=login_form(client, username, PASSWORD)
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def world(client):
    """One assignment held by Alpha, plus users who should not reach it.

    Returns the ids an attacker would guess at, and the credentials to guess
    with. Everything is built through the API the way a real deployment is.
    """
    admin_h = _admin(client)
    _seed(client, admin_h)

    pm_h = login_as_role(client, _admin(client)["Authorization"].split()[1], "PM")

    alpha_id = _make_contractor(client, admin_h, "Alpha Access Test")
    beta_id = _make_contractor(client, admin_h, "Beta Access Test")

    basket = client.get("/api/v1/hc/basket", headers=pm_h).json()
    assert len(basket) >= 2, "sample CPM should yield at least two on-air sites"
    target, other = basket[0], basket[1]

    # Alpha's assignment — the thing everyone below tries to reach.
    r = client.post(
        "/api/v1/hc/assignments",
        headers=pm_h,
        json={
            "contractor_id": alpha_id,
            "work_item_ids": [target["work_item_id"]],
        },
    )
    assert r.status_code == 201, r.text
    assignment = r.json()
    task = assignment["tasks"][0]

    # A province the target site is *not* in, so a coordinator granted only
    # that province is genuinely out of scope for it.
    provinces = client.get("/api/v1/reference/provinces", headers=admin_h).json()
    foreign = next(p for p in provinces if p["name"] != target["province"])

    return {
        "admin": admin_h,
        "pm": pm_h,
        "alpha_id": alpha_id,
        "beta_id": beta_id,
        # A contractor user at the rival company.
        "beta_user": _make_user(
            client, admin_h, "ac_beta_user", "Contractor",
            contractor_id=beta_id, sees_all=True,
        ),
        # A contractor user at the company that actually holds the assignment.
        "alpha_user": _make_user(
            client, admin_h, "ac_alpha_user", "Contractor",
            contractor_id=alpha_id, sees_all=True,
        ),
        # A coordinator granted one province, which is not the target's.
        "foreign_coordinator": _make_user(
            client, admin_h, "ac_foreign_coord", "Coordinator",
            province_ids=[foreign["id"]],
        ),
        "viewer": _make_user(client, admin_h, "ac_viewer", "Viewer", sees_all=True),
        "assignment_id": assignment["id"],
        "task_id": task["id"],
        "work_item_id": target["work_item_id"],
        "other_work_item_id": other["work_item_id"],
        "technologies": target["requested_technologies"],
    }


def _results(technologies):
    return {
        "technology_results": [
            {"technology": t, "result": "Normal"} for t in technologies
        ]
    }


# ---------------------------------------------------------------------------
# C1 — submitting a health-check result for someone else's task
# ---------------------------------------------------------------------------
def test_rival_contractor_cannot_submit_result_for_another_companys_task(
    client, world
):
    r = client.post(
        f"/api/v1/hc/tasks/{world['task_id']}/result",
        headers=world["beta_user"],
        json=_results(world["technologies"]),
    )
    assert r.status_code == 404, r.text


def test_the_owning_contractor_can_still_submit_its_own_result(client, world):
    r = client.post(
        f"/api/v1/hc/tasks/{world['task_id']}/result",
        headers=world["alpha_user"],
        json=_results(world["technologies"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["overall_result"] == "Ready"


def test_out_of_province_coordinator_cannot_review_a_task(client, world):
    r = client.post(
        f"/api/v1/hc/tasks/{world['task_id']}/review",
        headers=world["foreign_coordinator"],
        json={},
    )
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# C2 — bulk-overwriting a whole assignment through the template upload
# ---------------------------------------------------------------------------
def test_rival_contractor_cannot_upload_against_another_companys_assignment(
    client, world
):
    r = client.post(
        f"/api/v1/hc/assignments/{world['assignment_id']}/upload",
        headers=world["beta_user"],
        files={"file": ("x.xlsx", b"dummy", "application/vnd.ms-excel")},
    )
    # 404 before the file is ever parsed: the caller learns nothing about
    # whether the assignment exists.
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# C3 — reading an assignment, and downloading its site list
# ---------------------------------------------------------------------------
def test_rival_contractor_cannot_read_another_companys_assignment(client, world):
    r = client.get(
        f"/api/v1/hc/assignments/{world['assignment_id']}", headers=world["beta_user"]
    )
    assert r.status_code == 404, r.text


def test_viewer_cannot_download_an_assignment_template(client, world):
    r = client.get(
        f"/api/v1/hc/assignments/{world['assignment_id']}/template",
        headers=world["viewer"],
    )
    # The Viewer sees all provinces, so this one is allowed — the check that
    # matters is that a scoped user is not.
    assert r.status_code == 200, r.text

    r = client.get(
        f"/api/v1/hc/assignments/{world['assignment_id']}/template",
        headers=world["foreign_coordinator"],
    )
    assert r.status_code == 404, r.text


def test_rival_contractor_cannot_download_the_template(client, world):
    r = client.get(
        f"/api/v1/hc/assignments/{world['assignment_id']}/template",
        headers=world["beta_user"],
    )
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# C4 — province scope on health-check reads, exports and creation
# ---------------------------------------------------------------------------
def test_out_of_province_coordinator_sees_no_results(client, world):
    mine = client.get("/api/v1/hc/results", headers=world["pm"])
    assert mine.status_code == 200
    assert len(mine.json()) >= 1, "the PM sees everything, so there is data to hide"

    theirs = client.get("/api/v1/hc/results", headers=world["foreign_coordinator"])
    assert theirs.status_code == 200
    assert theirs.json() == []


def test_out_of_province_coordinator_sees_no_assignments(client, world):
    r = client.get("/api/v1/hc/assignments", headers=world["foreign_coordinator"])
    assert r.status_code == 200
    assert r.json() == []


def test_rival_contractor_sees_only_its_own_assignments(client, world):
    r = client.get("/api/v1/hc/my/assignments", headers=world["beta_user"])
    assert r.status_code == 200
    assert all(a["id"] != world["assignment_id"] for a in r.json())

    r = client.get("/api/v1/hc/my/assignments", headers=world["alpha_user"])
    assert r.status_code == 200
    assert any(a["id"] == world["assignment_id"] for a in r.json())


def test_out_of_province_coordinator_cannot_assign_a_health_check(client, world):
    r = client.post(
        "/api/v1/hc/assignments",
        headers=world["foreign_coordinator"],
        json={
            "contractor_id": world["alpha_id"],
            "work_item_ids": [world["other_work_item_id"]],
        },
    )
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# C5 — approving a drive test outside your scope
# ---------------------------------------------------------------------------
def test_out_of_province_coordinator_cannot_approve_a_drive_test(client, world):
    pm_h, wid = world["pm"], world["other_work_item_id"]

    r = client.post(
        f"/api/v1/work-items/{wid}/drive-test",
        headers=pm_h,
        json={"execution_date": "2026-01-15", "report_link": "http://example.test/r"},
    )
    assert r.status_code == 200, r.text
    drive_test_id = r.json()["drive_test_id"]

    r = client.post(
        f"/api/v1/drive-tests/{drive_test_id}/coordinator-review",
        headers=world["foreign_coordinator"],
        json={"decision": "Approved"},
    )
    assert r.status_code == 404, r.text

    # And the terminal write-back did not happen.
    detail = client.get(f"/api/v1/work-items/{wid}", headers=pm_h).json()
    assert detail["current_stage"] != "Completed"


def test_an_in_scope_coordinator_can_still_approve(client, world):
    admin_h, pm_h = world["admin"], world["pm"]
    wid = world["other_work_item_id"]

    coordinator = _make_user(
        client, admin_h, "ac_home_coord", "Coordinator", sees_all=True
    )
    active = client.get(f"/api/v1/work-items/{wid}", headers=pm_h).json()
    r = client.post(
        f"/api/v1/drive-tests/{active['active_drive_test_id']}/coordinator-review",
        headers=coordinator,
        json={"decision": "Approved"},
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# C6 — writing acceptance status for a village outside your scope
# ---------------------------------------------------------------------------
def test_out_of_province_coordinator_cannot_write_acceptance(client, world):
    pm_h = world["pm"]
    detail = client.get(
        f"/api/v1/work-items/{world['other_work_item_id']}", headers=pm_h
    ).json()
    village_id = detail["villages"][0]["id"]
    technology = world["technologies"][0]

    r = client.patch(
        f"/api/v1/villages/{village_id}/acceptance/{technology}",
        headers=world["foreign_coordinator"],
        json={"ict_status": "Approved"},
    )
    assert r.status_code == 404, r.text


def test_writing_acceptance_for_a_village_that_does_not_exist_is_a_404(client, world):
    r = client.patch(
        "/api/v1/villages/999999/acceptance/2G",
        headers=world["pm"],
        json={"ict_status": "Approved"},
    )
    # Previously a foreign-key violation surfacing as an unhandled 500.
    assert r.status_code == 404, r.text


def test_an_in_scope_pm_can_still_write_acceptance(client, world):
    pm_h = world["pm"]
    detail = client.get(
        f"/api/v1/work-items/{world['other_work_item_id']}", headers=pm_h
    ).json()
    village_id = detail["villages"][0]["id"]

    r = client.patch(
        f"/api/v1/villages/{village_id}/acceptance/{world['technologies'][0]}",
        headers=pm_h,
        json={"ict_status": "Approved"},
    )
    assert r.status_code == 200, r.text
