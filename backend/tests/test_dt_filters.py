"""The Drive Test dashboard's filter, its aging bands and its scorecard, and
the drill-through filters the work queue grew to receive them.

Three of these are new answers to questions the dashboard could not answer,
and one is a rule that has to hold for all of them:

* **A province filter that can only narrow.** It is applied after
  ``apply_work_item_scope``, so a user who asks for a province they were never
  granted must be refused rather than quietly widened back to everything or
  quietly handed an empty answer. The same goes for the drill-through filters
  on the work queue, which arrive from a URL anyone can edit.
* **Aging bands off the launch date.** They exist here and deliberately do not
  exist for problematic sites, and the difference is the point: a launch date
  is recorded, so "how long has this live site gone untested" is a
  measurement. Nothing records when a site *became* problematic.
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

    Launch dates are set relative to today so the bands stay right whenever
    the suite runs — a fixed date would drift into the next band and start
    failing on a calendar boundary rather than on a code change.
    """
    from app.models.reference import Contractor, Province
    from app.models.workitem import Assignment, Site, WorkItem

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

    def item(site, tag, stage, *, dt_status=None, contractor=None, age_days=None):
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
        return wi

    # Kerman: one ongoing site in each age band, plus one with no launch date.
    item(k_site, "age-new", STAGE_NEW, age_days=5, contractor=alfa.id)
    item(k_site, "age-2mo", STAGE_READY, age_days=60, contractor=alfa.id)
    item(k_site, "age-4mo", STAGE_ASSIGNED, age_days=120, contractor=alfa.id)
    item(k_site, "age-8mo", STAGE_READY, age_days=240, contractor=beta.id)
    item(k_site, "age-2yr", STAGE_READY, age_days=730, contractor=beta.id)
    item(k_site, "age-none", STAGE_READY, age_days=None)

    # Kerman done + problematic, so the scorecard has a denominator worth
    # dividing by and the province rows have something to reconcile.
    item(k_site, "k-done-1", STAGE_NEW, dt_status="Done", age_days=300, contractor=alfa.id)
    item(k_site, "k-done-2", STAGE_NEW, dt_status="Done", age_days=300, contractor=alfa.id)
    item(k_site, "k-prob", STAGE_READY, dt_status="Problematic", age_days=90, contractor=beta.id)

    # Yazd: a smaller book, so the two provinces differ and a filter is
    # visibly doing something.
    item(y_site, "y-ong", STAGE_READY, age_days=45, contractor=beta.id)
    item(y_site, "y-done", STAGE_NEW, dt_status="Done", age_days=200, contractor=beta.id)

    # A site Alfa used to hold and Beta holds now, so the drill-through filter
    # has to prefer the live assignment over the CPM-seeded subcontractor.
    handed = item(y_site, "y-handed", STAGE_ASSIGNED, age_days=30, contractor=alfa.id)
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
    ids = {"alfa": alfa.id, "beta": beta.id, "kerman": kerman.id, "yazd": yazd.id}
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
def test_ongoing_sites_land_in_the_band_their_launch_date_puts_them_in(client, world):
    body = _overview(client, world["admin"], province_id=world["ids"]["kerman"])
    bands = body["ongoing_breakdown"]["by_age"]

    assert _band(bands, "Under a month") == 1  # 5 days
    assert _band(bands, "1–3 months") == 1  # 60 days
    assert _band(bands, "3–6 months") == 1  # 120 days
    assert _band(bands, "6–12 months") == 1  # 240 days
    assert _band(bands, "Over a year") == 1  # 730 days


def test_the_bands_stay_in_age_order_with_empty_ones_kept(client, world):
    """An ordered scale, not a ranking. A band that vanishes when it empties
    changes what the row of bands means between one reading and the next."""
    body = _overview(client, world["admin"], province_id=world["ids"]["yazd"])
    names = [p["name"] for p in body["ongoing_breakdown"]["by_age"]]

    assert names == [
        "Under a month", "1–3 months", "3–6 months", "6–12 months", "Over a year",
    ]


def test_a_site_with_no_launch_date_is_counted_apart_not_filed_as_new(client, world):
    """An unknown age is not a young site. Filing it under the newest band
    would make an untested backlog look fresher than it is."""
    body = _overview(client, world["admin"], province_id=world["ids"]["kerman"])
    ongoing = body["ongoing_breakdown"]

    assert ongoing["without_launch_date"] == 1
    assert sum(p["value"] for p in ongoing["by_age"]) + ongoing["without_launch_date"] == (
        ongoing["total"]
    )


def test_there_are_still_no_problematic_aging_bands(client, world):
    """Absent by design: nothing records when a site became problematic."""
    body = _overview(client, world["admin"])
    assert set(body["problematic_breakdown"]) == {"total", "by_category", "by_province"}


# ----------------------------------------------------------- the scorecard
def test_the_scorecard_accounts_for_every_on_air_site(client, world):
    body = _overview(client, world["admin"])
    rows = body["contractor_scorecard"]

    assert sum(r["onair"] for r in rows) == body["kpis"]["total_onair"]["value"]
    assert sum(r["done"] for r in rows) == body["kpis"]["total_dt_done"]["value"]
    assert sum(r["ongoing"] for r in rows) == body["kpis"]["total_ongoing"]["value"]


def test_each_row_carries_its_own_denominator(client, world):
    body = _overview(client, world["admin"])
    for row in body["contractor_scorecard"]:
        assert row["done"] + row["ongoing"] + row["problematic"] == row["onair"]
        assert row["done_percent"] == pytest.approx(row["done"] / row["onair"] * 100, abs=0.1)


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
    assert "age-new" in tags


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
