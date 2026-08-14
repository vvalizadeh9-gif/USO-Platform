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

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from tests.conftest import login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_acc_pytest.db"):
        os.remove("/tmp/uep_acc_pytest.db")
    Base.metadata.drop_all(bind=engine)
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
