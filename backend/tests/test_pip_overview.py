"""Tests for GET /pip/overview: the PM's Monthly Plan page in one read.

The rules being checked:

* Each plan status: approved (with its version), awaiting_approval,
  returned, revision_requested (from -> to), not_submitted.
* Each needs-attention rule, including the day of the deadline and the day
  after it.
* hit_last_6 counts closed months where Delivered >= PIP and skips months
  with no plan rather than counting them as misses.
* A period's percentage is total Delivered / total PIP, never an average of
  monthly percentages; Assignment over a period is not a sum of balances.
* The All contractors row equals the sum of the rows.
* No plan is null, never 0; the MTN internal target is read per stream.
* Staff only: PM, Coordinator, RegionalManager, Viewer read it; Admin and a
  contractor get 403.

The clock is ``jalali.tehran_today``, patched per test; the running month is
1406/3 (خرداد), far from any real date.

Run with:  cd backend && pytest tests/test_pip_overview.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_pip_overview_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

URL = "/api/v1/pip/overview"
ONAIR = "راه_اندازی_دائم"
RUNNING = (1406, 3)
PLANNING = (1406, 4)


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_pip_overview_pytest.db"):
        os.remove("/tmp/uep_pip_overview_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _on_day(monkeypatch, day, period=RUNNING):
    today = jalali.from_shamsi_date(*period, day)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)


def _at(period, day=5):
    return datetime.combine(
        jalali.from_shamsi_date(*period, day), datetime.min.time(), tzinfo=timezone.utc
    )


@pytest.fixture(scope="module")
def world(client):
    from app.models.monthly_plan import ContractorMonthlyPlan
    from app.models.reference import Contractor, Province
    from app.models.workitem import Assignment, Site, WorkItem
    from app.services import acceptance_plan

    admin_h = _login(client)
    token = admin_h["Authorization"].split()[1]
    actors = {
        "admin": admin_h,
        "pm": login_as_role(client, token, "PM"),
        "coordinator": login_as_role(client, token, "Coordinator"),
        "regional": login_as_role(client, token, "RegionalManager"),
        "viewer": login_as_role(client, token, "Viewer"),
    }

    db = SessionLocal()
    a = Contractor(name="Alpha Ov", type="drive_test", active=True)
    b = Contractor(name="Beta Ov", type="drive_test", active=True)
    c = Contractor(name="Gamma Ov", type="drive_test", active=True)
    db.add_all([a, b, c])
    db.flush()
    province = Province(name="OverviewProv")
    db.add(province)
    db.flush()
    site = Site(site_code="OV-1", province_id=province.id)
    db.add(site)
    db.flush()

    tags = iter("ABCDEFGH")

    def _item(contractor, assigned, done=None):
        wi = WorkItem(
            site_id=site.id, site_type=next(tags), last_stage=ONAIR, current_stage="New",
            dt_status="Done" if done else "Pending",
            dt_date_gregorian=jalali.from_shamsi_date(*done, 8) if done else None,
            dt_sc_contractor_id=contractor.id,
        )
        db.add(wi)
        db.flush()
        db.add(Assignment(
            work_item_id=wi.id, assignment_type="official", contractor_id=contractor.id,
            assigned_at=_at(assigned, 2), is_active=True,
        ))

    # Alpha: one site delivered in 1406/2; two sites held in 1406/3, one done.
    _item(a, (1406, 2), done=(1406, 2))
    _item(a, RUNNING, done=RUNNING)
    _item(a, RUNNING)

    def _plan(contractor, stream, period, version, status, count, current=True):
        db.add(ContractorMonthlyPlan(
            contractor_id=contractor.id, stream=stream, shamsi_year=period[0],
            shamsi_month=period[1], version=version, is_current=current,
            committed_count=count, status=status,
            submitted_at=_at(period, 1),
        ))

    # DT history for Alpha: 1406/1 approved 4 (delivered 0: miss), 1406/2
    # approved 1 (delivered 1: hit). No plan in 1405/12 and before: skipped.
    _plan(a, "DT", (1406, 1), 1, "Approved", 4)
    _plan(a, "DT", (1406, 2), 1, "Approved", 1)
    # Running month, DT: Alpha approved 5 on 2 sites held (PIP > assignment);
    # Beta approved 3, then asked to revise to 2; Gamma nothing.
    _plan(a, "DT", RUNNING, 1, "Approved", 5)
    _plan(b, "DT", RUNNING, 1, "Approved", 3, current=False)
    _plan(b, "DT", RUNNING, 2, "RevisionRequested", 2)
    # Running month, Acceptance: Alpha returned.
    _plan(a, "ACCEPTANCE", RUNNING, 1, "Returned", 9)
    # Planning month, Acceptance: Beta submitted 7.
    _plan(b, "ACCEPTANCE", PLANNING, 1, "Submitted", 7)
    # Alpha's DT plan approved twice in 1406/2 would be a revision; keep it
    # simple -- one more approved version for Gamma's Acceptance in 1406/2.
    _plan(c, "ACCEPTANCE", (1406, 2), 1, "Approved", 6)
    _plan(c, "ACCEPTANCE", (1406, 2), 2, "Approved", 5)
    db.commit()

    pm = db.query(__import__("app.models.reference", fromlist=["User"]).User).filter_by(
        username="test_pm"
    ).one()
    acceptance_plan.set_target(db, year=RUNNING[0], month=RUNNING[1], target_count=10, user=pm, stream="DT")
    db.commit()
    ids = {"a": a.id, "b": b.id, "c": c.id}
    db.close()

    password = "Test-Fixture-Passphrase"
    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Contractor")
    r = client.post("/api/v1/admin/users", headers=admin_h, json={
        "username": "ov_alpha", "password": password, "first_name": "Ov",
        "family_name": "Alpha", "role_id": role_id, "sees_all_provinces": True,
        "province_ids": [], "contractor_id": ids["a"],
    })
    assert r.status_code == 201, r.text
    actors["contractor"] = _login(client, "ov_alpha", password)
    return {"actors": actors, "ids": ids}


def _get(client, world, params="", who="pm"):
    r = client.get(f"{URL}{params}", headers=world["actors"][who])
    assert r.status_code == 200, r.text
    return r.json()


def _row(stream, cid):
    return next(r for r in stream["rows"] if r["contractor_id"] == cid)


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("who", ["pm", "coordinator", "regional", "viewer"])
def test_staff_can_read(client, world, monkeypatch, who):
    _on_day(monkeypatch, 10)
    _get(client, world, who=who)


@pytest.mark.parametrize("who", ["admin", "contractor"])
def test_admin_and_contractor_cannot(client, world, monkeypatch, who):
    _on_day(monkeypatch, 10)
    r = client.get(URL, headers=world["actors"][who])
    assert r.status_code == 403


@pytest.mark.parametrize("params", ["?period=week", "?year=1406", "?year=1200&month=1"])
def test_bad_input_is_400(client, world, monkeypatch, params):
    _on_day(monkeypatch, 10)
    r = client.get(f"{URL}{params}", headers=world["actors"]["pm"])
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Header and statuses
# ---------------------------------------------------------------------------
def test_opens_on_the_running_month(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    data = _get(client, world)
    assert (data["shamsi_year"], data["shamsi_month"]) == RUNNING
    assert data["shamsi_month_name"] == jalali.month_name(RUNNING[1])
    assert data["day_of_month"] == 10
    assert data["days_in_month"] == jalali.days_in_month(*RUNNING)
    assert data["revision_window_open"] is True
    assert data["revisions_close_on"] == "1406/03/15"


def test_each_status(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    data = _get(client, world)
    ids = world["ids"]
    dt, acc = data["dt"], data["acceptance"]

    a = _row(dt, ids["a"])
    assert a["status"] == "approved" and a["in_force_version"] == 1

    b = _row(dt, ids["b"])
    assert b["status"] == "revision_requested"
    assert (b["revision_from"], b["revision_to"]) == (3, 2)
    assert b["pip"] == 3   # the approved number stays in force

    c = _row(dt, ids["c"])
    assert c["status"] == "not_submitted"
    assert c["pip"] is None and c["diff"] is None

    assert _row(acc, ids["a"])["status"] == "returned"

    planning = _get(client, world, f"?year={PLANNING[0]}&month={PLANNING[1]}")
    assert _row(planning["acceptance"], ids["b"])["status"] == "awaiting_approval"


def test_pip_above_assignment_and_the_running_figures(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    dt = _get(client, world)["dt"]
    a = _row(dt, world["ids"]["a"])
    assert (a["assignment"], a["pip"], a["delivered"], a["diff"]) == (2, 5, 1, -4)
    assert a["pip_above_assignment"] is True
    # Beta holds nothing against a PIP of 3: above too. Gamma has no PIP.
    assert _row(dt, world["ids"]["b"])["pip_above_assignment"] is True
    assert _row(dt, world["ids"]["c"])["pip_above_assignment"] is False
    # Acceptance has no Assignment.
    acc_a = _row(_get(client, world)["acceptance"], world["ids"]["a"])
    assert acc_a["assignment"] is None and acc_a["pip_above_assignment"] is None


def test_kpis_and_the_internal_target(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    data = _get(client, world)
    k = data["dt"]["kpis"]
    assert k["internal_pip"] == 10
    assert k["contractor_pip"] == 8          # 5 + 3 in force
    assert k["gap_vs_internal"] == -2
    assert k["delivered"] == 1
    days = jalali.days_in_month(*RUNNING)
    assert k["expected_by_today"] == round(8 * 10 / days)
    assert k["pace_diff"] == 1 - k["expected_by_today"]
    # No Acceptance internal target set: null, never 0.
    assert data["acceptance"]["kpis"]["internal_pip"] is None
    assert data["acceptance"]["kpis"]["assignment"] is None


def test_all_contractors_equals_the_sum_of_the_rows(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    for view in ("", "?period=year&year=1406&month=3"):
        data = _get(client, world, view)
        for key in ("dt", "acceptance"):
            s = data[key]
            rows = s["rows"]
            assert s["all_contractors"]["delivered"] == sum(r["delivered"] for r in rows)
            pips = [r["pip"] for r in rows if r["pip"] is not None]
            assert s["all_contractors"]["pip"] == (sum(pips) if pips else None)
    dt = _get(client, world)["dt"]["all_contractors"]
    assert (dt["plans_approved"], dt["plans_total"]) == (2, 3)


# ---------------------------------------------------------------------------
# Hits and periods
# ---------------------------------------------------------------------------
def test_hit_last_6_skips_months_with_no_plan(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    a = _row(_get(client, world)["dt"], world["ids"]["a"])
    # 1406/2 hit (1 of 1), 1406/1 missed (0 of 4); the four months before
    # had no plan and are not counted.
    assert a["hit_last_6"] == {"hit": 1, "of": 2}
    c = _row(_get(client, world)["dt"], world["ids"]["c"])
    assert c["hit_last_6"] == {"hit": 0, "of": 0}


def test_year_view_divides_totals_and_does_not_sum_balances(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    data = _get(client, world, "?period=year&year=1406&month=3")
    assert [m["shamsi_month"] for m in data["months"]] == [1, 2, 3]
    k = data["dt"]["kpis"]
    # PIP 4 + 1 + 8 = 13, delivered 0 + 1 + 1 = 2: 15.4%, not the mean of
    # 0%, 100% and 12.5%.
    assert k["contractor_pip"] == 13
    assert k["delivered"] == 2
    assert k["achievement_percent"] == 15.4
    assert k["expected_by_today"] is None and k["pace_diff"] is None
    # Alpha held 1 site from 1406/2 (done that month) and 2 new in 1406/3:
    # 3 sites over the period, not the sum of monthly balances.
    assert _row(data["dt"], world["ids"]["a"])["assignment"] == 3
    # The trend shows the period's months.
    assert [p["shamsi_month"] for p in data["dt"]["trend"]] == [1, 2, 3]


def test_month_trend_is_twelve_months_ending_on_the_month(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    trend = _get(client, world)["dt"]["trend"]
    assert len(trend) == 12
    assert (trend[-1]["shamsi_year"], trend[-1]["shamsi_month"]) == RUNNING
    assert trend[-1]["in_progress"] is True
    feb = next(p for p in trend if (p["shamsi_year"], p["shamsi_month"]) == (1406, 2))
    assert (feb["pip"], feb["delivered"], feb["hit"]) == (1, 1, True)
    assert all(p["pip"] is None for p in trend if (p["shamsi_year"], p["shamsi_month"]) < (1406, 1))


def test_since_start_starts_at_the_first_plan(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    data = _get(client, world, "?period=since_start")
    first = data["months"][0]
    assert (first["shamsi_year"], first["shamsi_month"]) == (1406, 1)
    assert (data["months"][-1]["shamsi_year"], data["months"][-1]["shamsi_month"]) == RUNNING
    acc = data["acceptance"]
    # Gamma's revised Acceptance PIP counts once, at the approved 5.
    assert _row(acc, world["ids"]["c"])["pip"] == 5


# ---------------------------------------------------------------------------
# Needs attention
# ---------------------------------------------------------------------------
def _kinds(data):
    return {(n["name"], n["stream"], n["kind"]) for n in data["needs_attention"]}


def test_needs_attention_after_the_deadline(client, world, monkeypatch):
    _on_day(monkeypatch, 4)   # the day after the deadline (day 3)
    kinds = _kinds(_get(client, world))
    assert ("Gamma Ov", "DT", "not_submitted") in kinds
    assert ("Beta Ov", "DT", "revision_requested") in kinds
    assert ("Alpha Ov", "DT", "pip_above_assignment") in kinds
    assert ("Beta Ov", "ACCEPTANCE", "awaiting_approval") in kinds
    # A returned plan is filed; it is not "not submitted".
    assert ("Alpha Ov", "ACCEPTANCE", "not_submitted") not in kinds
    chip = next(n for n in _get(client, world)["needs_attention"] if n["kind"] == "awaiting_approval")
    assert (chip["shamsi_year"], chip["shamsi_month"]) == PLANNING
    assert chip["plan_id"] is not None


def test_not_submitted_waits_for_the_deadline(client, world, monkeypatch):
    _on_day(monkeypatch, 3)   # the deadline day itself: not passed yet
    kinds = _kinds(_get(client, world))
    assert not any(k == "not_submitted" for _, _, k in kinds)
    assert ("Beta Ov", "DT", "revision_requested") in kinds


def test_the_revision_window_closes_after_day_15(client, world, monkeypatch):
    _on_day(monkeypatch, 16)
    assert _get(client, world)["revision_window_open"] is False
