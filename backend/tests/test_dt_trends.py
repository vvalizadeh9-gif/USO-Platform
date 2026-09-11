"""The Drive Test trend series and the month flow ledger.

``services/snapshots`` has been writing balances and flows for every Shamsi
month since movement capture was added, and its own docstring notes the flow
columns exist "for a figure nothing displays yet". ``services/dt_trends``
reads them. What is worth testing is not the reading — that is a loop over
columns — but the three ways the underlying capture is imperfect, because the
whole value of the chart depends on it drawing those honestly rather than
smoothing them into a clean line that was never observed:

* **A month nobody signed in during was never captured.** It has to come back
  as a gap, not as a zero and not as an interpolation between its neighbours.
  A zero draws a collapse that did not happen.
* **A month written before movement capture has no closing balance.** Its
  ``total_*`` reading was taken near the *start* of its month, so returning it
  as a closing balance would silently shift a month's figures by a month. It
  comes back flagged instead.
* **A province-scoped user reads their own provinces summed, never the
  national row** — the same rule the delta chips follow, for the same reason:
  a baseline drawn from thirty-one provinces under figures drawn from three
  is not imprecise, it is meaningless.

And one property of the ledger itself: ``opening + arrivals - completions ==
closing``. The waterfall on screen is only worth drawing if it lands on the
closing figure, and it lands on it by construction rather than by an
independently computed final bar.

Run with:  cd backend && pytest tests/test_dt_trends.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_trends_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.acceptance import MonthlySnapshot  # noqa: E402
from app.services import dt_trends  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

TREND = "/api/v1/drive-test/trend"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_trends_pytest.db"):
        os.remove("/tmp/uep_dt_trends_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _periods(n):
    """The last ``n`` Shamsi periods, oldest first."""
    year, month = jalali.current_shamsi_period()
    out = [(year, month)]
    for _ in range(n - 1):
        year, month = jalali.previous_period(year, month)
        out.insert(0, (year, month))
    return out


def _snapshot(db, year, month, *, province_id=None, closing=True, flows=True, base=100):
    """One snapshot row, with or without its movement columns."""
    row = MonthlySnapshot(
        shamsi_year=year,
        shamsi_month=month,
        province_id=province_id,
        total_onair=base,
        total_dt_done=base // 2,
        total_remaining=base - base // 2,
        total_ongoing=base - base // 2 - 5,
        total_problematic=5,
        current_month_dt_done=7,
    )
    if closing:
        row.closing_onair = base + 10
        row.closing_dt_done = base // 2 + 8
        row.closing_remaining = base + 10 - (base // 2 + 8)
        row.closing_ongoing = base + 10 - (base // 2 + 8) - 4
        row.closing_problematic = 4
        row.closing_captured_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    if flows:
        row.flow_new_onair = 10
        row.flow_dt_completed = 8
        row.flow_newly_problematic = 3
        row.flow_problematic_resolved = 4
        row.flow_ongoing_adjustment = 0
    db.add(row)
    return row


@pytest.fixture(autouse=True)
def clean_snapshots(client):
    db = SessionLocal()
    db.query(MonthlySnapshot).delete()
    db.commit()
    db.close()


# ------------------------------------------------------------------ the shape
def test_the_window_is_always_the_length_asked_for(client):
    """Even with nothing captured. The axis is months, not readings."""
    db = SessionLocal()
    series = dt_trends.month_series(db, None, months=6)
    db.close()

    assert len(series) == 6
    assert [p["captured"] for p in series] == [False] * 6


def test_the_window_ends_on_the_current_month(client):
    db = SessionLocal()
    series = dt_trends.month_series(db, None, months=4)
    db.close()

    assert (series[-1]["shamsi_year"], series[-1]["shamsi_month"]) == (
        jalali.current_shamsi_period()
    )
    assert series[-1]["is_open"] is True
    assert [p["is_open"] for p in series[:-1]] == [False, False, False]


def test_the_window_walks_back_across_a_year_boundary(client):
    """Built with previous_period rather than month arithmetic, so nothing
    lands on month 0 or month 13."""
    db = SessionLocal()
    series = dt_trends.month_series(db, None, months=18)
    db.close()

    assert all(1 <= p["shamsi_month"] <= 12 for p in series)
    assert len(series) == 18


# ------------------------------------------------------------ the three gaps
def test_an_uncaptured_month_is_a_gap_not_a_zero(client):
    """The line is meant to break, not to dive to the floor and back."""
    periods = _periods(3)
    db = SessionLocal()
    _snapshot(db, *periods[0], base=100)
    # periods[1] deliberately missing: nobody signed in that month.
    _snapshot(db, *periods[2], base=140)
    db.commit()
    series = dt_trends.month_series(db, None, months=3)
    db.close()

    assert [p["captured"] for p in series] == [True, False, True]
    assert series[1]["remaining"] is None
    assert series[1]["onair"] is None


def test_a_row_without_a_closing_balance_is_flagged_estimated(client):
    """Its total_* reading was taken near the start of its own month, so
    handing it over as a closing balance would shift the month by a month."""
    periods = _periods(2)
    db = SessionLocal()
    _snapshot(db, *periods[0], closing=False, flows=False, base=100)
    _snapshot(db, *periods[1], base=120)
    db.commit()
    series = dt_trends.month_series(db, None, months=2)
    db.close()

    assert series[0]["estimated"] is True
    assert series[0]["remaining"] == 50  # the total_* reading, not a closing one
    assert series[1]["estimated"] is False


def test_a_month_with_no_ledger_reports_no_flows_rather_than_zeros(client):
    """A month that predates movement capture did not have a quiet month."""
    periods = _periods(1)
    db = SessionLocal()
    _snapshot(db, *periods[0], flows=False)
    db.commit()
    series = dt_trends.month_series(db, None, months=1)
    db.close()

    assert series[0]["captured"] is True
    assert series[0]["flows"] is None


def test_a_partial_closing_balance_is_not_a_partial_sum(client):
    """Two provinces, one carrying a closing balance and one not.

    Summing only the one that has it would produce a smaller number that is
    indistinguishable on the chart from a real fall. All-or-nothing instead.
    """
    year, month = jalali.current_shamsi_period()
    db = SessionLocal()
    _snapshot(db, year, month, province_id=1, closing=True, base=100)
    _snapshot(db, year, month, province_id=2, closing=False, flows=False, base=60)
    db.commit()
    series = dt_trends.month_series(db, [1, 2], months=1)
    db.close()

    # Fell back to total_* for both, and said so, rather than reporting one
    # province's closing balance as the pair's.
    assert series[0]["estimated"] is True
    assert series[0]["onair"] == 160


# ------------------------------------------------------------------- scoping
def test_a_scoped_user_reads_their_provinces_summed_not_the_national_row(client):
    year, month = jalali.current_shamsi_period()
    db = SessionLocal()
    _snapshot(db, year, month, province_id=None, base=1000)  # the national row
    _snapshot(db, year, month, province_id=1, base=100)
    _snapshot(db, year, month, province_id=2, base=60)
    db.commit()
    scoped = dt_trends.month_series(db, [1, 2], months=1)
    national = dt_trends.month_series(db, None, months=1)
    db.close()

    assert scoped[0]["onair"] == 110 + 70  # both provinces' closing balances
    assert national[0]["onair"] == 1010
    assert scoped[0]["onair"] != national[0]["onair"]


def test_a_user_scoped_to_nothing_reads_nothing(client):
    year, month = jalali.current_shamsi_period()
    db = SessionLocal()
    _snapshot(db, year, month, province_id=None, base=1000)
    db.commit()
    series = dt_trends.month_series(db, [], months=1)
    db.close()

    assert [p["captured"] for p in series] == [False]


# ----------------------------------------------------------------- the ledger
def test_the_ledger_closes(client):
    """opening + arrivals - completions == closing, by construction."""
    year, month = jalali.current_shamsi_period()
    db = SessionLocal()
    _snapshot(db, year, month, base=100)
    db.commit()
    series = dt_trends.month_series(db, None, months=1)
    db.close()

    flows = dt_trends.latest_flows(series)
    assert flows is not None
    assert (
        flows["opening_remaining"] + flows["new_onair"] - flows["dt_completed"]
        == flows["closing_remaining"]
    )


def test_the_ledger_walks_back_to_the_newest_month_that_has_one(client):
    """The current month is the one worth reading and the one most likely to
    have no ledger yet. A section that showed an empty frame in that case
    would be worse than one showing last month's real figures."""
    periods = _periods(2)
    db = SessionLocal()
    _snapshot(db, *periods[0], base=100)  # has flows
    _snapshot(db, *periods[1], flows=False, base=140)  # current month, no ledger
    db.commit()
    series = dt_trends.month_series(db, None, months=2)
    db.close()

    flows = dt_trends.latest_flows(series)
    assert flows["shamsi_month"] == periods[0][1]
    assert flows["is_open"] is False


def test_no_ledger_anywhere_reports_none_rather_than_an_empty_one(client):
    periods = _periods(2)
    db = SessionLocal()
    _snapshot(db, *periods[0], flows=False)
    db.commit()
    series = dt_trends.month_series(db, None, months=2)
    db.close()

    assert dt_trends.latest_flows(series) is None


# ---------------------------------------------------------------- the endpoint
def test_the_endpoint_returns_the_window_and_the_ledger(client):
    # Signing in first, deliberately. ``ensure_current_month_snapshot`` runs on
    # the login path and refreshes the open month's movement columns, so a row
    # seeded before the login would be overwritten with the real (empty)
    # figures and this would be testing the seeding, not the endpoint.
    headers = _login(client)
    year, month = jalali.current_shamsi_period()
    db = SessionLocal()
    db.query(MonthlySnapshot).delete()
    _snapshot(db, year, month, base=100)
    db.commit()
    db.close()

    body = client.get(TREND, headers=headers, params={"months": 5}).json()
    assert len(body["months"]) == 5
    assert body["months"][-1]["is_open"] is True
    assert body["latest_flows"]["dt_completed"] == 8


def test_the_endpoint_does_not_repeat_the_flows_on_every_point(client):
    """They are returned once, paired with the opening balance that makes them
    a ledger. Every other point has no opening balance to close against."""
    headers = _login(client)
    year, month = jalali.current_shamsi_period()
    db = SessionLocal()
    db.query(MonthlySnapshot).delete()
    _snapshot(db, year, month, base=100)
    db.commit()
    db.close()

    body = client.get(TREND, headers=headers).json()
    assert all("flows" not in point for point in body["months"])


def test_the_endpoint_needs_a_signed_in_user(client):
    assert client.get(TREND).status_code == 401


def test_the_endpoint_caps_the_window(client):
    """Past three years the axis stops being readable long before the query
    stops being cheap, so the limit is about the chart."""
    headers = _login(client)
    assert client.get(TREND, headers=headers, params={"months": 37}).status_code == 422
    assert client.get(TREND, headers=headers, params={"months": 1}).status_code == 422
    assert client.get(TREND, headers=headers, params={"months": 36}).status_code == 200
