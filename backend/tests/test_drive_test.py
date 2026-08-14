"""Tests for the Drive Test Project feature.

Covers: on-air filtering, KPI math, ongoing derivation, Jalali conversion
boundaries, snapshot idempotency, contractor name normalization, and
province progress reporting.

Run with:  cd backend && pytest tests/test_drive_test.py -q
"""
import os
import sys
from datetime import date, datetime, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dt_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON, func  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dt_pytest.db"):
        os.remove("/tmp/uep_dt_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _seed_workitems(db):
    """Create a small deterministic dataset covering every KPI branch."""
    from app.models.reference import Contractor, Province
    from app.models.workitem import HealthCheck, Site, WorkItem

    prov = Province(name="TestProvince")
    db.add(prov)
    db.flush()

    contractor = Contractor(name="TestCo", type="drive_test")
    db.add(contractor)
    db.flush()

    site = Site(site_code="S1", province_id=prov.id)
    db.add(site)
    db.flush()

    # 1) On-air + DT Done
    done = WorkItem(
        site_id=site.id, site_type="Done", last_stage="راه_اندازی_دائم",
        dt_status="Done", dt_sc_contractor_id=contractor.id,
        dt_date_gregorian=date(2024, 5, 20), current_stage="New",
    )
    # 2) On-air + Problematic
    prob = WorkItem(
        site_id=site.id, site_type="Prob", last_stage="راه_اندازی_موقت",
        dt_status="Problematic", dt_problem_category="Temporary Power",
        current_stage="New",
    )
    # 3) On-air + no DT + health check Ready  => Ongoing
    ongoing = WorkItem(
        site_id=site.id, site_type="Ongoing", last_stage="راه_اندازی_دائم",
        dt_status=None, current_stage="New",
    )
    # 4) On-air + no DT + NO health check      => Remaining but NOT Ongoing
    notready = WorkItem(
        site_id=site.id, site_type="NotReady", last_stage="راه_اندازی_دائم",
        dt_status=None, current_stage="New",
    )
    # 5) NOT on-air (design stage)             => excluded entirely
    design = WorkItem(
        site_id=site.id, site_type="Design", last_stage="طراحی",
        dt_status=None, current_stage="New",
    )
    db.add_all([done, prob, ongoing, notready, design])
    db.flush()

    # Only the 'ongoing' work item has a passing health check.
    db.add(HealthCheck(
        work_item_id=ongoing.id, status="Ready",
        checked_at=datetime.now(timezone.utc),
    ))
    db.commit()
    return prov.id


def test_kpi_math_and_ongoing_definition(client):
    """On-air excludes design; ongoing = on-air with no DT outcome yet."""
    from app.services.drive_test_analytics import DriveTestAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    _seed_workitems(db)
    kpis = DriveTestAnalytics(db, _SystemScope()).compute_kpis()
    db.close()

    # 4 on-air (done, prob, ongoing, notready) — design excluded.
    assert kpis["total_onair"] == 4
    assert kpis["total_dt_done"] == 1
    assert kpis["total_remaining"] == 3  # onair - done
    assert kpis["total_problematic"] == 1
    # Ongoing = on-air AND dt_status not in (Done, Problematic).
    # Both 'ongoing' and 'notready' fixtures qualify — Ongoing is no longer
    # gated by the separate Health Check workflow.
    assert kpis["total_ongoing"] == 2


def test_charts_have_expected_shape(client):
    from app.services.drive_test_analytics import DriveTestAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    a = DriveTestAnalytics(db, _SystemScope())
    problematic = a.chart_problematic_by_category()
    done_by_contractor = a.chart_dt_done_by_contractor()
    yearly = a.chart_dt_done_yearly()
    db.close()

    assert {"name": "Temporary Power", "value": 1} in problematic
    assert any(r["name"] == "TestCo" and r["value"] == 1 for r in done_by_contractor)
    # DT done date 2024-05-20 → Shamsi year 1403.
    assert any(r["name"] == "1403" for r in yearly)


def test_jalali_conversion_boundaries():
    from app.core import jalali

    # 2024-03-19 is the last day of Shamsi year 1402 (esfand 29).
    y, m = jalali.to_shamsi(date(2024, 3, 19))
    assert (y, m) == (1402, 12)
    # 2024-03-20 is Nowruz — first day of 1403 (farvardin 1).
    y2, m2 = jalali.to_shamsi(date(2024, 3, 20))
    assert (y2, m2) == (1403, 1)
    # previous_period rolls the year back across farvardin.
    assert jalali.previous_period(1403, 1) == (1402, 12)


def test_snapshot_idempotent(client):
    """Repeated snapshot creation in the same month must not duplicate."""
    from app.models.acceptance import MonthlySnapshot
    from app.services.snapshots import ensure_current_month_snapshot

    db = SessionLocal()
    ensure_current_month_snapshot(db)
    first = db.query(MonthlySnapshot).count()
    ensure_current_month_snapshot(db)
    ensure_current_month_snapshot(db)
    second = db.query(MonthlySnapshot).count()
    db.close()

    assert first == second
    assert first >= 1  # at least the global snapshot exists


def test_contractor_name_normalization():
    """CPM rows spelling a contractor inconsistently must resolve to one row."""
    from app.services.cpm_import import CpmImportService

    db = SessionLocal()
    svc = CpmImportService(db, user_id=None)

    id1 = svc._contractor_id("Infinitel", kind="drive_test")
    id2 = svc._contractor_id(" infinitel ", kind="drive_test")
    id3 = svc._contractor_id("INFINITEL", kind="drive_test")
    db.commit()

    assert id1 == id2 == id3

    from app.models.reference import Contractor

    count = (
        db.query(Contractor)
        .filter(func.lower(Contractor.name) == "infinitel")
        .count()
    )
    db.close()
    assert count == 1  # exactly one row, not three


def test_province_progress_includes_done_percent(client):
    from app.services.drive_test_analytics import DriveTestAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    rows = DriveTestAnalytics(db, _SystemScope()).chart_progress_by_province()
    db.close()

    assert len(rows) >= 1
    for r in rows:
        assert "done_percent" in r
        assert 0.0 <= r["done_percent"] <= 100.0


def test_overview_endpoint_requires_auth(client):
    assert client.get("/api/v1/drive-test/overview").status_code == 401


def test_overview_endpoint_returns_payload(client):
    r = client.post("/api/v1/auth/login", data=login_form(client))
    token = r.json()["access_token"]
    r = client.get(
        "/api/v1/drive-test/overview",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "kpis" in body
    assert "progress_by_province" in body
    assert body["kpis"]["total_onair"]["value"] == 4
