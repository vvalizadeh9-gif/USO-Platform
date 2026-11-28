"""UEP-29: Admin > Data import -- drive test and acceptance data from Excel.

Every route is behind the ``data_import`` feature (UEP-25): Edit to download a
template, upload, decide, apply and undo; View to read the history and its
files.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import jalali
from app.core.access import Feature as F
from app.core.access import require_access
from app.core.database import get_db
from app.models.reference import User
from app.services import evidence_store
from app.services.data_import import batches, confirm, exports, template, undo

logger = logging.getLogger("uep.data_import")

router = APIRouter(prefix="/data-import", tags=["data-import"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_MB = 20


def _download(content: bytes, filename: str, media_type: str = XLSX) -> Response:
    safe = filename.replace('"', "'")
    return Response(
        content=content, media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


def _refuse(exc: batches.ImportError_):
    raise HTTPException(exc.status, exc.message) from None


def _batch(db: Session, batch_id: int):
    try:
        return batches.get(db, batch_id)
    except batches.ImportError_ as exc:
        _refuse(exc)


@router.get("/template")
def download_template(
    current: int = Query(default=0, ge=0, le=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_access(F.DATA_IMPORT, "edit")),
) -> Response:
    content = template.build(db, user, with_current=bool(current))
    return _download(content, template.filename(jalali.tehran_today()))


@router.post("/batches")
def upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_access(F.DATA_IMPORT, "edit")),
) -> dict:
    filename = file.filename or "upload.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted")
    try:
        content = evidence_store.read_capped(file.file, MAX_MB)
    except evidence_store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from None
    batches.expire_stale(db)
    try:
        batch = batches.preview(db, user, filename, content)
    except batches.ImportError_ as exc:
        db.rollback()
        _refuse(exc)
    db.commit()
    return batches.summary(db, batch)


@router.get("/batches")
def history(
    db: Session = Depends(get_db),
    _: User = Depends(require_access(F.DATA_IMPORT, "view")),
) -> list[dict]:
    if batches.expire_stale(db):
        db.commit()
    return batches.history(db)


@router.get("/batches/{batch_id}")
def batch_summary(
    batch_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_access(F.DATA_IMPORT, "view")),
) -> dict:
    return batches.summary(db, _batch(db, batch_id))


@router.get("/batches/{batch_id}/preview")
def preview(
    batch_id: int,
    tab: str = Query(default="conflicts"),
    field: str | None = Query(default=None, max_length=40),
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1, le=100000),
    db: Session = Depends(get_db),
    _: User = Depends(require_access(F.DATA_IMPORT, "edit")),
) -> dict:
    batch = _batch(db, batch_id)
    try:
        return batches.preview_page(db, batch, tab=tab, field=field, q=q, page=page)
    except batches.ImportError_ as exc:
        _refuse(exc)


class DecisionIn(BaseModel):
    decision: str = Field(pattern="^(keep|file)$")
    change_ids: list[int] | None = Field(default=None, max_length=5000)
    field: str | None = Field(default=None, max_length=40)
    all: bool = False


@router.post("/batches/{batch_id}/decisions")
def decide(
    batch_id: int,
    body: DecisionIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_access(F.DATA_IMPORT, "edit")),
) -> dict:
    batch = _batch(db, batch_id)
    try:
        updated = batches.decide(db, batch, decision=body.decision, change_ids=body.change_ids,
                                 field=body.field, all_conflicts=body.all)
    except batches.ImportError_ as exc:
        _refuse(exc)
    db.commit()
    return {"updated": updated, "decisions": batches.decision_counts(db, batch.id)}


@router.post("/batches/{batch_id}/apply")
def apply(
    batch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_access(F.DATA_IMPORT, "edit")),
) -> dict:
    batch = _batch(db, batch_id)
    try:
        result = confirm.apply(db, batch, user)
        db.commit()
    except batches.ImportError_ as exc:
        db.rollback()
        _refuse(exc)
    except Exception as exc:  # noqa: BLE001 -- one transaction: nothing is applied
        db.rollback()
        logger.exception("data import apply failed", extra={"batch": batch_id})
        raise HTTPException(
            500, f"Nothing was applied: the import failed ({type(exc).__name__}). "
                 "The batch is still in preview; try again or contact support."
        ) from None
    return {**batches.summary(db, batch), "result": result}


@router.post("/batches/{batch_id}/undo")
def undo_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_access(F.DATA_IMPORT, "edit")),
) -> dict:
    batch = _batch(db, batch_id)
    try:
        result = undo.undo(db, batch, user)
        db.commit()
    except batches.ImportError_ as exc:
        db.rollback()
        _refuse(exc)
    return {**batches.summary(db, batch), "result": result}


@router.get("/batches/{batch_id}/errors.xlsx")
def errors_file(
    batch_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_access(F.DATA_IMPORT, "view")),
) -> Response:
    batch = _batch(db, batch_id)
    return _download(exports.errors_file(db, batch), f"UEP_import_{batch.number}_errors.xlsx")


@router.get("/batches/{batch_id}/changes.xlsx")
def changes_file(
    batch_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_access(F.DATA_IMPORT, "view")),
) -> Response:
    batch = _batch(db, batch_id)
    return _download(exports.changes_file(db, batch), f"UEP_import_{batch.number}_changes.xlsx")


@router.get("/batches/{batch_id}/file")
def original_file(
    batch_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_access(F.DATA_IMPORT, "view")),
) -> Response:
    batch = _batch(db, batch_id)
    try:
        content = evidence_store.read_digest(db, batch.file_sha256)
    except evidence_store.FileMissing:
        raise HTTPException(404, "The stored file is missing") from None
    return _download(content, batch.filename)
