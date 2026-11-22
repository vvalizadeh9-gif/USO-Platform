"""The one-time copy of an old uploads folder into the database (UEP-20).

Run with:  cd backend && pytest tests/test_migrate_uploads_to_db.py -q
"""
import hashlib
import os
import sys
from datetime import datetime, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_migrate_uploads_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.core.database import SessionLocal  # noqa: E402
from app.models.acceptance import CpmImportBatch  # noqa: E402
from app.models.stored_file import StoredFile  # noqa: E402
from app.scripts import migrate_uploads_to_db as M  # noqa: E402
from tests.conftest import create_schema  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def schema():
    if os.path.exists("/tmp/uep_migrate_uploads_pytest.db"):
        os.remove("/tmp/uep_migrate_uploads_pytest.db")
    create_schema()


@pytest.fixture(autouse=True)
def empty_tables():
    db = SessionLocal()
    try:
        for column in M.evidence_store.FILE_REFERENCES:
            db.query(column.class_).delete()
        db.query(StoredFile).delete()
        db.commit()
    finally:
        db.close()
    yield


def _blob(root, content: bytes, ext: str = "pdf", name: str | None = None) -> str:
    digest = hashlib.sha256(content).hexdigest()
    folder = root / "acceptance" / digest[:2] / digest[2:4]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / (name or f"{digest}.{ext}")).write_bytes(content)
    return digest


def _run(root, *, dry_run=False) -> M.Report:
    db = SessionLocal()
    try:
        return M.migrate(db, root, dry_run=dry_run)
    finally:
        db.close()


def _count() -> int:
    db = SessionLocal()
    try:
        return db.query(StoredFile).count()
    finally:
        db.close()


def _batch(filename: str, when: datetime) -> int:
    db = SessionLocal()
    try:
        batch = CpmImportBatch(filename=filename, created_at=when)
        db.add(batch)
        db.commit()
        return batch.id
    finally:
        db.close()


def _letter(digest: str) -> None:
    from app.models.submission import SubmissionLetterFile

    db = SessionLocal()
    try:
        db.add(SubmissionLetterFile(
            sha256=digest, stored_path=f"acceptance/{digest[:2]}/{digest[2:4]}/{digest}.pdf",
            original_filename="mtn.pdf", size_bytes=1,
        ))
        db.commit()
    finally:
        db.close()


def test_files_are_copied_and_verified(tmp_path):
    digest = _blob(tmp_path, b"%PDF-1.4 a letter")
    report = _run(tmp_path)
    assert (report.copied, report.already_present, report.mismatched) == (1, 0, [])
    db = SessionLocal()
    try:
        assert bytes(db.get(StoredFile, digest).content) == b"%PDF-1.4 a letter"
    finally:
        db.close()


def test_a_hash_mismatch_is_reported_and_not_copied(tmp_path):
    _blob(tmp_path, b"%PDF-1.4 tampered", name="ab" * 32 + ".pdf")
    report = _run(tmp_path)
    assert report.copied == 0
    assert len(report.mismatched) == 1
    assert _count() == 0


def test_running_twice_gives_the_same_result(tmp_path):
    _blob(tmp_path, b"%PDF-1.4 one")
    _blob(tmp_path, b"%PDF-1.4 two")
    first = _run(tmp_path)
    second = _run(tmp_path)
    assert (first.copied, first.already_present) == (2, 0)
    assert (second.copied, second.already_present) == (0, 2)
    assert _count() == 2
    # Source files are never removed.
    assert len([p for p in tmp_path.rglob("*") if p.is_file()]) == 2


def test_dry_run_changes_nothing(tmp_path):
    _blob(tmp_path, b"%PDF-1.4 dry")
    batch_id = _batch("CPM.xlsx", datetime(2026, 3, 1, 10, 0, 5, tzinfo=timezone.utc))
    (tmp_path / "cpm_20260301100000_CPM.xlsx").write_bytes(b"PK\x03\x04 workbook")
    report = _run(tmp_path, dry_run=True)
    assert report.copied == 2
    assert report.workbooks_linked == [("cpm_20260301100000_CPM.xlsx", batch_id)]
    assert _count() == 0
    db = SessionLocal()
    try:
        assert db.get(CpmImportBatch, batch_id).source_sha256 is None
    finally:
        db.close()


def test_missing_files_are_reported_per_table_and_fail_the_run(tmp_path, capsys):
    present = _blob(tmp_path, b"%PDF-1.4 here")
    _letter(present)
    _letter("cd" * 32)  # never on disk
    report = _run(tmp_path)
    (missing,) = report.missing["submission_letter_files"]
    assert missing.endswith(": " + "cd" * 32)
    assert report.missing["acceptance_evidence"] == []
    assert report.missing["drive_test_evidence"] == []
    assert report.missing_rows == 1
    assert M.main(["--upload-dir", str(tmp_path)]) == 1
    assert "submission_letter_files: 1" in capsys.readouterr().out


def test_a_clean_run_exits_zero(tmp_path):
    _letter(_blob(tmp_path, b"%PDF-1.4 complete"))
    assert M.main(["--upload-dir", str(tmp_path)]) == 0


def test_an_unambiguous_workbook_is_retained_and_linked(tmp_path):
    content = b"PK\x03\x04 the March workbook"
    batch_id = _batch("CPM March.xlsx", datetime(2026, 3, 1, 10, 0, 7, tzinfo=timezone.utc))
    (tmp_path / "cpm_20260301100000_CPM March.xlsx").write_bytes(content)
    report = _run(tmp_path)
    digest = hashlib.sha256(content).hexdigest()
    assert report.workbooks_linked == [("cpm_20260301100000_CPM March.xlsx", batch_id)]
    db = SessionLocal()
    try:
        assert db.get(StoredFile, digest).retain is True
        assert db.get(CpmImportBatch, batch_id).source_sha256 == digest
    finally:
        db.close()
    # Again: still linked once, nothing duplicated.
    again = _run(tmp_path)
    assert again.copied == 0 and again.workbooks_linked == report.workbooks_linked


def test_an_ambiguous_workbook_is_stored_but_left_unlinked(tmp_path):
    when = datetime(2026, 4, 1, 9, 0, 0, tzinfo=timezone.utc)
    first = _batch("CPM.xlsx", when.replace(second=10))
    second = _batch("CPM.xlsx", when.replace(minute=30))
    (tmp_path / "cpm_20260401090000_CPM.xlsx").write_bytes(b"PK\x03\x04 which one?")
    report = _run(tmp_path)
    assert report.workbooks_unlinked == ["cpm_20260401090000_CPM.xlsx"]
    assert _count() == 1
    db = SessionLocal()
    try:
        assert db.get(CpmImportBatch, first).source_sha256 is None
        assert db.get(CpmImportBatch, second).source_sha256 is None
    finally:
        db.close()


def test_a_workbook_with_no_matching_import_is_unlinked(tmp_path):
    (tmp_path / "cpm_20250101000000_lost.xlsx").write_bytes(b"PK\x03\x04 lost")
    report = _run(tmp_path)
    assert report.workbooks_unlinked == ["cpm_20250101000000_lost.xlsx"]
    assert report.copied == 1
