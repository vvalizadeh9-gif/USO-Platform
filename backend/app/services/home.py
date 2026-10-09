"""UEP Home: the landing page's one read, composed from what already exists.

Nothing here is a second definition of anything:

* queues, counts and lateness are the Action Center registry's own fetches,
  summarised by ``board.summarize`` -- the same function the board uses;
* the next queue is ``board.up_next``;
* the week's change is this user's ``action_daily_snapshot`` rows;
* "done" is ``action_queues.done``;
* the month's plan is ``monthly_plan.running_month``, already scoped by role.

Each queue is fetched once per build, and the whole answer is shared for a few
seconds through ``count_cache`` (emptied by every commit), like the board.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import count_cache, jalali
from app.core.config import get_settings
from app.models.action_center import ActionDailySnapshot
from app.models.reference import User
from app.services.action_queues import board as boards
from app.services.action_queues import done, sla
from app.services.action_queues.context import QueueContext
from app.services.action_queues.registry import queues_for
from app.services.action_queues.types import (
    HOME_GROUP_LABELS,
    HOME_GROUP_ORDER,
    PROBLEM_OWNER,
    STAGE_GROUP,
    PendingItem,
    SlaKind,
)

#: How many owners a row names before "+N".
MAX_OWNERS = 2

#: Owners a row never names: the PM's own decisions say nothing by naming "PM".
_UNNAMED_OWNER_TYPES = frozenset({"role"})

#: Plan progress is the drive-test stream: the one every Home role works.
PLAN_STREAM = "DT"


def _owners(items: list[PendingItem], viewer: User) -> tuple[list[str], int]:
    """Who holds this queue's items, most items first, never the viewer's own
    company (on a contractor's board every item is theirs, so that names no
    one)."""
    counts: Counter = Counter()
    for item in items:
        owner = item.owner
        if owner is None or owner.type in _UNNAMED_OWNER_TYPES:
            continue
        if owner.type == "contractor" and owner.id == viewer.contractor_id:
            continue
        if owner.type == "coordinator" and owner.id == viewer.id:
            continue
        counts[owner.name] += 1
    ranked = [name for name, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
    return ranked[:MAX_OWNERS], max(0, len(ranked) - MAX_OWNERS)


def _week_deltas(db: Session, user: User, today: date, pending: int, overdue: int):
    """Live totals less this user's snapshot from seven days ago, or None
    each when there is no snapshot that day (a new user, a missed cron run)."""
    row = db.execute(
        select(
            func.count(ActionDailySnapshot.id),
            func.coalesce(func.sum(ActionDailySnapshot.count), 0),
            func.coalesce(func.sum(ActionDailySnapshot.overdue), 0),
        ).where(
            ActionDailySnapshot.user_id == user.id,
            ActionDailySnapshot.snapshot_date == today - timedelta(days=7),
        )
    ).one()
    if not row[0]:
        return None, None
    return pending - int(row[1]), overdue - int(row[2])


def _plan(db: Session, user: User, role: str, today: date) -> dict | None:
    """The running Shamsi month's drive-test plan, inside the user's scope."""
    if role == PROBLEM_OWNER:
        return None
    from app.services import monthly_plan

    month = monthly_plan.running_month(db, user)
    year, number = month["shamsi_year"], month["shamsi_month"]
    day = jalali.to_shamsi_date(today)[2]
    return {
        "stream": PLAN_STREAM,
        "shamsi_year": year,
        "shamsi_month": number,
        "month_name": month["shamsi_month_name"],
        # None, never 0: no approved plan is not a plan of nothing.
        "pip": month["pip"],
        "delivered": month["delivered"],
        "days_left": max(0, jalali.days_in_month(year, number) - day),
    }


def _path(url: str) -> str:
    return url.split("?", 1)[0]


def build(db: Session, user: User, now: datetime | None = None) -> dict:
    role = boards.require_board_role(user)
    ctx = QueueContext(db, user) if now is None else QueueContext(db, user, now=now)
    today = ctx.now.astimezone(sla.TEHRAN).date()
    window = timedelta(days=get_settings().home_due_soon_days)

    queues = queues_for(role)
    days = sla.sla_days_by_queue(db, [q.key for q in queues])
    summaries: list[boards.QueueSummary] = []
    owners: dict[str, tuple[list[str], int]] = {}
    for queue in queues:
        items = queue.fetch(ctx)
        summaries.append(
            boards.summarize(queue, items, days[queue.key], ctx.now, due_soon_window=window)
        )
        owners[queue.key] = _owners(items, user)

    live = [s for s in summaries if s.count]
    by_group: dict = defaultdict(list)
    for s in live:
        by_group[STAGE_GROUP[s.queue.stage]].append(s)
    # The groups this role has queues in, empty or not, so the cards stay put.
    role_groups = {STAGE_GROUP[q.stage] for q in queues}

    pending = sum(s.count for s in live)
    overdue = sum(s.overdue for s in live)
    pending_delta, overdue_delta = _week_deltas(db, user, today, pending, overdue)
    done_today, done_yesterday = done.done_by_day(db, user, role, today)
    nxt = boards.up_next(summaries)

    configured = {q.key: days[q.key] for q in queues if q.sla is SlaKind.CONFIGURED}
    distinct_days = set(configured.values())

    badges: dict[str, int] = defaultdict(int)
    for s in live:
        badges[_path(s.queue.url)] += s.count

    def ticket(s: boards.QueueSummary) -> dict:
        names, more = owners[s.queue.key]
        return {
            "queue_key": s.queue.key,
            "label": s.queue.label,
            "short_label": s.queue.short_label,
            "count": s.count,
            "on_time": s.on_time,
            "due_soon": s.due_soon,
            "late": s.overdue,
            "oldest_started_at": s.oldest_started_at,
            "earliest_due_at": s.earliest_due_at,
            "date_kind": s.date_kind,
            "url": s.queue.url,
            "owners": names,
            "owners_more": more,
        }

    def rank(s: boards.QueueSummary):
        return (-s.overdue, s.oldest_started_at or ctx.now)

    return {
        "role": boards.ROLE_DISPLAY.get(role, role),
        "scope_label": boards.scope_label(ctx, role),
        "generated_at": ctx.now,
        "due_soon_days": window.days,
        "sla_uniform_days": distinct_days.pop() if len(distinct_days) == 1 else None,
        "sla_days": configured,
        "totals": {
            "pending": pending,
            "queues": len(live),
            "overdue": overdue,
            "due_soon": sum(s.due_soon for s in live),
            "pending_week_delta": pending_delta,
            "overdue_week_delta": overdue_delta,
            "done_today": done_today,
            "done_yesterday": done_yesterday,
        },
        "up_next": nxt.queue.key if nxt else None,
        "groups": [
            {
                "key": group.value,
                "label": HOME_GROUP_LABELS[group],
                "tickets": [ticket(s) for s in sorted(by_group.get(group, []), key=rank)],
            }
            for group in HOME_GROUP_ORDER
            if group in role_groups
        ],
        "plan": _plan(db, user, role, today),
        "app_badges": dict(badges),
    }


def summary_for(db: Session, user: User) -> dict:
    """This user's Home, shared by every read of it for a few seconds."""
    boards.require_board_role(user)
    key = ("home", user.id, user.role_id, user.contractor_id)
    return count_cache.get_or_compute(key, lambda: build(db, user))
