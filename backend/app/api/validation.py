"""ICT and CRA validation, and the evidence viewer (UEP-16).

Read endpoints for the two validation pages and every way an evidence file
is opened. Deciding stays ``POST /acceptance/letters/review`` (my_work.py).
The rules live in ``acceptance_validation`` and ``email_evidence``; this
module resolves the caller, maps errors and writes the audit row every view
and download leaves.
"""
from __future__ import annotations

import io
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.database import get_db
from app.core.deps import COORDINATOR, PM, require_roles
from app.models.reference import User
from app.services import acceptance_validation as V
from app.services import email_evidence, evidence_store
from app.services.acceptance_letters import normalize_letter_number
from app.services.audit import record_audit

from .my_work import require_worker

router = APIRouter(prefix="/acceptance", tags=["validation"])

require_validator = require_roles(PM, COORDINATOR)


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "errors": []})


def _authority(raw: str) -> str:
    authority = (raw or "").upper().strip()
    if authority not in ("ICT", "CRA"):
        raise _error(400, "invalid_authority", "authority must be ICT or CRA")
    return authority


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except V.ValidationError as exc:
        raise _error(exc.status, exc.code, str(exc)) from None


# --------------------------------------------------------------------------
# The pages
# --------------------------------------------------------------------------
@router.get("/my-work/validation")
def validation_list(
    authority: str = Query(..., description="ICT|CRA"),
    group: str = V.GROUP_LETTER,
    late: bool = False,
    has_rejection: bool = False,
    contractor_id: int | None = None,
    province_id: int | None = None,
    region_id: int | None = None,
    q: str | None = Query(None, max_length=120),
    cursor: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    user: User = Depends(require_validator),
) -> dict:
    """One authority's filings waiting for validation, grouped by letter or
    site. ``counts.waiting`` / ``late`` are the Home queue's own figures."""
    if (province_id is not None or region_id is not None) and user.role.name != PM:
        raise _error(403, "forbidden_filter", "Province and region filters are the PM's")
    result = _run(
        V.list_groups, db, user, _authority(authority), group,
        V.Filters(late=late, has_rejection=has_rejection, contractor_id=contractor_id,
                  province_id=province_id, region_id=region_id, q=q),
        cursor=cursor, limit=limit,
    )
    return {
        "authority": result.authority,
        "group": group,
        "counts": result.counts,
        "groups": result.groups,
        "next_cursor": result.next_cursor,
        "sla_days": result.sla_days,
        "contractors": result.contractors,
        "provinces": result.provinces if user.role.name == PM else [],
        "regions": result.regions if user.role.name == PM else [],
    }


@router.get("/my-work/validation/{group}/{key:path}")
def validation_group(
    group: str,
    key: str,
    authority: str = Query(..., description="ICT|CRA"),
    db: Session = Depends(get_db),
    user: User = Depends(require_validator),
) -> dict:
    """One letter's filings, or one site's for both authorities (kept apart)."""
    return _run(V.group_detail, db, user, _authority(authority), group, key)


# --------------------------------------------------------------------------
# Evidence
# --------------------------------------------------------------------------
def _audit(db: Session, user: User, action: str, record, submission, extra: dict | None = None) -> None:
    record_audit(
        db, user_id=user.id, action=action, module="Acceptance",
        entity_type="AcceptanceEvidence", entity_id=record.id if record else None,
        new_value={
            "filename": record.original_filename if record else None,
            "authority": submission.authority if submission else None,
            "letter_number": submission.letter_number if submission else None,
            **(extra or {}),
        },
    )
    db.commit()


def _disposition(kind: str, filename: str) -> str:
    safe = filename.replace('"', "'").replace("\r", "").replace("\n", "")
    return f'{kind}; filename="{safe}"'


def _file_headers(filename: str, *, inline: bool) -> dict[str, str]:
    """A file's headers. A download is also sandboxed, so even opened by hand it
    can run nothing; an inline PDF is left to the browser's viewer (nginx's
    evidence-frame.conf lets the viewer frame it), its type proven by magic
    bytes and pinned by nosniff."""
    headers = {
        "Content-Disposition": _disposition("inline" if inline else "attachment", filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    }
    if not inline:
        headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return headers


def _bytes(record) -> bytes:
    path = evidence_store.absolute_path(record.stored_path)
    if not path.exists():
        raise _error(404, "missing_file", "The stored file is missing")
    return path.read_bytes()


def _serve(record, *, inline: bool) -> Response:
    # The type comes from the extension the magic bytes were checked against,
    # never from what the uploader sent; nosniff keeps the browser to it.
    shown = inline and evidence_store.kind_for(record.stored_path) in evidence_store.INLINE_KINDS
    return Response(
        content=_bytes(record),
        media_type=evidence_store.media_type_for(record.stored_path),
        headers=_file_headers(record.original_filename, inline=shown),
    )


@router.get("/my-work/evidence/{evidence_id}")
def evidence_view(
    evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_worker),
) -> Response:
    """One file for the viewer: inline for a PDF or an image, else a download."""
    record, submission = _run(V.evidence_record, db, user, evidence_id)
    response = _serve(record, inline=True)
    _audit(db, user, audit_actions.EVIDENCE_VIEWED, record, submission)
    return response


@router.get("/my-work/evidence/{evidence_id}/download")
def evidence_download(
    evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_worker),
) -> Response:
    record, submission = _run(V.evidence_record, db, user, evidence_id)
    response = _serve(record, inline=False)
    _audit(db, user, audit_actions.EVIDENCE_DOWNLOADED, record, submission)
    return response


def _parsed(record) -> email_evidence.ParsedEmail:
    if evidence_store.kind_for(record.stored_path) != evidence_store.KIND_EMAIL:
        raise _error(400, "not_email", "This file is not an email")
    try:
        return email_evidence.parse(record.stored_path, _bytes(record))
    except email_evidence.EmailError as exc:
        raise _error(422, "email_unreadable", str(exc)) from None


@router.get("/my-work/evidence/{evidence_id}/email")
def evidence_email(
    evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_worker),
) -> dict:
    """The email's headers, its plain-text body and its attachments. Never
    its HTML: an HTML-only body arrives converted to text."""
    record, submission = _run(V.evidence_record, db, user, evidence_id)
    parsed = _parsed(record)
    _audit(db, user, audit_actions.EVIDENCE_VIEWED, record, submission)
    return {
        "from": parsed.sender, "to": parsed.to, "cc": parsed.cc,
        "date": parsed.date, "subject": parsed.subject,
        "text_body": parsed.text_body,
        "attachments": [
            {"index": a.index, "filename": a.filename, "content_type": a.content_type,
             "size_bytes": a.size_bytes, "kind": a.kind}
            for a in parsed.attachments
        ],
    }


@router.get("/my-work/evidence/{evidence_id}/email/attachments/{index}")
def evidence_email_attachment(
    evidence_id: int, index: int, download: bool = False,
    db: Session = Depends(get_db), user: User = Depends(require_worker),
) -> Response:
    """One attachment. A PDF or an image whose bytes prove it may open inline;
    anything else is a download of opaque bytes."""
    record, submission = _run(V.evidence_record, db, user, evidence_id)
    attachments = _parsed(record).attachments
    if not 0 <= index < len(attachments):
        raise _error(404, "not_found", "Attachment not found")
    attachment = attachments[index]
    inline = not download and attachment.kind in evidence_store.INLINE_KINDS
    _audit(
        db, user,
        audit_actions.EVIDENCE_VIEWED if inline else audit_actions.EVIDENCE_DOWNLOADED,
        record, submission, {"attachment": attachment.filename},
    )
    return Response(
        content=attachment.data,
        media_type=email_evidence.served_type(attachment),
        headers=_file_headers(attachment.filename, inline=inline),
    )


def _zip_name(authority: str, letter_number: str) -> str:
    base = evidence_store.safe_filename(f"{authority}-{letter_number}".replace("/", "-"))
    return f"{base}.zip"


@router.get("/my-work/letters/evidence.zip")
def letter_evidence_zip(
    authority: str = Query(...), letter_number: str = Query(..., max_length=120),
    db: Session = Depends(get_db), user: User = Depends(require_worker),
) -> Response:
    """Every file of one letter, once each, as one zip named after it."""
    authority = _authority(authority)
    number = normalize_letter_number(letter_number)
    files = V.letter_files(db, user, authority, number)
    if not files:
        raise _error(404, "not_found", "No evidence on this letter")
    buffer = io.BytesIO()
    names: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for record in files:
            name = evidence_store.safe_filename(record.original_filename)
            stem, dot, ext = name.rpartition(".")
            n = 1
            while name in names:
                n += 1
                name = f"{stem}-{n}.{ext}" if dot else f"{name}-{n}"
            names.add(name)
            archive.writestr(name, _bytes(record))
    record_audit(
        db, user_id=user.id, action=audit_actions.EVIDENCE_DOWNLOADED, module="Acceptance",
        entity_type="AcceptanceEvidence", entity_id=None,
        new_value={"authority": authority, "letter_number": number,
                   "evidence_ids": [f.id for f in files], "zip": True},
    )
    db.commit()
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": _disposition("attachment", _zip_name(authority, number))},
    )
