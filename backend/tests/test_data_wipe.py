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
