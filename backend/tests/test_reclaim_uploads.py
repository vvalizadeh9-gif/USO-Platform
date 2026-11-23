"""Reclaiming database space without reclaiming anything that matters (UEP-20).

Stored files are content-addressed and shared, so deleting one that is still
referenced takes the file away from every row pointing at it. These tests are
mostly about what the job must NOT delete: anything referenced by any table in
``evidence_store.FILE_REFERENCES`` (one case per table -- the old disk-based
job forgot drive-test evidence and MTN submission letters), retained CPM
workbooks, and anything younger than the grace period.

Run with:  cd backend && pytest tests/test_reclaim_uploads.py -q
"""
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_reclaim_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.core.database import SessionLocal  # noqa: E402
from app.models.stored_file import StoredFile  # noqa: E402
from app.scripts import reclaim_uploads  # noqa: E402
from app.scripts.reclaim_uploads import find_reclaimable, reclaim  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

NOW = datetime.now(timezone.utc)
OLD = NOW - timedelta(days=30)


@pytest.fixture(scope="module", autouse=True)
def schema():
    if os.path.exists("/tmp/uep_reclaim_pytest.db"):
        os.remove("/tmp/uep_reclaim_pytest.db")
    create_schema()


@pytest.fixture(autouse=True)
def empty_tables():
    """Each case starts with no files and no referencing rows."""
    from app.services.evidence_store import FILE_REFERENCES

    db = SessionLocal()
    try:
        for column in FILE_REFERENCES:
            db.query(column.class_).delete()
        db.query(StoredFile).delete()
        db.commit()
    finally:
        db.close()
    yield


def _file(db, label: str, *, when: datetime = OLD, retain: bool = False) -> str:
    content = f"%PDF-1.4 {label}".encode()
    digest = hashlib.sha256(content).hexdigest()
    db.add(StoredFile(
        sha256=digest, extension="pdf", size_bytes=len(content), content=content,
        retain=retain, created_at=when, updated_at=when,
    ))
    db.flush()
    return digest


def _path(digest: str) -> str:
    return f"acceptance/{digest[:2]}/{digest[2:4]}/{digest}.pdf"


def _acceptance_evidence(db, digest: str) -> None:
    from app.models.acceptance_workflow import AcceptanceEvidence, AcceptanceSubmission

    submission = AcceptanceSubmission(
        village_id=1, authority="ICT", round_no=1, letter_number="L-1",
        source="Coordinator", review_status="Pending", submitted_at=NOW,
    )
    db.add(submission)
    db.flush()
    db.add(AcceptanceEvidence(
        submission_id=submission.id, sha256=digest, stored_path=_path(digest),
        original_filename="letter.pdf", size_bytes=8, uploaded_at=NOW,
    ))


def _drive_test_evidence(db, digest: str) -> None:
    from app.models.workitem import DriveTestEvidence

    db.add(DriveTestEvidence(
        drive_test_id=1, sha256=digest, stored_path=_path(digest),
        original_filename="route.pdf", size_bytes=8, uploaded_at=NOW,
    ))


def _submission_letter(db, digest: str) -> None:
    from app.models.submission import SubmissionLetterFile

    db.add(SubmissionLetterFile(
        sha256=digest, stored_path=_path(digest), original_filename="mtn.pdf", size_bytes=8,
    ))


def _cpm_batch(db, digest: str) -> None:
    from app.models.acceptance import CpmImportBatch

    db.add(CpmImportBatch(filename="cpm.xlsx", source_sha256=digest))


@pytest.mark.parametrize(
    "reference",
    [_acceptance_evidence, _drive_test_evidence, _submission_letter, _cpm_batch],
    ids=["acceptance_evidence", "drive_test_evidence", "submission_letter_files", "cpm_import_batches"],
)
def test_a_file_referenced_by_any_table_is_kept(reference):
    db = SessionLocal()
    try:
        kept = _file(db, reference.__name__)
        reference(db, kept)
        orphan = _file(db, "orphan")
        db.commit()

        reclaim(db, NOW, dry_run=False)

        assert db.get(StoredFile, kept) is not None
        assert db.get(StoredFile, orphan) is None
    finally:
        db.close()


def test_a_retained_workbook_is_never_removed():
    db = SessionLocal()
    try:
        workbook = _file(db, "workbook", when=NOW - timedelta(days=3650), retain=True)
        db.commit()
        reclaim(db, NOW, dry_run=False)
        assert db.get(StoredFile, workbook) is not None
    finally:
        db.close()


def test_a_recent_unreferenced_file_is_kept():
    """A scan is stored before its letter is filed."""
    db = SessionLocal()
    try:
        recent = _file(db, "recent", when=NOW - timedelta(days=6))
        db.commit()
        assert find_reclaimable(db, NOW) == []
        reclaim(db, NOW, dry_run=False)
        assert db.get(StoredFile, recent) is not None
    finally:
        db.close()


def test_a_file_reuploaded_recently_is_kept():
    """Created long ago but re-attached yesterday: its grace period restarted."""
    db = SessionLocal()
    try:
        digest = _file(db, "reattached")
        db.query(StoredFile).filter(StoredFile.sha256 == digest).update(
            {"updated_at": NOW - timedelta(days=1)}
        )
        db.commit()
        assert find_reclaimable(db, NOW) == []
    finally:
        db.close()


def test_old_orphans_are_removed_and_reported_with_their_size():
    db = SessionLocal()
    try:
        a, b = _file(db, "a"), _file(db, "b")
        db.commit()
        found = reclaim(db, NOW, dry_run=False)
        assert {sha for sha, _ in found} == {a, b}
        assert all(size > 0 for _, size in found)
        assert db.query(StoredFile).count() == 0
    finally:
        db.close()


def test_dry_run_removes_nothing(capsys):
    db = SessionLocal()
    try:
        orphan = _file(db, "dry")
        db.commit()
    finally:
        db.close()

    assert reclaim_uploads.main(["--dry-run"]) == 0
    out = capsys.readouterr().out
    assert f"would remove: {orphan}" in out
    assert "Dry run: nothing was removed." in out

    db = SessionLocal()
    try:
        assert db.get(StoredFile, orphan) is not None
    finally:
        db.close()


def test_an_empty_database_is_not_an_error(capsys):
    assert reclaim_uploads.main([]) == 0
    assert "0 unreferenced file(s)" in capsys.readouterr().out
