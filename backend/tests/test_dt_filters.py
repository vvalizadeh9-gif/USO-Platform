"""The Drive Test dashboard's filter, its aging bands and its scorecard, and
the drill-through filters the work queue grew to receive them.

Three of these are new answers to questions the dashboard could not answer,
and one is a rule that has to hold for all of them:

* **A province filter that can only narrow.** It is applied after
  ``apply_work_item_scope``, so a user who asks for a province they were never
  granted must be refused rather than quietly widened back to everything or
  quietly handed an empty answer. The same goes for the drill-through filters
  on the work queue, which arrive from a URL anyone can edit.
* **Two aging clocks, neither of them invented.** An ongoing site ages from
  its assignment date; a problematic site ages from the day it last entered
  the state, replayed from the platform's dated transitions. Where neither
  date exists -- a site nobody was given, a Problematic status imported as a
  bare CPM column -- the site is counted apart under its own key rather than
  filed into the newest band, which would make the backlog look fresher than
  it is.
* **A scorecard that compares.** Ranking contractors by a raw count mostly
  ranks them by size. Carrying the denominator is what makes two companies of
  different sizes readable against each other, and the rows still have to
  account for every on-air site.
* **A contractor is still shown no other company**, in every one of them.

Run with:  cd backend && pytest tests/test_dt_filters.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_filters_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import date, datetime, timedelta, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.services.drive_test_analytics import UNATTRIBUTED  # noqa: E402
from app.services.workflow import (  # noqa: E402
    STAGE_ASSIGNED,
    STAGE_HEALTH_PROBLEM,
    STAGE_NEW,
    STAGE_READY,
)
from tests.conftest import create_schema, login_form  # noqa: E402

OVERVIEW = "/api/v1/drive-test/overview"
WORK_ITEMS = "/api/v1/work-items"
ONAIR = "راه_اندازی_دائم"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_filters_pytest.db"):
        os.remove("/tmp/uep_dt_filters_pytest.db")
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


def _make_user(
    client, admin_h, username, role_name, *, contractor_id=None, province_ids=None
):
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
    if contractor_id is not None:
        body["contractor_id"] = contractor_id
    r = client.post("/api/v1/admin/users", headers=admin_h, json=body)
    assert r.status_code == 201, r.text
    return _login(client, username, password)


@pytest.fixture(scope="module")
def world(client):
    """Two provinces, two contractors, and ongoing sites of known ages.

    Assignment dates are set relative to today so the bands stay right
    whenever the suite runs — a fixed date would drift into the next band and
    start failing on a calendar boundary rather than on a code change.
    """
    from app.models.reference import Contractor, Province
    from app.models.workitem import Assignment, HealthCheck, Site, WorkItem

    admin_h = _login(client)
    today = date.today()

    db = SessionLocal()
    alfa = Contractor(name="Alfa Drive Tests", type="drive_test", active=True)
    beta = Contractor(name="Beta Surveys", type="drive_test", active=True)
    db.add_all([alfa, beta])
    db.flush()

    kerman = Province(name="Kerman")
    yazd = Province(name="Yazd")
    db.add_all([kerman, yazd])
    db.flush()

    k_site = Site(site_code="F-K", province_id=kerman.id)
    y_site = Site(site_code="F-Y", province_id=yazd.id)
    db.add_all([k_site, y_site])
    db.flush()

    def item(site, tag, stage, *, dt_status=None, contractor=None, age_days=None, assign=True):
        """One work item, optionally with a live assignment of a known age.

        ``age_days`` dates the *assignment*, which is what the aging bands
        run on. The launch date is set alongside it so the rest of the
        fixture still has a plausible on-air date to carry. ``assign=False``
        leaves the assignment to the caller, for the site whose whole point is
        the hand-over it was given by hand.
        """
        wi = WorkItem(
            site_id=site.id,
            site_type=tag,
            last_stage=ONAIR,
            current_stage=stage,
            dt_status=dt_status,
            dt_sc_contractor_id=contractor,
            launch_date_gregorian=(
                None if age_days is None else today - timedelta(days=age_days)
            ),
        )
        db.add(wi)
        db.flush()
        if assign and age_days is not None and contractor is not None:
            db.add(
                Assignment(
                    work_item_id=wi.id,
                    assignment_type="official",
                    contractor_id=contractor,
                    assigned_at=datetime.combine(
                        today - timedelta(days=age_days), datetime.min.time()
                    ).replace(tzinfo=timezone.utc),
                    is_active=True,
                )
            )
            db.flush()
        return wi

    # Kerman: one ongoing site in each age band, plus one never assigned.
    item(k_site, "age-3d", STAGE_ASSIGNED, age_days=3, contractor=alfa.id)
    item(k_site, "age-10d", STAGE_ASSIGNED, age_days=10, contractor=alfa.id)
    item(k_site, "age-18d", STAGE_ASSIGNED, age_days=18, contractor=alfa.id)
    item(k_site, "age-26d", STAGE_ASSIGNED, age_days=26, contractor=beta.id)
    item(k_site, "age-90d", STAGE_ASSIGNED, age_days=90, contractor=beta.id)
    item(k_site, "age-none", STAGE_READY, age_days=None)

    # Kerman done + problematic, so the scorecard has a denominator worth
    # dividing by and the province rows have something to reconcile.
    item(k_site, "k-done-1", STAGE_NEW, dt_status="Done", age_days=300, contractor=alfa.id)
    item(k_site, "k-done-2", STAGE_NEW, dt_status="Done", age_days=300, contractor=alfa.id)
    item(k_site, "k-prob", STAGE_READY, dt_status="Problematic", age_days=90, contractor=beta.id)

    # Two problematic sites the platform *dated*, so the problematic clock has
    # something to measure. The CPM-flagged site above deliberately stays
    # undated -- it is what `without_problem_date` counts.
    def flag(site, tag, *, events):
        """A site sitting in the in-app Problematic stage, with its history.

        ``events`` is ``[(days_ago, is_problematic)]``, oldest first, written
        as health checks because that is the dated signal the replay reads.
        """
        wi = item(site, tag, STAGE_HEALTH_PROBLEM, age_days=200, contractor=beta.id)
        for days_ago, problematic in events:
            db.add(
                HealthCheck(
                    work_item_id=wi.id,
                    status="Problematic" if problematic else "Ready",
                    checked_at=datetime.combine(
                        today - timedelta(days=days_ago), datetime.min.time()
                    ).replace(tzinfo=timezone.utc),
                )
            )
        db.flush()
        return wi

    # Flagged 5 days ago and still flagged: one clean spell.
    flag(k_site, "k-prob-fresh", events=[(5, True)])
    # Flagged a year ago, fixed, flagged again 40 days ago. The clock is the
    # spell it is in now, not the first one it was ever in.
    reflagged = flag(y_site, "y-prob-reflagged", events=[(365, True), (200, False), (40, True)])

    # Yazd: a smaller book, so the two provinces differ and a filter is
    # visibly doing something.
    item(y_site, "y-ong", STAGE_READY, age_days=45, contractor=beta.id)
    item(y_site, "y-done", STAGE_NEW, dt_status="Done", age_days=200, contractor=beta.id)

    # A site Alfa used to hold and Beta holds now, so the drill-through filter
    # has to prefer the live assignment over the CPM-seeded subcontractor.
    handed = item(
        y_site, "y-handed", STAGE_ASSIGNED, age_days=30, contractor=alfa.id, assign=False
    )
    db.add_all(
        [
            Assignment(
                work_item_id=handed.id,
                assignment_type="official",
                contractor_id=alfa.id,
                assigned_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                is_active=False,
            ),
            Assignment(
                work_item_id=handed.id,
                assignment_type="official",
                contractor_id=beta.id,
                assigned_at=datetime(2024, 6, 1, tzinfo=timezone.utc),
                is_active=True,
            ),
        ]
    )
    db.commit()
    ids = {
        "alfa": alfa.id,
        "beta": beta.id,
        "kerman": kerman.id,
        "yazd": yazd.id,
        "reflagged": reflagged.id,
    }
    db.close()

    return {
        "admin": admin_h,
        "ids": ids,
        "alfa": _make_user(client, admin_h, "f_alfa", "Contractor", contractor_id=ids["alfa"]),
        "kerman_only": _make_user(
            client, admin_h, "f_kerman", "Coordinator", province_ids=[ids["kerman"]]
        ),
    }


def _overview(client, headers, **params):
    r = client.get(OVERVIEW, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _band(points, name):
    return next(p["value"] for p in points if p["name"] == name)


# ------------------------------------------------------------ province filter
def test_the_filter_narrows_every_figure_on_the_page(client, world):
    everything = _overview(client, world["admin"])
    kerman = _overview(client, world["admin"], province_id=world["ids"]["kerman"])

    assert kerman["kpis"]["total_onair"]["value"] < everything["kpis"]["total_onair"]["value"]
    assert kerman["province_id"] == world["ids"]["kerman"]
    # And the province table now holds only the one province.
    assert [r["name"] for r in kerman["province_breakdown"]] == ["Kerman"]


def test_the_filtered_page_still_reconciles(client, world):
    """The filter must not break the property every section is built to have."""
    body = _overview(client, world["admin"], province_id=world["ids"]["kerman"])
    kpis = body["kpis"]

    assert kpis["total_ongoing"]["value"] + kpis["total_problematic"]["value"] == (
        kpis["total_remaining"]["value"]
    )
    ongoing = body["ongoing_breakdown"]
    assert sum(p["value"] for p in ongoing["by_stage"]) == ongoing["total"]
    assert (
        sum(p["value"] for p in ongoing["by_contractor"]) + ongoing["without_contractor"]
        == ongoing["total"]
    )


def test_a_province_outside_the_callers_scope_is_refused(client, world):
    """Not silently widened back to everything, and not silently empty —
    either would misreport what the reader is looking at."""
    r = client.get(
        OVERVIEW, headers=world["kerman_only"], params={"province_id": world["ids"]["yazd"]}
    )
    assert r.status_code == 404


def test_the_filter_offers_only_provinces_the_caller_may_see(client, world):
    scoped = _overview(client, world["kerman_only"])
    assert [p["name"] for p in scoped["provinces"]] == ["Kerman"]

    unrestricted = _overview(client, world["admin"])
    assert {p["name"] for p in unrestricted["provinces"]} >= {"Kerman", "Yazd"}


def test_the_payload_says_when_it_was_computed(client, world):
    """So the screen can say how old the figures are rather than calling a
    one-time fetch live."""
    assert _overview(client, world["admin"])["generated_at"]


# ---------------------------------------------------------------- aging bands
def test_ongoing_sites_land_in_the_band_their_assignment_date_puts_them_in(client, world):
    body = _overview(client, world["admin"], province_id=world["ids"]["kerman"])
    bands = body["ongoing_breakdown"]["by_age"]

    assert _band(bands, "Up to 1 week") == 1  # 3 days
    assert _band(bands, "1–2 weeks") == 1  # 10 days
    assert _band(bands, "2–3 weeks") == 1  # 18 days
    assert _band(bands, "3 weeks – 1 month") == 1  # 26 days
    assert _band(bands, "More than 2 months") == 1  # 90 days
    # The tail is two bands now, and 90 days is past both of them, so the
    # nearer one is empty rather than absorbing it.
    assert _band(bands, "1–2 months") == 0


def test_the_bands_stay_in_age_order_with_empty_ones_kept(client, world):
    """An ordered scale, not a ranking. A band that vanishes when it empties
    changes what the row of bands means between one reading and the next."""
    body = _overview(client, world["admin"], province_id=world["ids"]["yazd"])
    names = [p["name"] for p in body["ongoing_breakdown"]["by_age"]]

    assert names == [
        "Up to 1 week",
        "1–2 weeks",
        "2–3 weeks",
        "3 weeks – 1 month",
        "1–2 months",
        "More than 2 months",
    ]


def test_an_unassigned_site_is_counted_apart_not_filed_as_new(client, world):
    """No assignment is no clock, not a clock reading zero. Filing it under
    the newest band would make the backlog look fresher than it is and would
    credit a contractor with a site they were never given."""
    body = _overview(client, world["admin"], province_id=world["ids"]["kerman"])
    ongoing = body["ongoing_breakdown"]

    assert ongoing["without_assignment_date"] == 1
    assert sum(p["value"] for p in ongoing["by_age"]) + ongoing[
        "without_assignment_date"
    ] == (ongoing["total"])


# ------------------------------------------------- how long a site is stuck
def test_a_problematic_site_ages_from_the_day_it_last_became_problematic(client, world):
    """The spell it is in now, not the first one it was ever in.

    The Yazd site was flagged a year ago, fixed, and flagged again 40 days
    ago. Aged from the first flag it would read as the oldest band there is
    and would put a team on the hook for a problem they already solved.
    """
    bands = _overview(client, world["admin"])["problematic_breakdown"]["by_age"]

    assert _band(bands, "Up to 1 week") == 1  # flagged 5 days ago
    assert _band(bands, "1–2 months") == 1  # re-flagged 40 days ago
    assert _band(bands, "More than 2 months") == 0, "the year-old spell was closed"


def test_a_problematic_site_with_no_dated_flag_is_counted_apart(client, world):
    """A CPM-imported status is a bare column: no date, so no clock.

    Filing it under the newest band would make the backlog look fresher than
    it is, which is the one direction this chart must never be wrong in. The
    bands plus the undated sites still account for the whole total.
    """
    problematic = _overview(client, world["admin"])["problematic_breakdown"]

    assert problematic["without_problem_date"] == 1
    assert sum(p["value"] for p in problematic["by_age"]) + problematic[
        "without_problem_date"
    ] == problematic["total"]


def test_the_problematic_bands_are_the_ongoing_bands(client, world):
    """One vocabulary across both cards.

    They measure different clocks, but a reader moving between them should
    not have to learn a second set of buckets to compare the two.
    """
    body = _overview(client, world["admin"])
    ongoing = [p["key"] for p in body["ongoing_breakdown"]["by_age"]]
    problematic = [p["key"] for p in body["problematic_breakdown"]["by_age"]]

    assert ongoing == problematic


# ----------------------------------------------------------- the scorecard
def test_the_scorecard_accounts_for_every_assigned_site(client, world):
    body = _overview(client, world["admin"])
    rows = body["contractor_scorecard"]

    assert sum(r["done"] for r in rows) == body["kpis"]["total_dt_done"]["value"]
    assert sum(r["ongoing"] for r in rows) == body["kpis"]["total_ongoing"]["value"]
    assert sum(r["problematic"] for r in rows) == (
        body["kpis"]["total_problematic"]["value"]
    )
    assert sum(r["assigned"] for r in rows) == (
        body["kpis"]["total_dt_done"]["value"] + body["kpis"]["total_ongoing"]["value"]
    )


def test_a_problematic_site_is_not_part_of_a_contractors_assignment(client, world):
    """A site out for a health check, or sitting in a problem category, has
    not been committed to the contractor. Counting it against them would mark
    a company down for work the programme never gave them."""
    body = _overview(client, world["admin"])
    for row in body["contractor_scorecard"]:
        assert row["assigned"] == row["done"] + row["ongoing"]
        assert row["done_percent"] == pytest.approx(
            row["done"] / row["assigned"] * 100 if row["assigned"] else 0.0, abs=0.1
        )


def test_the_rows_rank_by_completion_not_by_size(client, world):
    body = _overview(client, world["admin"])
    named = [r for r in body["contractor_scorecard"] if r["contractor_id"] is not None]
    rates = [r["done_percent"] for r in named]

    assert rates == sorted(rates, reverse=True)


def test_the_unattributed_row_sorts_last_whatever_its_rate(client, world):
    """It is not a company and cannot beat one; leaving it in the ranking
    would read as though it had outperformed a contractor."""
    rows = _overview(client, world["admin"])["contractor_scorecard"]
    assert rows[-1]["name"] == UNATTRIBUTED
    assert rows[-1]["contractor_id"] is None


def test_a_contractor_sees_only_their_own_scorecard_row(client, world):
    """No unnamed aggregate here, unlike the ongoing breakdown: a rate over
    other companies' books is a comparison against named competitors with the
    name taken off."""
    rows = _overview(client, world["alfa"])["contractor_scorecard"]

    assert [r["name"] for r in rows] == ["Alfa Drive Tests"]


# ------------------------------------------------------------- drill-through
def test_the_queue_filters_by_province(client, world):
    headers = world["admin"]
    everything = client.get(WORK_ITEMS, headers=headers).json()
    kerman = client.get(
        WORK_ITEMS, headers=headers, params={"province_id": world["ids"]["kerman"]}
    ).json()

    assert 0 < len(kerman) < len(everything)
    assert {row["province"] for row in kerman} == {"Kerman"}


def test_the_queue_filters_by_contractor_the_way_the_dashboard_counts(client, world):
    """The live in-app assignment wins over the CPM-seeded subcontractor, so a
    reader lands on the same set of sites the figure they clicked counted."""
    headers = world["admin"]
    alfa = client.get(
        WORK_ITEMS, headers=headers, params={"contractor_id": world["ids"]["alfa"]}
    ).json()
    tags = {row["site_type"] for row in alfa}

    # Handed on to Beta, so it is Beta's now — not Alfa's, despite the stale
    # CPM column still naming Alfa.
    assert "y-handed" not in tags
    assert "age-3d" in tags


def test_the_two_queue_filters_combine(client, world):
    headers = world["admin"]
    rows = client.get(
        WORK_ITEMS,
        headers=headers,
        params={
            "province_id": world["ids"]["kerman"],
            "contractor_id": world["ids"]["beta"],
        },
    ).json()

    assert rows
    assert {row["province"] for row in rows} == {"Kerman"}


def test_a_queue_filter_cannot_widen_a_contractors_scope(client, world):
    """The filters arrive from a URL anyone can edit and are applied after the
    scope, so a contractor asking for a competitor by id gets a subset of what
    they could already see — never a row the scope was withholding.

    What comes back is not empty, and that is not a leak: ``apply_work_item_scope``
    deliberately hands a contractor every site they have *ever* held, so a site
    Alfa handed on to Beta is still in Alfa's set. Filtering by Beta's id
    selects that one site *out of Alfa's own rows*. The assertion is therefore
    subset-of-own-scope, which is the property the filter is responsible for.
    """
    own = client.get(WORK_ITEMS, headers=world["alfa"]).json()
    filtered = client.get(
        WORK_ITEMS, headers=world["alfa"], params={"contractor_id": world["ids"]["beta"]}
    ).json()

    own_ids = {row["id"] for row in own}
    assert {row["id"] for row in filtered} <= own_ids
    assert len(filtered) < len(own)

    # And an admin filtering on the same contractor reaches strictly more,
    # which is what says the narrowing happened inside Alfa's scope rather
    # than replacing it.
    as_admin = client.get(
        WORK_ITEMS, headers=world["admin"], params={"contractor_id": world["ids"]["beta"]}
    ).json()
    assert len(as_admin) > len(filtered)


def test_a_queue_filter_cannot_widen_a_province_scope(client, world):
    rows = client.get(
        WORK_ITEMS, headers=world["kerman_only"], params={"province_id": world["ids"]["yazd"]}
    ).json()

    assert rows == []


def test_the_export_takes_the_same_filters_as_the_list(client, world):
    """So a file downloaded from a drilled-through list holds that list."""
    r = client.get(
        "/api/v1/work-items/export",
        headers=world["admin"],
        params={"province_id": world["ids"]["kerman"]},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument"
    )
