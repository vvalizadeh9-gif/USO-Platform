"""The CPM workbook is read from memory and kept forever in the database (UEP-20).

Run with:  cd backend && pytest tests/test_cpm_import_stored.py -q
"""
import hashlib
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_cpm_stored_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.acceptance import CpmImportBatch  # noqa: E402
from app.models.stored_file import StoredFile  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form, sample_cpm_path  # noqa: E402

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_cpm_stored_pytest.db"):
        os.remove("/tmp/uep_cpm_stored_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def admin(client) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


@pytest.fixture(scope="module")
def workbook() -> bytes:
    path = sample_cpm_path()
    if path is None:
        pytest.skip("no CPM workbook available")
    with open(path, "rb") as f:
        return f.read()


@pytest.fixture(scope="module")
def imported(client, admin, workbook) -> int:
    r = client.post(
        "/api/v1/admin/cpm/import", headers=admin,
        files={"file": ("CPM 1405-08.xlsx", workbook, XLSX)},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_the_import_keeps_the_workbook_retained_and_linked(imported, workbook):
    db = SessionLocal()
    try:
        batch = db.get(CpmImportBatch, imported)
        assert batch.source_sha256 == hashlib.sha256(workbook).hexdigest()
        stored = db.get(StoredFile, batch.source_sha256)
        assert stored.retain is True
        assert stored.extension == "xlsx"
        assert bytes(stored.content) == workbook
    finally:
        db.close()


def test_admin_downloads_the_original_workbook(client, admin, imported, workbook):
    r = client.get(f"/api/v1/admin/cpm/imports/{imported}/workbook", headers=admin)
    assert r.status_code == 200
    assert r.content == workbook
    assert r.headers["content-type"].startswith(XLSX)
    assert r.headers["content-disposition"] == 'attachment; filename="CPM 1405-08.xlsx"'
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]


def test_a_non_admin_gets_403(client, admin, imported):
    pm = login_as_role(client, admin["Authorization"].split()[1], "PM")
    r = client.get(f"/api/v1/admin/cpm/imports/{imported}/workbook", headers=pm)
    assert r.status_code == 403


def test_an_unknown_or_unlinked_import_is_a_404(client, admin, imported):
    assert client.get("/api/v1/admin/cpm/imports/999999/workbook", headers=admin).status_code == 404
    db = SessionLocal()
    try:
        old = CpmImportBatch(filename="before-uep-20.xlsx")
        db.add(old)
        db.commit()
        old_id = old.id
    finally:
        db.close()
    r = client.get(f"/api/v1/admin/cpm/imports/{old_id}/workbook", headers=admin)
    assert r.status_code == 404


def test_a_rejected_workbook_stores_nothing(client, admin, imported):
    db = SessionLocal()
    try:
        files_before = db.query(StoredFile).count()
        batches_before = db.query(CpmImportBatch).count()
    finally:
        db.close()

    r = client.post(
        "/api/v1/admin/cpm/import", headers=admin,
        files={"file": ("broken.xlsx", b"PK\x03\x04 not really a workbook", XLSX)},
    )
    assert r.status_code == 400
    assert "could not be read as a CPM workbook" in r.json()["detail"]

    db = SessionLocal()
    try:
        assert db.query(StoredFile).count() == files_before
        assert db.query(CpmImportBatch).count() == batches_before
    finally:
        db.close()


def test_importing_the_same_workbook_again_stores_it_once(client, admin, imported, workbook):
    r = client.post(
        "/api/v1/admin/cpm/import", headers=admin,
        files={"file": ("CPM again.xlsx", workbook, XLSX)},
    )
    assert r.status_code == 200, r.text
    db = SessionLocal()
    try:
        digest = hashlib.sha256(workbook).hexdigest()
        assert db.query(StoredFile).filter(StoredFile.sha256 == digest).count() == 1
        assert db.get(CpmImportBatch, r.json()["id"]).source_sha256 == digest
    finally:
        db.close()
