"""The single source for every Submissions number (UEP-21 §5.2).

The view tiles, the side panel, the Acceptance rail badge and Home's two
queues all read from here, so the same village is never counted two ways. A
test holds ``/me/home``, ``/submissions/summary`` and the rail equal.
"""
from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.reference import User
from app.models.submission import BATCH_SENT, SubmissionBatch, SubmissionItem
from app.services import kpi, sla_policy
from app.services.action_queues.types import PendingItem
from app.services.submissions import batches, follow_up, ready, scope

CYCLE_STEP = "submit_cycle"


def cycle(db: Session, today: date) -> dict:
    """The two-week routine: day x of the cycle since the last batch went."""
    days = sla_policy.get_days(db, CYCLE_STEP)
    last = batches.last_sent(db)
    last_date = last.mtn_letter_date if last else None
    day = (today - last_date).days if last_date else None
    return {
        "days": days,
        "next_number": batches.next_number(db),
        "last_number": last.number if last else None,
        "last_date": last_date,
        "day": day,
        "due_in": (days - day) if day is not None else None,
    }


def _sent_split(db: Session, user: User, c: follow_up.MojriClock) -> dict:
    """In Mojri / waiting / late over every active sent item in scope."""
    stmt = follow_up.item_select(
        func.coalesce(follow_up.in_mojri(), False).label("confirmed"),
        func.coalesce(follow_up.late_condition(c), False).label("late"),
    ).where(follow_up.is_sent())
    out = {"in_mojri": 0, "waiting": 0, "late": 0}
    for confirmed, late in db.execute(scope.in_scope(stmt, db, user)).all():
        out["in_mojri" if confirmed else "late" if late else "waiting"] += 1
    return out


def _regions(db: Session, user: User) -> list[str]:
    ids = scope.province_ids(db, user)
    if ids is None:
        return []
    from app.models.reference import Province

    names = list(db.execute(select(Province.name).where(Province.id.in_(ids))).scalars())
    return kpi._regions_for(db, names)


def _sent_batches(db: Session) -> int:
    return db.execute(
        select(func.count(SubmissionBatch.id)).where(SubmissionBatch.status == BATCH_SENT)
    ).scalar() or 0


def _in_draft(db: Session, user: User) -> int:
    stmt = follow_up.item_select(func.count(SubmissionItem.id)).where(
        SubmissionItem.superseded_at.is_(None), SubmissionItem.sent_at.is_(None)
    )
    return db.execute(scope.in_scope(stmt, db, user)).scalar() or 0


def summary(db: Session, user: User, today: date | None = None) -> dict:
    today = today or jalali.tehran_today()
    c = follow_up.clock(db, today)
    villages = ready.ready_villages(db, user)
    late = follow_up.late_summary(follow_up.late_rows(db, user, c))
    split = _sent_split(db, user, c)
    who = scope.owner(db)
    return {
        "ready": {
            "villages": len(villages),
            "sites": len({v.work_item_id for v in villages}),
            "reasons": ready.reason_counts(villages),
        },
        "batches": {"sent": _sent_batches(db), "waiting": split["waiting"]},
        "follow_up": late,
        "mojri": {
            "in_mojri": split["in_mojri"], "waiting": split["waiting"], "late": split["late"],
            "as_of": c.file_date, "age_days": c.age_days, "stale": c.stale,
            "follow_up_days": c.days,
        },
        "in_draft": _in_draft(db, user),
        "cycle": cycle(db, today),
        "owner": {"id": who.id, "name": who.first_name} if who else None,
        "can_act": scope.can_act(db, user),
        "is_pm": scope.is_pm(user),
        "view_only": not scope.can_act(db, user),
        "scoped": scope.province_ids(db, user) is not None,
        "regions": _regions(db, user),
    }


# ----- Home (the owner and the PM only) ------------------------------------


def _start(day: date | None) -> datetime | None:
    if day is None:
        return None
    return datetime.combine(day, time.min, tzinfo=jalali.TEHRAN)


def submit_items(db: Session, user: User) -> list[PendingItem]:
    """Ready villages, each clocked from the last batch's letter date, so the
    queue turns late exactly when the cycle does."""
    if not scope.can_act(db, user):
        return []
    last = batches.last_sent(db)
    start = _start(last.mtn_letter_date if last else None)
    return [PendingItem(v.village_id, start) for v in ready.ready_villages(db, user)]


def follow_up_items(db: Session, user: User) -> list[PendingItem]:
    if not scope.can_act(db, user):
        return []
    return [
        PendingItem(r["item_id"], _start(r["sent_at"]))
        for r in follow_up.late_rows(db, user)
    ]


def home_meta(db: Session, user: User, today: date | None = None) -> dict:
    """What Home's two rows say beside their counts."""
    today = today or jalali.tehran_today()
    acts = scope.can_act(db, user)
    villages = ready.ready_villages(db, user) if acts else []
    late = follow_up.late_summary(follow_up.late_rows(db, user) if acts else [])
    cyc = cycle(db, today)
    return {
        "next_number": cyc["next_number"],
        "due_in": cyc["due_in"],
        "sites": len({v.work_item_id for v in villages}),
        "oldest_days": late.get("oldest_days"),
    }

