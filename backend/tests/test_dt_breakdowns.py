"""The Drive Test dashboard's ongoing, problematic and province breakdowns.

These sections are only worth putting in front of anyone if their numbers add
up, so that is what is tested here. Not the arithmetic of any one bucket — a
counter in a loop — but the four properties a reader has to be able to assume
without checking, and which nothing but a test can keep true as the workflow
grows new stages:

* **The stage buckets partition the ongoing total.** Every ongoing site is in
  exactly one bucket. A stage added to the workflow and not to
  ``ONGOING_STAGE_ORDER`` must land in ``Other`` and still be counted, not
  vanish and quietly shrink the section by a number nobody can see.
* **Ongoing plus problematic equals remaining.** The two sub-cards under
  Remaining are its parts. If they stop being its parts, the group header on
  the page is a lie.
* **The contractor rows plus the no-contractor count equal ongoing.** The
  contractor view deliberately drops unattributed sites, so it only
  reconciles with that count beside it — which is why the count is in the
  payload rather than left for the reader to work out.
* **A contractor is shown no other company.** The scope helper hands a
  contractor every site they have *ever* held, including ones since handed to
  a competitor. Those sites are still theirs to count and the competitor's
  name is not theirs to see, and getting that combination right is the whole
  reason the contractor view is not just the existing chart.

Aging bands are absent by design, not by omission: nothing records when a
site became problematic. See ``DriveTestAnalytics.breakdowns``.

Run with:  cd backend && pytest tests/test_dt_breakdowns.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_breakdowns_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.services.drive_test_analytics import (  # noqa: E402
    ONGOING_STAGE_ORDER,
    OTHER_CONTRACTORS,
    STAGE_OTHER,
)
from app.services.workflow import (  # noqa: E402
    STAGE_ASSIGNED,
    STAGE_DT_SUBMITTED,
    STAGE_HC_IN_PROGRESS,
    STAGE_HC_REVIEW,
    STAGE_HEALTH_PROBLEM,
    STAGE_NEW,
    STAGE_READY,
    STAGE_RETURNED,
)
from tests.conftest import create_schema, login_form  # noqa: E402

OVERVIEW = "/api/v1/drive-test/overview"

#: The on-air stage the DT KPIs recognise. Anything else is invisible to this
#: dashboard, which is what makes it the right value to seed with.
ONAIR = "راه_اندازی_دائم"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_breakdowns_pytest.db"):
        os.remove("/tmp/uep_dt_breakdowns_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# --------------------------------------------------------------------- setup
def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(client, headers, name):
    roles = client.get("/api/v1/reference/roles", headers=headers).json()
    return next(r["id"] for r in roles if r["name"] == name)


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
def world(client):
    """One deterministic programme: two provinces, two contractors, and at
    least one ongoing site in every stage the ongoing tab can show.

    Seeded once for the module. Every assertion below is a property of the
    whole set rather than of a particular row, so the tests neither depend on
    each other nor on the order they run in.
    """
    from app.models.reference import Contractor, Province
    from app.models.workitem import Assignment, Site, WorkItem

    admin_h = _login(client)

    db = SessionLocal()
    alfa = Contractor(name="Alfa Drive Tests", type="drive_test", active=True)
    beta = Contractor(name="Beta Surveys", type="drive_test", active=True)
    db.add_all([alfa, beta])
    db.flush()

    kerman = Province(name="Kerman")
    yazd = Province(name="Yazd")
    db.add_all([kerman, yazd])
    db.flush()

    kerman_site = Site(site_code="BD-K", province_id=kerman.id)
    yazd_site = Site(site_code="BD-Y", province_id=yazd.id)
    db.add_all([kerman_site, yazd_site])
    db.flush()

    def item(site, tag, stage, *, dt_status=None, category=None, contractor=None):
        wi = WorkItem(
            site_id=site.id,
            site_type=tag,
            last_stage=ONAIR,
            current_stage=stage,
            dt_status=dt_status,
            dt_problem_category=category,
            dt_sc_contractor_id=contractor,
        )
        db.add(wi)
        db.flush()
        return wi

    # Ongoing, one per stage, spread over both provinces. Alfa holds the two
    # that are with a contractor; the rest are attributed to nobody, which is
    # what the no-contractor count has to account for.
    item(kerman_site, "ong-new", STAGE_NEW)
    item(kerman_site, "ong-hc-prog", STAGE_HC_IN_PROGRESS)
    item(kerman_site, "ong-hc-review", STAGE_HC_REVIEW)
    item(kerman_site, "ong-ready", STAGE_READY)
    item(yazd_site, "ong-assigned", STAGE_ASSIGNED, contractor=alfa.id)
    item(yazd_site, "ong-returned", STAGE_RETURNED, contractor=alfa.id)
    item(yazd_site, "ong-submitted", STAGE_DT_SUBMITTED)

    # Problematic by both signals — the CPM status column and the in-app
    # stage — because the section has to count sites that became problematic
    # inside the app without waiting for the next import.
    item(kerman_site, "prob-cpm", STAGE_READY, dt_status="Problematic", category="Power")
    item(kerman_site, "prob-inapp", STAGE_HEALTH_PROBLEM)
    item(yazd_site, "prob-cpm-2", STAGE_READY, dt_status="Problematic", category="Access")

    # Done, so remaining is smaller than on-air and the reconciliation has
    # something to reconcile.
    item(kerman_site, "done-1", STAGE_NEW, dt_status="Done")
    item(yazd_site, "done-2", STAGE_NEW, dt_status="Done")

    # A site Alfa used to hold and Beta holds now. It is in Alfa's visible set
    # for good reasons (their history), and Beta's name must not reach them.
    handed_on = item(yazd_site, "ong-handed-on", STAGE_ASSIGNED, contractor=alfa.id)
    db.add_all(
        [
            Assignment(
                work_item_id=handed_on.id,
                assignment_type="official",
                contractor_id=alfa.id,
                assigned_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                is_active=False,
            ),
            Assignment(
                work_item_id=handed_on.id,
                assignment_type="official",
                contractor_id=beta.id,
                assigned_at=datetime(2024, 6, 1, tzinfo=timezone.utc),
                is_active=True,
            ),
        ]
    )
    db.commit()
    ids = {"alfa": alfa.id, "beta": beta.id}
    db.close()

    return {
        "admin": admin_h,
        "alfa": _make_user(client, admin_h, "bd_alfa", "Contractor", ids["alfa"]),
        "beta": _make_user(client, admin_h, "bd_beta", "Contractor", ids["beta"]),
    }


def _overview(client, headers):
    r = client.get(OVERVIEW, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _total(points):
    return sum(p["value"] for p in points)


# ---------------------------------------------------------------- the payload
def test_stage_buckets_sum_to_the_ongoing_total(client, world):
    body = _overview(client, world["admin"])
    ongoing = body["ongoing_breakdown"]

    assert _total(ongoing["by_stage"]) == ongoing["total"]
    assert ongoing["total"] == body["kpis"]["total_ongoing"]["value"]


def test_every_stage_bucket_is_a_known_stage_and_none_repeat(client, world):
    """A partition, not a selection: one bucket per stage, all of them known.

    The ``Other`` bucket is legitimate — it is the catch-all that keeps the
    sum honest when the workflow grows a stage this module has not been told
    about — but on this seeded set nothing should be in it, and its presence
    would mean exactly that.
    """
    ongoing = _overview(client, world["admin"])["ongoing_breakdown"]
    names = [p["name"] for p in ongoing["by_stage"]]

    assert len(names) == len(set(names))
    assert set(names) <= set(ONGOING_STAGE_ORDER) | {STAGE_OTHER}
    assert STAGE_OTHER not in names


def test_stage_buckets_stay_in_workflow_order(client, world):
    """Order carries the meaning here — the tab is read as a pipeline, so it
    must not be re-sorted by size the way the other views are."""
    ongoing = _overview(client, world["admin"])["ongoing_breakdown"]
    names = [p["name"] for p in ongoing["by_stage"] if p["name"] != STAGE_OTHER]

    assert names == [s for s in ONGOING_STAGE_ORDER if s in names]


def test_ongoing_plus_problematic_equals_remaining(client, world):
    body = _overview(client, world["admin"])
    kpis = body["kpis"]

    assert (
        body["ongoing_breakdown"]["total"] + body["problematic_breakdown"]["total"]
        == kpis["total_remaining"]["value"]
    )


def test_contractor_rows_plus_the_no_contractor_count_equal_ongoing(client, world):
    ongoing = _overview(client, world["admin"])["ongoing_breakdown"]

    assert (
        _total(ongoing["by_contractor"]) + ongoing["without_contractor"]
        == ongoing["total"]
    )
    # The count is the point of the assertion above — a zero would make it
    # pass without proving anything, and this set has unattributed sites.
    assert ongoing["without_contractor"] > 0


def test_ongoing_by_province_sums_to_the_ongoing_total(client, world):
    ongoing = _overview(client, world["admin"])["ongoing_breakdown"]

    assert _total(ongoing["by_province"]) == ongoing["total"]


def test_category_breakdown_sums_to_the_problematic_total(client, world):
    body = _overview(client, world["admin"])
    problematic = body["problematic_breakdown"]

    assert _total(problematic["by_category"]) == problematic["total"]
    assert _total(problematic["by_province"]) == problematic["total"]
    assert problematic["total"] == body["kpis"]["total_problematic"]["value"]


def test_problematic_counts_both_signals(client, world):
    """A site flagged inside the app counts even though no import has seen it.

    Seeded with two CPM-status sites and one in-app one, so a breakdown that
    read only ``dt_status`` would come back with two and pass every sum above.
    """
    problematic = _overview(client, world["admin"])["problematic_breakdown"]

    assert problematic["total"] == 3


def test_province_rows_sum_to_the_programme_totals(client, world):
    body = _overview(client, world["admin"])
    kpis = body["kpis"]
    rows = body["province_breakdown"]

    assert sum(r["onair"] for r in rows) == kpis["total_onair"]["value"]
    assert sum(r["done"] for r in rows) == kpis["total_dt_done"]["value"]
    assert sum(r["remaining"] for r in rows) == kpis["total_remaining"]["value"]
    assert sum(r["ongoing"] for r in rows) == kpis["total_ongoing"]["value"]
    assert sum(r["problematic"] for r in rows) == kpis["total_problematic"]["value"]


def test_province_rows_are_sorted_by_remaining_descending(client, world):
    """Not alphabetically. The table exists to say where the outstanding work
    is, and name order buries that under an answer nobody asked for."""
    rows = _overview(client, world["admin"])["province_breakdown"]
    remaining = [r["remaining"] for r in rows]

    assert remaining == sorted(remaining, reverse=True)
    assert len(rows) >= 2, "a one-row table proves nothing about ordering"


def test_each_province_row_is_internally_consistent(client, world):
    for row in _overview(client, world["admin"])["province_breakdown"]:
        assert row["remaining"] == row["onair"] - row["done"]
        assert row["ongoing"] + row["problematic"] == row["remaining"]


# ------------------------------------------------------------------- scoping
def test_a_contractor_sees_no_other_company_in_any_breakdown(client, world):
    """Alfa holds a site that is now Beta's. Beta's name must not appear.

    This is the case the existing per-contractor chart cannot handle on its
    own, and the reason the breakdown builds its own contractor rows: the
    site is legitimately in Alfa's scope, so it cannot simply be filtered
    out, and it is attributed to Beta, so it cannot be named.
    """
    body = _overview(client, world["alfa"])
    ongoing = body["ongoing_breakdown"]
    names = [p["name"] for p in ongoing["by_contractor"]]

    assert "Beta Surveys" not in names
    assert "Alfa Drive Tests" in names
    assert OTHER_CONTRACTORS in names, (
        "the handed-on site is still in Alfa's scope and has to be counted "
        "somewhere, or the contractor view stops reconciling"
    )


def test_a_contractors_breakdowns_still_reconcile(client, world):
    """The anonymising above must not cost the section its arithmetic."""
    body = _overview(client, world["alfa"])
    ongoing = body["ongoing_breakdown"]
    problematic = body["problematic_breakdown"]
    kpis = body["kpis"]

    assert _total(ongoing["by_stage"]) == ongoing["total"]
    assert (
        _total(ongoing["by_contractor"]) + ongoing["without_contractor"]
        == ongoing["total"]
    )
    assert _total(ongoing["by_province"]) == ongoing["total"]
    assert _total(problematic["by_category"]) == problematic["total"]
    assert ongoing["total"] + problematic["total"] == kpis["total_remaining"]["value"]


def test_a_contractor_sees_less_than_the_admin(client, world):
    """Guards the test above from passing on an empty or unscoped payload."""
    admin = _overview(client, world["admin"])["kpis"]["total_onair"]["value"]
    alfa = _overview(client, world["alfa"])["kpis"]["total_onair"]["value"]

    assert 0 < alfa < admin


# --------------------------------------------------------------- untouched
def test_the_existing_charts_are_still_there(client, world):
    """Additive: this section added fields, it did not replace any."""
    body = _overview(client, world["admin"])

    for key in (
        "ongoing_by_contractor",
        "problematic_by_category",
        "dt_done_by_contractor",
        "dt_done_yearly",
        "dt_done_monthly",
        "progress_by_province",
    ):
        assert key in body, key
