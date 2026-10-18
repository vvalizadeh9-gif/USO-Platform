"""The pending-work endpoints (``api/work_queues.py``) and what was removed.

* the Action Center's board, owners, feed and summary endpoints are gone (404);
* SLA days are an Admin setting, and a change shows on the next read;
* every user can turn their own digest off;
* a request letter sent to ICT moves a village onto My Work's "With
  authority" tab and onto the PM's follow-up queue, until it is answered.
"""
import os
import sys
from datetime import date

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_action_api_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Owner@12345"
API = "/api/v1"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_action_api_pytest.db"):
        os.remove("/tmp/uep_action_api_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    try:
        contractor = Contractor(name="Api Co", type="drive_test")
        db.add(contractor)
        db.flush()
        roles = {r.name: r for r in db.query(Role).all()}
        province = db.query(Province).order_by(Province.id).first()

        def user(username, role, **kw):
            db.add(User(
                username=username, password_hash=hash_password(PASSWORD),
                first_name=username, family_name="Api", role_id=roles[role].id,
                status=user_status.ACTIVE, **kw,
            ))

        user("a_pm", "PM", sees_all_provinces=True)
        user("a_coord", "Coordinator", sees_all_provinces=True)
        user("a_sc", "Contractor", contractor_id=contractor.id)
        user("a_power", "CpgPower", sees_all_provinces=True)
        user("a_rm", "RegionalManager", sees_all_provinces=True)
        user("a_viewer", "Viewer", sees_all_provinces=True)

        site = Site(site_code="API-1", province_id=province.id)
        db.add(site)
        db.flush()
        wi = WorkItem(
            site_id=site.id, site_type="Greenfield", requested_technology="4G",
            last_stage=C.STAGE_PERM_ONAIR, dt_status="Done",
            dt_sc_contractor_id=contractor.id,
        )
        db.add(wi)
        db.flush()
        db.add(Village(
            work_item_id=wi.id, village_code="API-V1", village_name="Api village",
            target_classification="هدف",
        ))
        db.commit()
    finally:
        db.close()


def _headers(client, username, password=PASSWORD):
    r = client.post(f"{API}/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


def _admin(client):
    return _headers(client, "admin", "Admin@12345")


# --------------------------------------------------------------------------
# The Action Center is gone
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path",
    ["/action-center/board", "/action-center/owners?queue=dt_review",
     "/action-center", "/action-center/summary"],
)
def test_the_action_center_endpoints_are_gone(client, path):
    assert client.get(f"{API}{path}", headers=_headers(client, "a_pm")).status_code == 404


def test_the_router_is_tagged_work_queues(client):
    spec = client.get("/openapi.json").json()["paths"]
    assert spec[f"{API}/admin/action-sla"]["get"]["tags"] == ["work-queues"]
    assert not [p for p in spec if p.startswith(f"{API}/action-center")]


# --------------------------------------------------------------------------
# SLA settings
# --------------------------------------------------------------------------
def test_the_deprecated_action_sla_reads_sla_policies(client):
    assert client.get(f"{API}/admin/action-sla", headers=_headers(client, "a_pm")).status_code == 403
    rows = client.get(f"{API}/admin/action-sla", headers=_admin(client)).json()
    by_key = {r["queue_key"]: r for r in rows}
    assert by_key["dt_review"]["sla_days"] == 1
    assert by_key["ict_to_file"]["sla_days"] == 14
    assert by_key["hc_fixes"]["configurable"] is False
    assert by_key["plan_submit"]["configurable"] is False


def test_changing_sla_policies_shows_on_the_next_read(client):
    admin = _admin(client)
    r = client.put(f"{API}/admin/sla-policies", headers=admin,
                   json={"changes": [{"step_key": "ict_file", "days": 3, "expected_days": 14}]})
    assert r.status_code == 200, r.text
    rows = client.get(f"{API}/admin/action-sla", headers=admin).json()
    assert {x["queue_key"]: x["sla_days"] for x in rows}["ict_to_file"] == 3
    # Out of range or unknown: 422. Stale expected value: 409.
    for bad in ({"step_key": "ict_file", "days": 0}, {"step_key": "nope", "days": 5}):
        assert client.put(f"{API}/admin/sla-policies", headers=admin,
                          json={"changes": [bad]}).status_code == 422
    assert client.put(f"{API}/admin/sla-policies", headers=admin, json={"changes": [
        {"step_key": "ict_file", "days": 5, "expected_days": 14}]}).status_code == 409
    # The old endpoint no longer writes a mapped queue.
    assert client.put(f"{API}/admin/action-sla", headers=admin,
                      json=[{"queue_key": "ict_to_file", "sla_days": 5}]).status_code == 422
    revert = client.post(f"{API}/admin/sla-policies/revert/{r.json()['change_id']}", headers=admin)
    assert revert.status_code == 200, revert.text
    assert {x["step_key"]: x["days"] for x in revert.json()["rows"]}["ict_file"] == 14
    assert client.get(f"{API}/admin/sla-policies", headers=_headers(client, "a_viewer")).status_code == 200


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------
def test_each_user_can_turn_their_digest_off_and_on(client):
    headers = _headers(client, "a_viewer")
    assert client.get(f"{API}/me/notifications", headers=headers).json() == {"email_digest": True}
    r = client.put(f"{API}/me/notifications", headers=headers, json={"email_digest": False})
    assert r.json() == {"email_digest": False}
    assert client.get(f"{API}/auth/me", headers=headers).json()["email_digest_enabled"] is False
    client.put(f"{API}/me/notifications", headers=headers, json={"email_digest": True})


# --------------------------------------------------------------------------
# Request letters: My Work's "With authority" and the PM's follow-up ticket
# --------------------------------------------------------------------------
def _village_id():
    from app.models.workitem import Village

    db = SessionLocal()
    try:
        return db.query(Village).filter(Village.village_code == "API-V1").one().id
    finally:
        db.close()


def _follow_up():
    """The PM's ICT follow-up queue, as Home and the digest count it."""
    from app.models.reference import User
    from app.services.action_queues.board import queue_summaries
    from app.services.action_queues.context import QueueContext
    from app.services.action_queues.registry import QUEUES_BY_KEY

    db = SessionLocal()
    try:
        pm = db.query(User).filter(User.username == "a_pm").one()
        return queue_summaries(QueueContext(db, pm), [QUEUES_BY_KEY["ict_follow_up"]])[0].count
    finally:
        db.close()


def test_sending_a_request_letter_puts_the_village_with_the_authority(client):
    vid = _village_id()
    sc = _headers(client, "a_sc")
    assert _follow_up() == 0

    r = client.post(f"{API}/acceptance/authority-requests", headers=sc, json={
        "authority": "ICT", "village_ids": [vid, 999999],
        "letter_number": "OUT-1", "letter_date": date(2026, 9, 30).isoformat(),
    })
    assert r.status_code == 201, r.text
    assert r.json()["recorded"] == 1
    assert {o["village_id"]: o["reason"] for o in r.json()["outcomes"]} == {
        vid: None, 999999: "not_found",
    }

    # Sending again while it is open is reported, not recorded twice.
    again = client.post(f"{API}/acceptance/authority-requests", headers=sc,
                        json={"authority": "ICT", "village_ids": [vid]}).json()
    assert again["outcomes"][0]["reason"] == "already_with_authority"

    assert _follow_up() == 1
    pm = _headers(client, "a_pm")
    tab = client.get(f"{API}/acceptance/my-work", headers=pm,
                     params={"tab": "with_authority", "authority": "ICT"}).json()
    assert tab["total"] == 1 and tab["rows"][0]["village_id"] == vid


def test_viewers_and_admin_cannot_send_requests(client):
    for headers in (_headers(client, "a_viewer"), _admin(client)):
        r = client.post(f"{API}/acceptance/authority-requests", headers=headers,
                        json={"authority": "CRA", "village_ids": [_village_id()]})
        assert r.status_code == 403
