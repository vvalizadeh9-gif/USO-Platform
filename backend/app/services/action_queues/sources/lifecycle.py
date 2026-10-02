"""Health Check and Drive Test queues, as pending items.

Every function here is an adapter: it calls the list function behind the
queue's own screen (``hc_queues``, ``health_check``) and reshapes its rows. No
condition is restated, so a ticket's count is the length of the list its link
opens.
"""
from __future__ import annotations

from app.services import hc_queues
from app.services import health_check as hc
from app.services.action_queues.context import QueueContext
from app.services.action_queues.types import OwnerRef, PendingItem

# My Drive Tests / DT In Progress row states.
WITH_CONTRACTOR = "with_contractor"
SENT_BACK = "sent_back"


def _coordinator_owned(ctx: QueueContext, rows: list[dict], id_key: str, since_key: str):
    owners = ctx.coordinators_for([r["work_item_id"] for r in rows])
    return [
        PendingItem(r[id_key], r[since_key], owner=owners.get(r["work_item_id"]))
        for r in rows
    ]


# --------------------------------------------------------------------------
# Health Check
# --------------------------------------------------------------------------
def sites_to_assign(ctx: QueueContext) -> list[PendingItem]:
    """The HC Pool's "Ready to assign" filter: never checked, or due a re-check."""
    rows = [
        b for b in hc.get_basket(ctx.db, ctx.user, ctx.work_items)
        if b["hc_state"] in hc.HC_READY_TO_ASSIGN_STATES
    ]
    return _coordinator_owned(ctx, rows, "work_item_id", "waiting_since")


def hc_results_to_review(ctx: QueueContext) -> list[PendingItem]:
    tasks = hc_queues.hc_review_tasks(ctx.db, ctx.user)
    owners = ctx.coordinators_for([t.work_item_id for t in tasks])
    return [
        PendingItem(t.id, t.completed_at, owner=owners.get(t.work_item_id))
        for t in tasks
    ]


def reroute_decisions(ctx: QueueContext) -> list[PendingItem]:
    return _coordinator_owned(
        ctx, hc_queues.reroutes(ctx.db, ctx.user), "id", "proposed_at"
    )


def hc_to_submit(ctx: QueueContext) -> list[PendingItem]:
    return [
        PendingItem(task.id, assignment.assigned_at, owner=ctx.contractor(assignment.contractor_id))
        for task, assignment in hc_queues.open_hc_tasks(ctx.db, ctx.user)
    ]


def fixes(ctx: QueueContext) -> list[PendingItem]:
    """Open fixes. An owner's are their own queue; staff see every category's.

    Overdue is the fix's own ``due_at``, set from its category's SLA when the
    fix was opened.
    """
    rows = (
        hc.owner_queue(ctx.db, ctx.user)
        if ctx.is_problem_owner
        else hc_queues.remediations(ctx.db, ctx.user)
    )
    return [
        PendingItem(
            r["id"], r["opened_at"], due_at=r["due_at"],
            owner=OwnerRef("category", None, r["category"] or "Uncategorised"),
        )
        for r in rows
    ]


# --------------------------------------------------------------------------
# Drive Test
# --------------------------------------------------------------------------
def dt_to_assign(ctx: QueueContext) -> list[PendingItem]:
    """Confirmed Ready and unassigned, or handed back by the contractor.

    A returned site's clock restarts when it came back, not at its HC review.
    """
    rows = hc_queues.dt_assignment(ctx.db, ctx.user, ctx.work_items)
    owners = ctx.coordinators_for([r["work_item_id"] for r in rows])
    return [
        PendingItem(
            r["work_item_id"], r["returned_at"] or r["ready_since"],
            owner=owners.get(r["work_item_id"]),
        )
        for r in rows
    ]


def dt_results_to_review(ctx: QueueContext) -> list[PendingItem]:
    return _coordinator_owned(
        ctx, hc_queues.dt_review(ctx.db, ctx.user), "drive_test_id", "submitted_at"
    )


def _drive_tests_owed(ctx: QueueContext, status: str, since_key: str) -> list[PendingItem]:
    """A contractor's own To Do rows, or for staff every contractor's."""
    rows = (
        hc_queues.contractor_dt_todo(ctx.db, ctx.user)
        if ctx.is_contractor
        else hc_queues.dt_in_progress(ctx.db, ctx.user, ctx.work_items)
    )
    return [
        PendingItem(r["work_item_id"], r[since_key], owner=ctx.contractor(r["contractor_id"]))
        for r in rows
        if r["status"] == status
    ]


def sites_to_drive_test(ctx: QueueContext) -> list[PendingItem]:
    return _drive_tests_owed(ctx, WITH_CONTRACTOR, "assigned_at")


def returned_to_redo(ctx: QueueContext) -> list[PendingItem]:
    return _drive_tests_owed(ctx, SENT_BACK, "sent_back_at")
