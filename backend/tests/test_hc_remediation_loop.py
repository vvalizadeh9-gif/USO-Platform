"""End-to-end tests for the health-check remediation loop.

Covers the cycle that makes a Not-Ready site come back by itself:

    basket -> assign -> SC fails it -> PM triages N categories
      -> owners fix in parallel -> last fix closing returns it to the basket
      -> re-check as round 2

Plus the guards around it: an owner only sees their own category, a site with
two owners does not return until both are done, and "not my area" moves a fix
only once a PM approves.

Data is seeded directly rather than via a CPM import so these run everywhere,
including environments without the sample spreadsheet.
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_hcloop_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import CPG_POWER, NWG_PLANNING, PM as PM_ROLE  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

POWER = "Temp Power"
PLANNING = "NWG RND"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_hcloop_pytest.db"):
        os.remove("/tmp/uep_hcloop_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed_fixtures()
        yield c


def _seed_fixtures() -> None:
    """One contractor, one on-air site per test, and an owner user per role."""
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        if db.query(Contractor).first() is None:
            db.add(Contractor(name="Ariana Telecom", type="drive_test"))
        province = db.query(Province).first()

        # Admin is deliberately barred from workflow writes, so the PM drives
        # the flow in these tests just as they would in production.
        for role_name in (PM_ROLE, CPG_POWER, NWG_PLANNING):
            role = db.query(Role).filter(Role.name == role_name).one()
            username = role_name.lower()
            if db.query(User).filter(User.username == username).first() is None:
                db.add(
                    User(
                        username=username,
                        password_hash=hash_password("Owner@12345"),
                        first_name=role_name, family_name="User",
                        role_id=role.id,
                        sees_all_provinces=True,
                        status=user_status.ACTIVE,
                    )
                )

        # One on-air site per test that consumes one, plus headroom.
        for n in range(14):
            code = f"LOOP-{n:04d}"
            if db.query(Site).filter(Site.site_code == code).first():
                continue
            site = Site(site_code=code, province_id=province.id if province else None)
            db.add(site)
            db.flush()
            db.add(
                WorkItem(
                    site_id=site.id,
                    site_type="Greenfield",
                    requested_technology="2G,3G,4G",
                    last_stage=C.STAGE_PERM_ONAIR,
                    dt_status=None,
                )
            )
        db.commit()
    finally:
        db.close()


def _headers(client, username="pm", password="Owner@12345"):
    r = client.post(
        "/api/v1/auth/login", data=login_form(client, username, password)
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _contractor_id():
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        return db.query(Contractor).first().id
    finally:
        db.close()


def _assign(client, h, work_item_id):
    """Raise a health check for one named site; return its task."""
    r = client.post(
        "/api/v1/hc/assignments",
        headers=h,
        json={"contractor_id": _contractor_id(), "work_item_ids": [work_item_id]},
    )
    assert r.status_code == 201, r.text
    return r.json()["tasks"][0]


def _take_site(client, h):
    """Assign a fresh pool site for health check; return (site, task).

    "Fresh" is ``hc_state == "New"``: never health-checked. The pool holds
    every on-air site whose drive test is not Done, including the ones these
    tests have already worked, so taking ``basket[0]`` would hand every test
    the same site and the fix queues would pile up on it.
    """
    basket = client.get("/api/v1/hc/basket", headers=h).json()
    fresh = [b for b in basket if b["hc_state"] == "New" and b["assignable"]]
    assert fresh, "expected at least one site that has never been checked"
    site = fresh[0]
    r = client.post(
        "/api/v1/hc/assignments",
        headers=h,
        json={
            "contractor_id": _contractor_id(),
            "work_item_ids": [site["work_item_id"]],
        },
    )
    assert r.status_code == 201, r.text
    return site, r.json()["tasks"][0]


def _fail(client, h, task, techs, comment="4G not radiating, generator 6h/day"):
    results = [{"technology": techs[0], "result": "NotNormal", "comment": comment}]
    results += [{"technology": t, "result": "Normal"} for t in techs[1:]]
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/result",
        headers=h,
        json={"technology_results": results},
    )
    assert r.status_code == 200, r.text
    assert r.json()["overall_result"] == "NotReady"


def _pass(client, h, task, techs):
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/result",
        headers=h,
        json={
            "technology_results": [
                {"technology": t, "result": "Normal"} for t in techs
            ]
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["overall_result"] == "Ready"


def _in_basket(client, h, work_item_id):
    basket = client.get("/api/v1/hc/basket", headers=h).json()
    return next((b for b in basket if b["work_item_id"] == work_item_id), None)


def _pool_state(client, h, work_item_id):
    """Where the pool says this site is in the health-check loop.

    A site never leaves the pool until its drive test is Done -- the pool is
    the quantity of on-air sites that still owe a health check, not the list
    of what can be assigned this minute. What used to be tested as "is it in
    the basket" is therefore tested as "what does the basket say about it".
    """
    row = _in_basket(client, h, work_item_id)
    assert row is not None, "an on-air site with no drive test is always in the pool"
    return row["hc_state"]


# ---------------------------------------------------------------- triage ----
def test_triage_opens_one_fix_per_category(client):
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])

    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_categories": [POWER, PLANNING]},
    )
    assert r.status_code == 200, r.text

    from app.models.health_check import HcRemediation

    db = SessionLocal()
    try:
        fixes = (
            db.query(HcRemediation)
            .filter(HcRemediation.hc_task_id == task["id"])
            .all()
        )
        assert len(fixes) == 2
        assert all(f.closed_at is None for f in fixes)
        # Each fix carries the SLA of its own category (7d power, 14d planning).
        spans = sorted((f.due_at - f.opened_at).days for f in fixes)
        assert spans == [7, 14]
    finally:
        db.close()


def test_not_ready_still_needs_a_category(client):
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])

    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/review", headers=h, json={"problem_categories": []}
    )
    assert r.status_code == 400


def test_single_category_payload_still_accepted(client):
    """The superseded single-value field keeps older clients working."""
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])

    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_category": POWER},
    )
    assert r.status_code == 200, r.text
    assert r.json()["problem_category"] == POWER


# ----------------------------------------------------------- owner queue ----
def test_owner_sees_only_their_own_category(client):
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])
    client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_categories": [POWER, PLANNING]},
    )

    power_q = client.get(
        "/api/v1/hc/my/fixes", headers=_headers(client, "cpgpower", "Owner@12345")
    ).json()
    nwg_q = client.get(
        "/api/v1/hc/my/fixes", headers=_headers(client, "nwgplanning", "Owner@12345")
    ).json()

    mine = [f for f in power_q if f["work_item_id"] == site["work_item_id"]]
    theirs = [f for f in nwg_q if f["work_item_id"] == site["work_item_id"]]
    assert len(mine) == 1 and mine[0]["category"] == POWER
    assert len(theirs) == 1 and theirs[0]["category"] == PLANNING
    # Each owner is told the other is still holding the site.
    assert mine[0]["also_waiting_on"] == [PLANNING]
    assert mine[0]["issue"]  # the SC's comment is carried through


def test_owner_cannot_close_another_teams_fix(client):
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])
    client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_categories": [PLANNING]},
    )

    nwg_fix = [
        f
        for f in client.get(
            "/api/v1/hc/my/fixes",
            headers=_headers(client, "nwgplanning", "Owner@12345"),
        ).json()
        if f["work_item_id"] == site["work_item_id"]
    ][0]

    r = client.post(
        f"/api/v1/hc/fixes/{nwg_fix['id']}/close",
        headers=_headers(client, "cpgpower", "Owner@12345"),
        json={"note": "not mine to close"},
    )
    assert r.status_code == 403


# ------------------------------------------------------------ the loop ------
def test_site_returns_only_after_every_fix_closes(client):
    h = _headers(client)
    site, task = _take_site(client, h)
    wid = site["work_item_id"]
    _fail(client, h, task, site["requested_technologies"])
    client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_categories": [POWER, PLANNING]},
    )

    # Being worked on: out of the basket entirely.
    assert _pool_state(client, h, wid) == "Fix in progress"

    power_h = _headers(client, "cpgpower", "Owner@12345")
    nwg_h = _headers(client, "nwgplanning", "Owner@12345")

    power_fix = [
        f for f in client.get("/api/v1/hc/my/fixes", headers=power_h).json()
        if f["work_item_id"] == wid
    ][0]
    r = client.post(
        f"/api/v1/hc/fixes/{power_fix['id']}/close",
        headers=power_h,
        json={"note": "Battery bank replaced"},
    )
    assert r.status_code == 200, r.text
    # One owner done is not enough — the other still holds it.
    assert r.json()["returned_to_basket"] is False
    assert _pool_state(client, h, wid) == "Fix in progress", (
        "one of two fixes closed is not the site coming back"
    )

    nwg_fix = [
        f for f in client.get("/api/v1/hc/my/fixes", headers=nwg_h).json()
        if f["work_item_id"] == wid
    ][0]
    r = client.post(
        f"/api/v1/hc/fixes/{nwg_fix['id']}/close",
        headers=nwg_h,
        json={"note": "Microwave plan re-issued"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["returned_to_basket"] is True

    # Back in the basket by itself, flagged as round 2 with a reason.
    row = _in_basket(client, h, wid)
    assert row is not None
    assert row["hc_state"] == "Ready for re-check"
    assert row["assignable"] is True
    assert row["round_no"] == 2
    assert row["returning_reason"]

    # Re-check passes → it leaves the loop for good.
    task2 = _assign(client, h, wid)
    assert task2["work_item_id"] == wid
    assert task2["round_no"] == 2
    _pass(client, h, task2, site["requested_technologies"])
    assert _pool_state(client, h, wid) == "Health check passed"


def test_untriaged_failure_reads_as_awaiting_triage(client):
    """A failed-but-untriaged site waits on the PM, and says so.

    It stays in the pool -- it is on-air and its drive test is not Done --
    but nobody should read it as work waiting to be assigned.
    """
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])
    assert _pool_state(client, h, site["work_item_id"]) == "Awaiting triage"


# --------------------------------------------------------------- reroute ----
def test_reroute_moves_the_fix_only_after_pm_approves(client):
    h = _headers(client)
    site, task = _take_site(client, h)
    wid = site["work_item_id"]
    _fail(client, h, task, site["requested_technologies"])
    client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_categories": [POWER]},
    )

    power_h = _headers(client, "cpgpower", "Owner@12345")
    nwg_h = _headers(client, "nwgplanning", "Owner@12345")
    fix = [
        f for f in client.get("/api/v1/hc/my/fixes", headers=power_h).json()
        if f["work_item_id"] == wid
    ][0]

    # A reason is mandatory — "not mine" alone is not actionable.
    r = client.post(
        f"/api/v1/hc/fixes/{fix['id']}/reroute",
        headers=power_h,
        json={"to_category": PLANNING, "reason": "   "},
    )
    assert r.status_code == 400

    r = client.post(
        f"/api/v1/hc/fixes/{fix['id']}/reroute",
        headers=power_h,
        json={"to_category": PLANNING, "reason": "Transmission design never issued"},
    )
    assert r.status_code == 200, r.text

    # Until a PM decides, the fix stays with the proposing owner.
    still_mine = client.get("/api/v1/hc/my/fixes", headers=power_h).json()
    assert any(f["work_item_id"] == wid and f["reroute_pending"] for f in still_mine)
    assert not any(f["work_item_id"] == wid
                   for f in client.get("/api/v1/hc/my/fixes", headers=nwg_h).json())

    r = client.post(
        f"/api/v1/hc/fixes/{fix['id']}/reroute/decide",
        headers=h,
        json={"approve": True},
    )
    assert r.status_code == 200, r.text

    assert not any(f["work_item_id"] == wid
                   for f in client.get("/api/v1/hc/my/fixes", headers=power_h).json())
    moved = [f for f in client.get("/api/v1/hc/my/fixes", headers=nwg_h).json()
             if f["work_item_id"] == wid]
    assert len(moved) == 1
    assert moved[0]["category"] == PLANNING


# --------------------------------------------------------------- history ----
def test_site_history_covers_every_round(client):
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])
    client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_categories": [POWER]},
    )
    power_h = _headers(client, "cpgpower", "Owner@12345")
    fix = [
        f for f in client.get("/api/v1/hc/my/fixes", headers=power_h).json()
        if f["work_item_id"] == site["work_item_id"]
    ][0]
    client.post(
        f"/api/v1/hc/fixes/{fix['id']}/close",
        headers=power_h,
        json={"note": "Rectifier replaced"},
    )

    events = client.get(
        f"/api/v1/hc/sites/{site['work_item_id']}/history", headers=h
    ).json()
    kinds = [e["kind"] for e in events]
    assert "assigned" in kinds
    assert "failed" in kinds
    assert "routed" in kinds
    assert "fixed" in kinds
    # Newest first, and the owner's note is preserved verbatim.
    fixed = next(e for e in events if e["kind"] == "fixed")
    assert fixed["detail"] == "Rectifier replaced"
    assert fixed["aging"]


def test_history_is_visible_to_a_category_owner(client):
    """History is readable by a category owner, not only by a PM.

    The routing is the premise, not decoration: a category owner sees a site
    because a fix is routed to their role (``apply_work_item_scope``), so the
    triage below is what puts this site in their scope at all. It used to be
    left implicit and passed on whichever site the previous test happened to
    leave at the head of the queue.
    """
    h = _headers(client)
    site, task = _take_site(client, h)
    _fail(client, h, task, site["requested_technologies"])
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_categories": [POWER]},
    )
    assert r.status_code == 200, r.text

    r = client.get(
        f"/api/v1/hc/sites/{site['work_item_id']}/history",
        headers=_headers(client, "cpgpower", "Owner@12345"),
    )
    assert r.status_code == 200
    assert r.json()
