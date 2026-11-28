"""UEP-31: Admin > Contractors, and which contractors Drive test offers.

* GET lists drive-test contractors only; POST adds one by hand (shown, source
  manual), 409 on a duplicate name whatever its case and spaces; PATCH switches
  it, and both are audit-logged.
* PM and Admin edit, Viewer reads, every other role gets 403.
* The CPM import creates a new drive-test name hidden, except on an empty
  system; an existing name is never changed.
* The migration hides only drive-test contractors with no work in 180 days.

Run with:  cd backend && pytest tests/test_contractors_admin.py -q
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_contractors_admin_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

API = "/api/v1"
URL = f"{API}/admin/contractors"


@pytest.fixture(scope="module")
def client():
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _admin_token(client):
    return client.post(f"{API}/auth/login", data=login_form(client)).cookies["uep_session"]


@pytest.fixture(scope="module")
def admin(client):
    return {"Authorization": f"Bearer {_admin_token(client)}"}


@pytest.fixture(scope="module")
def pm(client):
    return login_as_role(client, _admin_token(client), "PM")


def _contractor(name, kind="drive_test", shown=True):
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        c = Contractor(name=name, type=kind, active=True, show_in_drive_test=shown)
        db.add(c)
        db.commit()
        return c.id
    finally:
        db.close()


def test_get_lists_drive_test_contractors_only(client, pm):
    dt = _contractor("Pars Rayan")
    site = _contractor("Site Builder Co", kind="site")
    r = client.get(URL, headers=pm)
    assert r.status_code == 200, r.text
    rows = {c["id"]: c for c in r.json()}
    assert dt in rows and site not in rows
    assert set(rows[dt]) == {
        "id", "name", "source", "show_in_drive_test", "created_at", "open_hc", "open_dt", "provinces",
    }
    assert rows[dt]["source"] == "cpm" and rows[dt]["open_hc"] == 0


def test_post_adds_a_shown_manual_contractor_that_is_offered_at_once(client, pm):
    r = client.post(URL, headers=pm, json={"name": "  Ariana   Telecom "})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Ariana Telecom"
    assert body["source"] == "manual" and body["show_in_drive_test"] is True and body["created_at"]
    for url in ("/hc/contractors/load", "/drive-test/contractors/load"):
        names = [c["name"] for c in client.get(f"{API}{url}", headers=pm).json()]
        assert "Ariana Telecom" in names


def test_post_refuses_a_duplicate_name_whatever_its_case_and_spaces(client, pm):
    assert client.post(URL, headers=pm, json={"name": "Kavir Net"}).status_code == 201
    r = client.post(URL, headers=pm, json={"name": " kavir   NET"})
    assert r.status_code == 409
    assert r.json()["detail"] == "A contractor with this name already exists."


def test_patch_switches_and_audits(client, pm):
    from app.core import audit_actions
    from app.models.acceptance import AuditLog

    cid = _contractor("Zagros Link")
    r = client.patch(f"{URL}/{cid}", headers=pm, json={"show_in_drive_test": False})
    assert r.status_code == 200 and r.json()["show_in_drive_test"] is False
    names = [c["name"] for c in client.get(f"{API}/hc/contractors/load", headers=pm).json()]
    assert "Zagros Link" not in names
    db = SessionLocal()
    try:
        entry = (
            db.query(AuditLog)
            .filter(AuditLog.entity_type == "contractor", AuditLog.entity_id == cid)
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert entry.action == audit_actions.CONTRACTOR_VISIBILITY_CHANGED
        assert entry.old_value == {"show_in_drive_test": True}
        assert entry.new_value == {"show_in_drive_test": False}
    finally:
        db.close()
    assert client.patch(f"{URL}/999999", headers=pm, json={"show_in_drive_test": True}).status_code == 404


def test_admin_edits_viewer_reads_others_are_refused(client, admin):
    token = _admin_token(client)
    viewer = login_as_role(client, token, "Viewer")
    coordinator = login_as_role(client, token, "Coordinator")
    cid = _contractor("Toos Net")

    assert client.patch(f"{URL}/{cid}", headers=admin, json={"show_in_drive_test": False}).status_code == 200
    assert client.get(URL, headers=viewer).status_code == 200
    assert client.post(URL, headers=viewer, json={"name": "Viewer Co"}).status_code == 403
    assert client.patch(f"{URL}/{cid}", headers=viewer, json={"show_in_drive_test": True}).status_code == 403
    assert client.get(URL, headers=coordinator).status_code == 403


def test_cpm_import_creates_a_new_name_hidden_except_on_an_empty_system(client):
    from app.models.reference import Contractor
    from app.services.cpm_import import CpmImportService

    db = SessionLocal()
    try:
        # Not empty: drive-test contractors are already shown.
        svc = CpmImportService(db, None)
        svc._load_reference_caches()
        new = svc._contractor("Mehvar   Tel", kind="drive_test")
        site = svc._contractor("Brand New Builder", kind="site")
        existing = svc._contractor("pars rayan", kind="drive_test")
        db.flush()
        assert new.show_in_drive_test is False and new.source == "cpm" and new.created_at
        assert site.show_in_drive_test is True
        assert existing.show_in_drive_test is True and existing.source == "cpm"

        # Empty: nothing shown yet, so the first import's names are shown.
        db.query(Contractor).update({Contractor.show_in_drive_test: False})
        svc = CpmImportService(db, None)
        svc._load_reference_caches()
        assert svc._contractor("Arvand Link", kind="drive_test").show_in_drive_test is True
    finally:
        db.rollback()
        db.close()


def test_migration_hides_only_contractors_idle_for_180_days(client):
    import importlib.util
    from pathlib import Path

    from app.core.database import engine
    from app.models.health_check import HcAssignment, HcTask
    from app.models.reference import Contractor
    from app.models.workitem import Site, WorkItem

    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        db.query(Contractor).update({Contractor.show_in_drive_test: False})
        idle = Contractor(name="Idle Old Name", type="drive_test", active=True, show_in_drive_test=True)
        recent = Contractor(name="Recent Worker", type="drive_test", active=True, show_in_drive_test=True)
        busy = Contractor(name="Old But Busy", type="drive_test", active=True, show_in_drive_test=True)
        builder = Contractor(name="Idle Builder", type="site", active=True, show_in_drive_test=True)
        db.add_all([idle, recent, busy, builder])
        site = Site(site_code="UEP31-MIG")
        db.add(site)
        db.flush()
        wi = WorkItem(site_id=site.id, site_type="New Site")
        db.add(wi)
        db.flush()
        a_recent = HcAssignment(code="HC-UEP31-1", contractor_id=recent.id, assigned_at=now - timedelta(days=10))
        a_old = HcAssignment(code="HC-UEP31-2", contractor_id=busy.id, assigned_at=now - timedelta(days=400))
        db.add_all([a_recent, a_old])
        db.flush()
        db.add(HcTask(hc_assignment_id=a_old.id, work_item_id=wi.id))  # still open
        db.commit()
        ids = {"idle": idle.id, "recent": recent.id, "busy": busy.id, "builder": builder.id}
    finally:
        db.close()

    path = next(Path(__file__).resolve().parents[1].glob("alembic/versions/*_contractor_visibility.py"))
    spec = importlib.util.spec_from_file_location("uep31_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as conn:
        assert module.hide_inactive(conn, now) == ["Idle Old Name"]

    db = SessionLocal()
    try:
        shown = {k: db.get(Contractor, v).show_in_drive_test for k, v in ids.items()}
        assert shown == {"idle": False, "recent": True, "busy": True, "builder": True}
    finally:
        db.close()
