"""Queue summaries: what Home, the app rail counts and the daily digest read.

A ticket is a queue summarised: how many items, how many past their SLA, the
oldest clock start and the earliest due date.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.services.action_queues import sla
from app.services.action_queues.context import QueueContext
from app.services.action_queues.types import (
    CONTRACTOR,
    PM,
    PROBLEM_OWNER,
    DateKind,
    PendingItem,
    QueueDefinition,
)

#: A problem owner's role is named this way, not by its role name.
ROLE_DISPLAY = {PROBLEM_OWNER: "Problem owner"}

#: Beyond this many provinces the scope label gives a count instead of names.
MAX_NAMED_PROVINCES = 3


class NotOnBoard(PermissionError):
    """This user owns no pending work (Viewer, Admin)."""


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
    late inside it are counted too (Home); the digest leaves it out."""
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


# --------------------------------------------------------------------------
# Scope
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
