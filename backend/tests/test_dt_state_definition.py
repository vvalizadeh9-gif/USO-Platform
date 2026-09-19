"""What each figure on the Drive Test dashboard counts, as the definition.

Four states, and every on-air site is in exactly one:

    DT Done     dt_status == 'Done'
    Ongoing     dt_status == 'Ongoing'
    Problematic dt_status == 'Problematic', or the in-app HC flagged it
    Not started none of the above -- in practice a blank DT status

Ongoing used to be spelled by negation -- "not Done and not Problematic" --
which is a different claim. It swept in every on-air site whose DT status was
*blank*, and a blank column is a drive test nobody has started, not one in
flight. Nothing in the platform ever writes ``Ongoing``; it arrives only from
CPM column AW. So the negation reported the whole untouched backlog as work in
progress, on the KPI card, in the contractor scorecard and in every ongoing
breakdown under it.

Seeded directly so this runs everywhere.

Run with:  cd backend && pytest tests/test_dt_state_definition.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_dtstate_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from app.services.workflow import STAGE_HEALTH_PROBLEM, STAGE_NEW  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

ONAIR = C.STAGE_PERM_ONAIR
OFFAIR = "طراحی"

#: site_type -> (last_stage, dt_status, current_stage, expected state key).
#: ``None`` as the expected state means the site is off-air and is counted by
#: nothing on this dashboard.
SEED = {
    "done": (ONAIR, "Done", STAGE_NEW, "total_dt_done"),
    "done-lowercase": (ONAIR, "done", STAGE_NEW, "total_dt_done"),
    "ongoing": (ONAIR, "Ongoing", STAGE_NEW, "total_ongoing"),
    "ongoing-padded": (ONAIR, " Ongoing ", STAGE_NEW, "total_ongoing"),
    "problematic-cpm": (ONAIR, "Problematic", STAGE_NEW, "total_problematic"),
    # The June CPM (column AW) spells this "Problematical" on 24 rows and
    # never "Problematic". Owner's decision: read it the same way.
    "problematical-cpm": (ONAIR, "Problematical", STAGE_NEW, "total_problematic"),
    "problematical-cpm-padded": (ONAIR, " problematical ", STAGE_NEW, "total_problematic"),
    # Flagged inside the app over a DT status the next import will overwrite.
    # Problematic wins, so the states stay a partition rather than counting
    # this site twice.
    "problematic-in-app": (ONAIR, "Ongoing", STAGE_HEALTH_PROBLEM, "total_problematic"),
    "not-started": (ONAIR, None, STAGE_NEW, "total_not_started"),
    "not-started-blank": (ONAIR, "   ", STAGE_NEW, "total_not_started"),
    "offair": (OFFAIR, None, STAGE_NEW, None),
}


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_dtstate_pytest.db"):
        os.remove("/tmp/uep_dtstate_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Province
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        province = db.query(Province).order_by(Province.id).first()
        site = Site(site_code="DTS-0001", province_id=province.id)
        db.add(site)
        db.flush()
        for tag, (last_stage, dt_status, stage, _) in SEED.items():
            db.add(WorkItem(
                site_id=site.id,
                site_type=tag,
                last_stage=last_stage,
                dt_status=dt_status,
                current_stage=stage,
            ))
        db.commit()
    finally:
        db.close()


def _kpis(client):
    from app.services.drive_test_analytics import DriveTestAnalytics
    from app.services.snapshots import _SystemScope

    db = SessionLocal()
    try:
        return DriveTestAnalytics(db, _SystemScope()).compute_kpis()
    finally:
        db.close()


def _expected(key: str) -> int:
    return sum(1 for spec in SEED.values() if spec[3] == key)


def test_each_state_counts_exactly_the_sites_it_names(client):
    kpis = _kpis(client)

    assert kpis["total_dt_done"] == _expected("total_dt_done")
    assert kpis["total_ongoing"] == _expected("total_ongoing")
    assert kpis["total_problematic"] == _expected("total_problematic")
    assert kpis["total_not_started"] == _expected("total_not_started")


def test_a_blank_dt_status_is_not_started_rather_than_ongoing(client):
    """The regression. Two sites here have no DT status; neither is ongoing."""
    kpis = _kpis(client)

    assert kpis["total_not_started"] == 2
    assert kpis["total_ongoing"] == 2, "only the two that say Ongoing"


def test_the_four_states_partition_on_air(client):
    """So Remaining is the sum of the cards under it, and the KPI band's bar
    is the whole programme rather than a picture of part of it."""
    kpis = _kpis(client)

    assert (
        kpis["total_dt_done"]
        + kpis["total_ongoing"]
        + kpis["total_problematic"]
        + kpis["total_not_started"]
        == kpis["total_onair"]
    )
    assert (
        kpis["total_ongoing"]
        + kpis["total_problematic"]
        + kpis["total_not_started"]
        == kpis["total_remaining"]
    )


def test_an_off_air_site_is_counted_by_nothing(client):
    kpis = _kpis(client)

    assert kpis["total_onair"] == len(SEED) - 1


def test_the_status_column_is_read_through_the_normaliser(client):
    """``done``, ``Done``, `` Ongoing `` and a whitespace-only cell are all
    read the way the import would have written them. The import canonicalises
    what it writes; seeded and hand-edited rows do not go through it, and a
    lowercase ``done`` counted as not-done is the kind of wrong a dashboard
    never announces."""
    from app.services.drive_test_analytics import (
        is_dt_done,
        is_not_started,
        is_ongoing,
    )
    from app.models.workitem import WorkItem

    db = SessionLocal()
    try:
        by_tag = {w.site_type: w for w in db.query(WorkItem).all()}
        assert is_dt_done(by_tag["done-lowercase"])
        assert is_ongoing(by_tag["ongoing-padded"])
        assert is_not_started(by_tag["not-started-blank"])
    finally:
        db.close()


def test_normalize_dt_status_reads_the_misspelling_as_problematic():
    """"Problematical" (and padded/cased variants) canonicalise the same way
    as "Problematic". Anything else unrecognised is kept as-is, and a blank
    cell is None -- unknown values are not silently dropped."""
    assert C.normalize_dt_status("Problematical") == C.DT_STATUS_PROBLEMATIC
    assert C.normalize_dt_status(" problematical ") == C.DT_STATUS_PROBLEMATIC
    assert C.normalize_dt_status("Problematic") == C.DT_STATUS_PROBLEMATIC
    assert C.normalize_dt_status("Foo") == "Foo"
    assert C.normalize_dt_status("   ") is None
    assert C.normalize_dt_status(None) is None
