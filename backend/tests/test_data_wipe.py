"""Tests for the CPM data wipe feature and import history endpoint.

Run with:  cd backend && pytest tests/test_data_wipe.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_wipe_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema, login_form, sample_cpm_path  # noqa: E402


def _enable_sqlite_fk(dbapi_connection, connection_record):  # noqa: ANN001
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_wipe_pytest.db"):
        os.remove("/tmp/uep_wipe_pytest.db")

    # Production runs on Postgres, which always enforces foreign keys.
    # SQLite (this test's backend) does not, by default, which is exactly how
    # the acceptance_submissions/hc_remediations gap below shipped unnoticed:
    # the wipe "worked" in every test because nothing here was checking FKs.
    # Force it on for every connection this module's engine opens -- before
    # create_schema() and app startup hand out the first one from the pool --
    # so this test is real evidence, not just an unchecked bulk-delete call.
    #
    # ``app.core.database.engine`` is a process-wide singleton shared by every
    # test module in one pytest run, so the listener (and the dispose() calls
    # around it) are scoped to this fixture's lifetime and torn down at the
    # end -- leaving it registered would silently turn on FK enforcement for
    # every test module that happens to run afterwards.
    from sqlalchemy import event

    from app.core.database import engine

    event.listen(engine, "connect", _enable_sqlite_fk)
    engine.dispose()  # drop any already-open connection from an earlier module

    create_schema()

    from app.main import app

    with TestClient(app) as c:
        yield c

    event.remove(engine, "connect", _enable_sqlite_fk)
    engine.dispose()  # so the next module's connections don't inherit this


def _login(client):
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return r.json()["access_token"]


def _import_sample(client, token):
    sample = sample_cpm_path()
    if not sample:
        pytest.skip("sample CPM file not available")
    with open(sample, "rb") as f:
        return client.post(
            "/api/v1/admin/cpm/import",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("CPM_2_.xlsx", f, "application/vnd.ms-excel")},
        )


def test_wipe_requires_admin_role(client):
    token = _login(client)
    r = client.post(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "username": "coordwipe",
            "password": "Test-Fixture-Passphrase",
            "first_name": "Coord", "family_name": "Wipe",
            "role_id": next(
                role["id"]
                for role in client.get(
                    "/api/v1/reference/roles",
                    headers={"Authorization": f"Bearer {token}"},
                ).json()
                if role["name"] == "Coordinator"
            ),
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    coord_token = _login_as(client, "coordwipe", "Test-Fixture-Passphrase")
    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {coord_token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 403


def _login_as(client, username, password):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    return r.json()["access_token"]


def test_wipe_rejects_wrong_confirmation_phrase(client):
    token = _login(client)
    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "delete everything"},
    )
    assert r.status_code == 400


def test_wipe_deletes_cpm_data_but_preserves_users(client):
    token = _login(client)
    _import_sample(client, token)

    before_items = client.get(
        "/api/v1/work-items", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert len(before_items) > 0  # sanity check the import actually seeded data

    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"]["work_items"] >= len(before_items)  # list is paginated
    assert body["total_deleted"] > 0

    after_items = client.get(
        "/api/v1/work-items", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert after_items == []

    # Users/roles/provinces must survive the wipe.
    users = client.get(
        "/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert any(u["username"] == "admin" for u in users)


def test_import_history_lists_batches(client):
    token = _login(client)
    _import_sample(client, token)  # re-seed since previous test wiped everything

    r = client.get(
        "/api/v1/admin/cpm/import-history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    history = r.json()
    assert len(history) >= 1
    assert "filename" in history[0]
    assert "created_at" in history[0]


def test_second_import_after_wipe_reseeds_cleanly(client):
    """After a wipe, the next import must go through seed mode again
    (no change requests, since there's nothing to diff against)."""
    token = _login(client)
    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 200

    resp = _import_sample(client, token)
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["changed_count"] == 0  # clean seed, not a diff
    assert summary["new_count"] > 0


def test_wipe_succeeds_with_acceptance_submissions_and_hc_remediations(client):
    """Regression test for a wipe that used to 500 on real data.

    ``acceptance_submissions`` (filed by a contractor/coordinator) and
    ``hc_remediations`` (opened on a Not-Ready health check) both reference
    rows the wipe deletes, but neither was itself being deleted first. Any
    site that had ever gone through those workflows made the whole wipe fail
    with a foreign-key violation -- which is what "Erase failed" meant.
    """
    from datetime import datetime, timezone

    from app.core.database import SessionLocal
    from app.models.acceptance_workflow import AcceptanceSubmission
    from app.models.health_check import HcAssignment, HcRemediation, HcTask
    from app.models.reference import Contractor, ProblemCategory
    from app.models.workitem import Site, Village, WorkItem

    token = _login(client)
    now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        site = Site(site_code="WIPE-FK-1")
        db.add(site)
        db.flush()

        work_item = WorkItem(site_id=site.id, site_type="Target", current_stage="New")
        db.add(work_item)
        db.flush()

        village = Village(work_item_id=work_item.id, village_code="WIPE-FK-1-V1")
        db.add(village)
        db.flush()

        db.add(AcceptanceSubmission(
            village_id=village.id, authority="ICT", round_no=1,
            letter_number="L-FK-1", source="Contractor",
            review_status="Pending", submitted_at=now,
        ))

        contractor = Contractor(name="FK-Check Co", type="drive_test")
        db.add(contractor)
        db.flush()

        hc_assignment = HcAssignment(
            code="HC-FK-1", contractor_id=contractor.id, assigned_at=now, status="Open"
        )
        db.add(hc_assignment)
        db.flush()

        hc_task = HcTask(
            hc_assignment_id=hc_assignment.id, work_item_id=work_item.id, round_no=1
        )
        db.add(hc_task)
        db.flush()

        category = db.query(ProblemCategory).first()
        if category is None:
            category = ProblemCategory(name="FK-Check Category")
            db.add(category)
            db.flush()

        db.add(HcRemediation(
            hc_task_id=hc_task.id, work_item_id=work_item.id,
            problem_category_id=category.id, status="Open", opened_at=now,
        ))
        db.commit()
    finally:
        db.close()

    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 200, r.text
    deleted = r.json()["deleted"]
    assert deleted["acceptance_submissions"] >= 1
    assert deleted["hc_remediations"] >= 1

    db = SessionLocal()
    try:
        assert db.query(AcceptanceSubmission).count() == 0
        assert db.query(HcRemediation).count() == 0
        assert db.query(HcTask).count() == 0
        assert db.query(Village).count() == 0
    finally:
        db.close()


# ----- WIPE_ORDER is held to the schema ------------------------------------
#
# The wipe has failed in production twice for the same reason: a new table
# referencing CPM data shipped without a line in the wipe. These two tests
# read the schema itself, so the next such table fails here instead.

#: The tables every CPM-derived row ultimately hangs off.
_CPM_ROOTS = {"sites", "work_items", "villages"}


def _all_tables():
    """Every table the app defines. ``app.main`` imports every router, and so
    every model module, which is what registers a table on ``Base.metadata``."""
    import app.main  # noqa: F401
    from app.core.database import Base

    return Base.metadata.tables


def _referenced(table) -> set[str]:
    return {fk.column.table.name for fk in table.foreign_keys}


def test_every_table_hanging_off_cpm_data_is_wiped():
    from app.services.data_wipe import WIPE_ORDER

    tables = _all_tables()
    reaches = set(_CPM_ROOTS)
    # Transitive closure: keep adding tables with an FK into the set until
    # nothing new appears.
    while True:
        more = {
            name for name, table in tables.items()
            if name not in reaches and _referenced(table) & reaches
        }
        if not more:
            break
        reaches |= more

    wiped = {table.name for _, table in WIPE_ORDER}
    missing = sorted(reaches - wiped)
    assert not missing, (
        "These tables reference CPM data but are not in data_wipe.WIPE_ORDER, "
        f"so the wipe will fail its FK check on them: {', '.join(missing)}"
    )


def test_the_wipe_deletes_children_before_parents():
    from app.services.data_wipe import WIPE_ORDER

    _all_tables()
    position = {table.name: index for index, (_, table) in enumerate(WIPE_ORDER)}
    problems = [
        f"{table.name} is deleted after {parent}, which it references"
        for index, (_, table) in enumerate(WIPE_ORDER)
        for parent in _referenced(table)
        if parent != table.name and parent in position and position[parent] < index
    ]
    assert not problems, "\n".join(problems)


def test_wipe_succeeds_after_a_mojri_import(client):
    """Regression test: after any Mojri import, ``mojri_tracker_status`` held
    an FK to ``villages`` that the wipe never cleared, so erasing failed."""
    from app.core.database import SessionLocal
    from app.models.mojri import IN_TRACKER, MojriImportRun, MojriTrackerStatus
    from app.models.workitem import Site, Village, WorkItem

    token = _login(client)

    db = SessionLocal()
    try:
        site = Site(site_code="WIPE-MOJRI-1")
        db.add(site)
        db.flush()
        work_item = WorkItem(site_id=site.id, site_type="Target", current_stage="New")
        db.add(work_item)
        db.flush()
        village = Village(work_item_id=work_item.id, village_code="WIPE-MOJRI-1-V1")
        db.add(village)
        db.flush()
        run = MojriImportRun(filename="mojri.xlsx")
        db.add(run)
        db.flush()
        db.add(MojriTrackerStatus(
            village_id=village.id, ict_status=IN_TRACKER, source_import_id=run.id,
        ))
        db.commit()
    finally:
        db.close()

    r = client.post(
        "/api/v1/admin/cpm/wipe-data",
        headers={"Authorization": f"Bearer {token}"},
        json={"confirm": "ERASE ALL CPM DATA"},
    )
    assert r.status_code == 200, r.text
    deleted = r.json()["deleted"]
    assert deleted["mojri_tracker_status"] >= 1
    assert deleted["mojri_import_runs"] >= 1
