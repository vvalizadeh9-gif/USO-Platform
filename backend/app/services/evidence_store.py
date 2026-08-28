"""Content-addressed storage for acceptance evidence.

One ICT letter routinely covers a hundred villages, and each of those is a
separate submission. Storing the upload under a per-submission name would put a
hundred identical copies of the same scan on disk and in every backup. Naming
the file by the SHA-256 of its contents instead means the second and subsequent
uploads of the same document cost one database row and no bytes.

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
from pathlib import Path

from app.core.config import get_settings

# DOCX and XLSX are ZIP containers, so they share the ZIP signature. That means
# a ZIP renamed to .docx passes this check; the point of the check is to stop a
# script or an HTML page being served back to a browser as a document, which it
# does. Deeper validation would mean opening the container, which is not worth
# it for a scan attached to a letter.
_ZIP_MAGIC = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")

# extension -> (human label, accepted magic-byte prefixes)
ALLOWED_TYPES: dict[str, tuple[str, tuple[bytes, ...]]] = {
    "pdf": ("PDF document", (b"%PDF",)),
    "jpg": ("JPEG image", (b"\xff\xd8\xff",)),
    "jpeg": ("JPEG image", (b"\xff\xd8\xff",)),
    "png": ("PNG image", (b"\x89PNG\r\n\x1a\n",)),
    "webp": ("WebP image", (b"RIFF",)),
    "docx": ("Word document", _ZIP_MAGIC),
    "xlsx": ("Excel workbook", _ZIP_MAGIC),
}

# What the upload box tells the user it accepts.
ACCEPTED_EXTENSIONS = sorted(ALLOWED_TYPES)

# Beyond this, a submission is being used as a filing cabinet.
MAX_FILES_PER_SUBMISSION = 10

# Everything lives under this subdirectory of the upload volume.
_SUBDIR = "acceptance"


class EvidenceError(ValueError):
    """An upload that must be refused, with a message safe to show the user."""


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
    if not any(content.startswith(m) for m in magics):
        raise EvidenceError(f"The file does not look like a real {ext.upper()} file")
    # WebP is RIFF....WEBP; RIFF alone is also a WAV or an AVI.
    if ext == "webp" and content[8:12] != b"WEBP":
        raise EvidenceError("The file does not look like a real WEBP file")

    return ext


def store(filename: str, content: bytes) -> dict:
    """Validate and save one upload. Returns the row data for the database.

    Writing is skipped when the blob is already on disk, which is what makes
    the hundredth village on the same letter free.
    """
    ext = validate(filename, content)
    digest = hashlib.sha256(content).hexdigest()

    # Two levels of 256 buckets: no directory ever holds a large fraction of
    # the files, which keeps listing and backing them up cheap.
    relative = os.path.join(_SUBDIR, digest[:2], digest[2:4], f"{digest}.{ext}")
    absolute = Path(get_settings().upload_dir) / relative

    if not absolute.exists():
        absolute.parent.mkdir(parents=True, exist_ok=True)
        # Write beside the target and rename, so a crash mid-write cannot leave
        # a truncated file sitting at a name that says it is complete.
        temporary = absolute.with_suffix(absolute.suffix + ".part")
        temporary.write_bytes(content)
        temporary.replace(absolute)

    return {
        "sha256": digest,
        "stored_path": relative,
        "size_bytes": len(content),
        "extension": ext,
    }


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
}


def media_type_for(stored_path: str) -> str:
    """The Content-Type to serve a stored blob as.

    Read from the stored path, whose extension was set by :func:`validate` from
    the file's magic bytes -- never from the Content-Type header the uploader
    supplied.
    """
    return _MEDIA_TYPES.get(_extension(stored_path), "application/octet-stream")


def absolute_path(stored_path: str) -> Path:
    """Resolve a stored relative path against the upload directory.

    Refuses anything that escapes it. ``stored_path`` comes from our own
    database rather than from a request, but a path-traversal guard on the
    function that opens files is cheap and does not depend on every future
    caller staying careful.
    """
    root = Path(get_settings().upload_dir).resolve()
    candidate = (root / stored_path).resolve()
    if not candidate.is_relative_to(root):
        raise EvidenceError("Invalid evidence path")
    return candidate
