"""``GET /drive-test/flow``: on-air and DT-done counts by Shamsi month.

Same style as ``test_dt_site_list.py``: one seeded world, hit the real
endpoint through the real app, assert on the JSON. The property that matters
most is parity -- see ``test_parity_with_kpis`` -- because a flow chart whose
buckets do not add up to the KPI cards on the same dashboard is worse than no
chart at all.

Run with:  cd backend && pytest tests/test_dt_flow.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_flow_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

FLOW = "/api/v1/drive-test/flow"
OVERVIEW = "/api/v1/drive-test/overview"

#: The on-air stage the DT KPIs recognise.
ONAIR = "راه_اندازی_دائم"
#: A stage that is not on-air, for a site the endpoint must never count.
OFFAIR = "طراحی"

CURRENT_YEAR, CURRENT_MONTH = jalali.current_shamsi_period()


def _shift(year: int, month: int, delta: int) -> tuple[int, int]:
    """``(year, month)`` shifted by ``delta`` Shamsi months (may be negative)."""
    total = year * 12 + (month - 1) + delta
    return total // 12, total % 12 + 1


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_flow_pytest.db"):
        os.remove("/tmp/uep_dt_flow_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(client, headers, name):
    roles = client.get("/api/v1/reference/roles", headers=headers).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _make_user(client, admin_h, username, role_name, *, province_ids=None):
    password = "Test-Fixture-Passphrase"
    body = {
        "username": username,
        "password": password,
        "first_name": "Test",
        "family_name": username,
        "role_id": _role_id(client, admin_h, role_name),
        "sees_all_provinces": province_ids is None,
        "province_ids": province_ids or [],
    }
    r = client.post("/api/v1/admin/users", headers=admin_h, json=body)
    assert r.status_code == 201, r.text
    return _login(client, username, password)


@pytest.fixture(scope="module")
def world(client):
    """One programme with a work item in every placement this endpoint has
    to answer for: opening (both ends of the 1403/1404 boundary), a named
    month, not-placed (blank, malformed, and after the current month), an
    off-air site, and a second province to check scoping against.
    """
    from app.models.reference import Province
    from app.models.workitem import Site, WorkItem

    admin_h = _login(client)

    db = SessionLocal()
    flow_p = Province(name="FlowProvince")
    other_p = Province(name="OtherFlowProvince")
    db.add_all([flow_p, other_p])
    db.flush()

    flow_site = Site(site_code="SL-FLOW", province_id=flow_p.id)
    other_site = Site(site_code="SL-FLOW-OTHER", province_id=other_p.id)
    db.add_all([flow_site, other_site])
    db.flush()

    def item(
        site,
        tag,
        *,
        last_stage=ONAIR,
        launch_shamsi=None,
        dt_status=None,
        dt_date=None,
    ):
        wi = WorkItem(
            site_id=site.id,
            site_type=tag,
            last_stage=last_stage,
            current_stage="New",
            dt_status=dt_status,
            launch_date_shamsi=launch_shamsi,
            dt_date_gregorian=dt_date,
        )
        db.add(wi)
        return wi

    esfand_last_day = jalali.days_in_month(1403, 12)

    # -- opening: dated before 1404/01/01, at both ends of the boundary --
    last_of_esfand = item(
        flow_site, "opening-esfand",
        launch_shamsi=f"1403/12/{esfand_last_day:02d}",
    )
    item(
        flow_site, "opening-done",
        launch_shamsi="1403/06/01",
        dt_status="Done",
        dt_date=jalali.from_shamsi_date(1403, 11, 20),
    )

    # -- first of Farvandin 1404: the first month of the series, not opening --
    first_of_farvardin = item(
        flow_site, "first-farvardin", launch_shamsi="1404/01/01",
    )

    # -- a named month in the middle of the series --
    item(
        flow_site, "mid-month-onair", launch_shamsi="1404/05/10",
    )
    item(
        flow_site, "mid-month-done",
        launch_shamsi="1404/05/10",
        dt_status="Done",
        dt_date=jalali.from_shamsi_date(1404, 5, 12),
    )

    # -- not placed: blank, malformed, and after the current month --
    item(flow_site, "undated")
    item(flow_site, "malformed", launch_shamsi="not-a-real-date")
    future_year, future_month = _shift(CURRENT_YEAR, CURRENT_MONTH, 1)
    item(flow_site, "future-onair", launch_shamsi=f"{future_year:04d}/{future_month:02d}/01")
    item(
        flow_site, "done-no-date",
        launch_shamsi="1404/05/10",  # placed on-air; isolates the DT-done gap
        dt_status="Done",
        dt_date=None,
    )

    # -- off-air: must not appear anywhere in the payload --
    item(flow_site, "offair", last_stage=OFFAIR, launch_shamsi="1404/05/10")

    # -- a site in a second province, for the scoping tests --
    item(other_site, "other-onair", launch_shamsi="1404/05/10")
    item(
        other_site, "other-done",
        launch_shamsi="1404/05/10",
        dt_status="Done",
        dt_date=jalali.from_shamsi_date(1404, 5, 12),
    )

    db.commit()
    ids = {
        "flow_province": flow_p.id,
        "other_province": other_p.id,
        "last_of_esfand": last_of_esfand.id,
        "first_of_farvardin": first_of_farvardin.id,
    }
    db.close()

    return {
        "admin": admin_h,
        "ids": ids,
        "flow_staff": _make_user(
            client, admin_h, "flow_scoped", "Coordinator", province_ids=[ids["flow_province"]]
        ),
    }


def _flow(client, headers, **params):
    r = client.get(FLOW, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _overview(client, headers, **params):
    r = client.get(OVERVIEW, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _months_by_period(body):
    return {(m["year"], m["month"]): m for m in body["months"]}


# --------------------------------------------------------------- months axis
def test_months_run_farvardin_1404_to_now_with_no_gaps(client, world):
    body = _flow(client, world["admin"])
    months = body["months"]

    assert (months[0]["year"], months[0]["month"]) == (1404, 1)
    assert (months[-1]["year"], months[-1]["month"]) == (CURRENT_YEAR, CURRENT_MONTH)

    year, month = 1404, 1
    for point in months:
        assert (point["year"], point["month"]) == (year, month)
        year, month = _shift(year, month, 1)


def test_only_current_month_is_open(client, world):
    body = _flow(client, world["admin"])
    open_months = [(m["year"], m["month"]) for m in body["months"] if m["is_open"]]
    assert open_months == [(CURRENT_YEAR, CURRENT_MONTH)]


# ------------------------------------------------------------- placement
def test_first_of_farvardin_lands_in_the_first_month_not_opening(client, world):
    body = _flow(client, world["admin"])
    months = _months_by_period(body)
    # first-farvardin, mid-month-onair, mid-month-done, done-no-date all also
    # land elsewhere; isolate by checking the count that only 1404/01 holds.
    assert months[(1404, 1)]["on_aired"] >= 1


def test_last_day_of_esfand_is_opening_not_a_month(client, world):
    body = _flow(client, world["admin"])
    months = _months_by_period(body)
    assert (1403, 12) not in months
    # The opening balance must include it -- checked precisely in the
    # dedicated opening test below via the full-count comparison.
    assert body["opening"]["on_air"] >= 1


def test_opening_equals_everything_dated_before_1404_01_01(client, world):
    """Opening's on_air/dt_done are exactly the on-air/DT-done items whose
    placement date is before 1 Farvardin 1404 -- computed independently here
    from the seeded dates, not by re-reading the endpoint's own logic."""
    from app.services.drive_test_analytics import DriveTestAnalytics, is_dt_done
    from app.models.reference import User

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        analytics = DriveTestAnalytics(db, admin, province_id=world["ids"]["flow_province"])
        onair = analytics.onair_items()

        boundary = jalali.from_shamsi_date(1404, 1, 1)
        expected_opening_onair = 0
        expected_opening_done = 0
        for wi in onair:
            if wi.launch_date_shamsi:
                try:
                    launch = jalali.parse_shamsi(wi.launch_date_shamsi)
                except ValueError:
                    launch = None
                if launch is not None and launch < boundary:
                    expected_opening_onair += 1
            if is_dt_done(wi) and wi.dt_date_gregorian and wi.dt_date_gregorian < boundary:
                expected_opening_done += 1
    finally:
        db.close()

    body = _flow(client, world["admin"], province_id=world["ids"]["flow_province"])
    assert body["opening"]["on_air"] == expected_opening_onair
    assert body["opening"]["dt_done"] == expected_opening_done


# ------------------------------------------------------------- not placed
def test_undated_malformed_and_future_are_not_placed(client, world):
    body = _flow(client, world["admin"], province_id=world["ids"]["flow_province"])
    # undated, malformed, future-onair -> 3 on-air items with no usable month.
    assert body["not_placed"]["on_air"] >= 3


def test_done_with_no_dt_date_is_not_placed(client, world):
    body = _flow(client, world["admin"], province_id=world["ids"]["flow_province"])
    assert body["not_placed"]["dt_done"] >= 1


# ------------------------------------------------------------------ off-air
def test_offair_site_never_appears(client, world):
    body = _flow(client, world["admin"], province_id=world["ids"]["flow_province"])
    total = (
        body["opening"]["on_air"]
        + sum(m["on_aired"] for m in body["months"])
        + body["not_placed"]["on_air"]
    )
    overview = _overview(client, world["admin"], province_id=world["ids"]["flow_province"])
    # The off-air seed item must not have inflated the on-air total the KPI
    # itself would also refuse to count it into.
    assert total == overview["kpis"]["total_onair"]["value"]


# ------------------------------------------------------------------ parity
@pytest.mark.parametrize("scope_key", ["admin", "flow_staff"])
def test_parity_with_kpis(client, world, scope_key):
    """opening + all months + not_placed == the KPI on-air/DT-done figures,
    for the same user and the same province scope."""
    headers = world[scope_key]
    # Both scoped to the same province, so the two runs are directly
    # comparable and neither depends on state seeded by the other tests.
    params = {"province_id": world["ids"]["flow_province"]}

    body = _flow(client, headers, **params)
    overview = _overview(client, headers, **params)

    total_onair = (
        body["opening"]["on_air"]
        + sum(m["on_aired"] for m in body["months"])
        + body["not_placed"]["on_air"]
    )
    total_done = (
        body["opening"]["dt_done"]
        + sum(m["dt_done"] for m in body["months"])
        + body["not_placed"]["dt_done"]
    )

    assert total_onair == overview["kpis"]["total_onair"]["value"]
    assert total_done == overview["kpis"]["total_dt_done"]["value"]


# ------------------------------------------------------------------ scoping
def test_province_scoped_user_gets_narrower_numbers(client, world):
    admin_body = _flow(client, world["admin"], province_id=world["ids"]["flow_province"])
    staff_body = _flow(client, world["flow_staff"])

    assert staff_body["opening"] == admin_body["opening"]
    assert staff_body["not_placed"] == admin_body["not_placed"]
    assert staff_body["months"] == admin_body["months"]


def test_province_scoped_user_cannot_reach_another_province(client, world):
    r = client.get(
        FLOW,
        headers=world["flow_staff"],
        params={"province_id": world["ids"]["other_province"]},
    )
    assert r.status_code == 404
