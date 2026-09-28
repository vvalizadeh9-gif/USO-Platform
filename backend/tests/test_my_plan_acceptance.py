"""The contractor's own screen, Acceptance half: ``GET /pip/my?stream=ACCEPTANCE``.

``/pip/my`` used to build ``current_month`` and ``history`` from the drive-test
scorecard whatever stream was asked for. These tests hold the stream-aware
version to its rules:

* **Acceptance figures come from the Acceptance scorecard** -- villages fully
  accepted that month against the approved Acceptance PIP -- and Acceptance
  has no Assignment, so ``assignment`` is null.
* **A contractor sees one company: their own**, even when another contractor
  has Acceptance data in the same months.
* **The DT response is what it was**, plus ``expected_by_today``.
* **``expected_by_today``** is the straight-line share of the PIP, null
  without one.
* **MTN's internal target never reaches a contractor.**

Run with:  cd backend && pytest tests/test_my_plan_acceptance.py -q
"""
import json
import os
import sys
from datetime import date

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_my_plan_acceptance_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

PIP = "/api/v1/pip"
RUNNING = jalali.current_shamsi_period()
PREVIOUS = jalali.previous_period(*RUNNING)
PLANNING = jalali.next_period(*RUNNING)
#: A number nobody would pick by accident, so finding it in a payload means
#: the internal target leaked.
INTERNAL = 4321


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_my_plan_acceptance_pytest.db"):
        os.remove("/tmp/uep_my_plan_acceptance_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def world(client):
    """Two contractors with Acceptance villages and PIPs in the same months."""
    from app.models.acceptance import Acceptance
    from app.models.monthly_plan import ContractorMonthlyPlan
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

    admin_h = _login(client)
    db = SessionLocal()
    a = Contractor(name="Own Acc Co", type="drive_test", active=True)
    b = Contractor(name="Rival Acc Co", type="drive_test", active=True)
    db.add_all([a, b])
    db.flush()
    province = Province(name="MyAccProv")
    db.add(province)
    db.flush()

    running_day = jalali.from_shamsi_date(*RUNNING, 1)
    previous_day = jalali.from_shamsi_date(*PREVIOUS, 10)

    def _site(code, contractor, accepted_on):
        site = Site(site_code=code, province_id=province.id)
        db.add(site)
        db.flush()
        wi = WorkItem(
            site_id=site.id, site_type="A", dt_status="Done",
            requested_technology="2G", current_stage="New",
            dt_sc_contractor_id=contractor.id,
        )
        db.add(wi)
        db.flush()
        for i, day in enumerate(accepted_on):
            v = Village(work_item_id=wi.id, village_code=f"{code}-{i}",
                        target_classification="هدف")
            v.acceptances = [Acceptance(
                technology="2G", ict_status="Approved", ict_date=day,
                cra_status="Approved", cra_date=day,
            )]
            db.add(v)

    # Own: 2 villages this month, 1 last month. Rival: 5 this month, 3 last.
    _site("MA-1", a, [running_day, running_day, previous_day])
    _site("MR-1", b, [running_day] * 5 + [previous_day] * 3)

    def _plan(contractor, stream, period, count):
        db.add(ContractorMonthlyPlan(
            contractor_id=contractor.id, stream=stream, shamsi_year=period[0],
            shamsi_month=period[1], version=1, is_current=True,
            committed_count=count, status="Approved",
        ))

    _plan(a, "ACCEPTANCE", RUNNING, 7)
    _plan(a, "ACCEPTANCE", PREVIOUS, 6)
    _plan(b, "ACCEPTANCE", RUNNING, 77)
    _plan(b, "ACCEPTANCE", PREVIOUS, 66)
    # A DT plan must not turn up as the Acceptance PIP.
    _plan(a, "DT", RUNNING, 55)
    db.commit()
    ids = {"a": a.id, "b": b.id}
    db.close()

    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Contractor")
    password = "Test-Fixture-Passphrase"
    for username, cid in (("own_acc", ids["a"]), ("rival_acc", ids["b"])):
        r = client.post("/api/v1/admin/users", headers=admin_h, json={
            "username": username, "password": password, "first_name": "Acc",
            "family_name": username, "role_id": role_id, "sees_all_provinces": True,
            "province_ids": [], "contractor_id": cid,
        })
        assert r.status_code == 201, r.text

    # MTN's internal Acceptance and DT targets for the running month.
    pm = login_as_role(client, admin_h["Authorization"].split()[1], "PM")
    for stream in ("ACCEPTANCE", "DT"):
        r = client.put(f"{PIP}/internal-target", headers=pm, json={
            "stream": stream, "year": RUNNING[0], "month": RUNNING[1],
            "target_count": INTERNAL,
        })
        assert r.status_code == 200, r.text

    return {
        **ids,
        "own": _login(client, "own_acc", password),
        "rival": _login(client, "rival_acc", password),
    }


def _mine(client, headers, stream="ACCEPTANCE", **extra):
    params = {"year": PLANNING[0], "month": PLANNING[1], "stream": stream, **extra}
    r = client.get(f"{PIP}/my", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _point(body, period):
    return next(
        h for h in body["history"]
        if (h["shamsi_year"], h["shamsi_month"]) == period
    )


def test_acceptance_figures_are_the_contractors_own(client, world):
    body = _mine(client, world["own"])
    assert len(body["history"]) == 6
    assert body["history"][-1]["in_progress"] is True

    running = _point(body, RUNNING)
    assert (running["delivered"], running["pip"]) == (2, 7)
    previous = _point(body, PREVIOUS)
    assert (previous["delivered"], previous["pip"]) == (1, 6)

    # Acceptance has no Assignment: null, not 0.
    assert all(h["assignment"] is None for h in body["history"])
    current = body["current_month"]
    assert (current["delivered"], current["pip"]) == (2, 7)
    assert current["assignment"] is None
    assert current["carried_in"] is None and current["newly_assigned"] is None


def test_no_other_contractors_acceptance_figures(client, world):
    own = _mine(client, world["own"])
    text = str(own)
    assert "Rival Acc Co" not in text
    for figure in (77, 66, 5, 3):
        assert all(
            figure not in (h["pip"], h["delivered"]) for h in own["history"]
        ), figure

    # The rival sees theirs -- the stream is read per account, not shared.
    rival = _mine(client, world["rival"])
    assert (_point(rival, RUNNING)["delivered"], _point(rival, RUNNING)["pip"]) == (5, 77)
    assert "Own Acc Co" not in str(rival)

    # And naming the rival in the query changes nothing.
    smuggled = _mine(client, world["own"], contractor_id=world["b"])
    assert smuggled["history"] == own["history"]


def test_the_dt_response_is_unchanged(client, world):
    """DT still reads the drive-test scorecard: the DT PIP, a real Assignment."""
    default = _mine(client, world["own"], stream="DT")
    running = _point(default, RUNNING)
    assert running["pip"] == 55
    assert isinstance(running["assignment"], int)
    assert isinstance(default["current_month"]["carried_in"], int)

    # No stream given is DT, exactly as before.
    r = client.get(f"{PIP}/my", headers=world["own"],
                   params={"year": PLANNING[0], "month": PLANNING[1]})
    assert r.json() == default

    # The fields it had are the fields it has, plus expected_by_today.
    assert set(default["current_month"]) == {
        "shamsi_year", "shamsi_month", "shamsi_month_name", "label",
        "assignment", "carried_in", "newly_assigned", "pip", "delivered",
        "pace_pct", "expected_by_today",
    }
    assert set(default["history"][0]) == {
        "shamsi_year", "shamsi_month", "shamsi_month_name", "label",
        "assignment", "pip", "delivered", "in_progress",
    }


def test_expected_by_today_is_on_the_running_month(client, world):
    from app.services import monthly_plan as plans

    body = _mine(client, world["own"])
    assert body["current_month"]["expected_by_today"] == plans.expected_by_today(
        7, *RUNNING
    )


def _thirty_day_month():
    """A Shamsi month with 30 days (مهر..بهمن are; this year's will do)."""
    year = RUNNING[0]
    month = next(m for m in range(7, 12) if jalali.days_in_month(year, m) == 30)
    return year, month


def test_expected_by_today_is_a_straight_line():
    from app.services.monthly_plan import expected_by_today

    year, month = _thirty_day_month()
    day4 = jalali.from_shamsi_date(year, month, 4)
    assert expected_by_today(30, year, month, today=day4) == 4
    assert expected_by_today(None, year, month, today=day4) is None
    # Before the month it is 0; after it, the whole PIP.
    assert expected_by_today(30, year, month, today=jalali.from_shamsi_date(year, month - 1, 20)) == 0
    assert expected_by_today(30, year, month, today=jalali.from_shamsi_date(year, month + 1, 2)) == 30


def test_expected_by_today_is_null_without_a_pip(client, world):
    from app.services import monthly_plan as plans

    assert plans.expected_by_today(None, *RUNNING, today=date.today()) is None
    # The rival's DT stream has no approved plan this month.
    body = _mine(client, world["rival"], stream="DT")
    assert body["current_month"]["pip"] is None
    assert body["current_month"]["expected_by_today"] is None


@pytest.mark.parametrize("stream", ["DT", "ACCEPTANCE"])
def test_no_contractor_response_carries_the_internal_target(client, world, stream):
    for who in ("own", "rival"):
        body = _mine(client, world[who], stream=stream)
        text = json.dumps(body, ensure_ascii=False)
        assert str(INTERNAL) not in text
        assert "internal" not in text.lower()
