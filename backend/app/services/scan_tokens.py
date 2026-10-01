"""A scanned letter uploaded once, referenced by a signed token.

My Work uploads the scan as soon as it is attached, before the letter is
sent, and the letter then names it by ``scan_id``. Nothing is written to the
database until the letter is filed: the file goes into the content-addressed
store (``evidence_store``), and the token carries what an evidence row needs,
signed so it cannot be forged or pointed at somebody else's file.

A token is valid for :data:`TTL` and only for the user it was issued to. An
upload that is never sent leaves one blob behind -- content-addressed, so a
re-attached copy costs nothing -- which a cleanup job can sweep later.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

from app.core.config import get_settings
from app.services import evidence_store

TTL = timedelta(hours=24)


class ScanError(ValueError):
    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Scan:
    sha256: str
    stored_path: str
    filename: str
    content_type: str
    size_bytes: int
    uploaded_by: int
    expires_at: str  # ISO 8601, UTC


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(body: str) -> str:
    key = get_settings().scan_key.encode()
    return _b64(hmac.new(key, body.encode(), hashlib.sha256).digest())


def issue(filename: str, content: bytes, *, user_id: int, now: datetime | None = None) -> tuple[str, Scan]:
    """Store an upload and return ``(scan_id, scan)``. Raises EvidenceError."""
    stored = evidence_store.store(filename, content)
    now = now or datetime.now(timezone.utc)
    scan = Scan(
        sha256=stored["sha256"],
        stored_path=stored["stored_path"],
        filename=evidence_store.safe_filename(filename)[:255],
        content_type=evidence_store.media_type_for(stored["stored_path"]),
        size_bytes=stored["size_bytes"],
        uploaded_by=user_id,
        expires_at=(now + TTL).isoformat(),
    )
    body = _b64(json.dumps(asdict(scan), separators=(",", ":")).encode())
    return f"{body}.{_sign(body)}", scan


def redeem(scan_id: str | None, *, user_id: int, now: datetime | None = None) -> Scan:
    """The scan a token names, if it is genuine, unexpired and this user's."""
    if not scan_id:
        raise ScanError("A scanned letter is required", "scan_missing")
    try:
        body, signature = scan_id.split(".", 1)
        if not hmac.compare_digest(signature, _sign(body)):
            raise ValueError
        scan = Scan(**json.loads(_unb64(body)))
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        raise ScanError("The scanned letter could not be found", "scan_missing") from None
    if scan.uploaded_by != user_id:
        raise ScanError("The scanned letter could not be found", "scan_missing")
    now = now or datetime.now(timezone.utc)
    if datetime.fromisoformat(scan.expires_at) <= now:
        raise ScanError("The scanned letter expired; attach it again", "scan_expired")
    return scan
