"""The board, the per-owner breakdown, and the summaries both are built on.

A ticket is a queue summarised: how many items, how many past their SLA, the
oldest clock start and the earliest due date. Zero-count tickets are left off
and so are stages left with no tickets: the board shows what needs doing, and
an empty board says so once rather than as a wall of zeroes.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.core import count_cache
from app.models.reference import User
from app.services.action_queues import sla
from app.services.action_queues.context import QueueContext, board_role
from app.services.action_queues.registry import QUEUES, QUEUES_BY_KEY, queues_for
from app.services.action_queues.types import (
    CONTRACTOR,
    COORDINATOR,
    PM,
    PROBLEM_OWNER,
    STAGE_LABELS,
    STAGE_ORDER,
    DateKind,
    PendingItem,
    QueueDefinition,
)

#: The board names a problem owner's role this way, not by its role name.
ROLE_DISPLAY = {PROBLEM_OWNER: "Problem owner"}

#: Beyond this many provinces the scope label gives a count instead of names.
MAX_NAMED_PROVINCES = 3


class NotOnBoard(PermissionError):
    """This user has no Action Center (Regional Manager, Viewer, Admin)."""


@dataclass(frozen=True)
class QueueSummary:
    queue: QueueDefinition
    count: int
    overdue: int
    oldest_started_at: datetime | None
    earliest_due_at: datetime | None
    #: Items turning late within the due-soon window; 0 unless one was given.
    due_soon: int = 0

    @property
    def date_kind(self) -> DateKind:
        return self.queue.date_kind

    @property
    def on_time(self) -> int:
        return self.count - self.overdue - self.due_soon


@dataclass(frozen=True)
class StageSummary:
    key: str
    label: str
    tickets: list[QueueSummary]

    @property
    def total(self) -> int:
        return sum(t.count for t in self.tickets)


@dataclass(frozen=True)
class Board:
    role: str
    scope_label: str
    generated_at: datetime
    stages: list[StageSummary] = field(default_factory=list)

    @property
    def pending(self) -> int:
        return sum(s.total for s in self.stages)

    @property
    def overdue(self) -> int:
        return sum(t.overdue for s in self.stages for t in s.tickets)


# --------------------------------------------------------------------------
# Summaries
# --------------------------------------------------------------------------
def summarize(
    queue: QueueDefinition,
    items: list[PendingItem],
    sla_days: int,
    now: datetime,
    *,
    due_soon_window: timedelta | None = None,
) -> QueueSummary:
    """One queue's items as a ticket. With ``due_soon_window``, items that turn
    late inside it are counted too (Home); the board leaves it out."""
    starts = [sla.effective_start(i.started_at) for i in items]
    dues = [d for d in (sla.as_datetime(i.due_at) for i in items) if d is not None]
    due_soon = 0
    if due_soon_window is not None:
        due_soon = sum(
            1 for i in items
            if sla.item_status(i, queue.sla, sla_days, now, due_soon_window) == sla.DUE_SOON
        )
    return QueueSummary(
        queue=queue,
        count=len(items),
        overdue=sum(1 for i in items if sla.is_overdue(i, queue.sla, sla_days, now)),
        oldest_started_at=min(starts) if starts else None,
        earliest_due_at=min(dues) if dues else None,
        due_soon=due_soon,
    )


def queue_summaries(
    ctx: QueueContext,
    queues: list[QueueDefinition],
    *,
    due_soon_window: timedelta | None = None,
) -> list[QueueSummary]:
    """Every queue summarised for this user, zero counts included."""
    days = sla.sla_days_by_queue(ctx.db, [q.key for q in queues])
    return [
        summarize(q, q.fetch(ctx), days[q.key], ctx.now, due_soon_window=due_soon_window)
        for q in queues
    ]


def require_board_role(user: User) -> str:
    role = board_role(user)
    if role is None:
        raise NotOnBoard("The Action Center is not available for this role")
    return role


# --------------------------------------------------------------------------
# The board
# --------------------------------------------------------------------------
def scope_label(ctx: QueueContext, role: str) -> str:
    user = ctx.user
    if role == CONTRACTOR:
        return user.contractor.name if user.contractor else "Your sites"
    if role == PROBLEM_OWNER:
        return f"{user.role.name} fixes"
    if user.sees_all_provinces or (role == PM and not user.provinces):
        return "All provinces"
    names = sorted(p.name for p in user.provinces)
    if not names:
        return "No provinces granted"
    if len(names) > MAX_NAMED_PROVINCES:
        return f"{len(names)} provinces"
    return "، ".join(names)


def _stages(summaries: list[QueueSummary]) -> list[StageSummary]:
    by_stage: dict = defaultdict(list)
    for s in summaries:
        if s.count:
            by_stage[s.queue.stage].append(s)
    return [
        StageSummary(stage.value, STAGE_LABELS[stage], by_stage[stage])
        for stage in STAGE_ORDER
        if by_stage.get(stage)
    ]


def build_board(ctx: QueueContext) -> Board:
    role = require_board_role(ctx.user)
    summaries = queue_summaries(ctx, queues_for(role))
    return Board(
        role=ROLE_DISPLAY.get(role, role),
        scope_label=scope_label(ctx, role),
        generated_at=ctx.now,
        stages=_stages(summaries),
    )


def board_for(db, user: User) -> Board:
    """This user's board, shared by every read of it for a few seconds.

    The sidebar badge and the page ask for the same board, often in the same
    click. ``count_cache`` empties itself on every commit, so an action shows
    on the next read; the key carries everything scope depends on.
    """
    require_board_role(user)
    key = ("action-board", user.id, user.role_id, user.contractor_id)
    return count_cache.get_or_compute(key, lambda: build_board(QueueContext(db, user)))


# --------------------------------------------------------------------------
# Per-owner breakdown
# --------------------------------------------------------------------------
OWNER_VIEWERS = frozenset({PM, COORDINATOR})


@dataclass(frozen=True)
class OwnerRow:
    owner_type: str
    owner_id: int | None
    name: str
    count: int
    overdue: int
    oldest_started_at: datetime | None


class UnknownQueue(KeyError):
    pass


def owners_breakdown(ctx: QueueContext, queue_key: str) -> list[OwnerRow]:
    """Who holds this queue's items, inside the viewer's own scope.

    A PM sees every owner. A coordinator sees only contractors: the queue is
    fetched with their province scope, so those are their own contractors.
    Worst first: most overdue, then most items.
    """
    role = board_role(ctx.user)
    if role not in OWNER_VIEWERS:
        raise NotOnBoard("The per-owner breakdown is for PMs and coordinators")
    queue = QUEUES_BY_KEY.get(queue_key)
    if queue is None:
        raise UnknownQueue(queue_key)

    sla_days = sla.sla_days_by_queue(ctx.db, [queue.key])[queue.key]
    groups: dict[tuple, list[PendingItem]] = defaultdict(list)
    for item in queue.fetch(ctx):
        owner = item.owner
        key = (owner.type, owner.id, owner.name) if owner else ("unassigned", None, "Unassigned")
        if role == COORDINATOR and key[0] != "contractor":
            continue
        groups[key].append(item)

    rows = []
    for (otype, oid, name), items in groups.items():
        s = summarize(queue, items, sla_days, ctx.now)
        rows.append(OwnerRow(otype, oid, name, s.count, s.overdue, s.oldest_started_at))
    rows.sort(key=lambda r: (-r.overdue, -r.count, r.name))
    return rows


def all_queue_keys() -> list[str]:
    return [q.key for q in QUEUES]
