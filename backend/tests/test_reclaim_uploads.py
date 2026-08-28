"""Reclaiming upload storage without reclaiming anything that matters.

The dangerous half of this script is the evidence sweep: blobs are
content-addressed and shared, so deleting one that is still referenced takes
the evidence away from every submission pointing at it. These tests are mostly
about what it must NOT delete.

Run with:  cd backend && pytest tests/test_reclaim_uploads.py -q
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_reclaim_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.scripts.reclaim_uploads import (  # noqa: E402
    find_old_workbooks,
    find_orphan_evidence,
)
from tests.conftest import create_schema  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def schema():
    if os.path.exists("/tmp/uep_reclaim_pytest.db"):
        os.remove("/tmp/uep_reclaim_pytest.db")
    create_schema()


def _aged(path, days: int):
    when = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp()
    os.utime(path, (when, when))


def test_only_old_workbooks_are_selected(tmp_path):
    old = tmp_path / "cpm_20240101120000_CPM.xlsx"
    recent = tmp_path / "cpm_20260801120000_CPM.xlsx"
    for f in (old, recent):
        f.write_bytes(b"x")
    _aged(old, 400)
    _aged(recent, 3)

    found = find_old_workbooks(tmp_path, keep_days=180, now=datetime.now(timezone.utc))
    assert found == [old]


def test_files_that_are_not_workbooks_are_left_alone(tmp_path):
    """The sweep matches what import_cpm writes, and nothing else."""
    for name in ("notes.txt", "cpm_backup.xlsx", "important.xlsx", "cpm_short_x.xlsx"):
        f = tmp_path / name
        f.write_bytes(b"x")
        _aged(f, 999)

    assert find_old_workbooks(tmp_path, keep_days=1, now=datetime.now(timezone.utc)) == []


def test_referenced_evidence_is_never_removed(tmp_path):
    """The property that matters: a shared blob stays while anything points at it."""
    from app.core.database import SessionLocal
    from app.models.acceptance_workflow import AcceptanceEvidence, AcceptanceSubmission

    blob = tmp_path / "acceptance" / "aa" / "bb" / "aabb.pdf"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"%PDF-1.4")

    db = SessionLocal()
    try:
        submission = AcceptanceSubmission(
            village_id=1,
            authority="ICT",
            round_no=1,
            letter_number="L-1",
            source="Coordinator",
            review_status="Pending",
            submitted_at=datetime.now(timezone.utc),
        )
        db.add(submission)
        db.flush()
        db.add(
            AcceptanceEvidence(
                submission_id=submission.id,
                sha256="aabb",
                stored_path="acceptance/aa/bb/aabb.pdf",
                original_filename="letter.pdf",
                size_bytes=8,
                uploaded_at=datetime.now(timezone.utc),
            )
        )
        db.flush()
        assert find_orphan_evidence(db, tmp_path) == []
    finally:
        db.rollback()
        db.close()


def test_unreferenced_evidence_is_found(tmp_path):
    from app.core.database import SessionLocal

    orphan = tmp_path / "acceptance" / "cc" / "dd" / "ccdd.pdf"
    orphan.parent.mkdir(parents=True)
    orphan.write_bytes(b"%PDF-1.4")

    db = SessionLocal()
    try:
        assert find_orphan_evidence(db, tmp_path) == [orphan]
    finally:
        db.close()


def test_a_missing_uploads_directory_is_not_an_error(tmp_path):
    """A fresh deployment that has never had an upload must not crash the job."""
    from app.core.database import SessionLocal

    missing = tmp_path / "not-created-yet"
    assert find_old_workbooks(missing, keep_days=1, now=datetime.now(timezone.utc)) == []
    db = SessionLocal()
    try:
        assert find_orphan_evidence(db, missing) == []
    finally:
        db.close()
