"""Home's two Submissions queues (UEP-21 §5.8), for the owner and the PM only.

Both read ``services/submissions/counts.py`` -- the same source as the page's
tiles and its rail badge -- so the three numbers cannot drift apart. Anyone
else gets an empty queue, which Home hides.
"""
from __future__ import annotations

from app.services.action_queues.context import QueueContext
from app.services.action_queues.types import PendingItem
from app.services.submissions import counts


def submit_to_ict(ctx: QueueContext) -> list[PendingItem]:
    return counts.submit_items(ctx.db, ctx.user)


def mojri_follow_up(ctx: QueueContext) -> list[PendingItem]:
    return counts.follow_up_items(ctx.db, ctx.user)
