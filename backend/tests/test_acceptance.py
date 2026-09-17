"""Tests for the Acceptance dashboard analytics.

Covers: pure-هدف filtering, the DT-Done gate, per-requested-technology approval,
no-deduplication counting (every site/village row counts, even repeats across
site-types), the site-level rollup, and per-province status math.

Run with:  cd backend && pytest tests/test_acceptance.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_acc_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_acc_pytest.db"):
        os.remove("/tmp/uep_acc_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _acc(tech, ict, cra):
    from app.models.acceptance import Acceptance

    return Acceptance(technology=tech, ict_status=ict, cra_status=cra)


def _seed(db):
    """Deterministic dataset exercising every Acceptance rule."""
    from app.models.reference import Province
    from app.models.workitem import Site, Village, WorkItem

    p1 = Province(name="Prov1")
    p2 = Province(name="Prov2")
    db.add_all([p1, p2])
    db.flush()

    s1 = Site(site_code="S1", province_id=p1.id)
    s2 = Site(site_code="S2", province_id=p2.id)
    db.add_all([s1, s2])
    db.flush()

    # --- Site S1 ---
    # WI-A: DT Done, requests 2G & 3G.
    wi_a = WorkItem(site_id=s1.id, site_type="A", dt_status="Done",
                    requested_technology="2G/3G", current_stage="New")
    # WI-B: DT Done, requests 4G.
    wi_b = WorkItem(site_id=s1.id, site_type="B", dt_status="Done",
                    requested_technology="4G", current_stage="New")
    # WI-E: DT Done, requests 2G — a *second* work item listing village V1
    #       (same code) so it must deduplicate with WI-A's V1.
    wi_e = WorkItem(site_id=s1.id, site_type="E", dt_status="Done",
                    requested_technology="2G", current_stage="New")
    # WI-V: DT Done but the village is a verbal sub-flag → excluded.
    wi_v = WorkItem(site_id=s1.id, site_type="V", dt_status="Done",
                    requested_technology="2G", current_stage="New")
    # WI-C: NOT DT Done → village excluded from the universe.
    wi_c = WorkItem(site_id=s1.id, site_type="C", dt_status=None,
                    requested_technology="2G", current_stage="New")
    # --- Site S2 ---
    wi_d = WorkItem(site_id=s2.id, site_type="D", dt_status="Done",
                    requested_technology="2G", current_stage="New")
    db.add_all([wi_a, wi_b, wi_e, wi_v, wi_c, wi_d])
    db.flush()

    # V1 on WI-A: ICT ok (2G+3G approved), CRA not (3G pending).
    v1 = Village(work_item_id=wi_a.id, village_code="V1", target_classification="هدف")
    v1.acceptances = [_acc("2G", "Approved", "Approved"), _acc("3G", "Approved", "Pending")]
    # V3 on WI-B: ICT ok, CRA ok.
    v3 = Village(work_item_id=wi_b.id, village_code="V3", target_classification="هدف")
    v3.acceptances = [_acc("4G", "Approved", "Approved")]
    # V1-dup on WI-E: same code "V1" on the same site — counted as a SEPARATE
    # row (no deduplication). Fully approved.
    v1d = Village(work_item_id=wi_e.id, village_code="V1", target_classification="هدف")
    v1d.acceptances = [_acc("2G", "Approved", "Approved")]
    # Verbal sub-flag village → excluded.
    v2 = Village(work_item_id=wi_v.id, village_code="V2",
                 target_classification="هدف (Verbally)")
    v2.acceptances = [_acc("2G", "Approved", "Approved")]
    # Not-DT-done village → excluded.
    v4 = Village(work_item_id=wi_c.id, village_code="V4", target_classification="هدف")
    v4.acceptances = [_acc("2G", "Approved", "Approved")]
    # V5 on WI-D (S2): ICT not (2G pending), CRA ok.
    v5 = Village(work_item_id=wi_d.id, village_code="V5", target_classification="هدف")
    v5.acceptances = [_acc("2G", "Pending", "Approved")]

    db.add_all([v1, v3, v1d, v2, v4, v5])
    db.commit()


def test_kpis(client):
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    _seed(db)
    kpis = AcceptanceAnalytics(db, _SystemScope()).compute_kpis()
    db.close()

    # Rows counted (no dedup): V1, V3, V1d, V5. V2 verbal, V4 not-done → excluded.
    assert kpis["total_dt_done_villages"] == 4
    assert kpis["total_ict_approval"] == 3   # V1, V3, V1d
    assert kpis["total_ict_remained"] == 1   # V5
    assert kpis["total_cra_approval"] == 3   # V3, V1d, V5
    assert kpis["total_cra_remained"] == 1   # V1


def test_analysis(client):
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    a = AcceptanceAnalytics(db, _SystemScope()).compute_analysis()
    db.close()

    # S1: V1(ict✓,cra✗) + V3(ict✓,cra✓) + V1d(ict✓,cra✓) → ict full, not cra full.
    # S2: V5(ict✗,cra✓) → cra full, not ict full.
    assert a["sites_ict_full"] == 1
    assert a["sites_cra_full"] == 1
    assert a["sites_ict_and_cra_full"] == 0
    assert a["sites_ict_not_cra"] == 1
    assert a["sites_cra_not_ict"] == 1
    assert a["villages_ict_not_cra"] == 1   # V1
    assert a["villages_cra_not_ict"] == 1   # V5


def test_province_status(client):
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = AcceptanceAnalytics(db, _SystemScope()).compute_provinces()
    db.close()

    by_name = {r["name"]: r for r in rows}
    # Prov1 = S1 rows V1, V3, V1d (no dedup).
    assert by_name["Prov1"]["total"] == 3
    assert by_name["Prov1"]["ict_approved"] == 3
    assert by_name["Prov1"]["cra_approved"] == 2   # V3, V1d
    assert by_name["Prov1"]["ict_approved_pct"] == 100.0
    assert by_name["Prov1"]["cra_approved_pct"] == 66.7
    assert by_name["Prov2"]["total"] == 1
    assert by_name["Prov2"]["ict_approved"] == 0
    assert by_name["Prov2"]["cra_approved"] == 1


def test_is_pure_target():
    from app.services import cpm_columns as C

    assert C.is_pure_target("هدف") is True
    assert C.is_pure_target(" هدف ") is True
    assert C.is_pure_target("هدف (Verbally)") is False
    assert C.is_pure_target("هدف (Removed Verbally)") is False
    assert C.is_pure_target("اقماری") is False
    assert C.is_pure_target(None) is False


def test_approval_token_parsing():
    """The parser accepts natural English/Persian tokens, not just the tech name."""
    from app.services.cpm_import import CpmImportService

    approve = CpmImportService._approval
    assert approve("approved", "2G") == "Approved"
    assert approve("Approved", "3G") == "Approved"
    assert approve("2G", "2G") == "Approved"        # original tech-name convention
    assert approve("✓", "4G") == "Approved"
    assert approve("تایید", "2G") == "Approved"
    assert approve("rejected", "2G") == "Rejected"
    assert approve("رد", "2G") == "Rejected"
    assert approve(None, "2G") == "Pending"
    assert approve("maybe later", "2G") == "Pending"


def test_apply_acceptance_sets_values_and_preserves_blanks(client):
    """A value sets the status; a blank cell leaves the existing status intact."""
    from app.models.acceptance import Acceptance
    from app.models.workitem import Village
    from app.services import cpm_columns as C
    from app.services.cpm_import import CpmImportService

    db = SessionLocal()
    svc = CpmImportService(db, user_id=None)

    # Existing village: 2G pending, 3G already approved. No 4G row yet.
    village = Village(work_item_id=1, village_code="VX")
    village.acceptances = [
        Acceptance(technology="2G", ict_status="Pending", cra_status="Pending"),
        Acceptance(technology="3G", ict_status="Approved", cra_status="Approved"),
    ]

    # Raw CPM row: only ICT 2G filled ("approved"); everything else blank.
    raw = [None] * 70
    raw[C.COL_HISTORY["ict_2g"]] = "approved"

    svc._apply_acceptance(raw, village)
    db.close()

    by_tech = {a.technology: a for a in village.acceptances}
    # 2G ICT set from the cell; 2G CRA blank → left as Pending.
    assert by_tech["2G"].ict_status == "Approved"
    assert by_tech["2G"].cra_status == "Pending"
    # 3G both cells blank → existing approvals preserved (not downgraded).
    assert by_tech["3G"].ict_status == "Approved"
    assert by_tech["3G"].cra_status == "Approved"
    # 4G row auto-created, defaults Pending.
    assert by_tech["4G"].ict_status == "Pending"
    assert by_tech["4G"].cra_status == "Pending"


def test_overview_endpoint(client):
    assert client.get("/api/v1/acceptance/overview").status_code == 401

    r = client.post("/api/v1/auth/login", data=login_form(client))
    token = r.json()["access_token"]
    r = client.get(
        "/api/v1/acceptance/overview",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kpis"]["total_dt_done_villages"] == 4
    assert "analysis" in body
    assert len(body["provinces"]) == 2


# ---------------------------------------------------------------------------
# The reviewed Overview changes: Rejected split out from Remained, a
# fully-accepted count, and a province table ordered worst-first with an aging
# column.
#
# These run last on purpose: they widen the seeded universe (a third province,
# two more villages, one filed submission), and every assertion above is
# written against the original four rows.
# ---------------------------------------------------------------------------
def _seed_rejections(db):
    """A third province: one rejected village and one still pending.

    Small (2 rows against Prov1's 3) but with everything outstanding, so it is
    only at the top of the province table if the table is sorted by what is
    left to do rather than by size.
    """
    from app.models.reference import Province
    from app.models.workitem import Site, Village, WorkItem

    p3 = Province(name="Prov3")
    db.add(p3)
    db.flush()
    s3 = Site(site_code="S3", province_id=p3.id)
    db.add(s3)
    db.flush()
    wi_f = WorkItem(site_id=s3.id, site_type="F", dt_status="Done",
                    requested_technology="2G/3G", current_stage="New")
    db.add(wi_f)
    db.flush()

    # V6: 3G rejected by both → the whole village is rejected by both. One
    # rejected technology rejects the village (acceptance_workflow's rule).
    v6 = Village(work_item_id=wi_f.id, village_code="V6",
                 target_classification="هدف",
                 ict_status="Rejected", cra_status="Rejected")
    v6.acceptances = [_acc("2G", "Approved", "Approved"),
                      _acc("3G", "Rejected", "Rejected")]
    # V7: filed, nobody has answered yet — pending with both authorities.
    v7 = Village(work_item_id=wi_f.id, village_code="V7",
                 target_classification="هدف",
                 ict_status="Pending", cra_status="Pending")
    v7.acceptances = [_acc("2G", "Pending", "Pending"),
                      _acc("3G", "Pending", "Pending")]
    db.add_all([v6, v7])
    db.commit()
    return v7.id


def test_kpis_split_rejected_from_pending(client):
    """Rejected and Pending are reported apart; Remained still holds both."""
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    _seed_rejections(db)
    kpis = AcceptanceAnalytics(db, _SystemScope()).compute_kpis()
    db.close()

    assert kpis["total_dt_done_villages"] == 6           # V1, V3, V1d, V5, V6, V7
    assert kpis["total_ict_approval"] == 3               # V1, V3, V1d
    assert kpis["total_ict_rejected"] == 1               # V6
    assert kpis["total_ict_pending"] == 2                # V5, V7
    assert kpis["total_cra_approval"] == 3               # V3, V1d, V5
    assert kpis["total_cra_rejected"] == 1               # V6
    assert kpis["total_cra_pending"] == 2                # V1, V7

    # The contract the old consumers rely on: remained is the two put together.
    for authority in ("ict", "cra"):
        assert (
            kpis[f"total_{authority}_remained"]
            == kpis[f"total_{authority}_rejected"] + kpis[f"total_{authority}_pending"]
        )


def test_analysis_counts_fully_accepted_villages(client):
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    analysis = AcceptanceAnalytics(db, _SystemScope()).compute_analysis()
    db.close()

    # Only V3 and V1d are finished with both authorities.
    assert analysis["villages_both_approved"] == 2


def test_provinces_sort_worst_first(client):
    """The table leads with the province that has the most left outstanding.

    Prov3 is the smallest province seeded and the last one added; it belongs at
    the top because all four of its authority slots are outstanding, which is
    the opposite of what sorting by total size produced.
    """
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = AcceptanceAnalytics(db, _SystemScope()).compute_provinces()
    db.close()

    assert [r["name"] for r in rows] == ["Prov3", "Prov1", "Prov2"]
    assert rows[0]["total"] == 2          # smaller than Prov1's 3 — not the sort key
    assert rows[0]["ict_remained"] == 2   # V6 rejected, V7 pending
    assert rows[0]["cra_remained"] == 2
    # Descending by outstanding work, with size only breaking the tie below.
    remained = [r["ict_remained"] + r["cra_remained"] for r in rows]
    assert remained == sorted(remained, reverse=True)


def test_province_aging_reads_the_my_work_clock(client):
    """The aging column is the oldest wait among Pending villages, or nothing.

    It is measured with acceptance_workflow's own aging helpers — the same days
    a My Work row prints — so a province and a village can never disagree about
    how long something has been sitting.
    """
    from datetime import datetime, timedelta, timezone

    from app.models.acceptance_workflow import AcceptanceSubmission
    from app.models.workitem import Village
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    village_id = db.query(Village.id).filter_by(village_code="V7").scalar()

    # Nothing has been filed anywhere yet, so no province has an age to report.
    rows = {r["name"]: r for r in AcceptanceAnalytics(db, _SystemScope()).compute_provinces()}
    assert rows["Prov3"]["ict_oldest_days"] is None
    assert rows["Prov3"]["cra_oldest_days"] is None

    db.add(AcceptanceSubmission(
        village_id=village_id, authority="ICT", round_no=1,
        letter_number="L-AGE-1", source="Coordinator", review_status="Pending",
        submitted_at=datetime.now(timezone.utc) - timedelta(days=12),
    ))
    db.commit()

    rows = {r["name"]: r for r in AcceptanceAnalytics(db, _SystemScope()).compute_provinces()}
    db.close()
    # V7 is Prov3's only Pending village on either side, and the only one with
    # any submission history — so both columns read its wait. Aging is a
    # property of the village's last movement, not of one authority's letter,
    # which is exactly how My Work computes waiting_days.
    assert rows["Prov3"]["ict_oldest_days"] == 12
    assert rows["Prov3"]["cra_oldest_days"] == 12


# ---------------------------------------------------------------------------
# The village-level partition, and aging measured from the drive test.
# ---------------------------------------------------------------------------
def test_villages_partition_into_four_states(client):
    """The four village states sum to the universe, with none counted twice.

    This is the arithmetic the headline card depends on. "Approved vs
    remained" could not be read as one bar because remained was a residual;
    these four are acceptance_workflow's own queue buckets, so the dashboard
    and My Work's chips count the same groups.
    """
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    scope = AcceptanceAnalytics(db, _SystemScope())
    analysis = scope.compute_analysis()
    universe = scope.compute_kpis()["total_dt_done_villages"]
    db.close()

    parts = (
        analysis["villages_accepted"],
        analysis["villages_needs_attention"],
        analysis["villages_in_review"],
        analysis["villages_not_filed"],
    )
    assert sum(parts) == universe
    # V6 was rejected by both authorities and V7 is sitting with them; the
    # other four rows have never been filed. No village is approved by both,
    # so "accepted" is empty — and the four still sum to the universe.
    assert analysis["villages_accepted"] == 0
    assert analysis["villages_needs_attention"] == 1     # V6
    assert analysis["villages_in_review"] == 1           # V7
    assert analysis["villages_not_filed"] == universe - 2


def test_dt_age_is_a_different_clock_from_the_waiting_one(client):
    """Aging from the drive test sees the village nobody ever filed.

    The authority clock is undefined for a village with no submissions, and
    the province table renders that as an em dash — which reads as "nothing
    pending here" on precisely the row that most needs chasing.
    """
    from datetime import date, timedelta

    from app.models.workitem import Village, WorkItem
    from app.services import acceptance_workflow as flow
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    # V6/V7's work item, drive-tested 200 days ago and never submitted.
    village = db.query(Village).filter_by(village_code="V6").one()
    work_item = db.get(WorkItem, village.work_item_id)
    work_item.dt_date_gregorian = date.today() - timedelta(days=200)
    db.commit()

    rows = {r["name"]: r for r in AcceptanceAnalytics(db, _SystemScope()).compute_provinces()}
    db.close()

    prov3 = rows["Prov3"]
    # The authority clock still says nothing: no submission was ever made for
    # V6, so it has no wait to report.
    assert prov3["ict_oldest_days"] != 200
    # The programme clock does, and puts it in the critical band.
    assert prov3["ict_oldest_age_days"] == 200
    assert prov3["ict_age_buckets"][flow.AGE_CRITICAL] >= 1


def test_age_buckets_sum_to_what_is_outstanding(client):
    """Every outstanding village lands in exactly one age band.

    Including the undated ones: a village whose DT date never made it through
    the import is unmeasured, not new, so it gets its own band rather than
    being quietly counted as fresh.
    """
    from app.services import acceptance_workflow as flow
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = AcceptanceAnalytics(db, _SystemScope()).compute_provinces()
    db.close()

    for row in rows:
        for authority in ("ict", "cra"):
            buckets = row[f"{authority}_age_buckets"]
            assert set(buckets) == set(flow.AGE_BUCKETS)
            assert sum(buckets.values()) == row[f"{authority}_remained"]


def test_dt_age_bucket_keeps_undated_apart_from_fresh():
    from app.services import acceptance_workflow as flow

    assert flow.dt_age_bucket(0) == flow.AGE_FRESH
    assert flow.dt_age_bucket(flow.AGE_WARN_DAYS - 1) == flow.AGE_FRESH
    assert flow.dt_age_bucket(flow.AGE_WARN_DAYS) == flow.AGE_WARN
    assert flow.dt_age_bucket(flow.AGE_CRITICAL_DAYS) == flow.AGE_CRITICAL
    assert flow.dt_age_bucket(None) == flow.AGE_UNKNOWN


def test_province_splits_outstanding_into_refused_and_unanswered(client):
    """The two halves of outstanding are reported apart, and still sum to it.

    Prov3 holds one village rejected by both authorities and one nobody has
    answered. They are different conversations — a refusal is the programme's
    to resolve, a wait is the office's to finish — and the province row now
    carries each, without losing the combined figure the "Needs attention"
    ranking reads.
    """
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = {r["name"]: r for r in AcceptanceAnalytics(db, _SystemScope()).compute_provinces()}
    db.close()

    prov3 = rows["Prov3"]
    for authority in ("ict", "cra"):
        assert prov3[f"{authority}_rejected"] == 1      # V6
        assert prov3[f"{authority}_pending"] == 1       # V7
        assert (
            prov3[f"{authority}_rejected"] + prov3[f"{authority}_pending"]
            == prov3[f"{authority}_remained"]
        )


def test_split_age_buckets_sum_to_the_combined_one(client):
    """Each outstanding village is aged once, under one half of outstanding.

    This is what makes the two bars readable as a whole. Aging *rejected*
    against *remained* would not: rejected is a subset of remained, so a
    refused village would be counted in both bars with nothing on screen
    saying so.
    """
    from app.services import acceptance_workflow as flow
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = AcceptanceAnalytics(db, _SystemScope()).compute_provinces()
    db.close()

    for row in rows:
        for authority in ("ict", "cra"):
            rejected = row[f"{authority}_rejected_age_buckets"]
            pending = row[f"{authority}_pending_age_buckets"]
            combined = row[f"{authority}_age_buckets"]
            assert set(rejected) == set(pending) == set(flow.AGE_BUCKETS)
            for band in flow.AGE_BUCKETS:
                assert rejected[band] + pending[band] == combined[band]
            assert sum(rejected.values()) == row[f"{authority}_rejected"]
            assert sum(pending.values()) == row[f"{authority}_pending"]


def test_province_counts_villages_the_drive_test_has_not_reached(client):
    """``total_villages`` is the funnel; ``total`` is the part acceptance sees.

    Prov1 holds a هدف village on a work item that is not DT-Done (V4). It has
    no acceptance status — nothing can be filed for it — but leaving it out of
    the province row entirely made the province look smaller than it is.
    """
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = {r["name"]: r for r in AcceptanceAnalytics(db, _SystemScope()).compute_provinces()}
    db.close()

    prov1 = rows["Prov1"]
    assert prov1["total"] == 3            # V1, V3, V1d — drive test done
    assert prov1["total_villages"] == 4   # and V4, which it has not reached
    # The verbal sub-flag village is not هدف and is in neither number.
    assert prov1["total_villages"] == prov1["total"] + 1
    for row in rows.values():
        assert row["total_villages"] >= row["total"]


def test_province_rows_carry_their_id_for_the_drill_through(client):
    """Every row can open the villages it counted, scoped to that province."""
    from app.services.acceptance_analytics import AcceptanceAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = AcceptanceAnalytics(db, _SystemScope()).compute_provinces()
    db.close()

    assert all(row["province_id"] is not None for row in rows)
    assert len({row["province_id"] for row in rows}) == len(rows)
