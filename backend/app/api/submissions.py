"""Acceptance > Submissions (UEP-21): DT-done villages sent to ICT HQ.

Every endpoint is scoped by UEP-21 §3.5:

* PM, the owner coordinator and Viewer read every region; any other
  coordinator reads only their own provinces; every other role is a 403
  (the permission map's ``submissions`` area).
* Writes are the PM's and the owner's. Changing the owner is the PM's alone.

Writes are audited. Draft creation locks its villages in one transaction;
marking as sent is idempotent.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit_actions, user_status
from app.core.database import get_db
from app.core.deps import COORDINATOR, get_current_user
from app.core.jalali import parse_day, tehran_today
from app.models.reference import Role, User
from app.models.submission import SubmissionSettings
from app.services import evidence_store
from app.services.audit import record_audit
from app.services.submissions import (
    batches,
    counts,
    excel,
    follow_up,
    past_import,
    ready,
    scope,
    villages,
)

router = APIRouter(prefix="/submissions", tags=["submissions"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MODULE = "Submissions"


def reader(user: User = Depends(get_current_user)) -> User:
    scope.require_read(user)
    return user


def _actor(db: Session, user: User) -> None:
    scope.require_act(db, user)


def _audit(db: Session, user: User, action: str, entity_id: int | None, value: dict,
           entity_type: str = "SubmissionBatch") -> None:
    record_audit(db, user_id=user.id, action=action, module=MODULE,
                 entity_type=entity_type, entity_id=entity_id, new_value=value)


def _person(u: User) -> dict:
    return {"id": u.id, "name": f"{u.first_name} {u.family_name}".strip()}


def _xlsx(content: bytes, name: str) -> Response:
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _day(text: str | None, label: str) -> date | None:
    """A date typed as ISO or Shamsi; the one conversion is core/jalali's."""
    try:
        return parse_day(text)
    except ValueError as exc:
        raise HTTPException(400, f"The {label} is not a valid date: {exc}") from None


def _letter_day(text: str | None, label: str = "letter date") -> date:
    day = _day(text, label)
    if day is None:
        raise HTTPException(400, f"Enter the {label}")
    if day > tehran_today():
        raise HTTPException(400, f"The {label} cannot be in the future")
    return day


def _letter_upload(db: Session, user: User, file: UploadFile | None) -> int | None:
    if file is None or not file.filename:
        return None
    try:
        content = evidence_store.read_capped(file.file)
        return batches.store_letter(db, user, file.filename, content)
    except evidence_store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from None


def _xlsx_upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted")
    try:
        content = evidence_store.read_capped(file.file)
    except evidence_store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from None
    if not content:
        raise HTTPException(400, "The file is empty")
    return content


# ----- Reads ----------------------------------------------------------------


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    return counts.summary(db, user)


@router.get("/ready")
def ready_list(
    reason: str | None = None, since: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(reader),
) -> dict:
    return ready.ready_list(db, user, reason, _day(since, "date"))


@router.get("/villages")
def your_villages(db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    return {"rows": villages.your_villages(db, user)}


@router.get("/batches")
def batch_list(db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    return {"rows": batches.batch_list(db, user)}


@router.get("/batches/{number}")
def batch_detail(number: int, db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    return batches.batch_detail(db, user, batches.get_batch(db, number))


@router.get("/batches/{number}/excel")
def batch_excel(number: int, db: Session = Depends(get_db), user: User = Depends(reader)) -> Response:
    batch = batches.get_batch(db, number)
    ids = batches.batch_village_ids(db, batch)
    return _xlsx(excel.build(db, ids, batch.number), excel.filename(batch.number))


@router.get("/files/{file_id}")
def letter_file(file_id: int, db: Session = Depends(get_db), _: User = Depends(reader)) -> Response:
    record = batches.letter_file(db, file_id)
    path = evidence_store.absolute_path(record.stored_path)
    if not path.exists():
        raise HTTPException(404, "The stored file is missing")
    return Response(
        content=path.read_bytes(),
        media_type=evidence_store.media_type_for(record.stored_path),
        headers={
            "Content-Disposition":
                'attachment; filename="' + record.original_filename.replace('"', "'") + '"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/follow-up")
def follow_up_list(db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    rows = follow_up.late_rows(db, user)
    return {"rows": rows, **follow_up.late_summary(rows)}


@router.get("/follow-up/excel")
def follow_up_excel(db: Session = Depends(get_db), user: User = Depends(reader)) -> Response:
    ids = [r["village_id"] for r in follow_up.late_rows(db, user)]
    name = f"MTN_Irancell_Drive_Test_follow_up_{tehran_today():%Y%m%d}.xlsx"
    return _xlsx(excel.build(db, ids, "FollowUp"), name)


# ----- Batch writes ----------------------------------------------------------


class DraftIn(BaseModel):
    village_ids: list[int] = Field(min_length=1, max_length=5000)


@router.post("/batches", status_code=201)
def create_draft(payload: DraftIn, db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    _actor(db, user)
    batch = batches.create_draft(db, user, payload.village_ids)
    _audit(db, user, audit_actions.CREATED, batch.id,
           {"number": batch.number, "villages": len(payload.village_ids)})
    db.commit()
    return {"number": batch.number}


@router.delete("/batches/{number}/villages/{village_id}")
def remove_village(number: int, village_id: int, db: Session = Depends(get_db),
                   user: User = Depends(reader)) -> dict:
    _actor(db, user)
    batch = batches.get_batch(db, number)
    batches.remove_village(db, batch, village_id)
    _audit(db, user, audit_actions.UPDATED, batch.id, {"removed_village_id": village_id})
    db.commit()
    return {"status": "ok"}


@router.post("/batches/{number}/cancel")
def cancel_draft(number: int, db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    _actor(db, user)
    batch = batches.get_batch(db, number)
    batches.cancel(db, batch)
    _audit(db, user, audit_actions.DELETED, batch.id, {"number": number, "status": "cancelled"})
    db.commit()
    return {"status": "ok"}


@router.post("/batches/{number}/send")
def mark_sent(
    number: int,
    mtn_letter_no: str = Form(..., max_length=120),
    mtn_letter_date: str = Form(...),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db), user: User = Depends(reader),
) -> dict:
    _actor(db, user)
    batch = batches.get_batch(db, number)
    sent_on = _letter_day(mtn_letter_date)
    if batch.status == "sent":
        return {"status": "already_sent", "number": number}
    file_id = _letter_upload(db, user, file)
    batches.mark_sent(db, user, batch, mtn_letter_no, sent_on, file_id)
    _audit(db, user, audit_actions.UPDATED, batch.id,
           {"status": "sent", "mtn_letter_no": mtn_letter_no, "mtn_letter_date": str(sent_on)})
    db.commit()
    return {"status": "sent", "number": number}


@router.post("/batches/{number}/letters/{kind}")
def add_letter(
    number: int, kind: str,
    no: str = Form("", max_length=120),
    letter_date: str = Form(..., alias="date"),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db), user: User = Depends(reader),
) -> dict:
    _actor(db, user)
    batch = batches.get_batch(db, number)
    day = _letter_day(letter_date)
    file_id = _letter_upload(db, user, file)
    batches.add_letter(db, batch, kind, no, day, file_id)
    _audit(db, user, audit_actions.UPDATED, batch.id,
           {f"{kind}_letter_no": no, f"{kind}_letter_date": str(day)})
    db.commit()
    return {"status": "ok"}


# ----- Follow-up writes ------------------------------------------------------


class RaiseIn(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=5000)
    note: str | None = Field(None, max_length=500)


class ResendIn(BaseModel):
    item_ids: list[int] = Field(min_length=1, max_length=5000)


@router.post("/follow-up/raise")
def mark_raised(payload: RaiseIn, db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    _actor(db, user)
    n = follow_up.mark_raised(db, user, payload.item_ids, payload.note)
    _audit(db, user, audit_actions.UPDATED, None,
           {"raised": payload.item_ids, "note": payload.note}, entity_type="SubmissionItem")
    db.commit()
    return {"raised": n}


@router.post("/follow-up/resend")
def send_again(payload: ResendIn, db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    _actor(db, user)
    n = follow_up.send_again(db, payload.item_ids)
    _audit(db, user, audit_actions.UPDATED, None,
           {"send_again": payload.item_ids}, entity_type="SubmissionItem")
    db.commit()
    return {"resent": n}


# ----- Past batches ----------------------------------------------------------


@router.post("/import/preview")
def import_preview(file: UploadFile = File(...), db: Session = Depends(get_db),
                   user: User = Depends(reader)) -> dict:
    _actor(db, user)
    return past_import.preview(db, _xlsx_upload(file), file.filename or "")


@router.post("/import/commit")
def import_commit(
    file: UploadFile = File(...),
    digest: str = Form(...),
    mtn_letter_date: str = Form(...),
    mtn_letter_no: str | None = Form(None, max_length=120),
    number: int | None = Form(None, ge=1),
    db: Session = Depends(get_db), user: User = Depends(reader),
) -> dict:
    _actor(db, user)
    batch, created = past_import.commit(
        db, user, _xlsx_upload(file), file.filename or "", digest,
        _letter_day(mtn_letter_date), mtn_letter_no, number,
    )
    if created:
        _audit(db, user, audit_actions.IMPORTED, batch.id,
               {"number": batch.number, "filename": batch.source_filename})
    db.commit()
    return {"number": batch.number, "created": created}


# ----- Owner ------------------------------------------------------------------


class OwnerIn(BaseModel):
    user_id: int


@router.get("/owner")
def get_owner(db: Session = Depends(get_db), _: User = Depends(reader)) -> dict:
    who = scope.owner(db)
    return {"owner": _person(who) if who else None}


@router.get("/owner/candidates")
def owner_candidates(db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    """Active coordinators the PM may make the owner."""
    scope.require_pm(user)
    rows = db.execute(
        select(User).join(Role, User.role_id == Role.id)
        .where(Role.name == COORDINATOR, User.status == user_status.ACTIVE)
        .order_by(User.first_name, User.family_name)
    ).scalars()
    return {"rows": [_person(u) for u in rows]}


@router.put("/owner")
def set_owner(payload: OwnerIn, db: Session = Depends(get_db), user: User = Depends(reader)) -> dict:
    scope.require_pm(user)
    target = db.get(User, payload.user_id)
    if target is None or target.role.name != COORDINATOR or target.status != user_status.ACTIVE:
        raise HTTPException(400, "The owner must be a coordinator")
    row = scope.settings(db)
    if row is None:
        row = SubmissionSettings(id=scope.SETTINGS_ID)
        db.add(row)
    before = row.owner_user_id
    row.owner_user_id, row.updated_by = target.id, user.id
    record_audit(db, user_id=user.id, action=audit_actions.UPDATED, module=MODULE,
                 entity_type="SubmissionSettings", entity_id=scope.SETTINGS_ID,
                 old_value={"owner_user_id": before}, new_value={"owner_user_id": target.id})
    db.commit()
    return {"owner": _person(target)}
