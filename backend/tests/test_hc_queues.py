"""The active queues: an item is present exactly while its condition holds.

That is the whole rule, and it is what these tests assert. Nothing is pushed to
a queue and nothing is dismissed from one, so every test here follows the same
shape: perform the action that satisfies a queue's condition, check the item
appears, perform the action that resolves it, check it is gone.

The counts are covered too, because a badge that disagrees with the list behind
it is worse than no badge — a tab reading 3 that opens empty teaches people to
stop trusting the numbers.
"""
import os
import sys
from datetime import date

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_queues_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import (  # noqa: E402
    CONTRACTOR,
    COORDINATOR,
    CPG_POWER,
    PM as PM_ROLE,
)
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

POWER = "Temp Power"
PLANNING = "NWG RND"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_queues_pytest.db"):
        os.remove("/tmp/uep_queues_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        contractor = db.query(Contractor).first()
        if contractor is None:
            contractor = Contractor(name="Ariana Telecom", type="drive_test")
            db.add(contractor)
            db.flush()
        province = db.query(Province).first()

        for role_name, username in (
            (PM_ROLE, "pm"), (COORDINATOR, "coord"),
            (CONTRACTOR, "sc"), (CPG_POWER, "power"),
        ):
            role = db.query(Role).filter(Role.name == role_name).one()
            if db.query(User).filter(User.username == username).first() is None:
                db.add(User(
                    username=username,
                    password_hash=hash_password("Owner@12345"),
                    first_name=role_name, family_name="User",
                    role_id=role.id, sees_all_provinces=True,
                    contractor_id=(
                        contractor.id if role_name == CONTRACTOR else None
                    ),
                    status=user_status.ACTIVE,
                ))

        for n in range(20):
            code = f"QUEUE-{n:04d}"
            if db.query(Site).filter(Site.site_code == code).first():
                continue
            site = Site(site_code=code, province_id=province.id if province else None)
            db.add(site)
            db.flush()
            db.add(WorkItem(
                site_id=site.id, site_type="Greenfield",
                requested_technology="2G", last_stage=C.STAGE_PERM_ONAIR,
                dt_status=None,
            ))
        db.commit()
    finally:
        db.close()


def _h(client, username="pm"):
    r = client.post(
        "/api/v1/auth/login", data=login_form(client, username, "Owner@12345")
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


_taken: set[str] = set()


def _fresh_site():
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        rows = (
            db.query(WorkItem, Site)
            .join(Site, WorkItem.site_id == Site.id)
            .filter(Site.site_code.like("QUEUE-%"))
            .order_by(Site.site_code)
            .all()
        )
        for wi, site in rows:
            if site.site_code not in _taken:
                _taken.add(site.site_code)
                return wi.id, site.site_code
    finally:
        db.close()
    raise AssertionError("seed more QUEUE- sites")


def _queue(client, name, headers=None):
    r = client.get(f"/api/v1/hc/queues/{name}", headers=headers or _h(client))
    assert r.status_code == 200, r.text
    return r.json()


def _counts(client, headers=None):
    r = client.get("/api/v1/hc/queues/counts", headers=headers or _h(client))
    assert r.status_code == 200, r.text
    return r.json()


def _codes(rows):
    return {r.get("site_code") for r in rows}


def _assign_hc(client, wi_id):
    r = client.post(
        "/api/v1/hc/assignments", headers=_h(client),
        json={"contractor_id": _contractor_id(), "work_item_ids": [wi_id]},
    )
    assert r.status_code == 201, r.text
    return r.json()["tasks"][0]["id"]


def _submit(client, task_id, *, ok):
    result = (
        {"technology": "2G", "result": "Normal"}
        if ok
        else {"technology": "2G", "result": "NotNormal", "comment": "Down"}
    )
    r = client.post(
        f"/api/v1/hc/tasks/{task_id}/result", headers=_h(client),
        json={"technology_results": [result]},
    )
    assert r.status_code == 200, r.text


def _review(client, task_id, categories):
    r = client.post(
        f"/api/v1/hc/tasks/{task_id}/review", headers=_h(client),
        json={"problem_categories": categories},
    )
    assert r.status_code == 200, r.text


# ---------------- in progress ----------------
def test_in_progress_holds_a_site_only_while_it_is_unanswered(client):
    wi_id, code = _fresh_site()
    task_id = _assign_hc(client, wi_id)

    rows = _queue(client, "in-progress")
    assert any(code in (r["pending_sites"] or []) for r in rows)

    _submit(client, task_id, ok=True)

    rows = _queue(client, "in-progress")
    assert not any(code in (r["pending_sites"] or []) for r in rows)


# ---------------- review ----------------
def test_review_holds_a_result_only_until_it_is_decided(client):
    wi_id, code = _fresh_site()
    task_id = _assign_hc(client, wi_id)
    _submit(client, task_id, ok=True)

    r = client.get(
        "/api/v1/hc/results", headers=_h(client), params={"reviewed": False}
    )
    assert code in {row["site_code"] for row in r.json()}

    _review(client, task_id, [])

    r = client.get(
        "/api/v1/hc/results", headers=_h(client), params={"reviewed": False}
    )
    assert code not in {row["site_code"] for row in r.json()}

    # And it is in the archive, not lost.
    r = client.get(
        "/api/v1/hc/results", headers=_h(client), params={"reviewed": True}
    )
    assert code in {row["site_code"] for row in r.json()}


def test_review_rows_carry_the_round_and_requested_technologies(client):
    """Both were already in the payload; the table simply never showed them."""
    wi_id, code = _fresh_site()
    task_id = _assign_hc(client, wi_id)
    _submit(client, task_id, ok=True)

    r = client.get(
        "/api/v1/hc/results", headers=_h(client), params={"reviewed": False}
    )
    row = next(x for x in r.json() if x["site_code"] == code)
    assert row["round_no"] == 1
    assert row["requested_technologies"] == ["2G"]


# ---------------- remediation ----------------
def test_remediation_board_holds_a_fix_until_the_owner_closes_it(client):
    wi_id, code = _fresh_site()
    task_id = _assign_hc(client, wi_id)
    _submit(client, task_id, ok=False)
    _review(client, task_id, [POWER])

    rows = _queue(client, "remediations")
    assert code in _codes(rows)
    fix = next(r for r in rows if r["site_code"] == code)
    assert fix["category"] == POWER
    assert fix["technologies"] == ["2G"]

    client.post(
        f"/api/v1/hc/fixes/{fix['id']}/close", headers=_h(client, "power"),
        json={"note": "Battery replaced"},
    )
    assert code not in _codes(_queue(client, "remediations"))


def test_reroutes_holds_a_dispute_until_it_is_decided(client):
    wi_id, code = _fresh_site()
    task_id = _assign_hc(client, wi_id)
    _submit(client, task_id, ok=False)
    _review(client, task_id, [POWER])

    fix = next(r for r in _queue(client, "remediations") if r["site_code"] == code)
    assert code not in _codes(_queue(client, "reroutes"))

    client.post(
        f"/api/v1/hc/fixes/{fix['id']}/reroute", headers=_h(client, "power"),
        json={"to_category": PLANNING, "reason": "This is a planning issue"},
    )

    rows = _queue(client, "reroutes")
    dispute = next(r for r in rows if r["site_code"] == code)
    assert dispute["from_category"] == POWER
    assert dispute["to_category"] == PLANNING
    assert dispute["reason"] == "This is a planning issue"

    # A Coordinator may decide it — they choose the category in the first place.
    r = client.post(
        f"/api/v1/hc/fixes/{fix['id']}/reroute/decide",
        headers=_h(client, "coord"), json={"approve": True},
    )
    assert r.status_code == 200, r.text
    assert code not in _codes(_queue(client, "reroutes"))


# ---------------- drive test ----------------
def test_dt_assignment_holds_only_confirmed_ready_unassigned_sites(client):
    wi_id, code = _fresh_site()
    task_id = _assign_hc(client, wi_id)
    _submit(client, task_id, ok=True)

    # Passed but not yet confirmed: not assignable, so not in the queue.
    assert code not in _codes(_queue(client, "dt-assignment"))

    _review(client, task_id, [])
    assert code in _codes(_queue(client, "dt-assignment"))

    client.post(
        "/api/v1/work-items/assign", headers=_h(client),
        json={
            "work_item_ids": [wi_id], "contractor_id": _contractor_id(),
            "assignment_type": "official",
        },
    )
    assert code not in _codes(_queue(client, "dt-assignment"))


def test_the_dt_assignment_queue_never_offers_a_row_the_server_refuses(client):
    """Whatever is listed must actually be assignable.

    A queue that offers rows the assignment endpoint then rejects is worse than
    no queue, so the listing condition and the server's guard have to be the
    same condition — this asserts they are.
    """
    for row in _queue(client, "dt-assignment"):
        r = client.post(
            "/api/v1/work-items/assign", headers=_h(client),
            json={
                "work_item_ids": [row["work_item_id"]],
                "contractor_id": _contractor_id(),
                "assignment_type": "official",
            },
        )
        assert r.status_code == 200, f"{row['site_code']}: {r.text}"


def test_dt_review_holds_a_submission_until_it_is_decided(client):
    wi_id, code = _fresh_site()
    task_id = _assign_hc(client, wi_id)
    _submit(client, task_id, ok=True)
    _review(client, task_id, [])
    client.post(
        "/api/v1/work-items/assign", headers=_h(client),
        json={
            "work_item_ids": [wi_id], "contractor_id": _contractor_id(),
            "assignment_type": "official",
        },
    )

    assert code not in _codes(_queue(client, "dt-review"))

    r = client.post(
        f"/api/v1/work-items/{wi_id}/drive-test", headers=_h(client, "sc"),
        json={"execution_date": date.today().isoformat()},
    )
    dt_id = r.json()["drive_test_id"]

    rows = _queue(client, "dt-review")
    row = next(x for x in rows if x["site_code"] == code)
    assert row["contractor_name"]
    assert row["evidence"] == []

    client.post(
        f"/api/v1/drive-tests/{dt_id}/coordinator-review",
        headers=_h(client, "coord"), json={"decision": "Approved"},
    )
    assert code not in _codes(_queue(client, "dt-review"))


# ---------------- counts ----------------
def test_counts_match_the_lists_behind_them(client):
    """A badge that disagrees with its list teaches people to ignore badges."""
    counts = _counts(client)
    assert counts["remediation"] == len(_queue(client, "remediations"))
    assert counts["reroutes"] == len(_queue(client, "reroutes"))
    assert counts["dt_assignment"] == len(_queue(client, "dt-assignment"))
    assert counts["dt_review"] == len(_queue(client, "dt-review"))
    assert counts["in_progress"] == sum(
        r["sites_pending"] for r in _queue(client, "in-progress")
    )

    r = client.get(
        "/api/v1/hc/results", headers=_h(client), params={"reviewed": False}
    )
    assert counts["hc_review"] == len(r.json())


def test_both_peers_see_the_queues_and_nobody_else_does(client):
    for username in ("pm", "coord"):
        assert client.get(
            "/api/v1/hc/queues/counts", headers=_h(client, username)
        ).status_code == 200

    for username in ("sc", "power"):
        assert client.get(
            "/api/v1/hc/queues/counts", headers=_h(client, username)
        ).status_code == 403


def test_action_center_counters_lead_to_the_queues(client):
    r = client.get("/api/v1/action-center/summary", headers=_h(client))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "counters" in body and "items" in body

    counts = _counts(client)
    for counter in body["counters"]:
        if counter["key"] in counts:
            assert counter["count"] == counts[counter["key"]], counter
        # Every counter points somewhere, and never at a zero queue.
        assert counter["url"].startswith("/")
        assert counter["count"] > 0
