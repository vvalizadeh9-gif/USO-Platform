"""The read-only coordinator's "Your villages" list (UEP-21 §4.8): every
drive-tested village in their regions and where it stands."""
from __future__ import annotations

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.mojri import MojriTrackerStatus
from app.models.reference import User
from app.models.submission import BATCH_SENT, SubmissionBatch, SubmissionItem
from app.models.workitem import Village
from app.services.submissions import follow_up, scope

IN_DRAFT, READY, WAITING, IN_MOJRI, LATE = "in_draft", "ready", "waiting", "in_mojri", "follow_up"
MAX_ROWS = 2000


def _status(r, c: follow_up.MojriClock) -> tuple[str, int | None]:
    if r.item_id is None:
        return READY, None
    if r.sent_at is None:
        return IN_DRAFT, None
    if r.confirmed:
        return IN_MOJRI, None
    waited = (c.today - r.sent_at).days
    if c.cutoff is not None and r.sent_at <= c.cutoff:
        return LATE, waited
    return WAITING, waited


def your_villages(db: Session, user: User) -> list[dict]:
    c = follow_up.clock(db)
    stmt = (
        scope.village_select(
            SubmissionItem.id.label("item_id"), SubmissionItem.sent_at,
            SubmissionBatch.number, SubmissionBatch.status.label("batch_status"),
            SubmissionBatch.mtn_letter_date,
            func.coalesce(follow_up.in_mojri(), False).label("confirmed"),
        )
        .outerjoin(SubmissionItem, and_(
            SubmissionItem.village_id == Village.id, SubmissionItem.superseded_at.is_(None)
        ))
        .outerjoin(SubmissionBatch, SubmissionItem.batch_id == SubmissionBatch.id)
        .outerjoin(MojriTrackerStatus, MojriTrackerStatus.village_id == Village.id)
        .where(scope.universe(db))
        .order_by(scope.VILLAGE_COLUMNS[5], Village.village_code)
        .limit(MAX_ROWS)
    )
    rows = []
    for r in db.execute(scope.in_scope(stmt, db, user)).all():
        status, days = _status(r, c)
        rows.append({
            "village_id": r.village_id, "site_code": r.site_code, "site_type": r.site_type,
            "village_code": r.village_code, "village_name": r.village_name,
            "province": r.province, "cra_region": r.cra_region,
            "status": status, "days": days, "batch_number": r.number,
            "outside_uep": r.item_id is not None and r.number is None,
            "mtn_letter_date": r.mtn_letter_date if r.batch_status == BATCH_SENT else None,
            "sent_at": r.sent_at,
        })
    return rows
