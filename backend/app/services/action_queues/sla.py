"""When an item is overdue, and where an undated clock starts.

Data imported from CPM carries no dates from before tracking began on
**1 Mehr 1405**. An item whose clock has no start, or one that started before
then, is measured from that day instead -- the product owner's rule. That is a
read rule, not a backfill: the stored dates are left exactly as they are.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.core.config import get_settings
from app.models.action_center import DEFAULT_SLA_DAYS, ActionQueueSla
from app.services.action_queues.types import PendingItem, SlaKind

TEHRAN = jalali.TEHRAN

#: 1 Mehr 1405, midnight in Tehran.
TRACKING_EPOCH_SHAMSI = (1405, 7, 1)
_epoch_day = jalali.from_shamsi_date(*TRACKING_EPOCH_SHAMSI)
TRACKING_EPOCH = datetime(
    _epoch_day.year, _epoch_day.month, _epoch_day.day, tzinfo=TEHRAN
).astimezone(timezone.utc)

#: The SLA an administrator may set, in days.
MIN_SLA_DAYS = 1
MAX_SLA_DAYS = 365


def as_datetime(value: datetime | date | None) -> datetime | None:
    """A timezone-aware UTC datetime, from a datetime (naive = UTC) or a date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc)
    return datetime(value.year, value.month, value.day, tzinfo=TEHRAN).astimezone(
        timezone.utc
    )


def effective_start(started_at: datetime | date | None) -> datetime:
    """The item's clock start, never earlier than the tracking epoch."""
    start = as_datetime(started_at)
    return TRACKING_EPOCH if start is None or start < TRACKING_EPOCH else start


def is_overdue(item: PendingItem, kind: SlaKind, sla_days: int, now: datetime) -> bool:
    if kind is SlaKind.CONFIGURED:
        return now - effective_start(item.started_at) > timedelta(days=sla_days)
    due = as_datetime(item.due_at)
    return due is not None and now > due


# An item's standing on Home. Every item is exactly one of the three.
LATE = "late"
DUE_SOON = "due_soon"
ON_TIME = "on_time"


def due_soon_window() -> timedelta:
    """How far ahead "due soon" looks: Home and the snapshot behind its trends."""
    return timedelta(days=get_settings().home_due_soon_days)


def due_at_for(item: PendingItem, kind: SlaKind, sla_days: int) -> datetime | None:
    """When the item turns late: its clock start plus the queue's SLA, or its
    own due date for queues measured against one. None if it never does."""
    if kind is SlaKind.CONFIGURED:
        return effective_start(item.started_at) + timedelta(days=sla_days)
    return as_datetime(item.due_at)


def item_status(
    item: PendingItem, kind: SlaKind, sla_days: int, now: datetime, window: timedelta
) -> str:
    """Late, due soon (turns late within ``window``), or on time.

    Late is decided by :func:`is_overdue` itself, so Home and the board can
    never disagree on what is late; a late item is never also due soon.
    """
    if is_overdue(item, kind, sla_days, now):
        return LATE
    due = due_at_for(item, kind, sla_days)
    if due is not None and due - now <= window:
        return DUE_SOON
    return ON_TIME


def sla_days_by_queue(db: Session, keys: list[str]) -> dict[str, int]:
    """Each queue's SLA in days: its stored row, else the default."""
    stored = dict(
        db.execute(
            select(ActionQueueSla.queue_key, ActionQueueSla.sla_days).where(
                ActionQueueSla.queue_key.in_(keys)
            )
        ).all()
    )
    return {key: stored.get(key, DEFAULT_SLA_DAYS) for key in keys}
