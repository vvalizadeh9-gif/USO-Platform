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

**Revisions go through the PM.** A contractor asks for a new number on an
approved plan (``POST /my/revision-request``); the PM approves or returns it
through the same two endpoints that decide a first submission. The approved
number stays in force until the request is approved.

**PM approves; Admin does not.** Deciding a contractor's monthly target is an
operational act, and Admin is a systems role -- the separation of duties in
ARCHITECTURE.md, which is deliberate and is the rule most often broken by a
test that "fixes" a 403. Admin can read the queue, and cannot decide.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core import audit_actions, jalali
from app.core.database import get_db
from app.core.deps import (
    ADMIN,
    CONTRACTOR,
    COORDINATOR,
    PM,
    REGIONAL,
    VIEWER,
    get_current_user,
    require_roles,
)
from app.models.monthly_plan import (
    PLAN_STREAMS,
    STATUS_APPROVED,
    STREAM_DT,
    ContractorMonthlyPlan,
)
from app.models.reference import Contractor, User
from app.schemas import (
    InternalTargetOut,
    InternalTargetPeriod,
    InternalTargetWrite,
    MonthlyPlanContext,
    MonthlyPlanHistoryRow,
    MonthlyPlanOut,
    MonthlyPlanQueueOut,
    MonthlyPlanQueueRow,
    MonthlyPlanReturn,
    MonthlyPlanRevisionRequest,
    MonthlyPlanWrite,
    MonthStanding,
    PlanMonthPoint,
    PlanningMonth,
    PlanRevision,
    PlanRevisionsOut,
    PipOverviewOut,
    PlanStream,
    ScorecardOut,
)
from app.services import acceptance_plan as internal_targets
from app.services import monthly_plan as plans
from app.services import pip_export, pip_overview
from app.services.audit import record_audit
from app.services.drive_test_analytics import DriveTestAnalytics

router = APIRouter(prefix="/pip", tags=["pip"])

#: Who may read the PM's queue. Everyone with an oversight interest in whether
#: the month's targets are in -- and deliberately not a contractor, for whom
#: this screen is a list of every competitor's commitments.
QUEUE_READERS = (PM, COORDINATOR, REGIONAL, VIEWER, ADMIN)

#: Who may decide one. PM alone: the Coordinator may read the queue but the
#: target is the PM's to set, and Admin does not perform operational acts.
require_pm = require_roles(PM)
require_queue_reader = require_roles(*QUEUE_READERS)

#: What a .xlsx is, on the wire. Same string the health-check and work-item
#: downloads use.
XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


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
    stream: PlanStream = Query("DT", description="DT or ACCEPTANCE"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MonthlyPlanContext:
    """This contractor's current plan for the month, plus the context to fill it in.

    Three blocks, one request, because they are one screen: ``planning`` is
    the month being filed for, ``current_month`` is where the running month
    stands, and ``history`` is the six months behind it. The numeric ones come
    from ``DriveTestAnalytics.scorecard``, which is what the Drive Test
    dashboard reads, so neither screen can report a figure the other does not.

    Returns ``plan: null`` rather than a 404 when nothing has been started.
    Not having filed yet is the normal state on day one of the month, and it is
    the state the form most needs to render.
    """
    contractor_id = _own_contractor(user)
    _guard(lambda: plans.validate_period(year, month))

    plan = plans.current_plan(db, contractor_id, year, month, stream)
    in_force = plans.in_force_plan(db, contractor_id, year, month, stream)
    deadline = plans.deadline_for(year, month)

    # The six months behind the planning month, the running one last. One
    # scorecard call answers both this and ``current_month`` below — the
    # figures come from the service the Drive Test dashboard reads, so the two
    # screens cannot disagree about a contractor's month.
    months = plans.recent_months(db, user, contractor_id)
    running = months[-1]

    return MonthlyPlanContext(
        shamsi_year=year,
        shamsi_month=month,
        shamsi_month_name=jalali.month_name(month),
        plan=_as_out(plan) if plan is not None else None,
        previous_month_committed=plans.previous_approved_count(
            db, contractor_id, year, month, stream
        ),
        open_assignments=plans.open_assignment_count(db, user),
        deadline_shamsi=jalali.format_shamsi(deadline),
        deadline_gregorian=deadline,
        deadline_passed=plans.deadline_has_passed(year, month),
        planning=PlanningMonth(
            shamsi_year=year,
            shamsi_month=month,
            shamsi_month_name=jalali.month_name(month),
            label=plans.month_label(year, month),
            stream=stream,
            version=plan.version if plan is not None else None,
            status=plan.status if plan is not None else None,
            committed_count=plan.committed_count if plan is not None else None,
            return_comment=plan.return_comment if plan is not None else None,
            returned_by=(
                plans.decider_names(db, [plan]).get(plan.decided_by)
                if plan is not None and plan.return_comment
                else None
            ),
            deadline_shamsi=jalali.format_shamsi(deadline),
            deadline_gregorian=deadline,
            deadline_passed=plans.deadline_has_passed(year, month),
            is_late=plans.is_late(plan) if plan is not None else False,
            days_remaining=plans.days_remaining(year, month),
            in_force_count=in_force.committed_count if in_force is not None else None,
            in_force_version=in_force.version if in_force is not None else None,
            revision_reason=plan.revision_reason if plan is not None else None,
            revision_comment=plan.revision_comment if plan is not None else None,
            revision_open=plans.revision_window_open(year, month),
        ),
        current_month=MonthStanding(
            **{k: v for k, v in running.items() if k != "in_progress"},
            pace_pct=plans.pace_percent(
                running["shamsi_year"], running["shamsi_month"]
            ),
        ),
        history=[
            PlanMonthPoint(
                shamsi_year=point["shamsi_year"],
                shamsi_month=point["shamsi_month"],
                shamsi_month_name=point["shamsi_month_name"],
                label=point["label"],
                assignment=point["assignment"],
                pip=point["pip"],
                delivered=point["delivered"],
                in_progress=point["in_progress"],
            )
            for point in months
        ],
    )


@router.get("/my/history", response_model=list[MonthlyPlanHistoryRow])
def my_history(
    months: int = Query(6, ge=1, le=plans.MAX_HISTORY_MONTHS),
    stream: PlanStream = Query("DT", description="DT or ACCEPTANCE"),
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
    for year, month, plan in plans.history(db, contractor_id, months, stream):
        # The number in force, not the latest version's: a pending revision
        # is a proposal, and this is a history of commitments.
        in_force = plans.in_force_plan(db, contractor_id, year, month, stream)
        rows.append(
            MonthlyPlanHistoryRow(
                shamsi_year=year,
                shamsi_month=month,
                shamsi_month_name=jalali.month_name(month),
                committed_count=in_force.committed_count if in_force else None,
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
        db, contractor_id, payload.shamsi_year, payload.shamsi_month, payload.stream
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
            stream=payload.stream,
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


@router.post("/my/revision-request", response_model=MonthlyPlanOut)
def request_revision(
    payload: MonthlyPlanRevisionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MonthlyPlanOut:
    """Ask the PM to change this month's approved number.

    Writes a new version with status ``RevisionRequested``; the approved
    version is not touched and stays in force until the PM approves the
    request. Open for the running month only, until the end of day 15 on the
    Tehran clock. The contractor is the caller's own -- this endpoint takes no
    contractor id -- so the request can only ever be about the caller's
    company.
    """
    contractor_id = _own_contractor(user)
    previous = plans.current_plan(
        db, contractor_id, payload.shamsi_year, payload.shamsi_month, payload.stream
    )
    before = plans.audit_snapshot(previous) if previous is not None else None

    plan = _guard(
        lambda: plans.request_revision(
            db,
            contractor_id=contractor_id,
            user=user,
            year=payload.shamsi_year,
            month=payload.shamsi_month,
            stream=payload.stream,
            committed_count=payload.committed_count,
            reason=payload.reason,
            comment=payload.comment,
        )
    )

    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.SUBMITTED,
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
    stream: PlanStream = Query("DT", description="DT or ACCEPTANCE"),
    db: Session = Depends(get_db),
    user: User = Depends(require_queue_reader),
) -> MonthlyPlanQueueOut:
    """Every contractor's standing for the month, filed or not.

    Closed to contractors: this is a list of what every other company in the
    programme has committed to, and no contractor has any business reading it.
    """
    rows = _guard(lambda: plans.queue_rows(db, year, month, stream))
    in_force = plans.approved_pip_in_force(db, year, month, stream)

    # The month now running, for every contractor this caller may see. Same
    # service the contractor's own screen reads, so a figure here and a figure
    # there cannot disagree about the same company and month.
    running = plans.running_month(db, user)
    standing = running["rows"]

    return MonthlyPlanQueueOut(
        shamsi_year=year,
        shamsi_month=month,
        shamsi_month_name=jalali.month_name(month),
        label=plans.month_label(year, month),
        stream=stream,
        deadline_shamsi=jalali.format_shamsi(plans.deadline_for(year, month)),
        deadline_passed=plans.deadline_has_passed(year, month),
        days_remaining=plans.days_remaining(year, month),
        current_month=MonthStanding(
            **{k: v for k, v in running.items() if k != "rows"}
        ),
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
                in_force_count=in_force.get(contractor.id),
                revision_reason=plan.revision_reason if plan is not None else None,
                revision_comment=plan.revision_comment if plan is not None else None,
                # A contractor the running month never touched has no row in
                # the scorecard, which is an answer and not a gap: they held
                # nothing and delivered nothing.
                assignment=standing.get(contractor.id, {}).get("available", 0),
                pip=standing.get(contractor.id, {}).get("pip"),
                delivered=standing.get(contractor.id, {}).get("delivered", 0),
            )
            for contractor, plan, previous in rows
        ],
    )


#: Who may read the overview: the staff roles the Monthly Plan page is open to
#: (``MONTHLY_PLAN_ROLES`` less Contractor). Not Admin, whom the page does not
#: serve, and never a contractor: the response carries MTN's internal target
#: and every company's numbers.
OVERVIEW_READERS = (PM, COORDINATOR, REGIONAL, VIEWER)
require_overview_reader = require_roles(*OVERVIEW_READERS)


@router.get("/overview", response_model=PipOverviewOut)
def overview(
    period: str = Query("month", description="month, year or since_start"),
    year: int | None = Query(None, description="Shamsi year; the running month if omitted"),
    month: int | None = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    user: User = Depends(require_overview_reader),
) -> PipOverviewOut:
    """The PM's Monthly Plan page: DT and Acceptance side by side, one read.

    KPIs, an All-contractors row, one row per contractor (non-filers
    included), a 12-month trend, and what needs attention now. See
    ``services/pip_overview.py`` for how each figure is made.
    """
    try:
        data = pip_overview.overview(db, user, period=period, year=year, month=month)
    except (pip_overview.OverviewError, plans.PlanError) as exc:
        raise HTTPException(400, str(exc)) from None
    return PipOverviewOut(**data)


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
    """Lock a submitted plan, or a revision request, as the month's target.

    PM only. Admin gets a 403 here by design — see the module docstring. A
    revision request can only be approved up to the end of day 15; after it,
    the approved plan is final and the request can only be returned.
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
    """Send a submitted plan or a revision request back, with the reason.

    A returned revision leaves the approved version in force. PM only, and the
    comment is required: a number returned without one tells
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


# ---------------------------------------------------------------- scorecard
#
# The month-by-month record behind the form above: what was committed, what
# was in the contractor's hands to work on, and what they delivered.
#
# It lives on this router rather than beside ``/drive-test/plan-delivery``
# because it is the Monthly Plan screen's data and carries this router's
# permission rule -- a contractor account reaches its own figures and cannot
# construct a request that names another company. The computation itself is
# ``DriveTestAnalytics.scorecard``, so the month a drive test counts into is
# decided by the same code the Drive Test dashboard uses and the two can never
# disagree about it.


def _periods(months: int, year: int | None) -> list[tuple[int, int]]:
    """The Shamsi months to report on, oldest first.

    A whole Shamsi year when one is named, otherwise the rolling window ending
    with the current month. Rolling rather than year-to-date because in
    فروردین a year-to-date window is one month long, and one month is not a
    record of anything.
    """
    if year is not None:
        return [(year, m) for m in range(1, 13)]
    return plans.trailing_periods(months)


@router.get("/scorecard", response_model=ScorecardOut)
def scorecard(
    months: int = Query(12, ge=1, le=36),
    year: int | None = Query(None, description="A whole Shamsi year instead"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ScorecardOut:
    """Commitment against delivery, month by month, for whoever is asking.

    A contractor sees only their own company; everyone else sees every
    contractor, with the per-contractor rows nested inside each month. The
    narrowing happens inside the service, on the way in, not to the rows on
    the way out.
    """
    return ScorecardOut(**DriveTestAnalytics(db, user).scorecard(_periods(months, year)))


def _revision_counts(
    db: Session, user: User, periods: list[tuple[int, int]]
) -> dict[str, dict[tuple[int, int, int], int]]:
    """Revision requests per stream, keyed by (contractor, year, month).

    A revision is a version the contractor asked for with a reason; a plan
    returned and handed in again is not one. Narrowed to the caller's own
    company in the query for a contractor account.
    """
    from sqlalchemy import func, select, tuple_

    stmt = (
        select(
            ContractorMonthlyPlan.stream,
            ContractorMonthlyPlan.contractor_id,
            ContractorMonthlyPlan.shamsi_year,
            ContractorMonthlyPlan.shamsi_month,
            func.count(),
        )
        .where(
            ContractorMonthlyPlan.revision_reason.is_not(None),
            tuple_(ContractorMonthlyPlan.shamsi_year, ContractorMonthlyPlan.shamsi_month).in_(periods),
        )
        .group_by(
            ContractorMonthlyPlan.stream,
            ContractorMonthlyPlan.contractor_id,
            ContractorMonthlyPlan.shamsi_year,
            ContractorMonthlyPlan.shamsi_month,
        )
    )
    if user.role.name == CONTRACTOR:
        stmt = stmt.where(ContractorMonthlyPlan.contractor_id == (user.contractor_id or -1))
    out: dict[str, dict[tuple[int, int, int], int]] = {stream: {} for stream in PLAN_STREAMS}
    for stream, cid, y, m, n in db.execute(stmt).all():
        out.setdefault(stream, {})[(cid, y, m)] = n
    return out


def _plan_export(db: Session, user: User, period: str, year: int | None, month: int | None) -> Response:
    """Every stream for the page's period, one sheet each (``PLAN_SHEETS``)."""
    from app.services import acceptance_plan as targets

    today = jalali.tehran_today()
    ry, rm, _ = jalali.to_shamsi_date(today)
    if (year is None) != (month is None):
        # Year view sends a year alone; the month is then irrelevant.
        if period == "year" and year is not None:
            month = 1
        else:
            raise HTTPException(400, "Give both year and month, or neither")
    if year is None:
        year, month = ry, rm
    _guard(lambda: plans.validate_period(year, month))
    try:
        periods = pip_overview.period_months(db, period, year, month, (ry, rm))
    except pip_overview.OverviewError as exc:
        raise HTTPException(400, str(exc)) from None

    scorecards = {
        stream: (
            DriveTestAnalytics(db, user).scorecard(periods)
            if stream == STREAM_DT
            else targets.acceptance_scorecard(db, user, periods, stream)
        )
        for stream in PLAN_STREAMS
    }
    internal = None
    if user.role.name != CONTRACTOR:
        # MTN's own number, staff only. A contractor's file never carries it.
        internal = {
            stream: {
                (y, m): (t.target_count if (t := targets.get_current_target(db, y, m, stream)) else None)
                for y, m in periods
            }
            for stream in PLAN_STREAMS
        }
    content = pip_export.plan_workbook(
        scorecards, revisions=_revision_counts(db, user, periods), internal=internal
    )
    stamp = (jalali.format_shamsi(date.today()) or "").replace("/", "-")
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="pip-plan-{period}-{stamp}.xlsx"'
        },
    )


@router.get("/scorecard.xlsx")
def scorecard_export(
    months: int = Query(12, ge=1, le=36),
    year: int | None = Query(None),
    period: str | None = Query(
        None, description="month, year or since_start: the Monthly Plan export, every stream"
    ),
    month: int | None = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The same figures as a workbook, scoped identically.

    With ``period`` (the Monthly Plan page's Month / Year / Since start), the
    file follows that period and carries every stream: "DT Delivery",
    "Acceptance", "ICT" and "CRA" sheets, each with a row per contractor per
    month, a total per month and a grand total, and -- for staff only -- the
    Internal PIP per month.
    Without it, the older scorecard workbook below, unchanged.

    Same service call as the screen, so the file cannot report something the
    page does not -- and same scoping, so a contractor downloads their own
    months and nobody else's.

    The full ledger goes in the file even though the screen folds it into one
    column: a spreadsheet has room, and the columns that let a reader check
    that the balances close are the ones worth exporting.
    """
    if period is not None:
        return _plan_export(db, user, period, year, month)
    data = DriveTestAnalytics(db, user).scorecard(_periods(months, year))
    stamp = (jalali.format_shamsi(date.today()) or "").replace("/", "-")
    return Response(
        content=pip_export.scorecard_workbook(data),
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="pip-scorecard-{stamp}.xlsx"'
        },
    )


@router.get("/revisions", response_model=PlanRevisionsOut)
def revisions(
    year: int = Query(..., description="Shamsi year"),
    month: int = Query(..., ge=1, le=12),
    contractor_id: int | None = Query(
        None, description="Staff only; a contractor always reads their own"
    ),
    stream: PlanStream = Query("DT", description="DT or ACCEPTANCE"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PlanRevisionsOut:
    """Every version of one contractor's plan for one stream and month, oldest first.

    Each version says who handed it in or asked for it and when, who decided
    it and when, and which one is in force.

    Nothing is reconstructed here: the table already keeps a row per version,
    which is what the append-on-revision rule exists for. This reads them.

    ``contractor_id`` is ignored for a contractor account, which always reads
    its own -- so the parameter cannot become the request that names another
    company, and a contractor passing one gets their own plan back rather than
    an error that would confirm the other id exists.
    """
    if user.role.name == CONTRACTOR:
        contractor_id = _own_contractor(user)
    else:
        if user.role.name not in QUEUE_READERS:
            raise HTTPException(403, "You do not have permission to read plans")
        if contractor_id is None:
            raise HTTPException(400, "contractor_id is required")

    _guard(lambda: plans.validate_period(year, month))
    rows = plans.all_versions(db, contractor_id, year, month, stream)
    contractor = db.get(Contractor, contractor_id)
    if contractor is None:
        raise HTTPException(404, "No such contractor")

    who = plans.user_names(
        db, {p.decided_by for p in rows} | {p.submitted_by for p in rows}
    )
    approved = [p.version for p in rows if p.status == STATUS_APPROVED]
    in_force_version = max(approved) if approved else None
    return PlanRevisionsOut(
        contractor_id=contractor_id,
        contractor_name=contractor.name,
        stream=stream,
        shamsi_year=year,
        shamsi_month=month,
        shamsi_month_name=jalali.month_name(month),
        revisions=[
            PlanRevision(
                version=p.version,
                status=p.status,
                committed_count=p.committed_count,
                is_current=p.is_current,
                in_force=p.version == in_force_version,
                is_late=plans.is_late(p),
                return_comment=p.return_comment,
                revision_reason=p.revision_reason,
                revision_comment=p.revision_comment,
                submitted_by=who.get(p.submitted_by),
                submitted_at=p.submitted_at,
                submitted_shamsi=jalali.format_shamsi(
                    p.submitted_at.date() if p.submitted_at else None
                ),
                decided_at=p.decided_at,
                decided_shamsi=jalali.format_shamsi(
                    p.decided_at.date() if p.decided_at else None
                ),
                decided_by=who.get(p.decided_by),
            )
            for p in rows
        ],
    )


# ---------------------------------------------------------------------------
# MTN internal target: the PM's own number per stream, not a contractor's PIP
# ---------------------------------------------------------------------------
def _target_period(target, names: dict[int, str]) -> InternalTargetPeriod:
    return InternalTargetPeriod(
        stream=target.stream,
        shamsi_year=target.shamsi_year,
        shamsi_month=target.shamsi_month,
        shamsi_month_name=jalali.month_name(target.shamsi_month),
        version=target.version,
        target_count=target.target_count,
        set_by=names.get(target.set_by),
        set_at=target.set_at,
        note=target.note,
    )


@router.get("/internal-target", response_model=InternalTargetOut)
def internal_target(
    stream: PlanStream = Query(..., description="DT or ACCEPTANCE"),
    year: int | None = Query(None, description="Shamsi year; the running month if omitted"),
    month: int | None = Query(None, ge=1, le=12),
    months: int = Query(12, ge=1, le=internal_targets.MAX_HISTORY_MONTHS),
    db: Session = Depends(get_db),
    user: User = Depends(require_queue_reader),
) -> InternalTargetOut:
    """One stream's MTN internal target for a month, the month before, and history.

    Staff only, for every stream: this is what MTN commits to management, set
    against the contractors' own PIPs, and no contractor reads it here.
    (``GET /acceptance/plan`` keeps its own, older read rule for the
    Acceptance target; it is unchanged.)

    ``DT`` is a monthly amount; ``ACCEPTANCE`` is cumulative.
    """
    if (year is None) != (month is None):
        raise HTTPException(400, "Give both year and month, or neither")
    if year is None:
        year, month = jalali.current_shamsi_period()
    _guard(lambda: plans.validate_period(year, month))

    current = internal_targets.get_current_target(db, year, month, stream)
    prev_year, prev_month = jalali.previous_period(year, month)
    previous = internal_targets.get_current_target(db, prev_year, prev_month, stream)
    history = internal_targets.recent_targets(
        db, upto_year=year, upto_month=month, months=months, stream=stream
    )
    names = plans.user_names(
        db, {t.set_by for t in [current, previous, *history] if t is not None}
    )
    return InternalTargetOut(
        stream=stream,
        shamsi_year=year,
        shamsi_month=month,
        shamsi_month_name=jalali.month_name(month),
        current=_target_period(current, names) if current is not None else None,
        previous=_target_period(previous, names) if previous is not None else None,
        history=[_target_period(t, names) for t in history],
    )


@router.put("/internal-target", response_model=InternalTargetPeriod)
def set_internal_target(
    payload: InternalTargetWrite,
    db: Session = Depends(get_db),
    user: User = Depends(require_pm),
) -> InternalTargetPeriod:
    """Set one stream's MTN internal target for one Shamsi month.

    PM only; Admin gets 403, like every other operational decision on this
    router. Always appends a new version -- the number a month was measured
    against is never rewritten.
    """
    before = internal_targets.get_current_target(
        db, payload.shamsi_year, payload.shamsi_month, payload.stream
    )
    try:
        target = internal_targets.set_target(
            db,
            year=payload.shamsi_year,
            month=payload.shamsi_month,
            target_count=payload.target_count,
            user=user,
            note=payload.note,
            stream=payload.stream,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None

    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.CREATED,
        module="PIP",
        entity_type="AcceptanceMonthlyTarget",
        entity_id=target.id,
        old_value=(
            {"target_count": before.target_count, "version": before.version}
            if before is not None
            else None
        ),
        new_value={
            "stream": target.stream,
            "shamsi_year": target.shamsi_year,
            "shamsi_month": target.shamsi_month,
            "target_count": target.target_count,
            "version": target.version,
        },
        reason=target.note,
    )
    db.commit()
    db.refresh(target)
    return _target_period(target, plans.user_names(db, {target.set_by}))
