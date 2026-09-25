"""Tests for the acceptance plan: the PM's monthly target, and the trend.

Covers:

* Only a PM may set the target -- a Coordinator gets 403.
* Setting a target makes it the plan's ``current`` period.
* A second target for the same month appends version 2 and flips
  ``is_current`` on the first row, checked directly against the database.
* A negative target is rejected.
* The monthly trend buckets a village into the Shamsi month its authority
  verdict actually cleared in -- one authority alone counts only that
  authority's ``_new``, and a village cleared by both on different dates
  counts as fully accepted in the *later* month.
* Cumulative totals in the trend accumulate correctly across months.

Run with:  cd backend && pytest tests/test_acceptance_plan.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_acc_plan_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

ACC = "/api/v1/acceptance"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_acc_plan_pytest.db"):
        os.remove("/tmp/uep_acc_plan_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def actors(client):
    admin_h = _login(client)
    return {
        "admin": admin_h,
        "pm": login_as_role(client, admin_h["Authorization"].split()[1], "PM"),
        "coordinator": login_as_role(
            client, admin_h["Authorization"].split()[1], "Coordinator"
        ),
    }


# ---------------------------------------------------------------------------
# Periods: each test claims months of its own, walking backward from a fixed
# point far enough from "now" that no other test's data can bleed in.
# ---------------------------------------------------------------------------
_NOW_YEAR, _NOW_MONTH = jalali.current_shamsi_period()


def _back(n: int) -> tuple[int, int]:
    year, month = _NOW_YEAR, _NOW_MONTH
    for _ in range(n):
        year, month = jalali.previous_period(year, month)
    return year, month


# ---------------------------------------------------------------------------
# Permission and CRUD
# ---------------------------------------------------------------------------
def test_non_pm_cannot_set_target(client, actors):
    year, month = _back(20)
    r = client.put(
        f"{ACC}/plan",
        headers=actors["coordinator"],
        json={"shamsi_year": year, "shamsi_month": month, "target_count": 500},
    )
    assert r.status_code == 403, r.text


def test_pm_can_set_target_and_it_becomes_current(client, actors):
    year, month = _back(21)
    r = client.put(
        f"{ACC}/plan",
        headers=actors["pm"],
        json={
            "shamsi_year": year, "shamsi_month": month,
            "target_count": 1200, "note": "First programme target",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target_count"] == 1200
    assert body["shamsi_year"] == year
    assert body["shamsi_month"] == month
    assert body["set_by"] is not None
    assert body["note"] == "First programme target"

    # GET /plan only reflects this as "current" when it is this month's
    # target, so point the read at the same period through history rather
    # than assuming it is `current`.
    read = client.get(f"{ACC}/plan?months=36", headers=actors["admin"])
    assert read.status_code == 200, read.text
    history = read.json()["history"]
    row = next(
        h for h in history if h["shamsi_year"] == year and h["shamsi_month"] == month
    )
    assert row["target_count"] == 1200


def test_setting_a_second_target_appends_a_version(client, actors):
    from app.models.acceptance_plan import AcceptanceMonthlyTarget

    year, month = _back(22)
    r1 = client.put(
        f"{ACC}/plan",
        headers=actors["pm"],
        json={"shamsi_year": year, "shamsi_month": month, "target_count": 300},
    )
    assert r1.status_code == 200, r1.text

    r2 = client.put(
        f"{ACC}/plan",
        headers=actors["pm"],
        json={
            "shamsi_year": year, "shamsi_month": month,
            "target_count": 350, "note": "Revised upward",
        },
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["target_count"] == 350

    db = SessionLocal()
    rows = (
        db.query(AcceptanceMonthlyTarget)
        .filter(
            AcceptanceMonthlyTarget.shamsi_year == year,
            AcceptanceMonthlyTarget.shamsi_month == month,
        )
        .order_by(AcceptanceMonthlyTarget.version)
        .all()
    )
    db.close()

    assert [row.version for row in rows] == [1, 2]
    assert [row.target_count for row in rows] == [300, 350]
    assert [row.is_current for row in rows] == [False, True]


def test_negative_target_is_rejected(client, actors):
    year, month = _back(23)
    r = client.put(
        f"{ACC}/plan",
        headers=actors["pm"],
        json={"shamsi_year": year, "shamsi_month": month, "target_count": -1},
    )
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# Trend
# ---------------------------------------------------------------------------
def _seed_trend_villages(p_old, p_mid, p_new):
    """Three villages exercising single-authority, cross-month full
    acceptance, and multi-village accumulation within one period.

    * Village A -- ICT approved in ``p_mid`` only; CRA never filed. Counts
      only toward ``ict_new`` for ``p_mid``.
    * Village B -- ICT approved in ``p_old``, CRA approved in ``p_new``
      (later). Fully accepted in ``p_new``, the *later* of the two dates.
    * Village C -- both authorities approved on the same day in ``p_old``.
      Fully accepted in ``p_old``, alongside B's ICT-only contribution that
      month.
    """
    from app.models.acceptance import Acceptance
    from app.models.reference import Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    province = Province(name="TrendProv")
    db.add(province)
    db.flush()
    site = Site(site_code="TR-1", province_id=province.id)
    db.add(site)
    db.flush()

    def _wi(site_type):
        wi = WorkItem(
            site_id=site.id, site_type=site_type, dt_status="Done",
            requested_technology="2G", current_stage="New",
        )
        db.add(wi)
        db.flush()
        return wi

    d_old = jalali.from_shamsi_date(*p_old, 10)
    d_mid = jalali.from_shamsi_date(*p_mid, 10)
    d_new = jalali.from_shamsi_date(*p_new, 10)

    wi_a = _wi("A")
    village_a = Village(
        work_item_id=wi_a.id, village_code="TA", target_classification="هدف"
    )
    acc_a = Acceptance(technology="2G", ict_status="Approved", ict_date=d_mid)
    village_a.acceptances = [acc_a]

    wi_b = _wi("B")
    village_b = Village(
        work_item_id=wi_b.id, village_code="TB", target_classification="هدف"
    )
    acc_b = Acceptance(
        technology="2G",
        ict_status="Approved", ict_date=d_old,
        cra_status="Approved", cra_date=d_new,
    )
    village_b.acceptances = [acc_b]

    wi_c = _wi("C")
    village_c = Village(
        work_item_id=wi_c.id, village_code="TC", target_classification="هدف"
    )
    acc_c = Acceptance(
        technology="2G",
        ict_status="Approved", ict_date=d_old,
        cra_status="Approved", cra_date=d_old,
    )
    village_c.acceptances = [acc_c]

    db.add_all([village_a, village_b, village_c])
    db.commit()
    db.close()


def test_trend_buckets_by_authority_verdict_date_and_accumulates(client, actors):
    p_old = _back(6)
    p_mid = _back(5)
    p_new = _back(4)
    _seed_trend_villages(p_old, p_mid, p_new)

    # Give p_mid a target too, to check it round-trips through the trend.
    client.put(
        f"{ACC}/plan",
        headers=actors["pm"],
        json={"shamsi_year": p_mid[0], "shamsi_month": p_mid[1], "target_count": 2},
    )

    r = client.get(f"{ACC}/trends?months=7", headers=actors["admin"])
    assert r.status_code == 200, r.text
    months = {(m["shamsi_year"], m["shamsi_month"]): m for m in r.json()["months"]}

    old_row = months[p_old]
    mid_row = months[p_mid]
    new_row = months[p_new]

    # p_old: village B contributes ict_new, village C contributes both +
    # fully_accepted_new (same day).
    assert old_row["ict_new"] == 2      # B, C
    assert old_row["cra_new"] == 1      # C
    assert old_row["fully_accepted_new"] == 1   # C only -- B's CRA is later

    # p_mid: village A, ICT only. Not fully accepted (CRA never filed).
    assert mid_row["ict_new"] == 1
    assert mid_row["cra_new"] == 0
    assert mid_row["fully_accepted_new"] == 0
    assert mid_row["target_count"] == 2

    # p_new: village B's CRA clears here -- this is where it becomes fully
    # accepted, not p_old where its ICT cleared.
    assert new_row["ict_new"] == 0
    assert new_row["cra_new"] == 1      # B
    assert new_row["fully_accepted_new"] == 1   # B

    # Cumulative totals carry forward across the whole window.
    assert old_row["ict_cumulative"] == 2
    assert mid_row["ict_cumulative"] == 3
    assert new_row["ict_cumulative"] == 3

    assert old_row["cra_cumulative"] == 1
    assert mid_row["cra_cumulative"] == 1
    assert new_row["cra_cumulative"] == 2

    assert old_row["fully_accepted_cumulative"] == 1
    assert mid_row["fully_accepted_cumulative"] == 1
    assert new_row["fully_accepted_cumulative"] == 2

    # A period with no target set carries no figure, rather than a synthetic
    # zero.
    assert old_row["target_count"] is None
    assert new_row["target_count"] is None


def test_trend_cumulative_is_not_truncated_by_the_window(client, actors):
    """A short window still reports the totals earned before it started.

    The data seeded by the test above lands in the 6th, 5th and 4th months
    back; a 5-month window begins at the 4th, so everything from the two
    older months is outside it. The cumulative figures must still carry
    those in, or a chart with a shorter axis would quietly report a smaller
    programme.
    """
    p_new = _back(4)

    r = client.get(f"{ACC}/trends?months=5", headers=actors["admin"])
    assert r.status_code == 200, r.text
    months = {(m["shamsi_year"], m["shamsi_month"]): m for m in r.json()["months"]}
    assert _back(5) not in months and _back(6) not in months

    row = months[p_new]
    assert row["ict_cumulative"] == 3     # 2 in the oldest month, 1 in the middle
    assert row["cra_cumulative"] == 2
    assert row["fully_accepted_cumulative"] == 2
