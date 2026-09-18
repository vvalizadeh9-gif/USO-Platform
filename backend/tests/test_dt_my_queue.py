"""My Drive Tests: a contractor's own view of dt_in_progress / dt_review.

One place for a contractor to work instead of knowing which sites to open on
Work Items. To Do is exactly Prompt 2's ``dt_in_progress`` queue, restricted
to this company's own active assignments -- the tests below assert that
parity directly, rather than trusting the docstring that promises it.

Run with:  cd backend && pytest tests/test_dt_my_queue.py -q
"""
import io
import os
import sys
from datetime import date

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_my_queue_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import ADMIN, CONTRACTOR, COORDINATOR, PM as PM_ROLE  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

# A one-pixel PNG. The evidence store checks magic bytes, so the content has
# to really be the type its extension claims.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006"
    "00057f9d1f0000000049454e44ae426082"
)


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_my_queue_pytest.db"):
        os.remove("/tmp/uep_dt_my_queue_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username, password="Owner@12345"):
    r = client.post(
        "/api/v1/auth/login", data=login_form(client, username, password)
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _make_contractor_user(db, *, username, contractor_id):
    from app.models.reference import Role, User

    role = db.query(Role).filter(Role.name == CONTRACTOR).one()
    user = db.query(User).filter(User.username == username).one_or_none()
    if user is None:
        user = User(
            username=username,
            password_hash=hash_password("Owner@12345"),
            first_name="Field", family_name=username,
            role_id=role.id, sees_all_provinces=False,
            contractor_id=contractor_id,
            status=user_status.ACTIVE,
        )
        db.add(user)
    else:
        user.contractor_id = contractor_id
    db.flush()
    return user


def _make_staff_user(db, *, role_name, username):
    from app.models.reference import Role, User

    role = db.query(Role).filter(Role.name == role_name).one()
    if db.query(User).filter(User.username == username).first() is None:
        db.add(User(
            username=username,
            password_hash=hash_password("Owner@12345"),
            first_name=role_name, family_name="User",
            role_id=role.id, sees_all_provinces=True,
            status=user_status.ACTIVE,
        ))


@pytest.fixture(scope="module")
def world(client):
    """Two drive-test contractors, staff users, and a fresh-site factory."""
    from app.models.reference import Contractor, Province

    db = SessionLocal()
    try:
        alpha = db.query(Contractor).filter(Contractor.name == "Alpha DT").one_or_none()
        if alpha is None:
            alpha = Contractor(name="Alpha DT", type="drive_test")
            db.add(alpha)
        beta = db.query(Contractor).filter(Contractor.name == "Beta DT").one_or_none()
        if beta is None:
            beta = Contractor(name="Beta DT", type="drive_test")
            db.add(beta)
        db.flush()

        province = db.query(Province).first()

        _make_staff_user(db, role_name=PM_ROLE, username="my_pm")
        _make_staff_user(db, role_name=COORDINATOR, username="my_coord")
        _make_staff_user(db, role_name=ADMIN, username="my_admin")
        alpha_user = _make_contractor_user(db, username="my_alpha", contractor_id=alpha.id)
        beta_user = _make_contractor_user(db, username="my_beta", contractor_id=beta.id)
        # A contractor account with no company at all.
        no_co_user = _make_contractor_user(db, username="my_noco", contractor_id=None)
        db.commit()

        out = {
            "province_id": province.id if province else None,
            "alpha_id": alpha.id,
            "beta_id": beta.id,
            "alpha_user": alpha_user.id,
            "beta_user": beta_user.id,
            "no_co_user": no_co_user.id,
        }
    finally:
        db.close()
    return out


_taken: set[str] = set()


def _fresh_site(world, prefix="MYQ"):
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        n = len(_taken)
        code = f"{prefix}-{n:04d}"
        while code in _taken:
            n += 1
            code = f"{prefix}-{n:04d}"
        _taken.add(code)
        site = Site(site_code=code, province_id=world["province_id"])
        db.add(site)
        db.flush()
        wi = WorkItem(
            site_id=site.id, site_type="Greenfield",
            requested_technology="2G", last_stage=C.STAGE_PERM_ONAIR,
            dt_status=None,
        )
        db.add(wi)
        db.commit()
        return wi.id, code
    finally:
        db.close()


def _confirm_ready(client, wi_id, contractor_id):
    r = client.post(
        "/api/v1/hc/assignments", headers=_login(client, "my_pm"),
        json={"contractor_id": contractor_id, "work_item_ids": [wi_id]},
    )
    task_id = r.json()["tasks"][0]["id"]
    client.post(
        f"/api/v1/hc/tasks/{task_id}/result", headers=_login(client, "my_pm"),
        json={"technology_results": [{"technology": "2G", "result": "Normal"}]},
    )
    client.post(
        f"/api/v1/hc/tasks/{task_id}/review", headers=_login(client, "my_pm"),
        json={"problem_categories": []},
    )


def _assign_dt(client, wi_id, contractor_id):
    r = client.post(
        "/api/v1/work-items/assign", headers=_login(client, "my_pm"),
        json={
            "work_item_ids": [wi_id], "contractor_id": contractor_id,
            "assignment_type": "official",
        },
    )
    assert r.status_code == 200, r.text


def _submit_dt(client, wi_id, username, execution_date=None):
    r = client.post(
        f"/api/v1/work-items/{wi_id}/drive-test", headers=_login(client, username),
        json={"execution_date": (execution_date or date.today()).isoformat()},
    )
    assert r.status_code == 200, r.text
    return r.json()["drive_test_id"]


def _decide_dt(client, dt_id, decision, comment=None):
    r = client.post(
        f"/api/v1/drive-tests/{dt_id}/coordinator-review",
        headers=_login(client, "my_coord"),
        json={"decision": decision, "comment": comment},
    )
    assert r.status_code == 200, r.text


def _queue(client, username, tab):
    r = client.get(
        "/api/v1/drive-tests/my/queue", headers=_login(client, username),
        params={"tab": tab},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _counts(client, username):
    r = client.get(
        "/api/v1/drive-tests/my/counts", headers=_login(client, username)
    )
    assert r.status_code == 200, r.text
    return r.json()


def _codes(rows):
    return {r["site_code"] for r in rows}


# ---------------- ownership ----------------
def test_a_contractor_sees_only_their_own_companys_sites_in_both_tabs(client, world):
    mine_id, mine_code = _fresh_site(world)
    theirs_id, theirs_code = _fresh_site(world)
    _confirm_ready(client, mine_id, world["alpha_id"])
    _confirm_ready(client, theirs_id, world["beta_id"])
    _assign_dt(client, mine_id, world["alpha_id"])
    _assign_dt(client, theirs_id, world["beta_id"])

    todo = _queue(client, "my_alpha", "todo")
    assert mine_code in _codes(todo)
    assert theirs_code not in _codes(todo)

    _submit_dt(client, mine_id, "my_alpha")
    _submit_dt(client, theirs_id, "my_beta")

    submitted = _queue(client, "my_alpha", "submitted")
    assert mine_code in _codes(submitted)
    assert theirs_code not in _codes(submitted)


def test_submitting_or_uploading_against_another_companys_site_is_refused(client, world):
    """Same answer as everywhere else in this codebase for out-of-scope: a
    contractor who has never held this site cannot even see it, so both the
    submit and the evidence-upload path answer the same 404 a nonexistent id
    would -- see ``_load_work_item`` / ``_load_drive_test`` /
    ``visibility.py``. The difference between "no" and "not yours" is
    deliberately not observable."""
    theirs_id, _code = _fresh_site(world)
    _confirm_ready(client, theirs_id, world["beta_id"])
    _assign_dt(client, theirs_id, world["beta_id"])

    r = client.post(
        f"/api/v1/work-items/{theirs_id}/drive-test", headers=_login(client, "my_alpha"),
        json={"execution_date": date.today().isoformat()},
    )
    assert r.status_code == 404, r.text

    dt_id = _submit_dt(client, theirs_id, "my_beta")
    r = client.post(
        f"/api/v1/drive-tests/{dt_id}/evidence", headers=_login(client, "my_alpha"),
        files={"file": ("route.png", io.BytesIO(PNG), "image/png")},
    )
    assert r.status_code == 404, r.text


# ---------------- To do parity with Prompt 2 ----------------
def test_todo_is_exactly_dt_in_progress_restricted_to_this_contractor(client, world):
    wi_id, code = _fresh_site(world)
    _confirm_ready(client, wi_id, world["alpha_id"])
    _assign_dt(client, wi_id, world["alpha_id"])

    staff_rows = client.get(
        "/api/v1/hc/queues/dt-in-progress", headers=_login(client, "my_pm")
    ).json()
    staff_codes_for_alpha = {
        r["site_code"] for r in staff_rows if r["contractor_name"] == "Alpha DT"
    }

    my_codes = _codes(_queue(client, "my_alpha", "todo"))
    assert code in staff_codes_for_alpha
    assert code in my_codes
    assert my_codes == staff_codes_for_alpha


# ---------------- walk one site ----------------
def test_walk_one_site_assigned_to_neither_tab(client, world):
    wi_id, code = _fresh_site(world)
    _confirm_ready(client, wi_id, world["alpha_id"])

    # Not yet assigned: in neither tab.
    assert code not in _codes(_queue(client, "my_alpha", "todo"))
    assert code not in _codes(_queue(client, "my_alpha", "submitted"))

    # Assigned: in To do.
    _assign_dt(client, wi_id, world["alpha_id"])
    assert code in _codes(_queue(client, "my_alpha", "todo"))
    row = next(r for r in _queue(client, "my_alpha", "todo") if r["site_code"] == code)
    assert row["status"] == "with_contractor"

    # Submit: in Submitted, not To do.
    dt_id = _submit_dt(client, wi_id, "my_alpha")
    assert code not in _codes(_queue(client, "my_alpha", "todo"))
    assert code in _codes(_queue(client, "my_alpha", "submitted"))

    # Sent back: in To do again, flagged, carrying the comment.
    _decide_dt(client, dt_id, "Rejected", comment="Route coverage incomplete")
    assert code not in _codes(_queue(client, "my_alpha", "submitted"))
    row = next(r for r in _queue(client, "my_alpha", "todo") if r["site_code"] == code)
    assert row["status"] == "sent_back"
    assert row["sent_back_comment"] == "Route coverage incomplete"
    assert row["active_drive_test_id"] == dt_id

    # Resubmit and approve: in neither tab, permanently.
    dt_id2 = _submit_dt(client, wi_id, "my_alpha")
    _decide_dt(client, dt_id2, "Approved")
    assert code not in _codes(_queue(client, "my_alpha", "todo"))
    assert code not in _codes(_queue(client, "my_alpha", "submitted"))


def test_a_contractor_returned_site_leaves_todo(client, world):
    wi_id, code = _fresh_site(world)
    _confirm_ready(client, wi_id, world["alpha_id"])
    _assign_dt(client, wi_id, world["alpha_id"])
    assert code in _codes(_queue(client, "my_alpha", "todo"))

    r = client.post(
        f"/api/v1/work-items/{wi_id}/return-to-coordinator",
        headers=_login(client, "my_alpha"), json={"reason": "Access road is closed"},
    )
    assert r.status_code == 200, r.text
    assert code not in _codes(_queue(client, "my_alpha", "todo"))


# ---------------- counts ----------------
def test_counts_equal_the_list_lengths(client, world):
    wi_id, _code = _fresh_site(world)
    _confirm_ready(client, wi_id, world["alpha_id"])
    _assign_dt(client, wi_id, world["alpha_id"])

    counts = _counts(client, "my_alpha")
    assert counts["todo"] == len(_queue(client, "my_alpha", "todo"))
    assert counts["submitted"] == len(_queue(client, "my_alpha", "submitted"))


# ---------------- access ----------------
def test_pm_coordinator_and_admin_get_403(client, world):
    for username in ("my_pm", "my_coord", "my_admin"):
        r = client.get(
            "/api/v1/drive-tests/my/queue", headers=_login(client, username),
            params={"tab": "todo"},
        )
        assert r.status_code == 403, f"{username}: {r.text}"
        r = client.get(
            "/api/v1/drive-tests/my/counts", headers=_login(client, username)
        )
        assert r.status_code == 403, f"{username}: {r.text}"


def test_a_contractor_without_a_company_gets_empty_lists_not_an_error(client, world):
    r = client.get(
        "/api/v1/drive-tests/my/queue", headers=_login(client, "my_noco"),
        params={"tab": "todo"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == []

    r = client.get(
        "/api/v1/drive-tests/my/queue", headers=_login(client, "my_noco"),
        params={"tab": "submitted"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == []

    assert _counts(client, "my_noco") == {"todo": 0, "submitted": 0}


def test_an_unknown_tab_gets_400(client, world):
    r = client.get(
        "/api/v1/drive-tests/my/queue", headers=_login(client, "my_alpha"),
        params={"tab": "anything-else"},
    )
    assert r.status_code == 400, r.text
