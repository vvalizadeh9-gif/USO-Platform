"""The Action Center's endpoints: who may read what, and the writes behind them.

* the board is served to PM, Coordinator, Contractor and problem owners and
  refused (403, not an empty board) to Regional Manager, Viewer and Admin;
* the legacy feed is deprecated and otherwise unchanged;
* the per-owner breakdown is PM and Coordinator only;
* SLA days are an Admin setting, and a change shows on the next board read;
* every user can turn their own digest off;
* a request letter sent to ICT moves a village onto My Work's "With
  authority" tab and onto the PM's follow-up ticket, until it is answered.
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

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
from app.models.action_center import DEFAULT_SLA_DAYS  # noqa: E402
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
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _admin(client):
    return _headers(client, "admin", "Admin@12345")


# --------------------------------------------------------------------------
# Access
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("username", "role"),
    [("a_pm", "PM"), ("a_coord", "Coordinator"), ("a_sc", "Contractor"),
     ("a_power", "Problem owner")],
)
def test_the_board_is_served_to_the_four_working_roles(client, username, role):
    r = client.get(f"{API}/action-center/board", headers=_headers(client, username))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == role
    assert body["totals"]["pending"] == sum(s["total"] for s in body["stages"])
    assert body["scope_label"]


@pytest.mark.parametrize("username", ["a_rm", "a_viewer"])
def test_regional_manager_and_viewer_are_refused_not_shown_an_empty_board(client, username):
    headers = _headers(client, username)
    assert client.get(f"{API}/action-center/board", headers=headers).status_code == 403


def test_admin_has_no_board(client):
    assert client.get(f"{API}/action-center/board", headers=_admin(client)).status_code == 403


def test_the_legacy_summary_still_works_and_is_marked_deprecated(client):
    r = client.get(f"{API}/action-center/summary", headers=_headers(client, "a_pm"),
                   params={"items": False})
    assert r.status_code == 200
    spec = client.get("/openapi.json").json()["paths"]
    assert spec[f"{API}/action-center/summary"]["get"]["deprecated"] is True


def test_the_board_lists_the_villages_to_file_with_its_link(client):
    body = client.get(f"{API}/action-center/board", headers=_headers(client, "a_sc")).json()
    ict = next(s for s in body["stages"] if s["key"] == "ict")
    ticket = next(t for t in ict["tickets"] if t["queue_key"] == "ict_to_file")
    assert ticket["count"] == 1
    assert ticket["url"] == "/my-work?authority=ICT&tab=not_filed"
    assert ticket["date_kind"] == "since"
    # Undated (no drive-test date): the clock starts at 1 Mehr 1405.
    assert ticket["oldest_started_at"].startswith("2026-09-22T20:30")


# --------------------------------------------------------------------------
# Per-owner breakdown
# --------------------------------------------------------------------------
def test_the_breakdown_is_for_pm_and_coordinator(client):
    for username in ("a_pm", "a_coord"):
        r = client.get(f"{API}/action-center/owners", params={"queue": "ict_to_file"},
                       headers=_headers(client, username))
        assert r.status_code == 200, r.text
    rows = client.get(f"{API}/action-center/owners", params={"queue": "ict_to_file"},
                      headers=_headers(client, "a_coord")).json()
    # The item is undated, so its clock started at 1 Mehr 1405 and it falls
    # overdue once the default SLA has passed since then. Worked out from now
    # rather than written down: a fixed 0 held only until 6 October 2026.
    started = datetime.fromisoformat(rows[0]["oldest_started_at"].replace("Z", "+00:00"))
    overdue = int(datetime.now(timezone.utc) - started > timedelta(days=DEFAULT_SLA_DAYS))
    assert rows == [{
        "owner_type": "contractor", "owner_id": rows[0]["owner_id"], "name": "Api Co",
        "count": 1, "overdue": overdue, "oldest_started_at": rows[0]["oldest_started_at"],
    }]
    for username in ("a_sc", "a_power", "a_rm", "a_viewer"):
        r = client.get(f"{API}/action-center/owners", params={"queue": "ict_to_file"},
                       headers=_headers(client, username))
        assert r.status_code == 403, username


def test_an_unknown_queue_is_404(client):
    r = client.get(f"{API}/action-center/owners", params={"queue": "nope"},
                   headers=_headers(client, "a_pm"))
    assert r.status_code == 404


# --------------------------------------------------------------------------
# SLA settings
# --------------------------------------------------------------------------
def test_sla_days_are_admin_only_and_default_to_fourteen(client):
    assert client.get(f"{API}/admin/action-sla", headers=_headers(client, "a_pm")).status_code == 403
    rows = client.get(f"{API}/admin/action-sla", headers=_admin(client)).json()
    by_key = {r["queue_key"]: r for r in rows}
    assert by_key["dt_review"]["sla_days"] == 14
    assert by_key["hc_fixes"]["configurable"] is False
    assert by_key["plan_submit"]["configurable"] is False


def test_changing_sla_days_shows_on_the_next_read(client):
    admin = _admin(client)
    r = client.put(f"{API}/admin/action-sla", headers=admin,
                   json=[{"queue_key": "ict_to_file", "sla_days": 3}])
    assert r.status_code == 200, r.text
    assert {x["queue_key"]: x["sla_days"] for x in r.json()}["ict_to_file"] == 3
    # Out of range, unknown, or a queue measured against its own due date.
    for bad in ({"queue_key": "ict_to_file", "sla_days": 0},
                {"queue_key": "nope", "sla_days": 5},
                {"queue_key": "hc_fixes", "sla_days": 5}):
        assert client.put(f"{API}/admin/action-sla", headers=admin, json=[bad]).status_code == 422
    client.put(f"{API}/admin/action-sla", headers=admin,
               json=[{"queue_key": "ict_to_file", "sla_days": 14}])


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


def _follow_up(client):
    body = client.get(f"{API}/action-center/board", headers=_headers(client, "a_pm")).json()
    tickets = {t["queue_key"]: t for s in body["stages"] for t in s["tickets"]}
    return tickets.get("ict_follow_up", {}).get("count", 0)


def test_sending_a_request_letter_puts_the_village_with_the_authority(client):
    vid = _village_id()
    sc = _headers(client, "a_sc")
    assert _follow_up(client) == 0

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

    assert _follow_up(client) == 1
    pm = _headers(client, "a_pm")
    tab = client.get(f"{API}/acceptance/my-work", headers=pm,
                     params={"tab": "with_authority", "authority": "ICT"}).json()
    assert tab["total"] == 1 and tab["rows"][0]["village_id"] == vid


def test_viewers_and_admin_cannot_send_requests(client):
    for headers in (_headers(client, "a_viewer"), _admin(client)):
        r = client.post(f"{API}/acceptance/authority-requests", headers=headers,
                        json={"authority": "CRA", "village_ids": [_village_id()]})
        assert r.status_code == 403
