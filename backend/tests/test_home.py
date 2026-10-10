"""UEP Home's read: the rules it adds to the Action Center, and its endpoint.

* an item is exactly one of late, due soon or on time, at the window's edges;
* the endpoint is served to the board's four roles and Regional Managers, and
  refused to the rest;
* its figures add up: statuses to counts, tickets to totals, badges to tickets
  -- and the totals count only the tickets Home returns;
* Acceptance is Pending ICT and Pending CRA for every role: villages, once per
  site, site type and village code, inside each role's own scope;
* "done today" counts this user's own acts, in Tehran days (none for an RM);
* the trends are 14 days of this user's snapshot, with gaps where it is silent;
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
from app.services.action_queues.types import PendingItem, SlaKind  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Owner@12345"
API = "/api/v1"
NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)
WINDOW = timedelta(days=3)
HOME_USERS = ["h_pm", "h_coord", "h_sc", "h_power", "h_rm"]


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


def test_one_village_listed_for_3g_and_4g_counts_once():
    from app.services.action_queues.sources.acceptance import one_per_village

    # (village id, work item id, village code): codes compare trimmed and
    # case-blind; a village with no code is never merged with another.
    rows = [(3, 1, "V1"), (1, 1, "v1 "), (2, 1, None), (4, 2, "V1"), (5, 1, "")]
    assert [r[0] for r in one_per_village(rows)] == [1, 2, 4, 5]


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
        other = Contractor(name="Other Co", type="drive_test")
        db.add_all([contractor, other])
        db.flush()
        roles = {r.name: r for r in db.query(Role).all()}
        home_province, far_province = db.query(Province).order_by(Province.id).limit(2).all()

        def user(username, role, provinces=(), **kw):
            db.add(User(
                username=username, password_hash=hash_password(PASSWORD),
                first_name=username, family_name="Home", role_id=roles[role].id,
                status=user_status.ACTIVE, provinces=list(provinces), **kw,
            ))

        user("h_pm", "PM", sees_all_provinces=True)
        user("h_coord", "Coordinator", sees_all_provinces=True)
        user("h_sc", "Contractor", contractor_id=contractor.id)
        user("h_power", "CpgPower", sees_all_provinces=True)
        user("h_rm", "RegionalManager", provinces=[home_province])
        user("h_viewer", "Viewer", sees_all_provinces=True)

        def work_item(code, province, contractor_id):
            site = Site(site_code=code, province_id=province.id)
            db.add(site)
            db.flush()
            wi = WorkItem(
                site_id=site.id, site_type="Greenfield", requested_technology="4G",
                last_stage=C.STAGE_PERM_ONAIR, dt_status="Done",
                dt_sc_contractor_id=contractor_id,
            )
            db.add(wi)
            db.flush()
            return wi

        def village(wi, code, ict="NotFiled", cra="NotFiled"):
            db.add(Village(
                work_item_id=wi.id, village_code=code, village_name=code,
                target_classification="هدف", ict_status=ict, cra_status=cra,
            ))

        mine = work_item("HOME-1", home_province, contractor.id)
        village(mine, "HOME-V1")
        village(mine, "HOME-V1")                                    # its 4G row
        village(mine, "HOME-V2", ict="Approved")                    # CRA pending
        village(mine, "HOME-V3", ict="Approved", cra="Approved")    # closed
        far = work_item("HOME-2", far_province, other.id)
        village(far, "FAR-V1")
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


def _tickets(body):
    return [t for g in body["groups"] for t in g["tickets"]]


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
     ("h_power", "Problem owner"), ("h_rm", "Regional manager")],
)
def test_home_is_served_to_the_working_roles_and_regional_managers(client, username, role):
    body = _home(client, username)
    assert body["role"] == role
    assert body["due_soon_days"] == 3


def test_a_viewer_is_refused(client):
    r = client.get(f"{API}/home/summary", headers=_headers(client, "h_viewer"))
    assert r.status_code == 403


def test_admin_is_refused(client):
    r = client.get(f"{API}/home/summary", headers=_headers(client, "admin", "Admin@12345"))
    assert r.status_code == 403


def test_a_regional_manager_still_has_no_board(client):
    r = client.get(f"{API}/action-center/board", headers=_headers(client, "h_rm"))
    assert r.status_code == 403


@pytest.mark.parametrize("username", HOME_USERS)
def test_the_figures_add_up(client, username):
    body = _home(client, username)
    tickets = _tickets(body)
    for g in body["groups"]:
        for t in g["tickets"]:
            assert t["on_time"] + t["due_soon"] + t["late"] == t["count"]
            assert t["owners_total"] == len(t["owners"]) + t["owners_more"]
            if g["key"] != "acceptance":
                assert t["count"] > 0, "zero-count tickets are left off, as on the board"
    totals = body["totals"]
    assert totals["pending"] == sum(t["count"] for t in tickets)
    assert totals["overdue"] == sum(t["late"] for t in tickets)
    assert totals["due_soon"] == sum(t["due_soon"] for t in tickets)
    assert totals["queues"] == len(tickets)
    badges = body["app_badges"]
    assert sum(b["count"] for b in badges.values()) == totals["pending"]
    for path, badge in badges.items():
        assert badge["count"] == sum(p["count"] for p in badge["parts"])
        assert badge["count"] == sum(
            t["count"] for t in tickets if t["url"].split("?")[0] == path
        )
    assert "up_next" not in body


def test_queues_home_does_not_show_are_not_in_its_totals(client):
    """The headline is the cards, not the whole board: a contractor's board
    has the detailed filing queues, Home only Pending ICT and Pending CRA."""
    headers = _headers(client, "h_sc")
    board = client.get(f"{API}/action-center/board", headers=headers).json()
    home = client.get(f"{API}/home/summary", headers=headers).json()
    board_keys = {t["queue_key"] for s in board["stages"] for t in s["tickets"]}
    home_keys = {t["queue_key"] for t in _tickets(home)}
    assert {"ict_to_file", "cra_to_file"} <= board_keys
    assert not {"ict_to_file", "cra_to_file"} & home_keys
    assert home["totals"]["pending"] == sum(t["count"] for t in _tickets(home))


def test_the_board_response_is_unchanged(client):
    board = client.get(f"{API}/action-center/board", headers=_headers(client, "h_sc")).json()
    assert set(board) == {"role", "scope_label", "generated_at", "totals", "stages"}
    ticket = board["stages"][0]["tickets"][0]
    assert set(ticket) == {
        "queue_key", "label", "count", "overdue", "oldest_started_at",
        "earliest_due_at", "date_kind", "url",
    }
    keys = {t["queue_key"] for s in board["stages"] for t in s["tickets"]}
    assert not keys & {"ict_pending", "cra_pending"}, "Home's own queues stay off the board"


def test_a_contractor_is_never_shown_as_the_owner_of_their_own_work(client):
    for t in _tickets(_home(client, "h_sc")):
        assert "Home Co" not in t["owners"]


# --------------------------------------------------------------------------
# Acceptance: Pending ICT and Pending CRA
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("username", "scope", "ict", "cra"),
    [
        # HOME-V1 (listed twice: 3G and 4G) and FAR-V1 are open on both
        # sides; HOME-V2 only on CRA; HOME-V3 is closed.
        ("h_pm", "All project", 2, 3),
        ("h_coord", "Your regions", 2, 3),
        ("h_rm", "Your regions", 1, 2),   # their one province: no FAR-V1
        ("h_sc", "Your sites", 1, 2),     # their own site only
    ],
)
def test_acceptance_is_pending_ict_and_cra_villages_in_scope(client, username, scope, ict, cra):
    body = _home(client, username)
    acceptance = next(g for g in body["groups"] if g["key"] == "acceptance")
    assert [t["queue_key"] for t in acceptance["tickets"]] == ["ict_pending", "cra_pending"]
    assert acceptance["scope_label"] == scope
    assert body["scope_label"] == scope
    assert [t["count"] for t in acceptance["tickets"]] == [ict, cra]
    assert {t["unit"] for t in acceptance["tickets"]} == {"villages"}


def test_a_problem_owner_gets_one_card_and_no_plan(client):
    body = _home(client, "h_power")
    assert [g["key"] for g in body["groups"]] == ["drive_test"]
    assert body["plan"] is None


def test_staff_get_all_three_cards_even_when_one_is_empty(client):
    assert [g["key"] for g in _home(client, "h_pm")["groups"]] == [
        "drive_test", "acceptance", "plans",
    ]


def test_a_regional_manager_gets_acceptance_and_no_done_today(client):
    body = _home(client, "h_rm")
    assert [g["key"] for g in body["groups"]] == ["acceptance"]
    assert body["totals"]["done_today"] is None
    assert body["trends"]["done"] is None


def test_the_header_carries_todays_shamsi_date(client):
    y, m, d = jalali.to_shamsi_date(jalali.tehran_today())
    assert _home(client, "h_pm")["shamsi_date"] == f"{y:04d}-{m:02d}-{d:02d}"


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
        # One site per assignment (hc_tasks is unique on the pair), so two.
        first, second = (
            HcAssignment(code=f"HOME-HC-{n}", contractor_id=contractor.id,
                         assigned_by=coord, assigned_at=now - timedelta(days=5))
            for n in (1, 2)
        )
        db.add_all([first, second])
        db.flush()
        db.add_all([
            HcTask(hc_assignment_id=first.id, work_item_id=wi.id, round_no=1,
                   completed_at=now, reviewed_by=pm, reviewed_at=now),
            # Reviewed by someone else: not the PM's.
            HcTask(hc_assignment_id=second.id, work_item_id=wi.id, round_no=2,
                   completed_at=now, reviewed_by=coord, reviewed_at=now),
        ])
        db.commit()
    finally:
        db.close()
    after = _home(client, "h_pm")
    assert after["totals"]["done_today"] == before["done_today"] + 1
    assert after["trends"]["done"][-1] == after["totals"]["done_today"]


# --------------------------------------------------------------------------
# Trends
# --------------------------------------------------------------------------
def _snapshot(username, days_ago, rows, *, due_soon=True):
    """Write one day of this user's snapshot: ``rows`` maps a queue key to
    (count, overdue, due soon)."""
    from app.models.action_center import ActionDailySnapshot

    db = SessionLocal()
    try:
        for key, (count, overdue, soon) in rows.items():
            db.add(ActionDailySnapshot(
                snapshot_date=jalali.tehran_today() - timedelta(days=days_ago),
                user_id=_user_id(username), queue_key=key, count=count, overdue=overdue,
                due_soon=soon if due_soon else None,
            ))
        db.commit()
    finally:
        db.close()


def test_trends_are_fourteen_days_ending_today_with_gaps(client):
    body = _home(client, "h_sc")
    trends, totals = body["trends"], body["totals"]
    assert len(trends["days"]) == 14
    assert trends["days"][-1] == jalali.tehran_today().isoformat()
    for series in ("pending", "overdue", "due_soon", "done"):
        assert len(trends[series]) == 14
    # No snapshot yet: every earlier day is a gap, not a zero.
    assert trends["pending"][:-1] == [None] * 13
    assert trends["pending"][-1] == totals["pending"]
    assert trends["overdue"][-1] == totals["overdue"]
    assert trends["due_soon"][-1] == totals["due_soon"]
    assert totals["pending_week_delta"] is None


def _home_keys(role):
    """Every queue this role's Home reads -- what the snapshot job writes,
    zero counts included."""
    from app.services.action_queues.registry import home_queues_for

    return [q.key for q in home_queues_for(role)]


def test_the_week_change_reads_the_snapshot_of_every_queue_home_shows(client):
    keys = _home_keys("Coordinator")
    assert _home(client, "h_coord")["totals"]["pending_week_delta"] is None

    # A day missing one of Home's queues says nothing about Home's total.
    _snapshot("h_coord", 7, {keys[0]: (1, 0, 0)})
    assert _home(client, "h_coord")["totals"]["pending_week_delta"] is None

    _snapshot("h_coord", 7, {k: (1, 1, 0) for k in keys[1:]})
    body = _home(client, "h_coord")
    totals = body["totals"]
    assert body["trends"]["pending"][-8] == len(keys)
    assert totals["pending_week_delta"] == totals["pending"] - len(keys)
    assert totals["overdue_week_delta"] == totals["overdue"] - (len(keys) - 1)
    assert totals["due_soon_week_delta"] == totals["due_soon"]


def test_a_day_snapshotted_before_due_soon_was_recorded_is_a_gap_for_due_soon(client):
    keys = _home_keys("PM")
    _snapshot("h_pm", 3, {k: (2, 0, 0) for k in keys}, due_soon=False)
    trends = _home(client, "h_pm")["trends"]
    assert trends["pending"][-4] == 2 * len(keys)
    assert trends["due_soon"][-4] is None


def test_the_snapshot_job_records_due_soon_and_home_only_queues(client):
    from app.models.action_center import ActionDailySnapshot
    from app.services import action_digest

    class NoMail:
        def send(self, message):
            raise AssertionError("send is off in this test")

    day = jalali.tehran_today() + timedelta(days=30)  # clear of the other tests
    db = SessionLocal()
    try:
        action_digest.run(db, NoMail(), day=day, send=False)

        def keys(username):
            rows = db.query(ActionDailySnapshot).filter_by(
                snapshot_date=day, user_id=_user_id(username)).all()
            assert all(r.due_soon is not None for r in rows)
            return {r.queue_key for r in rows}

        assert keys("h_rm") == {"ict_pending", "cra_pending"}
        assert {"ict_pending", "ict_to_file"} <= keys("h_sc")
    finally:
        db.close()
