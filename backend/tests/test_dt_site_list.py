"""The drill-through site list behind every figure on the Drive Test dashboard.

One property matters more than everything else in this file, and the first
test is it:

    for every figure on the dashboard, the list opened from that figure holds
    exactly as many rows as the figure said.

A list that can differ from the number that opened it is worse than no link at
all, because it looks like it worked. The parity test therefore walks the
whole payload -- every KPI, every problematic category, every ongoing age band
including the sites with no launch date, every ongoing stage, every contractor
scorecard cell, every province row -- and asserts the equality for each one,
rather than spot-checking a few.

The seed deliberately includes sites flagged Problematic by a CPM import whose
``current_stage`` is something else entirely. Those are the sites the Work
Items queue's stage filter cannot see, and they are why this endpoint exists
instead of another parameter on ``/work-items``.

Run with:  cd backend && pytest tests/test_dt_site_list.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_site_list_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import date, datetime, timedelta, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal, engine  # noqa: E402
from app.services.dt_site_list import UNATTRIBUTED  # noqa: E402
from app.services.drive_test_analytics import (  # noqa: E402
    AGE_BAND_LABEL_BY_KEY,
    NO_ASSIGNMENT_DATE,
    NO_PROBLEM_DATE,
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
SITES = "/api/v1/drive-test/sites"
EXPORT = "/api/v1/drive-test/sites/export"
PLAN = "/api/v1/drive-test/plan-delivery"

#: The on-air stage the DT KPIs recognise.
ONAIR = "راه_اندازی_دائم"
#: A stage that is not on-air, for a site the dashboard must never count.
OFFAIR = "طراحی"

NOW = datetime.now(timezone.utc)
TODAY = date.today()


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_site_list_pytest.db"):
        os.remove("/tmp/uep_dt_site_list_pytest.db")
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
    """One programme with a site in every shape this endpoint has to answer for.

    Two provinces, two contractors, sites in each ongoing stage, problematic
    sites by both signals, done sites dated into a known Shamsi month, an
    unattributed site, a site with no launch date and a site that is not
    on-air at all.
    """
    from app.models.health_check import HcAssignment, HcRemediation, HcTask
    from app.models.reference import Contractor, ProblemCategory, Province
    from app.models.workitem import Assignment, Site, Village, WorkItem

    admin_h = _login(client)

    db = SessionLocal()
    alfa = Contractor(name="Alfa Drive Tests", type="drive_test", active=True)
    beta = Contractor(name="Beta Surveys", type="drive_test", active=True)
    db.add_all([alfa, beta])
    kerman = Province(name="Kerman")
    yazd = Province(name="Yazd")
    db.add_all([kerman, yazd])
    db.flush()

    kerman_site = Site(site_code="SL-K", province_id=kerman.id)
    yazd_site = Site(site_code="SL-Y", province_id=yazd.id)
    db.add_all([kerman_site, yazd_site])
    db.flush()

    def item(
        site,
        tag,
        stage,
        *,
        # Ongoing by default: most of this fixture is ongoing sites, and that
        # column is what Ongoing means. Pass None for a drive test that has
        # not started.
        dt_status="Ongoing",
        category=None,
        contractor=None,
        launch_days=45,
        dt_date=None,
        last_stage=ONAIR,
    ):
        wi = WorkItem(
            site_id=site.id,
            site_type=tag,
            last_stage=last_stage,
            current_stage=stage,
            dt_status=dt_status,
            dt_problem_category=category,
            dt_sc_contractor_id=contractor,
            launch_date_gregorian=(
                TODAY - timedelta(days=launch_days) if launch_days is not None else None
            ),
            dt_date_gregorian=dt_date,
        )
        db.add(wi)
        db.flush()
        db.add(Village(work_item_id=wi.id, village_name=f"روستای {tag}"))
        return wi

    # Ongoing: one per stage. The two that carry a live assignment are held
    # for known lengths, because the age bands and the default ongoing sort
    # both run on the assignment clock, not on the launch date. The rest have
    # no assignment at all, which is its own bucket and has to be covered too.
    item(kerman_site, "ong-new", STAGE_NEW, launch_days=10)
    item(kerman_site, "ong-hc-prog", STAGE_HC_IN_PROGRESS, launch_days=60)
    item(kerman_site, "ong-hc-review", STAGE_HC_REVIEW, launch_days=120)
    item(kerman_site, "ong-ready", STAGE_READY, launch_days=200)
    held_long = item(
        yazd_site, "ong-assigned", STAGE_ASSIGNED, contractor=alfa.id, launch_days=400
    )
    held_short = item(
        yazd_site, "ong-returned", STAGE_RETURNED, contractor=alfa.id, launch_days=30
    )
    item(yazd_site, "ong-submitted", STAGE_DT_SUBMITTED, launch_days=None)
    db.add_all(
        [
            Assignment(
                work_item_id=held_long.id,
                assignment_type="official",
                contractor_id=alfa.id,
                assigned_at=NOW - timedelta(days=40),
                is_active=True,
            ),
            Assignment(
                work_item_id=held_short.id,
                assignment_type="official",
                contractor_id=alfa.id,
                assigned_at=NOW - timedelta(days=3),
                is_active=True,
            ),
        ]
    )

    # Problematic by the CPM signal, with a stage that is *not* Problematic --
    # the sites the Work Items stage filter cannot see.
    cpm_only = item(
        kerman_site, "prob-cpm", STAGE_READY, dt_status="Problematic", category="Temp Power"
    )
    item(
        yazd_site, "prob-cpm-2", STAGE_NEW, dt_status="Problematic", category="Temp Power"
    )
    item(yazd_site, "prob-cpm-3", STAGE_ASSIGNED, dt_status="Problematic")
    # Problematic by the in-app signal, with an open fix behind it.
    in_app = item(kerman_site, "prob-inapp", STAGE_HEALTH_PROBLEM, contractor=beta.id)

    # Done, dated into a known Shamsi month.
    done_date = jalali.from_shamsi_date(1404, 5, 12)
    item(kerman_site, "done-1", STAGE_NEW, dt_status="Done", dt_date=done_date,
         contractor=alfa.id)
    item(yazd_site, "done-2", STAGE_NEW, dt_status="Done", dt_date=done_date,
         contractor=beta.id)
    item(yazd_site, "done-3", STAGE_NEW, dt_status="Done",
         dt_date=jalali.from_shamsi_date(1404, 6, 3), contractor=alfa.id)

    # Not on-air: invisible to every figure on this dashboard, so it must be
    # invisible to every list opened from one.
    item(kerman_site, "offair", STAGE_NEW, last_stage=OFFAIR)

    # Not started: on-air with a blank DT status. It belongs to the list the
    # Not started figure opens and to no other, which is the claim the
    # bucket test below makes.
    item(kerman_site, "not-started-1", STAGE_NEW, dt_status=None, launch_days=75)

    # An open fix on the in-app problematic site, overdue, owned by a role.
    power = db.query(ProblemCategory).filter(
        ProblemCategory.owner_role_id.is_not(None)
    ).first()
    assignment = HcAssignment(
        code="HCA-SL-1",
        contractor_id=beta.id,
        assigned_at=NOW - timedelta(days=40),
        status="Open",
    )
    db.add(assignment)
    db.flush()
    task = HcTask(
        hc_assignment_id=assignment.id,
        work_item_id=in_app.id,
        round_no=2,
        overall_result="NotReady",
        problem_category=power.name,
        completed_at=NOW - timedelta(days=30),
        reviewed_at=NOW - timedelta(days=29),
    )
    db.add(task)
    db.flush()
    db.add(
        HcRemediation(
            hc_task_id=task.id,
            work_item_id=in_app.id,
            problem_category_id=power.id,
            owner_role_id=power.owner_role_id,
            status=HcRemediation.STATUS_OPEN,
            opened_at=NOW - timedelta(days=29),
            due_at=NOW - timedelta(days=7),
        )
    )

    # A site Alfa used to hold and Beta holds now: in Alfa's visible set, and
    # attributed to Beta.
    handed_on = item(yazd_site, "ong-handed-on", STAGE_ASSIGNED, contractor=alfa.id)
    db.add_all(
        [
            Assignment(
                work_item_id=handed_on.id,
                assignment_type="official",
                contractor_id=alfa.id,
                assigned_at=NOW - timedelta(days=300),
                is_active=False,
            ),
            Assignment(
                work_item_id=handed_on.id,
                assignment_type="official",
                contractor_id=beta.id,
                assigned_at=NOW - timedelta(days=100),
                is_active=True,
            ),
        ]
    )
    db.commit()
    ids = {
        "held_long": held_long.id,
        "held_short": held_short.id,
        "alfa": alfa.id,
        "beta": beta.id,
        "kerman": kerman.id,
        "yazd": yazd.id,
        "power_role": power.owner_role_id,
        "power_name": power.name,
        "cpm_only": cpm_only.id,
        "in_app": in_app.id,
    }
    db.close()

    return {
        "admin": admin_h,
        "ids": ids,
        "alfa": _make_user(client, admin_h, "sl_alfa", "Contractor", contractor_id=ids["alfa"]),
        "beta": _make_user(client, admin_h, "sl_beta", "Contractor", contractor_id=ids["beta"]),
        "kerman_staff": _make_user(
            client, admin_h, "sl_kerman", "Coordinator", province_ids=[ids["kerman"]]
        ),
        "power_owner": _make_user(client, admin_h, "sl_power", _role_name(power)),
    }


def _role_name(category):
    from app.core.database import SessionLocal
    from app.models.reference import Role

    db = SessionLocal()
    try:
        return db.get(Role, category.owner_role_id).name
    finally:
        db.close()


# ------------------------------------------------------------------ helpers
def _overview(client, headers, **params):
    r = client.get(OVERVIEW, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _sites(client, headers, **params):
    r = client.get(SITES, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _province_id(body, name):
    return next(p["id"] for p in body["provinces"] if p["name"] == name)


# ------------------------------------------------------------ 1. the parity
def test_every_figure_opens_a_list_of_exactly_that_many_sites(client, world):
    """The whole feature, asserted figure by figure.

    Every case below is a real link on the dashboard. If one of them fails,
    a reader somewhere clicks a number and gets a different number.
    """
    headers = world["admin"]
    body = _overview(client, headers)
    kpis = body["kpis"]

    checks: list[tuple[str, dict, int]] = [
        ("on-air", {"bucket": "onair"}, kpis["total_onair"]["value"]),
        ("done", {"bucket": "done"}, kpis["total_dt_done"]["value"]),
        ("ongoing", {"bucket": "ongoing"}, kpis["total_ongoing"]["value"]),
        ("problematic", {"bucket": "problematic"}, kpis["total_problematic"]["value"]),
        ("not started", {"bucket": "not_started"}, kpis["total_not_started"]["value"]),
        ("remaining", {"bucket": "remaining"}, kpis["total_remaining"]["value"]),
    ]

    for point in body["problematic_breakdown"]["by_category"]:
        checks.append(
            (
                f"problematic/{point['name']}",
                {"bucket": "problematic", "category": point["key"]},
                point["value"],
            )
        )

    for point in body["ongoing_breakdown"]["by_age"]:
        checks.append(
            (
                f"ongoing/age/{point['name']}",
                {"bucket": "ongoing", "age_band": point["key"]},
                point["value"],
            )
        )
    checks.append(
        (
            "ongoing/age/no assignment",
            {"bucket": "ongoing", "age_band": NO_ASSIGNMENT_DATE},
            body["ongoing_breakdown"]["without_assignment_date"],
        )
    )

    for point in body["problematic_breakdown"]["by_age"]:
        checks.append(
            (
                f"problematic/age/{point['name']}",
                {"bucket": "problematic", "age_band": point["key"]},
                point["value"],
            )
        )
    checks.append(
        (
            "problematic/age/no date",
            {"bucket": "problematic", "age_band": NO_PROBLEM_DATE},
            body["problematic_breakdown"]["without_problem_date"],
        )
    )

    for point in body["ongoing_breakdown"]["by_stage"]:
        checks.append(
            (
                f"ongoing/stage/{point['name']}",
                {"bucket": "ongoing", "stage": point["key"]},
                point["value"],
            )
        )

    for row in body["contractor_scorecard"]:
        contractor = UNATTRIBUTED if row["contractor_id"] is None else row["contractor_id"]
        # ``assigned`` included: it is the denominator the scorecard's rate
        # divides by, so it is the figure a contractor is most likely to
        # check, and a list that disagreed with it would be an argument.
        for bucket, key in (
            ("assigned", "assigned"),
            ("done", "done"),
            ("ongoing", "ongoing"),
            ("problematic", "problematic"),
        ):
            checks.append(
                (
                    f"scorecard/{row['name']}/{bucket}",
                    {"bucket": bucket, "contractor_id": contractor},
                    row[key],
                )
            )

    for row in body["province_breakdown"]:
        province_id = _province_id(body, row["name"])
        for bucket, key in (
            ("onair", "onair"),
            ("done", "done"),
            ("ongoing", "ongoing"),
            ("problematic", "problematic"),
            ("remaining", "remaining"),
        ):
            checks.append(
                (
                    f"province/{row['name']}/{bucket}",
                    {"bucket": bucket, "province_id": province_id},
                    row[key],
                )
            )

    # Plan and delivery: the month's Delivered figure, programme-wide and per
    # contractor.
    plan = client.get(PLAN, headers=headers, params={"year": 1404, "month": 5}).json()
    checks.append(
        (
            "delivered/1404-05",
            {"bucket": "delivered", "year": 1404, "month": 5},
            plan["actual"],
        )
    )
    for row in plan["rows"]:
        checks.append(
            (
                f"delivered/1404-05/{row['name']}",
                {
                    "bucket": "delivered",
                    "year": 1404,
                    "month": 5,
                    "contractor_id": row["contractor_id"],
                },
                row["actual"],
            )
        )

    mismatched = []
    for label, params, figure in checks:
        total = _sites(client, headers, **params)["total"]
        if total != figure:
            mismatched.append(f"{label}: figure {figure}, list {total}")
    assert not mismatched, "\n".join(mismatched)

    # A parity suite that only ever compares zeros proves nothing.
    assert sum(figure for _, _, figure in checks) > 0
    assert len(checks) > 30



def test_the_cpm_problematic_sites_are_the_ones_work_items_cannot_show(client, world):
    """The mismatch this endpoint exists for, asserted rather than described.

    These sites are Problematic to the dashboard and carry some other
    ``current_stage``, so ``/work-items?stage=Problematic`` returns none of
    them while the site list returns every one.
    """
    headers = world["admin"]
    listed = _sites(client, headers, bucket="problematic")
    stage_filtered = client.get(
        "/api/v1/work-items", headers=headers, params={"stage": "Problematic"}
    ).json()

    hidden = [r for r in listed["rows"] if r["current_stage"] != "Problematic"]
    assert hidden, "the seed must include CPM-flagged sites with another stage"
    assert len(stage_filtered) == listed["total"] - len(hidden)


# ------------------------------------------------------------- 2. the export
def test_the_export_holds_the_same_rows_as_the_list(client, world):
    from openpyxl import load_workbook

    import io as _io

    headers = world["admin"]
    params = {"bucket": "problematic"}
    listed = _sites(client, headers, **params)

    r = client.get(EXPORT, headers=headers, params=params)
    assert r.status_code == 200, r.text
    wb = load_workbook(_io.BytesIO(r.content))
    ws = wb.active

    # Header block, then the column headers, then one row per site.
    body_rows = [row for row in ws.iter_rows(min_row=6, values_only=True) if any(row)]
    assert len(body_rows) == listed["total"]
    assert "problematic" in ws["A2"].value
    assert str(listed["total"]) in ws["A3"].value


def test_the_export_filename_describes_the_filter(client, world):
    r = client.get(
        EXPORT,
        headers=world["admin"],
        params={"bucket": "problematic", "category": "Temp Power"},
    )
    assert r.status_code == 200
    disposition = r.headers["content-disposition"]
    assert "dt-problematic-temp-power-" in disposition
    assert disposition.endswith('.xlsx"')
    # Non-ASCII never reaches the filename, whatever the filter held.
    assert disposition.isascii()


# --------------------------------------------------------------- 3. the scope
def test_a_not_started_site_opens_from_that_figure_and_no_other(client, world):
    """A blank DT status is its own bucket now, and reads as one on the row.

    It used to be indistinguishable from a drive test in flight: the Ongoing
    figure counted it, the Ongoing list returned it, and its row said
    "Ongoing". Three places telling a reader that work had started on a site
    nobody had touched.
    """
    # The fixture names each site's village after its tag, and the village is
    # on the row — the site code is shared across the whole province here.
    village = "روستای not-started-1"

    def villages(bucket):
        rows = _sites(client, world["admin"], bucket=bucket)["rows"]
        return {r["villages"] for r in rows}

    assert village in villages("not_started")
    assert village not in villages("ongoing")
    assert village in villages("remaining")

    row = next(
        r
        for r in _sites(client, world["admin"], bucket="not_started")["rows"]
        if r["villages"] == village
    )
    assert row["bucket"] == "Not started"


def test_a_contractor_sees_only_their_own_sites(client, world):
    alfa_id = world["ids"]["alfa"]
    body = _sites(client, world["alfa"], bucket="onair")

    assert body["total"] > 0
    assert {r["contractor"] for r in body["rows"]} == {"Alfa Drive Tests"}
    assert body["filters_applied"]["contractor_id"] == str(alfa_id)


def test_a_contractor_asking_for_another_company_gets_their_own_rows(client, world):
    """Not an error: an error would confirm the other id exists.

    The same answer ``/pip/revisions`` gives, for the same reason.
    """
    own = _sites(client, world["alfa"], bucket="onair")
    asked = _sites(client, world["alfa"], bucket="onair", contractor_id=world["ids"]["beta"])

    assert asked["total"] == own["total"]
    assert {r["contractor"] for r in asked["rows"]} == {"Alfa Drive Tests"}


def test_a_category_owner_sees_only_the_sites_routed_to_them(client, world):
    """No new rule: ``apply_work_item_scope`` already routes by open fix."""
    body = _sites(client, world["power_owner"], bucket="onair")

    assert body["total"] == 1
    assert body["rows"][0]["work_item_id"] == world["ids"]["in_app"]


def test_a_province_outside_the_callers_scope_returns_nothing(client, world):
    """Empty, and not an error that would confirm the province exists."""
    yazd = world["ids"]["yazd"]
    body = _sites(client, world["kerman_staff"], bucket="onair", province_id=yazd)

    assert body["total"] == 0
    assert body["rows"] == []


def test_a_scoped_staff_user_sees_only_their_province(client, world):
    body = _sites(client, world["kerman_staff"], bucket="onair")

    assert body["total"] > 0
    assert {r["province"] for r in body["rows"]} == {"Kerman"}


# ----------------------------------------------------------- 4. the validation
@pytest.mark.parametrize(
    "params",
    [
        {"bucket": "nonsense"},
        {"bucket": "problematic", "category": "No Such Category"},
        {"bucket": "ongoing", "age_band": "last_tuesday"},
        {"bucket": "ongoing", "stage": "Somewhere"},
        # Valid values, invalid combinations.
        {"bucket": "problematic", "age_band": "m1_3"},
        {"bucket": "problematic", "stage": "Assigned"},
        {"bucket": "ongoing", "category": "Temp Power"},
        {"bucket": "delivered"},
        {"bucket": "delivered", "year": 1404},
        {"bucket": "onair", "year": 1404, "month": 5},
        {"bucket": "onair", "sort": "whatever_i_like"},
        {"bucket": "onair", "contractor_id": "bananas"},
        {"bucket": "onair", "overdue": "perhaps"},
        {"bucket": "onair", "owner_role_id": 99999},
    ],
)
def test_invalid_parameters_are_refused_rather_than_ignored(client, world, params):
    r = client.get(SITES, headers=world["admin"], params=params)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]


def test_an_unknown_sort_key_is_refused_on_the_export_too(client, world):
    r = client.get(EXPORT, headers=world["admin"], params={"sort": "salary"})
    assert r.status_code == 422


def test_a_limit_over_the_cap_is_refused(client, world):
    r = client.get(SITES, headers=world["admin"], params={"limit": 501})
    assert r.status_code == 422


# ------------------------------------------------------------- 5. the columns
def test_a_cpm_only_problematic_site_has_no_oldest_open_fix(client, world):
    """Null, never estimated: there is no in-app fix to date from."""
    rows = _sites(client, world["admin"], bucket="problematic")["rows"]
    row = next(r for r in rows if r["work_item_id"] == world["ids"]["cpm_only"])

    assert row["oldest_open_fix_days"] is None
    assert row["max_days_late"] is None
    assert row["problem_categories"] == ["Temp Power"]


def test_a_site_with_an_open_fix_carries_its_clock_and_its_owner(client, world):
    rows = _sites(client, world["admin"], bucket="problematic")["rows"]
    row = next(r for r in rows if r["work_item_id"] == world["ids"]["in_app"])

    assert row["oldest_open_fix_days"] == 29
    assert row["max_days_late"] == 7
    assert row["fix_owners"], "an open fix has an owning role"
    assert row["hc_round"] == 2


def test_the_age_band_runs_on_the_assignment_clock_not_the_launch_date(client, world):
    """The band a row reports is the band the dashboard counted it in.

    The seeded site went on air 400 days ago and was assigned 40 days ago.
    Aged from its launch it would read as the oldest band there is; the
    dashboard asks how long the company holding it has held it, so it is a
    site held between one and two months and no more than that.
    """
    rows = _sites(client, world["admin"], bucket="ongoing")["rows"]
    row = next(r for r in rows if r["work_item_id"] == world["ids"]["held_long"])

    assert row["days_since_launch"] == 400
    assert row["days_since_assignment"] == 40
    assert row["age_band"] == AGE_BAND_LABEL_BY_KEY["m1_2"]

    # And a site with no assignment has no clock, rather than a clock at zero.
    unassigned = next(r for r in rows if r["days_since_assignment"] is None)
    assert unassigned["age_band"] is None


def test_a_retired_age_band_key_still_opens_the_sites_it_used_to_mean(client, world):
    """A drill-through URL outlives the band it names.

    ``gt_1m`` was everything held for more than a month. That is now two
    bands, so a link someone pasted into a message last week has to resolve
    to both of them -- answering with one would be a list that looks right
    and is short, which is the failure this whole screen exists to prevent.
    """
    legacy = _sites(client, world["admin"], bucket="ongoing", age_band="gt_1m")
    m1_2 = _sites(client, world["admin"], bucket="ongoing", age_band="m1_2")
    gt_2m = _sites(client, world["admin"], bucket="ongoing", age_band="gt_2m")

    assert legacy["total"] == m1_2["total"] + gt_2m["total"]
    assert legacy["total"] > 0, "the fixture holds a site past a month"

    ids = {r["work_item_id"] for r in legacy["rows"]}
    assert ids == {r["work_item_id"] for r in [*m1_2["rows"], *gt_2m["rows"]]}

    # The pill reads back what was clicked, not what it resolved to: there is
    # no single band label spanning the two.
    assert legacy["filters_applied"]["age_band"] == "gt_1m"


def test_every_served_filter_option_is_one_the_endpoint_accepts(client, world):
    """The whole point of serving the vocabulary, asserted rather than claimed.

    The screen builds its band and stage controls from these lists. If one
    carries a value the same endpoint refuses, the control offers an option
    that answers 422 -- which is the failure serving them was meant to make
    impossible, not merely to fix once.

    The two buckets that age have different "no clock" keys and each refuses
    the other's, so this has to be checked per bucket rather than once.
    """
    for bucket in ("ongoing", "problematic"):
        body = _sites(client, world["admin"], bucket=bucket)
        assert body["age_bands"], f"{bucket} ages, so it offers bands"

        for option in body["age_bands"]:
            got = client.get(
                SITES,
                headers=world["admin"],
                params={"bucket": bucket, "age_band": option["key"]},
            )
            assert got.status_code == 200, (
                f"{bucket} offers age_band={option['key']} and then refuses it: {got.text}"
            )

    # A bucket that does not age offers nothing rather than something unusable.
    for bucket in ("done", "onair"):
        assert _sites(client, world["admin"], bucket=bucket)["age_bands"] == []


def test_the_problematic_no_clock_option_reaches_the_sites_it_counts(client, world):
    """The undated sites are the ones a reader most wants to open.

    They are the gap in the ageing chart -- the sites it cannot speak for --
    and a figure with no way through to the rows behind it is the one thing
    this whole screen exists to prevent.
    """
    overview = client.get(
        "/api/v1/drive-test/overview", headers=world["admin"]
    ).json()
    undated = overview["problematic_breakdown"]["without_problem_date"]

    offered = {o["key"] for o in _sites(client, world["admin"], bucket="problematic")["age_bands"]}
    assert NO_PROBLEM_DATE in offered

    body = _sites(client, world["admin"], bucket="problematic", age_band=NO_PROBLEM_DATE)
    assert body["total"] == undated


def test_rows_carry_the_site_and_its_villages(client, world):
    rows = _sites(client, world["admin"], bucket="onair")["rows"]

    assert all(r["site_code"] for r in rows)
    assert any(r["villages"] for r in rows)


def test_overdue_and_owner_filters_narrow_to_the_open_fix(client, world):
    headers = world["admin"]
    overdue = _sites(client, headers, bucket="problematic", overdue="true")
    owned = _sites(
        client, headers, bucket="problematic", owner_role_id=world["ids"]["power_role"]
    )

    assert [r["work_item_id"] for r in overdue["rows"]] == [world["ids"]["in_app"]]
    assert [r["work_item_id"] for r in owned["rows"]] == [world["ids"]["in_app"]]


# -------------------------------------------------------------- 6. the sorting
def test_the_default_ongoing_sort_is_longest_held_first_with_no_clock_last(
    client, world
):
    """Longest-held first, on the clock the age bands run on.

    A site nobody has been assigned has no clock running on it rather than a
    clock reading zero, so it sorts last in either direction: floating it to
    the top of a descending sort would put the least informative rows where
    the most urgent ones belong.
    """
    rows = _sites(client, world["admin"], bucket="ongoing")["rows"]
    days = [r["days_since_assignment"] for r in rows]
    known = [d for d in days if d is not None]

    assert known == sorted(known, reverse=True)
    assert days[len(known):] == [None] * (len(days) - len(known))
    assert None in days, "the seed must include an ongoing site with no assignment"

    # Held for 40 days above held for 3, rather than the other way round or in
    # launch-date order, where the two are the opposite way up.
    order = [r["work_item_id"] for r in rows]
    assert order.index(world["ids"]["held_long"]) < order.index(world["ids"]["held_short"])


def test_a_requested_sort_is_applied(client, world):
    rows = _sites(client, world["admin"], bucket="onair", sort="site_code")["rows"]
    codes = [r["site_code"] for r in rows]

    assert codes == sorted(codes)


def test_pagination_reports_the_total_before_the_page(client, world):
    headers = world["admin"]
    everything = _sites(client, headers, bucket="onair", limit=500)
    page = _sites(client, headers, bucket="onair", limit=2, offset=1)

    assert page["total"] == everything["total"] > 2
    assert len(page["rows"]) == 2
    assert page["rows"] == everything["rows"][1:3]


# ---------------------------------------------------------- 7. the query count
def test_the_query_count_does_not_grow_with_the_rows(client, world):
    """Bulk loading, asserted rather than hoped for.

    Five rows and fifty rows must cost the same number of queries. An N+1 here
    would not fail any assertion above -- it would just make a page of four
    hundred sites take a minute.
    """
    from app.models.workitem import Site, Village, WorkItem

    def count_for(headers, **params):
        queries = []
        listener = lambda conn, cursor, statement, *a: queries.append(statement)  # noqa: E731
        event.listen(engine, "before_cursor_execute", listener)
        try:
            _sites(client, headers, **params)
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(queries)

    headers = world["admin"]
    small = _sites(client, headers, bucket="onair")["total"]
    baseline = count_for(headers, bucket="onair", limit=500)

    db = SessionLocal()
    site = db.query(Site).first()
    for i in range(50):
        wi = WorkItem(
            site_id=site.id,
            site_type=f"bulk-{i}",
            last_stage=ONAIR,
            current_stage=STAGE_NEW,
            launch_date_gregorian=TODAY - timedelta(days=i + 1),
        )
        db.add(wi)
        db.flush()
        db.add(Village(work_item_id=wi.id, village_name=f"روستای {i}"))
    db.commit()
    db.close()

    grown = _sites(client, headers, bucket="onair", limit=500)["total"]
    after = count_for(headers, bucket="onair", limit=500)

    assert grown == small + 50
    assert after == baseline, (
        f"{baseline} queries for {small} rows, {after} for {grown}"
    )
