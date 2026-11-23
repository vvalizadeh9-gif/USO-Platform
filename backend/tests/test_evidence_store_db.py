"""The evidence store keeps files in the database (UEP-20).

Validation is unchanged from the disk-based store; what is new is where the
bytes go: ``stored_files``, one row per distinct file, written in the caller's
transaction.

Run with:  cd backend && pytest tests/test_evidence_store_db.py -q
"""
import hashlib
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_evidence_store_db_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from app.core.database import SessionLocal  # noqa: E402
from app.models.stored_file import StoredFile  # noqa: E402
from app.services import evidence_store  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

PDF = b"%PDF-1.7 a scanned letter"


@pytest.fixture(scope="module", autouse=True)
def schema():
    if os.path.exists("/tmp/uep_evidence_store_db_pytest.db"):
        os.remove("/tmp/uep_evidence_store_db_pytest.db")
    create_schema()


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.rollback()
    session.close()


def test_store_then_read_round_trips(db):
    stored = evidence_store.store(db, "Letter.PDF", PDF)
    db.commit()

    digest = hashlib.sha256(PDF).hexdigest()
    assert stored == {
        "sha256": digest,
        "stored_path": f"acceptance/{digest[:2]}/{digest[2:4]}/{digest}.pdf",
        "size_bytes": len(PDF),
        "extension": "pdf",
    }
    assert evidence_store.read(db, stored["stored_path"]) == PDF
    row = db.get(StoredFile, digest)
    assert (row.extension, row.size_bytes, row.retain) == ("pdf", len(PDF), False)
    # The path still carries the type, as rows written before UEP-20 do.
    assert evidence_store.media_type_for(stored["stored_path"]) == "application/pdf"
    assert evidence_store.kind_for(stored["stored_path"]) == evidence_store.KIND_PDF


def test_the_same_bytes_twice_are_one_row(db):
    content = b"%PDF-1.7 the letter for a hundred villages"
    first = evidence_store.store(db, "a.pdf", content)
    second = evidence_store.store(db, "b.pdf", content)
    db.commit()
    assert first["stored_path"] == second["stored_path"]
    assert db.query(StoredFile).filter(StoredFile.sha256 == first["sha256"]).count() == 1


def test_nothing_is_kept_when_the_callers_transaction_rolls_back(db):
    content = b"%PDF-1.7 a filing that is refused"
    stored = evidence_store.store(db, "x.pdf", content)
    db.rollback()
    assert db.get(StoredFile, stored["sha256"]) is None


@pytest.mark.parametrize(
    ("name", "content", "message"),
    [
        ("empty.pdf", b"", "The file is empty"),
        ("page.pdf", b"<html>not a pdf</html>", "does not look like a real PDF"),
        ("tool.exe", b"MZ\x90\x00", "Accepted formats"),
    ],
)
def test_validation_errors_are_unchanged_and_store_nothing(db, name, content, message):
    before = db.query(StoredFile).count()
    with pytest.raises(evidence_store.EvidenceError) as exc:
        evidence_store.store(db, name, content)
    assert message in str(exc.value)
    db.commit()
    assert db.query(StoredFile).count() == before


def test_a_file_that_is_too_large_is_refused(db, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    with pytest.raises(evidence_store.EvidenceError, match="1 MB limit"):
        evidence_store.store(db, "big.pdf", b"%PDF" + b"x" * (1024 * 1024))


def test_reading_a_missing_file_raises_file_missing(db):
    absent = "acceptance/aa/bb/" + "ab" * 32 + ".pdf"
    with pytest.raises(evidence_store.FileMissing):
        evidence_store.read(db, absent)
    with pytest.raises(evidence_store.FileMissing):
        evidence_store.read(db, "acceptance/not-a-digest.pdf")


def test_a_retained_file_stays_retained(db):
    content = b"PK\x03\x04 a workbook"
    digest = evidence_store.store_retained(db, "xlsx", content)
    db.commit()
    assert db.get(StoredFile, digest).retain is True

    # Uploading the same bytes as ordinary evidence never clears the flag.
    evidence_store.store(db, "copy.xlsx", content)
    db.commit()
    db.expire_all()
    assert db.get(StoredFile, digest).retain is True


def test_an_ordinary_file_becomes_retained_when_kept_as_a_workbook(db):
    content = b"PK\x03\x04 first evidence, later a workbook"
    stored = evidence_store.store(db, "e.xlsx", content)
    db.commit()
    evidence_store.store_retained(db, "xlsx", content)
    db.commit()
    db.expire_all()
    assert db.get(StoredFile, stored["sha256"]).retain is True


def test_storing_again_restarts_the_cleanup_grace_period(db):
    """A re-upload touches updated_at, so the cleanup cannot remove a file in
    the moment a new filing starts referencing it."""
    from datetime import datetime, timedelta, timezone

    content = b"%PDF-1.7 an old orphan, attached again"
    stored = evidence_store.store(db, "o.pdf", content)
    db.commit()
    old = datetime.now(timezone.utc) - timedelta(days=30)
    db.query(StoredFile).filter(StoredFile.sha256 == stored["sha256"]).update(
        {"created_at": old, "updated_at": old}
    )
    db.commit()

    evidence_store.store(db, "o.pdf", content)
    db.commit()
    db.expire_all()
    row = db.get(StoredFile, stored["sha256"])
    touched = row.updated_at if row.updated_at.tzinfo else row.updated_at.replace(tzinfo=timezone.utc)
    assert touched > old + timedelta(days=29)
