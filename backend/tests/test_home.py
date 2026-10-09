"""UEP Home's read: the rules it adds to the Action Center, and its endpoint.

* an item is exactly one of late, due soon or on time, at the window's edges;
* "next" is most late, then oldest, then most items, then registry order;
* the endpoint is served to the board's four roles and refused to the rest;
* its figures add up: statuses to counts, tickets to totals, badges to tickets;
* "done today" counts this user's own acts, in Tehran days;
* the week's change reads this user's snapshot, and is None without one;
* the board itself is unchanged by any of this.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_home_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali, user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from app.services.action_queues import sla  # noqa: E402
from app.services.action_queues.board import QueueSummary, up_next  # noqa: E402
from app.services.action_queues.registry import QUEUES_BY_KEY  # noqa: E402
from app.services.action_queues.types import PendingItem, SlaKind  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Owner@12345"
API = "/api/v1"
NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)
WINDOW = timedelta(days=3)


# --------------------------------------------------------------------------
# Due soon: the window's edges
# --------------------------------------------------------------------------
def _due(delta: timedelta) -> PendingItem:
    return PendingItem("x", None, due_at=NOW + delta)


@pytest.mark.parametrize(
    ("delta", "expected"),
    [
        (timedelta(days=3), sla.DUE_SOON),                       # exactly at the edge
        (timedelta(days=3, seconds=1), sla.ON_TIME),             # just outside it
        (timedelta(seconds=0), sla.DUE_SOON),                    # due this instant
        (timedelta(seconds=-1), sla.LATE),                       # late is never also soon
    ],
)
def test_a_dated_item_is_late_due_soon_or_on_time(delta, expected):
    assert sla.item_status(_due(delta), SlaKind.DEADLINE, 14, NOW, WINDOW) == expected


def test_an_sla_item_is_due_soon_in_the_last_three_days_of_its_sla():
    started = NOW - timedelta(days=11)  # 14-day SLA: late in exactly 3 days
    item = PendingItem("x", started)
    assert sla.item_status(item, SlaKind.CONFIGURED, 14, NOW, WINDOW) == sla.DUE_SOON
    assert sla.item_status(item, SlaKind.CONFIGURED, 15, NOW, WINDOW) == sla.ON_TIME
    assert sla.item_status(item, SlaKind.CONFIGURED, 10, NOW, WINDOW) == sla.LATE


def test_late_on_home_is_exactly_late_on_the_board():
    for days in range(0, 30):
        item = PendingItem("x", NOW - timedelta(days=days, hours=3))
        late = sla.item_status(item, SlaKind.CONFIGURED, 14, NOW, WINDOW) == sla.LATE
        assert late == sla.is_overdue(item, SlaKind.CONFIGURED, 14, NOW)


def test_an_item_with_no_due_date_is_never_due_soon():
    item = PendingItem("x", None, due_at=None)
    assert sla.item_status(item, SlaKind.CATEGORY, 14, NOW, WINDOW) == sla.ON_TIME


# --------------------------------------------------------------------------
# Up next
# --------------------------------------------------------------------------
def _s(key, count, overdue, oldest_days_ago):
    return QueueSummary(
        queue=QUEUES_BY_KEY[key], count=count, overdue=overdue,
        oldest_started_at=NOW - timedelta(days=oldest_days_ago), earliest_due_at=None,
    )


def test_up_next_is_the_queue_with_the_most_late_items():
    picked = up_next([_s("hc_review", 20, 1, 40), _s("dt_review", 9, 3, 5)])
    assert picked.queue.key == "dt_review"


def test_up_next_breaks_a_tie_on_late_by_the_oldest_item():
    picked = up_next([_s("hc_review", 9, 2, 10), _s("dt_review", 9, 2, 30)])
    assert picked.queue.key == "dt_review"


def test_up_next_then_breaks_by_the_most_items():
    picked = up_next([_s("hc_review", 4, 0, 10), _s("dt_review", 9, 0, 10)])
    assert picked.queue.key == "dt_review"


def test_up_next_is_stable_on_a_full_tie_and_skips_empty_queues():
    picked = up_next([_s("dt_review", 5, 0, 10), _s("hc_review", 5, 0, 10), _s("hc_assign", 0, 0, 1)])
    assert picked.queue.key == "hc_review"  # first in the registry


def test_up_next_is_none_when_nothing_is_pending():
    assert up_next([_s("hc_review", 0, 0, 1)]) is None
    assert up_next([]) is None


# --------------------------------------------------------------------------
# The endpoint
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_home_pytest.db"):
        os.remove("/tmp/uep_home_pytest.db")
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
        contractor = Contractor(name="Home Co", type="drive_test")
        db.add(contractor)
        db.flush()
        roles = {r.name: r for r in db.query(Role).all()}
        province = db.query(Province).order_by(Province.id).first()

        def user(username, role, **kw):
            db.add(User(
                username=username, password_hash=hash_password(PASSWORD),
                first_name=username, family_name="Home", role_id=roles[role].id,
                status=user_status.ACTIVE, **kw,
            ))

        user("h_pm", "PM", sees_all_provinces=True)
        user("h_coord", "Coordinator", sees_all_provinces=True)
        user("h_sc", "Contractor", contractor_id=contractor.id)
        user("h_power", "CpgPower", sees_all_provinces=True)
        user("h_rm", "RegionalManager", sees_all_provinces=True)
        user("h_viewer", "Viewer", sees_all_provinces=True)

        site = Site(site_code="HOME-1", province_id=province.id)
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
            work_item_id=wi.id, village_code="HOME-V1", village_name="Home village",
            target_classification="هدف",
        ))
        db.commit()
    finally:
        db.close()


def _headers(client, username, password=PASSWORD):
    r = client.post(f"{API}/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _home(client, username):
    r = client.get(f"{API}/home/summary", headers=_headers(client, username))
    assert r.status_code == 200, r.text
    return r.json()


def _user_id(username):
    from app.models.reference import User

    db = SessionLocal()
    try:
        return db.query(User).filter_by(username=username).one().id
    finally:
        db.close()


@pytest.mark.parametrize(
    ("username", "role"),
    [("h_pm", "PM"), ("h_coord", "Coordinator"), ("h_sc", "Contractor"),
     ("h_power", "Problem owner")],
)
def test_home_is_served_to_the_four_working_roles(client, username, role):
    body = _home(client, username)
    assert body["role"] == role
    assert body["due_soon_days"] == 3


@pytest.mark.parametrize("username", ["h_rm", "h_viewer"])
def test_regional_manager_and_viewer_are_refused(client, username):
    r = client.get(f"{API}/home/summary", headers=_headers(client, username))
    assert r.status_code == 403


def test_admin_is_refused(client):
    r = client.get(f"{API}/home/summary", headers=_headers(client, "admin", "Admin@12345"))
    assert r.status_code == 403


@pytest.mark.parametrize("username", ["h_pm", "h_coord", "h_sc", "h_power"])
def test_the_figures_add_up(client, username):
    body = _home(client, username)
    tickets = [t for g in body["groups"] for t in g["tickets"]]
    for t in tickets:
        assert t["on_time"] + t["due_soon"] + t["late"] == t["count"]
        assert t["count"] > 0, "zero-count tickets are left off, as on the board"
    totals = body["totals"]
    assert totals["pending"] == sum(t["count"] for t in tickets)
    assert totals["overdue"] == sum(t["late"] for t in tickets)
    assert totals["due_soon"] == sum(t["due_soon"] for t in tickets)
    assert totals["queues"] == len(tickets)
    assert sum(body["app_badges"].values()) == totals["pending"]
    for path, n in body["app_badges"].items():
        assert n == sum(t["count"] for t in tickets if t["url"].split("?")[0] == path)
    if tickets:
        assert body["up_next"] in {t["queue_key"] for t in tickets}
    else:
        assert body["up_next"] is None


def test_home_and_the_board_agree(client):
    headers = _headers(client, "h_sc")
    board = client.get(f"{API}/action-center/board", headers=headers).json()
    home = client.get(f"{API}/home/summary", headers=headers).json()
    assert home["totals"]["pending"] == board["totals"]["pending"]
    assert home["totals"]["overdue"] == board["totals"]["overdue"]


def test_the_board_response_is_unchanged(client):
    board = client.get(f"{API}/action-center/board", headers=_headers(client, "h_sc")).json()
    assert set(board) == {"role", "scope_label", "generated_at", "totals", "stages"}
    ticket = board["stages"][0]["tickets"][0]
    assert set(ticket) == {
        "queue_key", "label", "count", "overdue", "oldest_started_at",
        "earliest_due_at", "date_kind", "url",
    }


def test_a_contractor_is_never_shown_as_the_owner_of_their_own_work(client):
    body = _home(client, "h_sc")
    for g in body["groups"]:
        for t in g["tickets"]:
            assert "Home Co" not in t["owners"]


def test_a_problem_owner_gets_one_card_and_no_plan(client):
    body = _home(client, "h_power")
    assert [g["key"] for g in body["groups"]] == ["drive_test"]
    assert body["plan"] is None


def test_staff_get_all_three_cards_even_when_one_is_empty(client):
    assert [g["key"] for g in _home(client, "h_pm")["groups"]] == [
        "drive_test", "acceptance", "plans",
    ]


def test_done_today_counts_only_this_users_own_acts(client):
    from app.models.health_check import HcAssignment, HcTask
    from app.models.reference import Contractor
    from app.models.workitem import WorkItem

    pm, coord = _user_id("h_pm"), _user_id("h_coord")
    before = _home(client, "h_pm")["totals"]
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        contractor = db.query(Contractor).filter_by(name="Home Co").one()
        wi = db.query(WorkItem).first()
        a = HcAssignment(code="HOME-HC-1", contractor_id=contractor.id,
                         assigned_by=coord, assigned_at=now - timedelta(days=5))
        db.add(a)
        db.flush()
        db.add_all([
            HcTask(hc_assignment_id=a.id, work_item_id=wi.id, round_no=1,
                   completed_at=now, reviewed_by=pm, reviewed_at=now),
            # Reviewed by someone else: not the PM's.
            HcTask(hc_assignment_id=a.id, work_item_id=wi.id, round_no=2,
                   completed_at=now, reviewed_by=coord, reviewed_at=now),
        ])
        db.commit()
    finally:
        db.close()
    after = _home(client, "h_pm")["totals"]
    assert after["done_today"] == before["done_today"] + 1


def test_the_week_change_is_none_without_a_snapshot_and_reads_one_when_there_is(client):
    from app.models.action_center import ActionDailySnapshot

    first = _home(client, "h_coord")["totals"]
    assert first["pending_week_delta"] is None
    assert first["overdue_week_delta"] is None

    db = SessionLocal()
    try:
        db.add(ActionDailySnapshot(
            snapshot_date=jalali.tehran_today() - timedelta(days=7),
            user_id=_user_id("h_coord"), queue_key="hc_review", count=0, overdue=0,
        ))
        db.commit()
    finally:
        db.close()
    second = _home(client, "h_coord")["totals"]
    assert second["pending_week_delta"] == second["pending"]
    assert second["overdue_week_delta"] == second["overdue"]
