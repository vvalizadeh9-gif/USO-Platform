"""The Drive Test dashboard's plan-and-delivery section.

Four figures and a per-contractor breakdown, for one Shamsi month: what was
committed (PIP), what was handed out (Assigned), what was delivered (Actual),
and the ratio of the last two.

What is worth testing here is not the arithmetic — it is one division — but
the four things this section gets wrong easily:

* **Which plans count.** Approved *and* current. A superseded version and an
  unapproved revision are both easy to add in by accident, and either one
  turns the programme's target into a number nobody agreed to.
* **A month with nothing in it.** A dashboard that divides by an absent plan
  takes the whole page down, and the page has five other sections on it.
* **What a contractor is shown.** This is the only payload on this dashboard
  that can name a contractor. A contractor must see one row, their own, and
  no other company's name, target or achievement anywhere in it — including
  through the back door of a site they used to hold and somebody else now
  does.
* **That the DT dating rule is the one already in use.** The Actual figure
  and the dashboard's existing "DT Done this month" card must agree, because
  they are the same fact.

Run with:  cd backend && pytest tests/test_plan_delivery.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_plan_delivery_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PIP = "/api/v1/pip"
PLAN_DELIVERY = "/api/v1/drive-test/plan-delivery"

#: The on-air stage value the DT KPIs recognise. Anything else is invisible to
#: this whole dashboard, which is what makes it the right value to seed with.
ONAIR = "راه_اندازی_دائم"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_plan_delivery_pytest.db"):
        os.remove("/tmp/uep_plan_delivery_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(client, headers, name):
    roles = client.get("/api/v1/reference/roles", headers=headers).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _make_contractor(name):
    from app.models.reference import Contractor

    db = SessionLocal()
    contractor = Contractor(name=name, type="drive_test", active=True)
    db.add(contractor)
    db.commit()
    contractor_id = contractor.id
    db.close()
    return contractor_id


def _make_user(client, admin_h, username, role_name, contractor_id=None):
    password = "Test-Fixture-Passphrase"
    body = {
        "username": username,
        "password": password,
        "first_name": "Test",
        "family_name": username,
        "role_id": _role_id(client, admin_h, role_name),
        "sees_all_provinces": True,
        "province_ids": [],
    }
    if contractor_id is not None:
        body["contractor_id"] = contractor_id
    r = client.post("/api/v1/admin/users", headers=admin_h, json=body)
    assert r.status_code == 201, r.text
    return _login(client, username, password)


@pytest.fixture(scope="module")
def actors(client):
    """A PM and three contractor companies, each with an account.

    Three companies rather than two: the contractor-scoping test has to show
    that one company is picked out of a crowd, and with two companies a filter
    that happened to keep "the first row" would pass.
    """
    admin_h = _login(client)
    alfa = _make_contractor("Alfa Drive Tests")
    beta = _make_contractor("Beta Surveys")
    gamma = _make_contractor("Gamma Networks")

    db = SessionLocal()
    from app.models.reference import Province
    from app.models.workitem import Site

    province = Province(name="PlanDeliveryProvince")
    db.add(province)
    db.flush()
    site = Site(site_code="PD-1", province_id=province.id)
    db.add(site)
    db.commit()
    site_id = site.id
    db.close()

    return {
        "admin": admin_h,
        "pm": _make_user(client, admin_h, "pd_pm", "PM"),
        "alfa": _make_user(client, admin_h, "pd_alfa", "Contractor", alfa),
        "beta": _make_user(client, admin_h, "pd_beta", "Contractor", beta),
        "gamma": _make_user(client, admin_h, "pd_gamma", "Contractor", gamma),
        "alfa_id": alfa,
        "beta_id": beta,
        "gamma_id": gamma,
        "site_id": site_id,
    }


# ---------------------------------------------------------------------------
# Periods. Each test owns a month, so no test can be made to pass or fail by
# the order it runs in — a plan is keyed by (contractor, month) precisely so
# that two writes to one month collide.
# ---------------------------------------------------------------------------
_YEAR, _MONTH = jalali.current_shamsi_period()


def _shift(by):
    index = (_YEAR * 12 + (_MONTH - 1)) + by
    return index // 12, index % 12 + 1


def _day_in(year, month, day=10):
    """A Gregorian date that lands inside the given Shamsi month."""
    return jalali.from_shamsi_date(year, month, day)


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------
def _approve(client, actors, contractor_key, year, month, count):
    """File a plan as the contractor and approve it as the PM."""
    r = client.post(
        f"{PIP}/my",
        headers=actors[contractor_key],
        json={"year": year, "month": month, "committed_count": count, "submit": True},
    )
    assert r.status_code == 200, r.text
    plan_id = r.json()["id"]
    r = client.post(f"{PIP}/{plan_id}/approve", headers=actors["pm"])
    assert r.status_code == 200, r.text
    return plan_id


def _submit_only(client, actors, contractor_key, year, month, count):
    """File a plan and leave it waiting on the PM."""
    r = client.post(
        f"{PIP}/my",
        headers=actors[contractor_key],
        json={"year": year, "month": month, "committed_count": count, "submit": True},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _done_site(actors, contractor_id, year, month, tag, *, assigned_to=None):
    """One on-air, DT-done work item dated into a Shamsi month.

    ``contractor_id`` seeds the CPM drive-test subcontractor; ``assigned_to``
    additionally opens an active in-app assignment, which is what the
    dashboard's attribution actually prefers.
    """
    from app.models.workitem import Assignment, WorkItem

    db = SessionLocal()
    item = WorkItem(
        site_id=actors["site_id"],
        site_type=tag,
        last_stage=ONAIR,
        current_stage="New",
        dt_status="Done",
        dt_sc_contractor_id=contractor_id,
        dt_date_gregorian=_day_in(year, month),
    )
    db.add(item)
    db.flush()
    if assigned_to is not None:
        db.add(
            Assignment(
                work_item_id=item.id,
                assignment_type="official",
                contractor_id=assigned_to,
                assigned_at=datetime(2000, 1, 1, tzinfo=timezone.utc),
                is_active=True,
            )
        )
    db.commit()
    item_id = item.id
    db.close()
    return item_id


def _assign(work_item_id, contractor_id, year, month, *, day=12, active=True):
    """An assignment handed over on a date inside a Shamsi month."""
    from app.models.workitem import Assignment

    db = SessionLocal()
    db.add(
        Assignment(
            work_item_id=work_item_id,
            assignment_type="official",
            contractor_id=contractor_id,
            assigned_at=datetime.combine(
                _day_in(year, month, day), datetime.min.time(), tzinfo=timezone.utc
            ),
            is_active=active,
        )
    )
    db.commit()
    db.close()


def _ask(client, headers, year, month):
    r = client.get(PLAN_DELIVERY, headers=headers, params={"year": year, "month": month})
    assert r.status_code == 200, r.text
    return r.json()


def _row_named(body, name):
    return next((r for r in body["rows"] if r["name"] == name), None)


# ---------------------------------------------------------------------------
# 1. PIP counts approved current-version plans, and nothing else
# ---------------------------------------------------------------------------
def test_pip_sums_only_approved_current_version_plans(client, actors):
    year, month = _shift(-11)

    _approve(client, actors, "alfa", year, month, 40)
    _submit_only(client, actors, "beta", year, month, 30)  # awaiting the PM
    client.post(  # a draft nobody has handed in
        f"{PIP}/my",
        headers=actors["gamma"],
        json={"year": year, "month": month, "committed_count": 25, "submit": False},
    )

    body = _ask(client, actors["pm"], year, month)

    assert body["pip"] == 40, "a submitted or draft plan is not a commitment"
    assert _row_named(body, "Alfa Drive Tests")["pip"] == 40
    assert _row_named(body, "Beta Surveys")["pip"] == 0
    assert _row_named(body, "Gamma Networks")["pip"] == 0

    # The two companies that did not get to Approved are not quietly absent
    # from the total: they are counted, so a short PIP says how short.
    assert body["committed_contractors"] == 1
    assert body["uncommitted_contractors"] >= 2


# ---------------------------------------------------------------------------
# 2. A month nobody planned
# ---------------------------------------------------------------------------
def test_month_with_no_approved_plans_is_zero_pip_and_null_achievement(client, actors):
    year, month = _shift(-10)
    _done_site(actors, actors["alfa_id"], year, month, "PD-empty-month")

    body = _ask(client, actors["pm"], year, month)

    assert body["pip"] == 0
    assert body["actual"] == 1, "work delivered against no plan is still delivered"
    assert body["achievement_percent"] is None, (
        "no commitment is not the same fact as none of the commitment met, "
        "and 0% would say the second"
    )
    assert _row_named(body, "Alfa Drive Tests")["achievement_percent"] is None


def test_a_month_with_neither_plans_nor_work_still_answers(client, actors):
    year, month = _shift(-9)
    body = _ask(client, actors["pm"], year, month)
    assert (body["pip"], body["assigned"], body["actual"]) == (0, 0, 0)
    assert body["achievement_percent"] is None


# ---------------------------------------------------------------------------
# 3. A revision counts once, at its current version
# ---------------------------------------------------------------------------
def test_revision_counts_the_current_version_only_once(client, actors):
    year, month = _shift(-8)
    _approve(client, actors, "alfa", year, month, 40)

    r = client.post(
        f"{PIP}/my/revise",
        headers=actors["alfa"],
        json={"year": year, "month": month, "committed_count": 55},
    )
    assert r.status_code == 200, r.text

    # Mid-revision: version 1 is no longer current and version 2 is not yet
    # approved, so there is no approved current plan to count.
    mid = _ask(client, actors["pm"], year, month)
    assert mid["pip"] == 0, "a superseded approval is not still the target"
    assert len([r for r in mid["rows"] if r["name"] == "Alfa Drive Tests"]) == 1

    r = client.post(
        f"{PIP}/my",
        headers=actors["alfa"],
        json={"year": year, "month": month, "committed_count": 55, "submit": True},
    )
    assert r.status_code == 200, r.text
    client.post(f"{PIP}/{r.json()['id']}/approve", headers=actors["pm"])

    after = _ask(client, actors["pm"], year, month)
    assert after["pip"] == 55, "40 + 55 would be counting both versions"
    alfa_rows = [r for r in after["rows"] if r["name"] == "Alfa Drive Tests"]
    assert len(alfa_rows) == 1, "one contractor, one row, however many versions"
    assert alfa_rows[0]["pip"] == 55


# ---------------------------------------------------------------------------
# 4. What a contractor may see — the security rule of this feature
# ---------------------------------------------------------------------------
def test_contractor_sees_exactly_one_row_and_it_is_their_own(client, actors):
    year, month = _shift(-7)
    _approve(client, actors, "alfa", year, month, 10)
    _approve(client, actors, "beta", year, month, 20)
    _approve(client, actors, "gamma", year, month, 30)
    _done_site(actors, actors["alfa_id"], year, month, "PD-scope-a")
    _done_site(actors, actors["beta_id"], year, month, "PD-scope-b")

    body = _ask(client, actors["alfa"], year, month)

    assert [r["name"] for r in body["rows"]] == ["Alfa Drive Tests"]
    assert body["rows"][0]["contractor_id"] == actors["alfa_id"]

    # Not just the rows: no other company's name may appear anywhere in the
    # payload, and no other company's target may be inferable from the total.
    payload = repr(body)
    assert "Beta Surveys" not in payload
    assert "Gamma Networks" not in payload
    assert body["pip"] == 10, "the PIP total is this contractor's own, not the programme's"
    assert body["committed_contractors"] == 1
    assert body["uncommitted_contractors"] == 0


def test_contractor_gets_the_programme_average_without_a_name_on_it(client, actors):
    year, month = _shift(-6)
    _approve(client, actors, "alfa", year, month, 10)
    _approve(client, actors, "beta", year, month, 10)
    _done_site(actors, actors["alfa_id"], year, month, "PD-avg-a")
    _done_site(actors, actors["beta_id"], year, month, "PD-avg-b1")
    _done_site(actors, actors["beta_id"], year, month, "PD-avg-b2")

    alfa = _ask(client, actors["alfa"], year, month)
    assert alfa["achievement_percent"] == 10.0, "1 of 10"
    assert alfa["programme_achievement_percent"] == 15.0, "3 of 20, across everyone"
    assert len(alfa["rows"]) == 1

    # Staff have the rows themselves; the anonymous line would be a fourth way
    # of saying what the page already shows them.
    pm = _ask(client, actors["pm"], year, month)
    assert pm["programme_achievement_percent"] is None


def test_a_site_handed_on_stops_counting_for_the_company_that_held_it(client, actors):
    """The back door the contractor filter has to close.

    Row-level scoping deliberately keeps a site visible to every contractor
    that has *ever* held it, so their history does not develop holes. On this
    section that same rule would hand Alfa a drive test Beta delivered, and
    put Beta's name on a row of Alfa's dashboard.
    """
    year, month = _shift(-5)
    _approve(client, actors, "alfa", year, month, 5)
    _done_site(
        actors,
        actors["alfa_id"],
        year,
        month,
        "PD-handed-on",
        assigned_to=actors["beta_id"],
    )

    alfa = _ask(client, actors["alfa"], year, month)
    assert [r["name"] for r in alfa["rows"]] == ["Alfa Drive Tests"]
    assert "Beta Surveys" not in repr(alfa)
    assert alfa["actual"] == 0, "Beta drove it; Alfa is not measured on it"

    pm = _ask(client, actors["pm"], year, month)
    assert _row_named(pm, "Beta Surveys")["actual"] == 1, (
        "and the work has not vanished — it is Beta's"
    )


# ---------------------------------------------------------------------------
# 5. What a PM sees
# ---------------------------------------------------------------------------
def test_pm_sees_every_contractor(client, actors):
    year, month = _shift(-4)
    _approve(client, actors, "alfa", year, month, 10)
    _approve(client, actors, "beta", year, month, 20)
    _approve(client, actors, "gamma", year, month, 40)

    body = _ask(client, actors["pm"], year, month)

    names = {r["name"] for r in body["rows"]}
    assert {"Alfa Drive Tests", "Beta Surveys", "Gamma Networks"} <= names
    assert body["pip"] == 70
    assert body["committed_contractors"] == 3


# ---------------------------------------------------------------------------
# 6. The figures themselves
# ---------------------------------------------------------------------------
def test_achievement_is_actual_over_pip_and_rows_are_sorted_worst_last(client, actors):
    year, month = _shift(-3)
    _approve(client, actors, "alfa", year, month, 4)     # delivers 3 -> 75%
    _approve(client, actors, "beta", year, month, 2)     # delivers 2 -> 100%
    _approve(client, actors, "gamma", year, month, 10)   # delivers 1 -> 10%
    for i in range(3):
        _done_site(actors, actors["alfa_id"], year, month, f"PD-ach-a{i}")
    for i in range(2):
        _done_site(actors, actors["beta_id"], year, month, f"PD-ach-b{i}")
    _done_site(actors, actors["gamma_id"], year, month, "PD-ach-g0")

    body = _ask(client, actors["pm"], year, month)

    assert body["pip"] == 16
    assert body["actual"] == 6
    assert body["achievement_percent"] == 37.5
    assert _row_named(body, "Alfa Drive Tests")["achievement_percent"] == 75.0
    assert _row_named(body, "Beta Surveys")["achievement_percent"] == 100.0
    assert _row_named(body, "Gamma Networks")["achievement_percent"] == 10.0

    ranked = [
        r["name"]
        for r in body["rows"]
        if r["name"] in {"Alfa Drive Tests", "Beta Surveys", "Gamma Networks"}
    ]
    assert ranked == ["Beta Surveys", "Alfa Drive Tests", "Gamma Networks"]

    # A contractor with no plan has nothing to rank and sits after the ones
    # that do, rather than at either end of a scale it is not on.
    unranked = [r["name"] for r in body["rows"] if r["achievement_percent"] is None]
    if unranked:
        assert body["rows"][-1]["name"] in unranked


def test_assigned_counts_handovers_dated_into_the_month_once_each(client, actors):
    year, month = _shift(-2)
    other_year, other_month = _shift(-1)

    item = _done_site(actors, actors["alfa_id"], year, month, "PD-assigned")
    _assign(item, actors["alfa_id"], year, month, day=5)
    # Same site, same company, twice in the month: one piece of work.
    _assign(item, actors["alfa_id"], year, month, day=20, active=False)
    # And a handover belonging to a different month.
    second = _done_site(actors, actors["alfa_id"], year, month, "PD-assigned-2")
    _assign(second, actors["alfa_id"], other_year, other_month, day=8)

    body = _ask(client, actors["pm"], year, month)
    assert body["assigned"] == 1


def test_actual_uses_the_dashboard_s_existing_dt_dating_rule(client, actors):
    """The Actual figure and the dashboard's own month card are one fact.

    ``current_month_dt_done`` on ``/overview`` is the rule this section was
    told not to change. Asking both for the current month is the cheapest
    check that it did not: if the dating rule is ever forked, these two stop
    agreeing.
    """
    _done_site(actors, actors["gamma_id"], _YEAR, _MONTH, "PD-current-month")

    overview = client.get("/api/v1/drive-test/overview", headers=actors["pm"])
    assert overview.status_code == 200, overview.text
    card = overview.json()["kpis"]["current_month_dt_done"]["value"]

    body = _ask(client, actors["pm"], _YEAR, _MONTH)
    assert body["actual"] == card


def test_period_defaults_to_the_current_shamsi_month(client, actors):
    r = client.get(PLAN_DELIVERY, headers=actors["pm"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["shamsi_year"], body["shamsi_month"]) == (_YEAR, _MONTH)
    assert body["month_label"] == f"{jalali.month_name(_MONTH)} {_YEAR}"


def test_an_impossible_month_is_refused(client, actors):
    r = client.get(
        PLAN_DELIVERY, headers=actors["pm"], params={"year": 2025, "month": 6}
    )
    assert r.status_code == 400


def test_an_approved_commitment_of_zero_is_a_commitment(client, actors):
    """Zero is a number a PM agreed to, not a missing plan.

    The distinction matters because ``uncommitted_contractors`` is what the
    dashboard uses to say a PIP total is short — and a contractor who
    committed to nothing this month, and had that approved, is not short.
    """
    year, month = _shift(-16)
    _approve(client, actors, "alfa", year, month, 0)

    body = _ask(client, actors["alfa"], year, month)
    assert body["pip"] == 0
    assert body["committed_contractors"] == 1
    assert body["uncommitted_contractors"] == 0
    assert body["achievement_percent"] is None, "still nothing to divide by"
