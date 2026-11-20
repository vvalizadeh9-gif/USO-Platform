"""Mojri confirmation and lateness (UEP-21 §3.4).

* **Sent**: an active item in a sent batch, or recorded as sent outside UEP.
* **In Mojri**: its village reads ``in_tracker`` on the ICT side of Mojri's
  tracker, or a Mojri import already confirmed the item. ``needs_look`` does
  **not** count: it covers a refusal ("no", "رد") as well as an unreadable
  cell, and a refusal is not a receipt (PM decision, UEP-21 review).
* **Late**: sent, not in Mojri, and ``sent_at + mojri_follow_up days`` is on or
  before the **latest Mojri file's date** -- never today. A Mojri file nobody
  has refreshed therefore pauses the count by itself instead of flooding
  Follow up with villages ICT may well have registered.
* **Stale**: today is more than ``mojri_follow_up`` days past that file date.

A village leaves Follow up only when a newer Mojri file shows it, or when it is
marked Send again. There is no manual "resolve".
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.mojri import IN_TRACKER, MojriImportRun, MojriTrackerStatus
from app.models.reference import User
from app.models.submission import BATCH_SENT, SubmissionBatch, SubmissionItem
from app.models.workitem import Village
from app.services import sla_policy
from app.services.submissions import scope

FOLLOW_UP_STEP = "mojri_follow_up"


def follow_up_days(db: Session) -> int:
    return sla_policy.get_days(db, FOLLOW_UP_STEP)


def latest_file_date(db: Session) -> date | None:
    """The newest Mojri file's date; a run without one is dated on its import day."""
    rows = db.execute(select(MojriImportRun.file_date, MojriImportRun.created_at)).all()
    dates = [r.file_date or _day(r.created_at) for r in rows]
    return max(dates) if dates else None


def _day(moment: datetime | None) -> date | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(jalali.TEHRAN).date()


@dataclass(frozen=True)
class MojriClock:
    file_date: date | None
    days: int
    today: date

    @property
    def cutoff(self) -> date | None:
        """Sent on or before this day and still not in Mojri = late."""
        return self.file_date - timedelta(days=self.days) if self.file_date else None

    @property
    def age_days(self) -> int | None:
        return (self.today - self.file_date).days if self.file_date else None

    @property
    def stale(self) -> bool:
        return self.file_date is None or (self.today - self.file_date).days > self.days


def clock(db: Session, today: date | None = None) -> MojriClock:
    return MojriClock(latest_file_date(db), follow_up_days(db), today or jalali.tehran_today())


def is_sent() -> ColumnElement[bool]:
    """An active item that left MTN (sent batch, or found in Mojri)."""
    return (
        SubmissionItem.superseded_at.is_(None)
        & SubmissionItem.sent_at.isnot(None)
        & or_(SubmissionItem.batch_id.is_(None), SubmissionBatch.status == BATCH_SENT)
    )


def in_mojri() -> ColumnElement[bool]:
    """Confirmed by an import, or reading in_tracker now. Expects the item
    outer-joined to ``mojri_tracker_status``."""
    # Coalesced: a village with no tracker row at all must read "not in
    # Mojri", not NULL -- NULL would make NOT in_mojri() NULL too, and the
    # commonest late village would never be counted.
    return or_(
        SubmissionItem.mojri_confirmed_at.isnot(None),
        func.coalesce(MojriTrackerStatus.ict_status, "") == IN_TRACKER,
    )


def item_select(*columns):
    """Items with their batch, village location and Mojri status joined."""
    return scope.located(
        select(*columns)
        .select_from(SubmissionItem)
        .outerjoin(SubmissionBatch, SubmissionItem.batch_id == SubmissionBatch.id)
        .join(Village, SubmissionItem.village_id == Village.id)
        .outerjoin(MojriTrackerStatus, MojriTrackerStatus.village_id == Village.id)
    )


def late_condition(c: MojriClock) -> ColumnElement[bool]:
    if c.cutoff is None:
        return SubmissionItem.id.is_(None)  # no Mojri file yet: nothing is late
    return is_sent() & ~in_mojri() & (SubmissionItem.sent_at <= c.cutoff)


def late_rows(db: Session, user: User, c: MojriClock | None = None) -> list[dict]:
    c = c or clock(db)
    stmt = item_select(
        SubmissionItem.id, SubmissionItem.sent_at, SubmissionItem.raised_at,
        SubmissionItem.raised_note, SubmissionBatch.number,
        *scope.VILLAGE_COLUMNS,
    ).where(late_condition(c)).order_by(SubmissionItem.sent_at, SubmissionItem.id)
    rows = db.execute(scope.in_scope(stmt, db, user)).all()
    return [
        {
            "item_id": r.id, "batch_number": r.number, "village_id": r.village_id,
            "site_code": r.site_code, "site_type": r.site_type,
            "village_code": r.village_code, "village_name": r.village_name,
            "province": r.province, "cra_region": r.cra_region,
            "sent_at": r.sent_at, "waiting_days": (c.today - r.sent_at).days,
            "raised_at": r.raised_at, "raised_note": r.raised_note,
        }
        for r in rows
    ]


def late_summary(rows: list[dict]) -> dict:
    return {
        "late": len(rows),
        "oldest_days": max((r["waiting_days"] for r in rows), default=None),
        "raised": sum(1 for r in rows if r["raised_at"]),
        "not_raised": sum(1 for r in rows if not r["raised_at"]),
    }


def _late_items(db: Session, item_ids: list[int]) -> list[SubmissionItem]:
    """The given items, refusing any that is not late right now."""
    late_ids = set(
        db.execute(
            item_select(SubmissionItem.id).where(
                SubmissionItem.id.in_(item_ids), late_condition(clock(db))
            )
        ).scalars()
    )
    missing = set(item_ids) - late_ids
    if missing:
        raise HTTPException(409, "Some villages are no longer in Follow up. Refresh and try again.")
    return list(db.execute(select(SubmissionItem).where(SubmissionItem.id.in_(item_ids))).scalars())


def mark_raised(db: Session, user: User, item_ids: list[int], note: str | None) -> int:
    now = datetime.now(timezone.utc)
    items = _late_items(db, item_ids)
    for item in items:
        item.raised_at, item.raised_by = now, user.id
        item.raised_note = (note or "").strip()[:500] or None
    db.flush()
    return len(items)


def send_again(db: Session, item_ids: list[int]) -> int:
    """Supersede each late item: the village is Ready again, reason Re-send.
    The old item is kept; the next batch's item points back at it."""
    now = datetime.now(timezone.utc)
    items = _late_items(db, item_ids)
    for item in items:
        item.superseded_at = now
    db.flush()
    return len(items)


def mojri_split(db: Session, batch_ids: list[int], c: MojriClock) -> dict[int, dict]:
    """Per sent batch: in Mojri, waiting, and follow up (late, or sent again)."""
    if not batch_ids:
        return {}
    rows = db.execute(
        item_select(
            SubmissionItem.batch_id, SubmissionItem.superseded_at,
            func.coalesce(in_mojri(), False).label("confirmed"),
            func.coalesce(late_condition(c), False).label("late"),
        ).where(SubmissionItem.batch_id.in_(batch_ids))
    ).all()
    out: dict[int, dict] = {bid: {"in_mojri": 0, "waiting": 0, "follow_up": 0} for bid in batch_ids}
    for r in rows:
        bucket = out[r.batch_id]
        if r.superseded_at is not None:
            bucket["follow_up"] += 1
        elif r.confirmed:
            bucket["in_mojri"] += 1
        elif r.late:
            bucket["follow_up"] += 1
        else:
            bucket["waiting"] += 1
    return out
