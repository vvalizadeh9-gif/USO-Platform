"""Monthly plans and CPM changes, as pending items.

The queries behind them live here once: the legacy Action Center feed
(``services/action_center.py``) builds its plan and CPM rows on these same
functions, so the old feed and the board cannot count differently.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance import CpmChangeRequest
from app.models.monthly_plan import (
    PLAN_STREAMS,
    STATUS_DRAFT,
    STATUS_RETURNED,
    STATUS_REVISION_REQUESTED,
    STATUS_REVISION_RETURNED,
    STATUS_SUBMITTED,
    ContractorMonthlyPlan,
)
from app.models.reference import Contractor, User
from app.models.workitem import Site, WorkItem
from app.services import monthly_plan as plans
from app.services.action_queues.context import QueueContext
from app.services.action_queues.sla import TEHRAN
from app.services.action_queues.types import OwnerRef, PendingItem
from app.services.visibility import visible_work_item_ids

PM_OWNER = OwnerRef("role", None, "PM")


# --------------------------------------------------------------------------
# Shared queries
# --------------------------------------------------------------------------
def plans_awaiting_pm(db: Session) -> list[tuple[ContractorMonthlyPlan, str]]:
    """Current plans and revision requests waiting on the PM's decision."""
    return [
        tuple(row)
        for row in db.execute(
            select(ContractorMonthlyPlan, Contractor.name)
            .join(Contractor, Contractor.id == ContractorMonthlyPlan.contractor_id)
            .where(
                ContractorMonthlyPlan.is_current.is_(True),
                ContractorMonthlyPlan.status.in_([STATUS_SUBMITTED, STATUS_REVISION_REQUESTED]),
            )
        ).all()
    ]


def plan_clock(plan: ContractorMonthlyPlan) -> datetime | None:
    return plan.submitted_at or plan.decided_at or plan.updated_at


@dataclass(frozen=True)
class PlanGaps:
    """What one contractor owes on plans for the running month."""

    period: tuple[int, int]
    #: Returned plans (or revisions) still inside the window to answer them.
    returned: list[ContractorMonthlyPlan]
    #: Streams with no plan filed (a draft is not filed).
    missing: list[str]


def contractor_plan_gaps(db: Session, contractor_id: int, today: date) -> PlanGaps:
    running = jalali.to_shamsi_date(today)[:2]

    returned = []
    for plan in db.execute(
        select(ContractorMonthlyPlan).where(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.is_current.is_(True),
            ContractorMonthlyPlan.status.in_([STATUS_RETURNED, STATUS_REVISION_RETURNED]),
        )
    ).scalars():
        period = (plan.shamsi_year, plan.shamsi_month)
        if plan.status == STATUS_REVISION_RETURNED:
            if plans.revision_window_open(*period, today=today):
                returned.append(plan)
        elif period >= running:
            returned.append(plan)

    filed = {
        stream
        for stream, status in db.execute(
            select(ContractorMonthlyPlan.stream, ContractorMonthlyPlan.status).where(
                ContractorMonthlyPlan.contractor_id == contractor_id,
                ContractorMonthlyPlan.shamsi_year == running[0],
                ContractorMonthlyPlan.shamsi_month == running[1],
                ContractorMonthlyPlan.is_current.is_(True),
            )
        ).all()
        if status != STATUS_DRAFT
    }
    missing = [s for s in PLAN_STREAMS if s not in filed]
    return PlanGaps(running, returned, missing)


def pending_change_requests(db: Session, user: User) -> list[CpmChangeRequest]:
    """CPM change requests awaiting validation, inside this user's scope."""
    return list(
        db.execute(
            select(CpmChangeRequest)
            .where(
                CpmChangeRequest.status == "Pending",
                CpmChangeRequest.site_code.in_(_visible_site_codes(db, user)),
            )
            .order_by(CpmChangeRequest.id.desc())
        ).scalars()
    )


def _visible_site_codes(db: Session, user: User) -> Select:
    """Site codes inside this user's scope, as a subquery.

    Change requests are keyed by site code rather than by work item, so they
    cannot reuse ``visible_work_item_ids`` directly.
    """
    return (
        select(Site.site_code)
        .join(WorkItem, WorkItem.site_id == Site.id)
        .where(WorkItem.id.in_(visible_work_item_ids(user, db)))
        .distinct()
    )


# --------------------------------------------------------------------------
# Queues
# --------------------------------------------------------------------------
def _end_of_day(day: date) -> datetime:
    """The last instant of ``day`` in Tehran: due *on* a day means late only
    once that day is over, and the date shown is still that day."""
    return datetime.combine(day, time.max, tzinfo=TEHRAN)


def plans_to_approve(ctx: QueueContext) -> list[PendingItem]:
    return [
        PendingItem(plan.id, plan_clock(plan), owner=PM_OWNER)
        for plan, _name in plans_awaiting_pm(ctx.db)
    ]


def cpm_changes(ctx: QueueContext) -> list[PendingItem]:
    return [
        PendingItem(cr.id, cr.created_at, owner=PM_OWNER)
        for cr in pending_change_requests(ctx.db, ctx.user)
    ]


def _plan_items(ctx: QueueContext, contractor_id: int, today: date) -> list[PendingItem]:
    gaps = contractor_plan_gaps(ctx.db, contractor_id, today)
    owner = ctx.contractor(contractor_id)
    deadline = _end_of_day(plans.deadline_for(*gaps.period))
    items = [
        PendingItem(f"{contractor_id}:{stream}:{gaps.period[0]}-{gaps.period[1]}", None,
                    due_at=deadline, owner=owner)
        for stream in gaps.missing
    ]
    for plan in gaps.returned:
        if plan.status == STATUS_REVISION_RETURNED:
            due = _end_of_day(jalali.from_shamsi_date(
                plan.shamsi_year, plan.shamsi_month, plans.REVISION_CUTOFF_DAY))
        else:
            due = _end_of_day(plans.deadline_for(plan.shamsi_year, plan.shamsi_month))
        items.append(PendingItem(plan.id, plan_clock(plan), due_at=due, owner=owner))
    return items


def monthly_plan_to_submit(ctx: QueueContext) -> list[PendingItem]:
    """Streams not yet filed for the running month, and returned plans.

    Due on the plan deadline (day 3); a returned revision is due on the last
    day it may still be revised. For staff, every contractor who files plans.
    """
    # The board's own clock, not the wall clock: a digest run for a given day
    # must see that day's running month.
    today = ctx.now.astimezone(TEHRAN).date()
    if ctx.is_contractor:
        return _plan_items(ctx, ctx.user.contractor_id, today)
    filers = ctx.db.execute(select(ContractorMonthlyPlan.contractor_id).distinct()).scalars()
    return [item for cid in filers for item in _plan_items(ctx, cid, today)]
