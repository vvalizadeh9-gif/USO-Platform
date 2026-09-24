"""Mojri tracker reconciliation endpoints.

Two surfaces, split by role, and the split is the Admin/PM separation of duties
(ARCHITECTURE.md §6) applied to this feature:

* **the template** is a download. It reads data and writes nothing, so Admin
  may take it — that is the one thing Admin does here. PM may take it too,
  because PM runs the reconciliation and would otherwise have to ask an
  administrator for the file before doing their own job.
* **the import** writes operational data, so it is PM's alone. Admin is refused
  it, as Admin is refused every other operational write in this platform.

Coordinator reaches neither.

``preview`` and ``commit`` are separate endpoints on purpose, and ``preview``
writes nothing whatsoever. The file is uploaded twice — once to look at it, once
to apply it — rather than being staged on the server between the two, so an
abandoned preview leaves nothing behind, in the database or on disk. The digest
the preview returns is what ties the two uploads together: ``commit`` refuses a
file that is not the one that was previewed.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.database import get_db
from app.core.deps import ADMIN, PM, require_roles
from app.models.reference import User
from app.services import evidence_store, mojri_tracker
from app.services.audit import record_audit

router = APIRouter(prefix="/mojri", tags=["mojri"])

_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted")
    try:
        content = evidence_store.read_capped(file.file)
    except evidence_store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from None
    if not content:
        raise HTTPException(400, "The file is empty")
    return content


@router.get("/template.xlsx")
def download_template(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN, PM)),
) -> Response:
    """The fill-in template: one row per village we have already approved.

    A read. Admin has no write access to operational data and this performs no
    write — it opens no transaction that changes anything and records nothing.
    """
    content = mojri_tracker.build_template(db)
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{mojri_tracker.template_filename()}"'
            )
        },
    )


@router.post("/import/preview")
def preview_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(PM)),
) -> dict:
    """What confirming this file would do. Nothing is written."""
    content = _upload(file)
    return mojri_tracker.preview(db, content, file.filename or "")


@router.post("/import/commit")
def commit_import(
    file: UploadFile = File(...),
    digest: str = Form(..., description="The digest the preview returned"),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM)),
) -> dict:
    """Apply a previewed file. PM only, and only the file that was previewed."""
    content = _upload(file)
    result = mojri_tracker.commit(db, user, content, file.filename or "", digest)
    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.IMPORTED,
        module="mojri",
        entity_type="mojri_import_run",
        entity_id=result["import_run_id"],
        new_value={
            "filename": result["filename"],
            "matched": result["matched"],
            "unmatched": result["unmatched"],
            "disappeared": result["disappeared_count"],
            "ict": result["authorities"]["ict"],
            "cra": result["authorities"]["cra"],
        },
    )
    db.commit()
    return result
