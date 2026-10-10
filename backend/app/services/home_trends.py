"""Home's 14-day trends, read from this user's ``action_daily_snapshot`` rows.

Each series is one point per Tehran day, oldest first, ending today. Today's
point is the live figure (the one Home shows), not today's snapshot, so the
line always ends on the number above it. An earlier day is ``None`` -- a gap,
never a zero -- when its snapshot cannot answer for the queues Home shows now:

* no row at all that day (a new user, a missed cron run);
* rows, but not one for every queue Home shows (days before a queue existed);
* for due soon, rows written before the snapshot recorded it (NULL).

"Done" is not a snapshot figure: ``action_queues.done`` reads it from the
domain tables, so its days are known as far back as the series goes.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.action_center import ActionDailySnapshot
from app.models.reference import User

#: Points in each series, today included.
TREND_DAYS = 14

#: The week's change compares today with this many days ago.
WEEK = 7


@dataclass(frozen=True)
class DayFigures:
    pending: int | None
    overdue: int | None
    due_soon: int | None


def trend_days(today: date, days: int = TREND_DAYS) -> list[date]:
    return [today - timedelta(days=n) for n in range(days - 1, -1, -1)]


def snapshot_days(
    db: Session, user: User, queue_keys: list[str], first: date, last: date
) -> dict[date, DayFigures]:
    """This user's snapshot totals per day, over ``queue_keys`` only."""
    rows = db.execute(
        select(
            ActionDailySnapshot.snapshot_date,
            func.count(func.distinct(ActionDailySnapshot.queue_key)),
            func.coalesce(func.sum(ActionDailySnapshot.count), 0),
            func.coalesce(func.sum(ActionDailySnapshot.overdue), 0),
            func.count(ActionDailySnapshot.due_soon),
            func.coalesce(func.sum(ActionDailySnapshot.due_soon), 0),
        )
        .where(
            ActionDailySnapshot.user_id == user.id,
            ActionDailySnapshot.snapshot_date.between(first, last),
            ActionDailySnapshot.queue_key.in_(queue_keys),
        )
        .group_by(ActionDailySnapshot.snapshot_date)
    ).all()
    wanted = len(set(queue_keys))
    out: dict[date, DayFigures] = {}
    for day, queues, count, overdue, due_soon_rows, due_soon in rows:
        if queues < wanted:
            continue
        out[day] = DayFigures(
            pending=int(count),
            overdue=int(overdue),
            due_soon=int(due_soon) if due_soon_rows == queues else None,
        )
    return out


def week_delta(series: list[int | None]) -> int | None:
    """Today less a week ago, or None without a figure for either."""
    if len(series) <= WEEK:
        return None
    now, then = series[-1], series[-1 - WEEK]
    return None if now is None or then is None else now - then


def build_trends(
    db: Session,
    user: User,
    queue_keys: list[str],
    today: date,
    live: DayFigures,
    done: dict[date, int] | None,
) -> dict:
    """Every series Home draws. ``done`` is None for a role with no done count."""
    days = trend_days(today)
    past = snapshot_days(db, user, queue_keys, days[0], days[-2]) if queue_keys else {}
    blank = DayFigures(None, None, None)
    figures = [past.get(day, blank) for day in days[:-1]] + [live]
    return {
        "days": [day.isoformat() for day in days],
        "pending": [f.pending for f in figures],
        "overdue": [f.overdue for f in figures],
        "due_soon": [f.due_soon for f in figures],
        "done": [done.get(day, 0) for day in days] if done is not None else None,
    }
