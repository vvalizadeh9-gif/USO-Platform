"""Contractor monthly plan (PIP): HTTP layer.

A thin layer, as everywhere else in this codebase: it decides who is allowed
to ask, translates a rule violation into a 400, and records the audit entry.
Every rule lives in ``services/monthly_plan.py``.

Two permission facts are worth stating here rather than leaving to be inferred
from the decorators:

**A contractor account can only ever reach its own contractor's plans.** Not
because the response is filtered afterwards, but because no endpoint on this
router takes a contractor id from the caller at all: the contractor side reads
it off the authenticated account, and the PM side addresses a plan by its own
primary key behind a role guard a contractor cannot pass. There is no request
a contractor can construct that names another company.

**PM approves; Admin does not.** Deciding a contractor's monthly target is an
operational act, and Admin is a systems role -- the separation of duties in
ARCHITECTURE.md, which is deliberate and is the rule most often broken by a
test that "fixes" a 403. Admin can read the queue, and cannot decide.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core import audit_actions, jalali
from app.core.database import get_db
from app.core.deps import (
    ADMIN,
    COORDINATOR,
    PM,
    REGIONAL,
    VIEWER,
    get_current_user,
    require_roles,
)
from app.models.monthly_plan import STATUS_APPROVED, ContractorMonthlyPlan
from app.models.reference import User
from app.schemas import (
    MonthlyPlanContext,
    MonthlyPlanHistoryRow,
    MonthlyPlanOut,
    MonthlyPlanQueueOut,
    MonthlyPlanQueueRow,
    MonthlyPlanReturn,
    MonthlyPlanRevise,
    MonthlyPlanWrite,
)
from app.services import monthly_plan as plans
from app.services.audit import record_audit

router = APIRouter(prefix="/pip", tags=["pip"])

#: Who may read the PM's queue. Everyone with an oversight interest in whether
#: the month's targets are in -- and deliberately not a contractor, for whom
#: this screen is a list of every competitor's commitments.
QUEUE_READERS = (PM, COORDINATOR, REGIONAL, VIEWER, ADMIN)

#: Who may decide one. PM alone: the Coordinator may read the queue but the
#: target is the PM's to set, and Admin does not perform operational acts.
require_pm = require_roles(PM)
require_queue_reader = require_roles(*QUEUE_READERS)


def _own_contractor(user: User) -> int:
    """The contractor this account acts for, or a 403.

    A staff account has no ``contractor_id``, so it lands here too — which is
    correct: ``/my`` is the contractor's own form, and there is no contractor
    whose plan a PM would be filling in through it.
    """
    try:
        return plans.acts_for_contractor(user)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None


def _as_out(plan: ContractorMonthlyPlan) -> MonthlyPlanOut:
    out = MonthlyPlanOut.model_validate(plan)
    out.is_late = plans.is_late(plan)
    return out


def _guard(call):
    """Run a service call, turning a rule violation into a 400."""
    try:
        return call()
    except plans.PlanError as exc:
        raise HTTPException(400, str(exc)) from None


# ---------------------------------------------------------------------------
# Contractor side
# ---------------------------------------------------------------------------
@router.get("/my", response_model=MonthlyPlanContext)
def my_plan(
    year: int = Query(..., description="Shamsi year, e.g. 1405"),
    month: int = Query(..., ge=1, le=12, description="Shamsi month, 1-12"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MonthlyPlanContext:
    """This contractor's current plan for the month, plus the context to fill it in.

    Returns ``plan: null`` rather than a 404 when nothing has been started.
    Not having filed yet is the normal state on day one of the month, and it is
    the state the form most needs to render.
    """
    contractor_id = _own_contractor(user)
    _guard(lambda: plans.validate_period(year, month))

    plan = plans.current_plan(db, contractor_id, year, month)
    deadline = plans.deadline_for(year, month)
    return MonthlyPlanContext(
        shamsi_year=year,
        shamsi_month=month,
        shamsi_month_name=jalali.month_name(month),
        plan=_as_out(plan) if plan is not None else None,
        previous_month_committed=plans.previous_approved_count(
            db, contractor_id, year, month
        ),
        open_assignments=plans.open_assignment_count(db, user),
        deadline_shamsi=jalali.format_shamsi(deadline),
        deadline_gregorian=deadline,
        deadline_passed=plans.deadline_has_passed(year, month),
    )


@router.get("/my/history", response_model=list[MonthlyPlanHistoryRow])
def my_history(
    months: int = Query(6, ge=1, le=plans.MAX_HISTORY_MONTHS),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MonthlyPlanHistoryRow]:
    """This contractor's own last N Shamsi months, newest first.

    No actuals yet: comparing a commitment against what was delivered needs a
    settled rule for which month a drive test counts into, and that rule is
    deliberately untouched here.
    """
    contractor_id = _own_contractor(user)
    rows = []
    for year, month, plan in plans.history(db, contractor_id, months):
        approved = plan is not None and plan.status == STATUS_APPROVED
        rows.append(
            MonthlyPlanHistoryRow(
                shamsi_year=year,
                shamsi_month=month,
                shamsi_month_name=jalali.month_name(month),
                committed_count=plan.committed_count if approved else None,
                status=plan.status if plan is not None else None,
                version=plan.version if plan is not None else None,
            )
        )
    return rows


@router.post("/my", response_model=MonthlyPlanOut)
def save_my_plan(
    payload: MonthlyPlanWrite,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MonthlyPlanOut:
    """Save this month's plan as a draft, or hand it in.

    There is one plan per contractor per month and this endpoint edits it. A
    second account at the same company saving here updates the plan its
    colleague started; nothing on this router can produce a competing one.
    """
    contractor_id = _own_contractor(user)
    existing = plans.current_plan(
        db, contractor_id, payload.shamsi_year, payload.shamsi_month
    )
    before = plans.audit_snapshot(existing) if existing is not None else None

    plan = _guard(
        lambda: plans.save_plan(
            db,
            contractor_id=contractor_id,
            user=user,
            year=payload.shamsi_year,
            month=payload.shamsi_month,
            committed_count=payload.committed_count,
            submit=payload.submit,
        )
    )

    record_audit(
        db,
        user_id=user.id,
        action=(
            audit_actions.SUBMITTED if payload.submit
            else (audit_actions.UPDATED if existing is not None else audit_actions.CREATED)
        ),
        module="PIP",
        entity_type="ContractorMonthlyPlan",
        entity_id=plan.id,
        old_value=before,
        new_value=plans.audit_snapshot(plan),
    )
    db.commit()
    return _as_out(plan)


@router.post("/my/revise", response_model=MonthlyPlanOut)
def revise_my_plan(
    payload: MonthlyPlanRevise,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MonthlyPlanOut:
    """Open the next version of an approved plan, as a draft.

    A separate, explicit act rather than something ``POST /my`` falls into,
    because it is a different thing to do: the approved figure stays on the
    record exactly as decided and a second one begins beside it. The new
    version arrives as a Draft, and is handed in through ``POST /my`` like any
    other.
    """
    contractor_id = _own_contractor(user)
    previous = plans.current_plan(
        db, contractor_id, payload.shamsi_year, payload.shamsi_month
    )
    before = plans.audit_snapshot(previous) if previous is not None else None

    plan = _guard(
        lambda: plans.revise(
            db,
            contractor_id=contractor_id,
            user=user,
            year=payload.shamsi_year,
            month=payload.shamsi_month,
            committed_count=payload.committed_count,
        )
    )

    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.CREATED,
        module="PIP",
        entity_type="ContractorMonthlyPlan",
        entity_id=plan.id,
        old_value=before,
        new_value=plans.audit_snapshot(plan),
    )
    db.commit()
    return _as_out(plan)


# ---------------------------------------------------------------------------
# PM side
# ---------------------------------------------------------------------------
@router.get("/queue", response_model=MonthlyPlanQueueOut)
def queue(
    year: int = Query(..., description="Shamsi year, e.g. 1405"),
    month: int = Query(..., ge=1, le=12, description="Shamsi month, 1-12"),
    db: Session = Depends(get_db),
    user: User = Depends(require_queue_reader),
) -> MonthlyPlanQueueOut:
    """Every contractor's standing for the month, filed or not.

    Closed to contractors: this is a list of what every other company in the
    programme has committed to, and no contractor has any business reading it.
    """
    rows = _guard(lambda: plans.queue_rows(db, year, month))
    return MonthlyPlanQueueOut(
        shamsi_year=year,
        shamsi_month=month,
        shamsi_month_name=jalali.month_name(month),
        deadline_shamsi=jalali.format_shamsi(plans.deadline_for(year, month)),
        deadline_passed=plans.deadline_has_passed(year, month),
        rows=[
            MonthlyPlanQueueRow(
                contractor_id=contractor.id,
                contractor_name=contractor.name,
                plan_id=plan.id if plan is not None else None,
                status=plan.status if plan is not None else None,
                committed_count=plan.committed_count if plan is not None else None,
                previous_month_committed=previous,
                version=plan.version if plan is not None else None,
                submitted_at=plan.submitted_at if plan is not None else None,
                is_late=plans.is_late(plan) if plan is not None else False,
                return_comment=plan.return_comment if plan is not None else None,
            )
            for contractor, plan, previous in rows
        ],
    )


def _load_plan(plan_id: int, db: Session) -> ContractorMonthlyPlan:
    plan = db.get(ContractorMonthlyPlan, plan_id)
    if plan is None:
        raise HTTPException(404, "Plan not found")
    return plan


@router.post("/{plan_id}/approve", response_model=MonthlyPlanOut)
def approve_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_pm),
) -> MonthlyPlanOut:
    """Lock a submitted plan as that contractor's target for the month.

    PM only. Admin gets a 403 here by design — see the module docstring.
    """
    plan = _load_plan(plan_id, db)
    before = plans.audit_snapshot(plan)
    _guard(lambda: plans.approve(db, plan=plan, user=user))

    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.APPROVED,
        module="PIP",
        entity_type="ContractorMonthlyPlan",
        entity_id=plan.id,
        old_value=before,
        new_value=plans.audit_snapshot(plan),
    )
    db.commit()
    return _as_out(plan)


@router.post("/{plan_id}/return", response_model=MonthlyPlanOut)
def return_plan(
    plan_id: int,
    payload: MonthlyPlanReturn,
    db: Session = Depends(get_db),
    user: User = Depends(require_pm),
) -> MonthlyPlanOut:
    """Send a submitted plan back to the contractor, with the reason.

    PM only, and the comment is required: a number returned without one tells
    the contractor that the PM disagreed and nothing about what to write
    instead.
    """
    plan = _load_plan(plan_id, db)
    before = plans.audit_snapshot(plan)
    _guard(
        lambda: plans.return_plan(db, plan=plan, user=user, comment=payload.comment)
    )

    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.RETURNED,
        module="PIP",
        entity_type="ContractorMonthlyPlan",
        entity_id=plan.id,
        old_value=before,
        new_value=plans.audit_snapshot(plan),
    )
    db.commit()
    return _as_out(plan)
