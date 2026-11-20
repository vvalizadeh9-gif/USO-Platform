"""What a Mojri import does to Submissions (UEP-21 §5.7).

Runs after the tracker statuses are written, inside the same transaction:

* every **sent** item whose village now reads in Mojri gets
  ``mojri_confirmed_at`` (this is what closes a follow-up -- there is no
  manual resolve);
* every village in Mojri with **no active item** gets one with no batch,
  reason ``outside``, source ``mojri``, sent on the file's date: ICT HQ has it,
  so it was sent, just not through UEP.

The preview reports both counts before anything is written. Never touches
acceptance.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.submission import (
    REASON_OUTSIDE,
    SOURCE_MOJRI,
    SubmissionItem,
)
from app.models.workitem import Village, WorkItem
from app.services.submissions import follow_up


def _active_items(db: Session, village_ids: set[int]) -> dict[int, SubmissionItem]:
    if not village_ids:
        return {}
    rows = db.execute(
        select(SubmissionItem).where(
            SubmissionItem.village_id.in_(village_ids), SubmissionItem.superseded_at.is_(None)
        )
    ).scalars()
    return {item.village_id: item for item in rows}


def _late_ids(db: Session) -> set[int]:
    c = follow_up.clock(db)
    return set(
        db.execute(follow_up.item_select(SubmissionItem.id).where(follow_up.late_condition(c))).scalars()
    )


def effects(db: Session, in_mojri_ids: set[int]) -> dict:
    """The preview's two lines, for villages the file reads as in Mojri."""
    active = _active_items(db, in_mojri_ids)
    late = _late_ids(db)
    return {
        "follow_ups_closed": sum(1 for item in active.values() if item.id in late),
        "outside_uep": len(in_mojri_ids - set(active)),
    }


def apply(db: Session, in_mojri_ids: set[int], file_date: date) -> dict:
    active = _active_items(db, in_mojri_ids)
    confirmed = 0
    for item in active.values():
        if item.sent_at is not None and item.mojri_confirmed_at is None:
            item.mojri_confirmed_at = file_date
            confirmed += 1
    outside = in_mojri_ids - set(active)
    villages = db.execute(
        select(Village)
        .where(Village.id.in_(outside))
        .options(selectinload(Village.work_item).selectinload(WorkItem.site))
    ).scalars() if outside else []
    for village in villages:
        wi = village.work_item
        db.add(SubmissionItem(
            batch_id=None, village_id=village.id,
            site_code=wi.site.site_code if wi and wi.site else None,
            site_type=wi.site_type if wi else None, village_code=village.village_code,
            reason=REASON_OUTSIDE, source=SOURCE_MOJRI,
            sent_at=file_date, mojri_confirmed_at=file_date,
        ))
    db.flush()
    return {"confirmed": confirmed, "outside_uep": len(outside)}
