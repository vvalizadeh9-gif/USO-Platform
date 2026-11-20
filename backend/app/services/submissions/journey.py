"""Explorer's "Sent to ICT" step (UEP-21 §5.9): what went, when, and whether
ICT HQ's Mojri tracker has it yet. One entry per batch the site's villages
went in (or one "sent outside UEP" entry), earliest first."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.submission import SubmissionBatch, SubmissionItem
from app.models.workitem import Village
from app.services.submissions import follow_up


def _letter(batch: SubmissionBatch | None, kind: str) -> dict | None:
    if batch is None:
        return None
    no, when = getattr(batch, f"{kind}_letter_no"), getattr(batch, f"{kind}_letter_date")
    return {"no": no, "date": when} if (no or when) else None


def site_sends(db: Session, work_item_id: int) -> list[dict]:
    stmt = (
        follow_up.item_select(
            SubmissionItem.batch_id,
            func.min(SubmissionItem.sent_at).label("sent_at"),
            func.count(SubmissionItem.id).label("villages"),
            func.min(SubmissionItem.mojri_confirmed_at).label("first_confirmed"),
            func.count(SubmissionItem.mojri_confirmed_at).label("confirmed"),
        )
        .where(Village.work_item_id == work_item_id, follow_up.is_sent())
        .group_by(SubmissionItem.batch_id)
    )
    out = []
    for r in db.execute(stmt).all():
        batch = db.get(SubmissionBatch, r.batch_id) if r.batch_id else None
        out.append({
            "batch_number": batch.number if batch else None,
            "outside_uep": batch is None,
            "sent_at": r.sent_at,
            "villages": r.villages,
            "mtn": _letter(batch, "mtn"),
            "ict": _letter(batch, "ict"),
            "cra": _letter(batch, "cra"),
            "in_mojri_since": r.first_confirmed if r.confirmed == r.villages else None,
            "in_mojri": r.confirmed,
        })
    out.sort(key=lambda s: s["sent_at"] or date.max)
    return out


def first_sent(sends: list[dict]) -> date | None:
    return sends[0]["sent_at"] if sends else None
