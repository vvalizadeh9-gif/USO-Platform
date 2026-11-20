"""The case definitions (UEP-22 §4.2, §5.6), as pure functions.

Nothing here reads the database, so every screen that ages, buckets or flags
a case reads the same answer, and the unit tests need no fixtures.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from app.core import jalali
from app.models.acceptance_case import (
    BASKET_CONTRACTOR,
    BASKET_PM,
    OPEN_STATES,
    STATE_REJECTED,
    STATE_WAITING,
)

#: SLA policy steps (sla_policy.STEPS, area acceptance).
SLA_BASKET = "acceptance_basket"
SLA_FRESHNESS = "comment_freshness"

#: Time in basket: (key, label, first day, last day or None).
BUCKETS: tuple[tuple[str, str, int, int | None], ...] = (
    ("u3", "Under 3 months", 0, 90),
    ("m3_6", "3–6 months", 91, 182),
    ("m6_12", "6–12 months", 183, 365),
    ("o1y", "Over 1 year", 366, None),
)
BUCKET_KEYS = tuple(b[0] for b in BUCKETS)
BUCKET_LABELS = {b[0]: b[1] for b in BUCKETS}
#: Baskets' two extra columns.
COL_NO_COMMENT = "no_comment"
COL_TOTAL = "total"

#: Basket keys (Baskets rows and Filing's basket filter).
KEY_NEEDS_CATEGORY = "needs_category"
KEY_PARKED = "parked"
KEY_REJECTED_CONTRACTOR = "rejected:contractor"


@dataclass(frozen=True)
class Clock:
    """Today in Tehran and the two SLA policy values, read once per request."""

    today: date
    sla_days: int
    fresh_days: int


def tehran_today(now: datetime | None = None) -> date:
    moment = now or datetime.now(jalali.TEHRAN)
    return moment.astimezone(jalali.TEHRAN).date()


def local_date(moment: datetime | date | None) -> date | None:
    """A timestamp's Tehran calendar day (dates pass through). A naive
    timestamp is UTC, as everywhere in UEP (``action_queues.sla.as_datetime``)."""
    if moment is None or not isinstance(moment, datetime):
        return moment
    aware = moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    return aware.astimezone(jalali.TEHRAN).date()


def days_since(start: date | datetime | None, today: date) -> int | None:
    day = local_date(start)
    return None if day is None else max((today - day).days, 0)


def is_open(state: str) -> bool:
    return state in OPEN_STATES


def comment_age(last_comment_at: datetime | None, today: date) -> int | None:
    return days_since(last_comment_at, today)


def is_stale(state: str, last_comment_at: datetime | None, clock: Clock) -> bool:
    """Open, and no comment at all or none within the freshness window."""
    if not is_open(state):
        return False
    age = comment_age(last_comment_at, clock.today)
    return age is None or age > clock.fresh_days


def is_over_sla(state: str, days_in_basket: int, clock: Clock) -> bool:
    return is_open(state) and days_in_basket > clock.sla_days


def bucket_of(days: int) -> str:
    for key, _label, first, last in BUCKETS:
        if days >= first and (last is None or days <= last):
            return key
    return BUCKETS[-1][0]


def basket_key(state: str, basket_role: str | None, contractor_id: int | None) -> str | None:
    """The basket an open case is in, as Baskets and Filing's filter name it."""
    if state == STATE_WAITING:
        return f"contractor:{contractor_id or 0}"
    if state != STATE_REJECTED:
        return None
    if basket_role is None:
        return KEY_NEEDS_CATEGORY
    if basket_role == BASKET_PM:
        return KEY_PARKED
    if basket_role == BASKET_CONTRACTOR:
        return KEY_REJECTED_CONTRACTOR
    return f"team:{basket_role}"


def basket_owner(state: str, basket_role: str | None, contractor_name: str | None,
                 category_label: str | None) -> str | None:
    """Who holds the case, in the page's words ("Contractor A", "CPG Power", "PM")."""
    if state == STATE_WAITING or basket_role == BASKET_CONTRACTOR:
        return contractor_name or "No contractor"
    if state != STATE_REJECTED:
        return None
    if basket_role is None:
        return "Needs category"
    if basket_role == BASKET_PM:
        return "PM"
    return category_label or basket_role
