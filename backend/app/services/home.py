"""UEP Home: the landing page's one read, composed from what already exists.

Nothing here is a second definition of anything:

* queues, counts and lateness are the Action Center registry's own fetches,
  summarised by ``board.summarize`` -- the same function the board uses;
* which queues each card shows is ``registry.home_queues_for``, read from the
  declarative ``types.HOME_QUEUES``; every total is summed from exactly the
  tickets returned, so the headline always equals what the cards show;
* the trends and the week's change are this user's ``action_daily_snapshot``
  rows (``home_trends``);
* "done" is ``action_queues.done``;
* the month's plan is ``monthly_plan.running_month``, already scoped by role.

Each queue is fetched once per build, and the whole answer is shared for a few
seconds through ``count_cache`` (emptied by every commit), like the board.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core import count_cache, jalali
from app.models.reference import User
from app.services import home_trends
from app.services.action_queues import board as boards
from app.services.action_queues import done, sla
from app.services.action_queues.board import NotOnBoard
from app.services.action_queues.context import QueueContext, home_role
from app.services.action_queues.registry import home_queues_for
from app.services.action_queues.types import (
    CONTRACTOR,
    COORDINATOR,
    HOME_GROUP_LABELS,
    HOME_GROUP_ORDER,
    HOME_KEEPS_EMPTY,
    HOME_QUEUES,
    PM,
    PROBLEM_OWNER,
    REGIONAL_MANAGER,
    STAGE_GROUP,
    HomeGroup,
    PendingItem,
    SlaKind,
)

#: How many owners a row names before "+N".
MAX_OWNERS = 2

#: Owners a row never names: the PM's own decisions say nothing by naming "PM".
_UNNAMED_OWNER_TYPES = frozenset({"role"})

#: Plan progress is the drive-test stream: the one every Home role works.
PLAN_STREAM = "DT"


def _owners(items: list[PendingItem], viewer: User) -> list[str]:
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
    return [name for name, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


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




#: The scope every count on Home is inside, by role. A problem owner's Home is
#: their category's fixes, worded as the board words it.
SCOPE_LABELS: dict[str, str] = {
    PM: "All project",
    COORDINATOR: "Your regions",
    REGIONAL_MANAGER: "Your regions",
    CONTRACTOR: "Your sites",
}

#: Roles whose Home has no "Done today": nothing on it is theirs to finish.
NO_DONE_ROLES = frozenset({REGIONAL_MANAGER})

ROLE_DISPLAY = {**boards.ROLE_DISPLAY, REGIONAL_MANAGER: "Regional manager"}

#: Sorts a queue with no clock start after every dated one.
_NEVER = datetime.max.replace(tzinfo=timezone.utc)


def require_home_role(user: User) -> str:
    role = home_role(user)
    if role is None:
        raise NotOnBoard("Home is not available for this role")
    return role


@dataclass(frozen=True)
class _Row:
    """One queue as Home shows it: its summary and who holds its items."""

    summary: boards.QueueSummary
    owners: list[str]


def _ticket(row: _Row) -> dict:
    s = row.summary
    return {
        "queue_key": s.queue.key,
        "label": s.queue.label,
        "short_label": s.queue.short_label,
        "unit": s.queue.unit,
        "count": s.count,
        "on_time": s.on_time,
        "due_soon": s.due_soon,
        "late": s.overdue,
        "oldest_started_at": s.oldest_started_at,
        "earliest_due_at": s.earliest_due_at,
        "date_kind": s.date_kind,
        "url": s.queue.url,
        "owners": row.owners[:MAX_OWNERS],
        "owners_more": max(0, len(row.owners) - MAX_OWNERS),
        "owners_total": len(row.owners),
    }


def _shown(rows: list[_Row], group: HomeGroup) -> list[_Row]:
    """The rows a card shows: its live queues, or all of them on a card that
    keeps empty rows. Ranked worst first, unless the card fixes its order."""
    kept = [r for r in rows if r.summary.count or group in HOME_KEEPS_EMPTY]
    if HOME_QUEUES[group] is not None:
        return kept
    return sorted(
        kept,
        key=lambda r: (-r.summary.overdue, r.summary.oldest_started_at or _NEVER),
    )


def _badges(tickets: list[dict]) -> dict[str, dict]:
    """Pending items per app (keyed by the path a ticket opens), with the
    tickets each badge adds up, for its tooltip."""
    badges: dict[str, dict] = {}
    for t in tickets:
        if not t["count"]:
            continue
        badge = badges.setdefault(_path(t["url"]), {"count": 0, "parts": []})
        badge["count"] += t["count"]
        badge["parts"].append({"label": t["short_label"], "count": t["count"]})
    return badges


def build(db: Session, user: User, now: datetime | None = None) -> dict:
    role = require_home_role(user)
    ctx = QueueContext(db, user) if now is None else QueueContext(db, user, now=now)
    today = ctx.now.astimezone(sla.TEHRAN).date()
    window = sla.due_soon_window()

    queues = home_queues_for(role)
    days = sla.sla_days_by_queue(db, [q.key for q in queues])
    by_group: dict[HomeGroup, list[_Row]] = defaultdict(list)
    for queue in queues:
        items = queue.fetch(ctx)
        summary = boards.summarize(queue, items, days[queue.key], ctx.now, due_soon_window=window)
        by_group[STAGE_GROUP[queue.stage]].append(_Row(summary, _owners(items, user)))

    scope = SCOPE_LABELS.get(role) or boards.scope_label(ctx, role)
    # The groups this role has queues in, empty or not, so the cards stay put.
    groups = [
        {
            "key": group.value,
            "label": HOME_GROUP_LABELS[group],
            "scope_label": scope if group in HOME_KEEPS_EMPTY else None,
            "tickets": [_ticket(r) for r in _shown(by_group[group], group)],
        }
        for group in HOME_GROUP_ORDER
        if group in by_group
    ]
    tickets = [t for g in groups for t in g["tickets"]]
    live = home_trends.DayFigures(
        pending=sum(t["count"] for t in tickets),
        overdue=sum(t["late"] for t in tickets),
        due_soon=sum(t["due_soon"] for t in tickets),
    )

    done_days = None
    if role not in NO_DONE_ROLES:
        done_days = done.done_per_day(
            db, user, role, today - timedelta(days=home_trends.TREND_DAYS - 1), today
        )
    trends = home_trends.build_trends(db, user, [q.key for q in queues], today, live, done_days)

    configured = {q.key: days[q.key] for q in queues if q.sla is SlaKind.CONFIGURED}
    distinct_days = set(configured.values())

    return {
        "role": ROLE_DISPLAY.get(role, role),
        "scope_label": scope,
        "generated_at": ctx.now,
        "shamsi_date": "{:04d}-{:02d}-{:02d}".format(*jalali.to_shamsi_date(today)),
        "due_soon_days": window.days,
        "sla_uniform_days": distinct_days.pop() if len(distinct_days) == 1 else None,
        "sla_days": configured,
        "totals": {
            "pending": live.pending,
            "queues": len(tickets),
            "overdue": live.overdue,
            "due_soon": live.due_soon,
            "done_today": done_days[today] if done_days is not None else None,
            "done_yesterday": (
                done_days[today - timedelta(days=1)] if done_days is not None else None
            ),
            "pending_week_delta": home_trends.week_delta(trends["pending"]),
            "overdue_week_delta": home_trends.week_delta(trends["overdue"]),
            "due_soon_week_delta": home_trends.week_delta(trends["due_soon"]),
        },
        "trends": trends,
        "groups": groups,
        "plan": _plan(db, user, role, today),
        "app_badges": _badges(tickets),
    }


def summary_for(db: Session, user: User) -> dict:
    """This user's Home, shared by every read of it for a few seconds."""
    require_home_role(user)
    key = ("home", user.id, user.role_id, user.contractor_id)
    return count_cache.get_or_compute(key, lambda: build(db, user))
