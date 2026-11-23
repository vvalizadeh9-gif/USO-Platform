"""Content-addressed storage for every uploaded file, kept in PostgreSQL.

One ICT letter routinely covers a hundred villages, and each of those is a
separate submission. Storing the upload under a per-submission name would put a
hundred identical copies of the same scan in the database and in every backup.
Keying the file by the SHA-256 of its contents instead means the second and
subsequent uploads of the same document cost one metadata row and no bytes.

Since UEP-20 the bytes live in the ``stored_files`` table, not on a disk
volume: the application keeps no state of its own, and the one database backup
covers filings and their letters together. Writes happen inside the caller's
transaction, so a filing that rolls back leaves no orphan file behind.

The corollary matters: **deleting an evidence row must not delete the file**,
because other submissions may still reference the same hash.

Types are checked by reading the file's leading bytes, not by trusting its
extension. An extension is a claim by whoever uploaded the file; the magic
number is a property of the bytes.
"""
from __future__ import annotations

import hashlib
import os
import re
from email.parser import BytesHeaderParser
from pathlib import Path, PurePosixPath

from sqlalchemy import func, or_, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.acceptance import CpmImportBatch
from app.models.acceptance_workflow import AcceptanceEvidence
from app.models.stored_file import StoredFile
from app.models.submission import SubmissionLetterFile
from app.models.workitem import DriveTestEvidence

# DOCX and XLSX are ZIP containers, so they share the ZIP signature. That means
# a ZIP renamed to .docx passes this check; the point of the check is to stop a
# script or an HTML page being served back to a browser as a document, which it
# does. Deeper validation would mean opening the container, which is not worth
# it for a scan attached to a letter.
_ZIP_MAGIC = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")

# An Outlook .msg is an OLE compound file.
_OLE_MAGIC = (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",)

# extension -> (human label, accepted magic-byte prefixes)
ALLOWED_TYPES: dict[str, tuple[str, tuple[bytes, ...]]] = {
    "pdf": ("PDF document", (b"%PDF",)),
    "jpg": ("JPEG image", (b"\xff\xd8\xff",)),
    "jpeg": ("JPEG image", (b"\xff\xd8\xff",)),
    "png": ("PNG image", (b"\x89PNG\r\n\x1a\n",)),
    "webp": ("WebP image", (b"RIFF",)),
    "docx": ("Word document", _ZIP_MAGIC),
    "xlsx": ("Excel workbook", _ZIP_MAGIC),
    # An authority's answer often arrives by email (UEP-16). An .eml has no
    # magic number; its headers are parsed instead (see :func:`_check_eml`).
    "eml": ("Email message", ()),
    "msg": ("Outlook message", _OLE_MAGIC),
}

# What the upload box tells the user it accepts.
ACCEPTED_EXTENSIONS = sorted(ALLOWED_TYPES)

# Beyond this, a submission is being used as a filing cabinet.
MAX_FILES_PER_SUBMISSION = 10

# Every stored path starts with this. It named a folder on the old uploads
# volume; it is kept so rows written before and after UEP-20 look the same.
_SUBDIR = "acceptance"

#: Every model column that points at a stored file by its SHA-256. The cleanup
#: job, the one-time migration and the reference checks all read this list --
#: nobody repeats it -- and tests/test_file_references_complete.py fails if a
#: model gains a ``stored_path`` or ``*sha256`` column that is not in it.
FILE_REFERENCES = (
    AcceptanceEvidence.sha256,
    DriveTestEvidence.sha256,
    SubmissionLetterFile.sha256,
    CpmImportBatch.source_sha256,
)


class EvidenceError(ValueError):
    """An upload that must be refused, with a message safe to show the user."""


class FileMissing(LookupError):
    """A row points at a file that is not in ``stored_files``."""


# How much is read at a time when streaming an upload off the wire.
_CHUNK = 64 * 1024


def read_capped(source, limit_mb: int | None = None) -> bytes:
    """Read an upload, refusing it the moment it passes the size limit.

    Every upload endpoint used to call ``file.file.read()`` and *then* check the
    length, so a body far larger than the limit was fully in memory before
    anything rejected it. nginx allowed 75 MB while the application accepted 20,
    which meant the rejected bytes were paid for in RAM first, and a handful of
    concurrent uploads could exhaust a single backend container.

    Reading in chunks and stopping at the ceiling costs the same for a
    legitimate file and bounds the illegitimate one. The limit is enforced
    here rather than trusted from nginx, because the backend must be safe on
    its own terms -- nginx is a separate component with a separate config.
    """
    limit = (limit_mb or get_settings().max_upload_mb) * 1024 * 1024
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = source.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise EvidenceError(
                f"File is larger than the {limit // (1024 * 1024)} MB limit"
            )
        chunks.append(chunk)
    return b"".join(chunks)


def safe_filename(filename: str) -> str:
    """Reduce an uploaded filename to something safe to put in a path.

    An uploaded name is a claim by whoever uploaded it, and it reaches
    ``os.path.join``. A name of ``../../app/x.xlsx`` escaped the uploads
    directory entirely -- and /app is owned by the same user the container runs
    as, so an admin account could overwrite application code with it.

    Keeps only the base name, and only characters that cannot mean anything to
    a path.
    """
    # Backslashes first: a browser on Windows can send "C:\\Users\\me\\cpm.xlsx",
    # and os.path.basename on POSIX does not treat those as separators, so the
    # whole string would survive as one "name".
    base = os.path.basename((filename or "").replace("\\", "/")).strip()
    cleaned = "".join(c if (c.isalnum() or c in "._- ") else "_" for c in base)
    # Collapse runs of dots. A ".." left anywhere in the name cannot traverse
    # once the separators are gone, but leaving it there means the next reader
    # has to work that out; removing it means they do not.
    cleaned = re.sub(r"\.{2,}", "_", cleaned).strip(". ")
    return cleaned[:120] or "upload"


def _extension(filename: str) -> str:
    return Path(filename or "").suffix.lower().lstrip(".")


def validate(filename: str, content: bytes) -> str:
    """Check one upload and return its normalised extension.

    Raises :class:`EvidenceError` with a message meant for the person who
    uploaded the file.
    """
    if not content:
        raise EvidenceError("The file is empty")

    limit_mb = get_settings().max_upload_mb
    if len(content) > limit_mb * 1024 * 1024:
        raise EvidenceError(f"File is larger than the {limit_mb} MB limit")

    ext = _extension(filename)
    if ext not in ALLOWED_TYPES:
        raise EvidenceError(
            "Accepted formats: " + ", ".join(ACCEPTED_EXTENSIONS).upper()
        )

    _label, magics = ALLOWED_TYPES[ext]
    if ext == "eml":
        _check_eml(content)
    elif not any(content.startswith(m) for m in magics):
        raise EvidenceError(f"The file does not look like a real {ext.upper()} file")
    # WebP is RIFF....WEBP; RIFF alone is also a WAV or an AVI.
    if ext == "webp" and content[8:12] != b"WEBP":
        raise EvidenceError("The file does not look like a real WEBP file")

    return ext


#: Headers at least one of which every real message carries.
_EML_HEADERS = ("from", "date", "subject", "message-id")


def _check_eml(content: bytes) -> None:
    """An .eml is text, so the check is that its header block parses as one.

    Refused: anything that starts with markup (an HTML page renamed .eml), and
    anything whose head holds none of the headers every message carries.
    """
    head = content[:64 * 1024].lstrip()
    if head[:1] == b"<":
        raise EvidenceError("The file does not look like a real EML file")
    try:
        headers = BytesHeaderParser().parsebytes(head)
    except Exception:  # noqa: BLE001 -- any parser failure is "not an email"
        raise EvidenceError("The file does not look like a real EML file") from None
    if not any(headers.get(h) for h in _EML_HEADERS):
        raise EvidenceError("The file does not look like a real EML file")


def put(db: Session, digest: str, ext: str, content: bytes, *, retain: bool) -> None:
    """Insert the bytes once. A file already present costs no bytes.

    One ``INSERT ... ON CONFLICT`` rather than check-then-insert, so two
    requests uploading the same letter at the same moment cannot both insert
    it. On a conflict only ``updated_at`` (and ``retain``, which only ever
    turns on) is touched, never ``content``. That touch matters: it locks the
    row until the caller's transaction ends and restarts the cleanup job's
    grace period, so ``reclaim_uploads`` can never delete an old unreferenced
    file in the instant a new filing starts pointing at it.
    """
    dialect = db.get_bind().dialect.name
    insert = postgresql.insert if dialect == "postgresql" else sqlite.insert
    statement = insert(StoredFile).values(
        sha256=digest, extension=ext, size_bytes=len(content),
        content=content, retain=retain,
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["sha256"],
            set_={
                "updated_at": func.now(),
                "retain": or_(StoredFile.retain, statement.excluded.retain),
            },
        )
    )


def stored_path_for(digest: str, ext: str) -> str:
    """The path written to referencing rows: ``acceptance/aa/bb/<digest>.<ext>``.

    Nothing on disk any more; the format is kept so old and new rows are
    identical and a rollback stays possible.
    """
    return "/".join((_SUBDIR, digest[:2], digest[2:4], f"{digest}.{ext}"))


def store(db: Session, filename: str, content: bytes) -> dict:
    """Validate and save one upload. Returns the row data for the database.

    Writes in the caller's transaction (``db``) and does not commit: the file
    is kept only if the filing that references it is.
    """
    ext = validate(filename, content)
    digest = hashlib.sha256(content).hexdigest()
    put(db, digest, ext, content, retain=False)
    return {
        "sha256": digest,
        "stored_path": stored_path_for(digest, ext),
        "size_bytes": len(content),
        "extension": ext,
    }


def store_retained(db: Session, ext: str, content: bytes) -> str:
    """Keep a file forever (CPM workbooks). Returns its digest.

    The workbook is validated by the importer, not here: it is an .xlsx or an
    .xls, and it has just been parsed successfully.
    """
    digest = hashlib.sha256(content).hexdigest()
    put(db, digest, ext[:8], content, retain=True)
    return digest


_DIGEST = re.compile(r"^[0-9a-f]{64}$")


def digest_of(stored_path: str) -> str:
    """The SHA-256 a stored path names (its file-name stem)."""
    digest = PurePosixPath((stored_path or "").replace("\\", "/")).stem.lower()
    if not _DIGEST.match(digest):
        raise FileMissing(stored_path)
    return digest


def read_digest(db: Session, digest: str) -> bytes:
    content = db.execute(
        select(StoredFile.content).where(StoredFile.sha256 == digest)
    ).scalar_one_or_none()
    if content is None:
        raise FileMissing(digest)
    return bytes(content)


def read(db: Session, stored_path: str) -> bytes:
    """The bytes of a stored file. Raises :class:`FileMissing` if absent."""
    return read_digest(db, digest_of(stored_path))


# The type each validated extension is served back as. Keyed by what the magic
# bytes proved, so the value never came from the uploader.
_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "eml": "message/rfc822",
    "msg": "application/vnd.ms-outlook",
}

#: How the evidence viewer shows each type (UEP-16): its tag and its renderer.
KIND_PDF = "pdf"
KIND_IMAGE = "image"
KIND_EMAIL = "email"
KIND_FILE = "file"
_KINDS = {
    "pdf": KIND_PDF,
    "jpg": KIND_IMAGE, "jpeg": KIND_IMAGE, "png": KIND_IMAGE, "webp": KIND_IMAGE,
    "eml": KIND_EMAIL, "msg": KIND_EMAIL,
}

#: Served inline (the viewer draws them); everything else downloads.
INLINE_KINDS = frozenset({KIND_PDF, KIND_IMAGE})


def kind_for(stored_path: str) -> str:
    return _KINDS.get(_extension(stored_path), KIND_FILE)


def extension_of(stored_path: str) -> str:
    return _extension(stored_path)


def media_type_for(stored_path: str) -> str:
    """The Content-Type to serve a stored blob as.

    Read from the stored path, whose extension was set by :func:`validate` from
    the file's magic bytes -- never from the Content-Type header the uploader
    supplied.
    """
    return _MEDIA_TYPES.get(_extension(stored_path), "application/octet-stream")
