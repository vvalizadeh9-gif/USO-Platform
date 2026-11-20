"""Batches: create a draft, edit it, cancel it, mark it sent, add letters.

* **Draft** locks its villages: each gets an active item, and the partial
  unique index refuses a village already in another draft or already sent.
  Creating a draft is one transaction; a lost race is a 409.
* **Remove** deletes one draft item. **Cancel** supersedes them all, which
  releases the villages back to Ready.
* **Mark as sent** records the MTN letter and stamps every item with its date.
  Idempotent: a second call on a sent batch changes nothing.
* **Optional letters** (ICT HQ -> provinces + CRA, CRA HQ -> regions) can be
  added to a sent batch at any time. They never age and never warn.
* The next number is the highest live (not cancelled) number plus one.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.reference import User
from app.models.submission import (
    BATCH_CANCELLED,
    BATCH_DRAFT,
    BATCH_SENT,
    REASON_RESEND,
    SOURCE_BATCH,
    SubmissionBatch,
    SubmissionItem,
    SubmissionLetterFile,
)
from app.models.workitem import WorkItem
from app.services import evidence_store
from app.services.submissions import follow_up, ready, scope

#: Letter scans: PDF or an image, checked by magic bytes in the evidence store.
LETTER_TYPES = frozenset({"pdf", "jpg", "jpeg", "png", "webp"})
OPTIONAL_LETTERS = ("ict", "cra")

STATUS_DRAFT = "draft"
STATUS_SENT = "sent"
STATUS_FOLLOW_UP = "follow_up"
STATUS_CLOSED = "closed"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def next_number(db: Session) -> int:
    top = db.execute(
        select(func.max(SubmissionBatch.number)).where(SubmissionBatch.status != BATCH_CANCELLED)
    ).scalar()
    return (top or 0) + 1


def get_batch(db: Session, number: int) -> SubmissionBatch:
    batch = db.execute(
        select(SubmissionBatch).where(
            SubmissionBatch.number == number, SubmissionBatch.status != BATCH_CANCELLED
        )
    ).scalar_one_or_none()
    if batch is None:
        raise HTTPException(404, "Batch not found")
    return batch


def last_sent(db: Session) -> SubmissionBatch | None:
    return db.execute(
        select(SubmissionBatch)
        .where(SubmissionBatch.status == BATCH_SENT)
        .order_by(SubmissionBatch.mtn_letter_date.desc().nullslast(), SubmissionBatch.number.desc())
        .limit(1)
    ).scalar_one_or_none()


# ----- Draft ----------------------------------------------------------------


def _resend_sources(db: Session, village_ids: list[int]) -> dict[int, SubmissionItem]:
    """The superseded sent item each re-sent village points back to."""
    rows = db.execute(
        select(SubmissionItem)
        .where(
            SubmissionItem.village_id.in_(village_ids),
            SubmissionItem.superseded_at.isnot(None),
            SubmissionItem.sent_at.isnot(None),
            SubmissionItem.superseded_by_id.is_(None),
        )
        .order_by(SubmissionItem.superseded_at)
    ).scalars()
    return {item.village_id: item for item in rows}


def create_draft(db: Session, user: User, village_ids: list[int]) -> SubmissionBatch:
    wanted = list(dict.fromkeys(village_ids))
    if not wanted:
        raise HTTPException(400, "Select at least one village")
    available = {v.village_id: v for v in ready.ready_villages(db, user)}
    locked = [vid for vid in wanted if vid not in available]
    if locked:
        raise HTTPException(
            409, f"{len(locked)} of the selected villages are no longer ready. Refresh and try again."
        )
    batch = SubmissionBatch(number=next_number(db), status=BATCH_DRAFT, created_by=user.id)
    db.add(batch)
    sources = _resend_sources(db, wanted)
    try:
        db.flush()
        for vid in wanted:
            v = available[vid]
            item = SubmissionItem(
                batch_id=batch.id, village_id=vid, site_code=v.site_code,
                site_type=v.site_type, village_code=v.village_code,
                reason=v.reason, source=SOURCE_BATCH,
            )
            db.add(item)
            if v.reason == REASON_RESEND and vid in sources:
                db.flush()
                sources[vid].superseded_by_id = item.id
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Someone else locked some of these villages. Refresh and try again.") from None
    return batch


def _require_status(batch: SubmissionBatch, status: str, message: str) -> None:
    if batch.status != status:
        raise HTTPException(409, message)


def remove_village(db: Session, batch: SubmissionBatch, village_id: int) -> None:
    _require_status(batch, BATCH_DRAFT, "Only a draft can be edited")
    item = db.execute(
        select(SubmissionItem).where(
            SubmissionItem.batch_id == batch.id, SubmissionItem.village_id == village_id
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(404, "That village is not in this draft")
    _unlink_resend(db, item)
    db.delete(item)
    db.flush()


def _unlink_resend(db: Session, item: SubmissionItem) -> None:
    """A removed or cancelled re-send frees its source to be re-sent again."""
    db.execute(
        SubmissionItem.__table__.update()
        .where(SubmissionItem.superseded_by_id == item.id)
        .values(superseded_by_id=None)
    )


def cancel(db: Session, batch: SubmissionBatch) -> None:
    _require_status(batch, BATCH_DRAFT, "Only a draft can be cancelled")
    now = _now()
    for item in batch.items:
        _unlink_resend(db, item)
        item.superseded_at = now
    batch.status = BATCH_CANCELLED
    db.flush()


# ----- Letters --------------------------------------------------------------


def store_letter(db: Session, user: User, filename: str, content: bytes) -> int:
    ext = evidence_store.validate(filename, content)
    if ext not in LETTER_TYPES:
        raise evidence_store.EvidenceError("Attach the letter as a PDF or an image")
    stored = evidence_store.store(filename, content)
    row = SubmissionLetterFile(
        sha256=stored["sha256"], stored_path=stored["stored_path"],
        original_filename=evidence_store.safe_filename(filename),
        size_bytes=stored["size_bytes"], uploaded_by=user.id,
    )
    db.add(row)
    db.flush()
    return row.id


def mark_sent(
    db: Session, user: User, batch: SubmissionBatch,
    letter_no: str, letter_date: date, file_id: int | None,
) -> bool:
    """Returns False when the batch was already sent (nothing changed)."""
    if batch.status == BATCH_SENT:
        return False
    _require_status(batch, BATCH_DRAFT, "Only a draft can be sent")
    if not batch.items:
        raise HTTPException(409, "This draft has no villages")
    if not (letter_no or "").strip():
        raise HTTPException(400, "Enter the MTN letter number")
    batch.status = BATCH_SENT
    batch.sent_at = _now()
    batch.mtn_letter_no = letter_no.strip()[:120]
    batch.mtn_letter_date = letter_date
    batch.mtn_letter_file_id = file_id or batch.mtn_letter_file_id
    for item in batch.items:
        item.sent_at = letter_date
    db.flush()
    return True


def add_letter(
    db: Session, batch: SubmissionBatch, kind: str,
    letter_no: str, letter_date: date, file_id: int | None,
) -> None:
    if kind not in OPTIONAL_LETTERS:
        raise HTTPException(404, "Unknown letter")
    _require_status(batch, BATCH_SENT, "Letters are added to a sent batch")
    setattr(batch, f"{kind}_letter_no", (letter_no or "").strip()[:120] or None)
    setattr(batch, f"{kind}_letter_date", letter_date)
    if file_id:
        setattr(batch, f"{kind}_letter_file_id", file_id)
    db.flush()


def letter_file(db: Session, file_id: int) -> SubmissionLetterFile:
    row = db.get(SubmissionLetterFile, file_id)
    if row is None:
        raise HTTPException(404, "File not found")
    return row


# ----- Reads ----------------------------------------------------------------


def _letters(batch: SubmissionBatch) -> dict:
    return {
        kind: {
            "no": getattr(batch, f"{kind}_letter_no"),
            "date": getattr(batch, f"{kind}_letter_date"),
            "file_id": getattr(batch, f"{kind}_letter_file_id"),
        }
        for kind in ("mtn", "ict", "cra")
    }


def display_status(batch: SubmissionBatch, split: dict | None) -> str:
    if batch.status == BATCH_DRAFT:
        return STATUS_DRAFT
    if split and split["follow_up"]:
        return STATUS_FOLLOW_UP
    if split and not split["waiting"] and split["in_mojri"]:
        return STATUS_CLOSED
    return STATUS_SENT


def _item_counts(db: Session, user: User, batch_ids: list[int]) -> dict[int, dict]:
    """Villages and sites per batch, inside the user's scope."""
    if not batch_ids:
        return {}
    stmt = follow_up.item_select(SubmissionItem.batch_id, WorkItem.id).where(
        SubmissionItem.batch_id.in_(batch_ids)
    )
    out: dict[int, dict] = {bid: {"villages": 0, "sites": set()} for bid in batch_ids}
    for batch_id, work_item_id in db.execute(scope.in_scope(stmt, db, user)).all():
        out[batch_id]["villages"] += 1
        out[batch_id]["sites"].add(work_item_id)
    return {bid: {"villages": c["villages"], "sites": len(c["sites"])} for bid, c in out.items()}


def batch_list(db: Session, user: User) -> list[dict]:
    batches = list(
        db.execute(
            select(SubmissionBatch)
            .where(SubmissionBatch.status != BATCH_CANCELLED)
            .order_by(SubmissionBatch.number.desc())
        ).scalars()
    )
    ids = [b.id for b in batches]
    c = follow_up.clock(db)
    splits = follow_up.mojri_split(db, ids, c)
    counts = _item_counts(db, user, ids)
    rows = []
    for b in batches:
        split = splits.get(b.id) if b.status == BATCH_SENT else None
        letters = _letters(b)
        rows.append({
            "number": b.number, "status": display_status(b, split), "imported": b.imported,
            "mtn_letter_date": b.mtn_letter_date, "letters": letters,
            "letters_recorded": sum(1 for v in letters.values() if v["no"] or v["date"]),
            "mojri": split, **counts.get(b.id, {"villages": 0, "sites": 0}),
        })
    return rows


def batch_detail(db: Session, user: User, batch: SubmissionBatch) -> dict:
    c = follow_up.clock(db)
    stmt = follow_up.item_select(
        SubmissionItem.id, SubmissionItem.reason, SubmissionItem.superseded_at,
        SubmissionItem.mojri_confirmed_at,
        func.coalesce(follow_up.in_mojri(), False).label("confirmed"),
        func.coalesce(follow_up.late_condition(c), False).label("late"),
        *scope.VILLAGE_COLUMNS,
    ).where(SubmissionItem.batch_id == batch.id)
    rows = db.execute(scope.in_scope(stmt, db, user)).all()
    villages = [_village(r, batch) for r in rows]
    villages.sort(key=lambda v: (v["site_code"] or "", v["village_code"] or ""))
    split = follow_up.mojri_split(db, [batch.id], c).get(batch.id) if batch.status == BATCH_SENT else None
    regions = Counter(v["cra_region"] or "—" for v in villages)
    return {
        "number": batch.number, "status": display_status(batch, split),
        "imported": batch.imported, "sent_at": batch.sent_at,
        "letters": _letters(batch), "mojri": split,
        "villages_count": len(villages),
        "sites_count": len({v["work_item_id"] for v in villages}),
        "regions": [{"name": k, "count": n} for k, n in regions.most_common()],
        "days_since_sent": (c.today - batch.mtn_letter_date).days if batch.mtn_letter_date else None,
        "follow_up_days": c.days,
        "excel_filename": _excel_name(batch),
        "villages": villages,
    }


def _excel_name(batch: SubmissionBatch) -> str:
    from app.services.submissions.excel import filename

    return filename(batch.number)


def _village(r, batch: SubmissionBatch) -> dict:
    if batch.status != BATCH_SENT:
        mojri = None
    elif r.superseded_at is not None:
        mojri = "resent"
    elif r.confirmed:
        mojri = "in_mojri"
    elif r.late:
        mojri = "follow_up"
    else:
        mojri = "waiting"
    return {
        "item_id": r.id, "village_id": r.village_id, "village_code": r.village_code,
        "village_name": r.village_name, "work_item_id": r.work_item_id,
        "site_code": r.site_code, "site_type": r.site_type, "province": r.province,
        "cra_region": r.cra_region, "reason": r.reason, "mojri": mojri,
    }


def batch_village_ids(db: Session, batch: SubmissionBatch) -> list[int]:
    return list(
        db.execute(select(SubmissionItem.village_id).where(SubmissionItem.batch_id == batch.id)).scalars()
    )


def active_village_ids(db: Session, village_ids: list[int]) -> set[int]:
    if not village_ids:
        return set()
    return set(
        db.execute(
            select(SubmissionItem.village_id).where(
                SubmissionItem.village_id.in_(village_ids), SubmissionItem.superseded_at.is_(None)
            )
        ).scalars()
    )

