"""Contractor monthly plan (PIP): the rules.

Everything that writes ``contractor_monthly_plans`` goes through here. The API
layer checks who is asking and translates a rule violation into a 400; it holds
no rules of its own.

Two of the rules are load-bearing and neither is enforced by the database, so
they are worth naming before the code:

**One current version per contractor per month.** Creating a new version flips
the previous one's ``is_current`` in the same transaction. A partial unique
index would say the same thing to PostgreSQL, but the test suite builds its
database on SQLite, which treats partial indexes differently — a guarantee that
production has and the tests cannot exercise is a guarantee nobody is checking.
So it lives here, where the tests reach it.

**The status transitions.** Anything not in :data:`ALLOWED_TRANSITIONS` is
refused. An ``Approved`` row is immutable: it is a target somebody is measured
against, and a target that can be edited afterwards measures nothing.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.monthly_plan import (
    STATUS_APPROVED,
    STATUS_DRAFT,
    STATUS_RETURNED,
    STATUS_SUBMITTED,
    ContractorMonthlyPlan,
)
from app.models.reference import Contractor, User
from app.models.workitem import Assignment, WorkItem
from app.services.visibility import visible_work_item_ids
from app.services.workflow import STAGE_DT_DONE

# ---------------------------------------------------------------------------
# Bounds
# ---------------------------------------------------------------------------
#: The plan is a count of drive tests one contractor commits to in one month.
#: The whole programme is a few tens of thousands of sites over its life, so a
#: five-figure monthly commitment is a typo, not a promise. The cap exists to
#: catch a stray keystroke, not to express policy.
MAX_COMMITTED_COUNT = 10_000

#: A plausible range of Shamsi years. Wide enough that nobody planning ahead
#: hits it, narrow enough that ``14005`` or ``2025`` is refused at the door.
MIN_SHAMSI_YEAR = 1390
MAX_SHAMSI_YEAR = 1500

#: Long enough for a PM to say what is wrong with a number and what they want
#: instead. Anything past this is a document, and belongs somewhere else.
MAX_RETURN_COMMENT = 1000

#: The plan is due on day 3 of the month it covers. Later submissions are
#: accepted — a plan filed late is worth more than no plan — and recorded as
#: late through ``submitted_at``, which is what :func:`is_late` reads. This is
#: deliberately not a hard block.
DEADLINE_DAY = 3

#: How many months of a contractor's own history the API will hand back at
#: once. The screen shows a trend, not an archive.
MAX_HISTORY_MONTHS = 36

#: Draft and Returned are the two states the contractor still owns, so both
#: accept an edit and both submit. Submitted is nobody's to edit — the PM owes
#: a decision on the number they were given — and Approved is nobody's at all,
#: which is what :func:`revise` exists for.
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    STATUS_DRAFT: (STATUS_DRAFT, STATUS_SUBMITTED),
    STATUS_RETURNED: (STATUS_RETURNED, STATUS_SUBMITTED),
    STATUS_SUBMITTED: (STATUS_APPROVED, STATUS_RETURNED),
    STATUS_APPROVED: (),
}


class PlanError(ValueError):
    """A rule violation, with a message meant for the person who caused it."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_period(year: int, month: int) -> None:
    """Refuse a Shamsi period that cannot exist.

    Pydantic checks the same bounds on the request bodies. This is here as
    well because the query-string endpoints and any future internal caller
    reach the service without passing through a schema, and a plan filed
    against month 13 is a row nothing will ever find again.
    """
    if not MIN_SHAMSI_YEAR <= year <= MAX_SHAMSI_YEAR:
        raise PlanError(
            f"Year must be between {MIN_SHAMSI_YEAR} and {MAX_SHAMSI_YEAR}"
        )
    if not 1 <= month <= 12:
        raise PlanError("Month must be between 1 and 12")


def validate_count(count: int | None, *, required: bool) -> None:
    """Refuse a commitment that is missing when it is needed, or impossible."""
    if count is None:
        if required:
            raise PlanError("A committed count is required to submit a plan")
        return
    if count < 0:
        raise PlanError("The committed count cannot be negative")
    if count > MAX_COMMITTED_COUNT:
        raise PlanError(
            f"The committed count cannot be more than {MAX_COMMITTED_COUNT}"
        )


def _check_transition(current: str, target: str) -> None:
    if target not in ALLOWED_TRANSITIONS.get(current, ()):
        if current == STATUS_APPROVED:
            raise PlanError(
                "This month's plan is approved and cannot be edited. "
                "Submit a revision instead."
            )
        raise PlanError(f"A {current} plan cannot become {target}")


# ---------------------------------------------------------------------------
# The deadline
# ---------------------------------------------------------------------------
def deadline_for(year: int, month: int) -> date:
    """The Gregorian date that day 3 of this Shamsi month falls on.

    Stored dates are Gregorian and displayed Shamsi throughout the platform,
    and this is no different: the deadline is expressed in the calendar the
    contractor works in and compared in the one the database keeps.
    """
    return jalali.from_shamsi_date(year, month, DEADLINE_DAY)


def deadline_has_passed(year: int, month: int, today: date | None = None) -> bool:
    """Whether day 3 of that Shamsi month is behind us."""
    return (today or date.today()) > deadline_for(year, month)


def is_late(plan: ContractorMonthlyPlan) -> bool:
    """Whether this plan was handed in after its month's deadline.

    Derived from ``submitted_at`` rather than stored as a flag. A stored one
    would be a second copy of a fact the timestamp already carries, free to
    drift from it, and would have to be got right at every write; this cannot
    be wrong unless the timestamp is.
    """
    if plan.submitted_at is None:
        return False
    submitted = plan.submitted_at
    if submitted.tzinfo is None:
        # SQLite hands back naive datetimes for values written as aware ones,
        # and comparing the two raises. Everything here is written in UTC.
        submitted = submitted.replace(tzinfo=timezone.utc)
    return submitted.date() > deadline_for(plan.shamsi_year, plan.shamsi_month)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def current_plan(
    db: Session, contractor_id: int, year: int, month: int
) -> ContractorMonthlyPlan | None:
    """The live version of one contractor's plan for one month, or None.

    Keyed by contractor rather than by user, which is the whole of decision 2:
    a second account at the same company opening this month finds the plan its
    colleague started, not an empty form.
    """
    return db.execute(
        select(ContractorMonthlyPlan).where(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
            ContractorMonthlyPlan.is_current.is_(True),
        )
    ).scalar_one_or_none()


def previous_approved_count(
    db: Session, contractor_id: int, year: int, month: int
) -> int | None:
    """Last month's approved commitment for this contractor, or None.

    The single most useful number to put in front of somebody filling in this
    month's: almost every plan is last month's figure adjusted.
    """
    prev_year, prev_month = jalali.previous_period(year, month)
    plan = current_plan(db, contractor_id, prev_year, prev_month)
    if plan is None or plan.status != STATUS_APPROVED:
        return None
    return plan.committed_count


def open_assignment_count(db: Session, user: User) -> int:
    """How many sites this contractor holds that still owe a drive test.

    An active assignment whose drive test is not yet approved. Deliberately
    built on ``visible_work_item_ids`` — the platform's one scoping function —
    rather than on a filter written for this screen, so a contractor cannot
    be shown a count that includes work they cannot see.
    """
    if user.contractor_id is None:
        return 0
    return (
        db.query(WorkItem.id)
        .join(Assignment, Assignment.work_item_id == WorkItem.id)
        .filter(
            WorkItem.deleted_at.is_(None),
            WorkItem.id.in_(visible_work_item_ids(user, db)),
            Assignment.contractor_id == user.contractor_id,
            Assignment.is_active.is_(True),
            WorkItem.current_stage != STAGE_DT_DONE,
        )
        .distinct()
        .count()
    )


def history(
    db: Session, contractor_id: int, months: int
) -> list[tuple[int, int, ContractorMonthlyPlan | None]]:
    """The last *months* Shamsi periods, newest first, with each one's plan.

    Every period is returned whether or not a plan exists for it. A month the
    contractor never filed is a fact about the contractor, and dropping the row
    would let a six-month history quietly show four months and read as
    complete.
    """
    months = max(1, min(months, MAX_HISTORY_MONTHS))
    year, month = jalali.current_shamsi_period()
    out: list[tuple[int, int, ContractorMonthlyPlan | None]] = []
    for _ in range(months):
        out.append((year, month, current_plan(db, contractor_id, year, month)))
        year, month = jalali.previous_period(year, month)
    return out


def queue_rows(
    db: Session, year: int, month: int
) -> list[tuple[Contractor, ContractorMonthlyPlan | None, int | None]]:
    """One row per contractor for the PM's queue, submitted or not.

    The contractors who have not filed are the point of this screen — a queue
    of only the plans that arrived cannot show the PM who is missing. So the
    list is driven by the contractors, and the plan is what may be absent.

    Active contractors, plus any inactive one that has a plan for this month:
    deactivating a company should not make a decision the PM still owes
    disappear from the queue it is owed in.
    """
    validate_period(year, month)

    with_a_plan = select(ContractorMonthlyPlan.contractor_id).where(
        ContractorMonthlyPlan.shamsi_year == year,
        ContractorMonthlyPlan.shamsi_month == month,
    )
    contractors = (
        db.query(Contractor)
        .filter(
            Contractor.active.is_(True) | Contractor.id.in_(with_a_plan),
        )
        .order_by(Contractor.name)
        .all()
    )

    rows = []
    for contractor in contractors:
        plan = current_plan(db, contractor.id, year, month)
        previous = previous_approved_count(db, contractor.id, year, month)
        rows.append((contractor, plan, previous))
    return rows


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def _clear_current(db: Session, contractor_id: int, year: int, month: int) -> None:
    """Take ``is_current`` off every row for this contractor and month.

    Called immediately before a new version is inserted, in the same
    transaction, which is what keeps "exactly one current version" true
    without a partial index.
    """
    rows = (
        db.query(ContractorMonthlyPlan)
        .filter(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
            ContractorMonthlyPlan.is_current.is_(True),
        )
        .all()
    )
    for row in rows:
        row.is_current = False


def _next_version(db: Session, contractor_id: int, year: int, month: int) -> int:
    highest = (
        db.query(ContractorMonthlyPlan.version)
        .filter(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
        )
        .order_by(ContractorMonthlyPlan.version.desc())
        .limit(1)
        .scalar()
    )
    return (highest or 0) + 1


def save_plan(
    db: Session,
    *,
    contractor_id: int,
    user: User,
    year: int,
    month: int,
    committed_count: int | None,
    submit: bool,
) -> ContractorMonthlyPlan:
    """Create or update this month's plan, optionally submitting it.

    One entry point for both, because from the contractor's side they are one
    form with two buttons, and splitting them into two endpoints would mean
    two places that have to agree about which month is being written.

    A plan already awaiting a PM's decision is refused rather than silently
    edited: the number the PM is looking at has to be the number that was
    handed to them. An approved one is refused too — :func:`revise` is the way
    past that, and it is a deliberate, separate act.
    """
    validate_period(year, month)
    validate_count(committed_count, required=submit)

    plan = current_plan(db, contractor_id, year, month)

    if plan is not None:
        # Two states this endpoint will not touch, spelled out here rather
        # than left to the transition table so each one can say what to do
        # instead. Both are refusals to edit a number somebody else is
        # already acting on.
        if plan.status == STATUS_APPROVED:
            raise PlanError(
                "This month's plan is approved and cannot be edited. "
                "Submit a revision instead."
            )
        if plan.status == STATUS_SUBMITTED:
            raise PlanError(
                "This month's plan has been submitted and is waiting on the "
                "PM. Ask for it to be returned before changing it."
            )

    if plan is None:
        plan = ContractorMonthlyPlan(
            contractor_id=contractor_id,
            shamsi_year=year,
            shamsi_month=month,
            version=_next_version(db, contractor_id, year, month),
            is_current=True,
            status=STATUS_DRAFT,
            is_default=False,
        )
        # Defensive: nothing should be current if the read above found
        # nothing, but if a row ever were, two current versions would be
        # worse than a redundant update.
        _clear_current(db, contractor_id, year, month)
        db.add(plan)

    plan.committed_count = committed_count
    if submit:
        _check_transition(plan.status, STATUS_SUBMITTED)
        plan.status = STATUS_SUBMITTED
        plan.submitted_by = user.id
        plan.submitted_at = _now()
        # The decision fields describe the decision that produced the current
        # status, and a resubmission has not had one yet. ``return_comment``
        # stays: it is what the contractor is answering and what the PM will
        # read next to the new number. Who returned it, and when, is in the
        # audit log either way.
        plan.decided_by = None
        plan.decided_at = None

    db.flush()
    return plan


def revise(
    db: Session,
    *,
    contractor_id: int,
    user: User,
    year: int,
    month: int,
    committed_count: int,
) -> ContractorMonthlyPlan:
    """Open the next version of an approved plan, as a draft.

    The approved row is left exactly as it was decided and stops being
    current; the new row carries ``version = previous + 1``. Both stay
    readable, which is the point — a revision is a second promise, not a
    correction of the record of the first.

    It arrives as a Draft rather than as a submission, so the SC gets the same
    save-then-submit as any other month and there is only one code path that
    hands a plan to a PM.
    """
    validate_period(year, month)
    validate_count(committed_count, required=True)

    approved = current_plan(db, contractor_id, year, month)
    if approved is None:
        raise PlanError("There is no plan for this month to revise")
    if approved.status != STATUS_APPROVED:
        raise PlanError("Only an approved plan is revised; edit this one instead")

    _clear_current(db, contractor_id, year, month)
    plan = ContractorMonthlyPlan(
        contractor_id=contractor_id,
        shamsi_year=year,
        shamsi_month=month,
        version=_next_version(db, contractor_id, year, month),
        is_current=True,
        status=STATUS_DRAFT,
        is_default=False,
        committed_count=committed_count,
    )
    db.add(plan)
    db.flush()
    return plan


def approve(
    db: Session, *, plan: ContractorMonthlyPlan, user: User
) -> ContractorMonthlyPlan:
    """Lock a submitted plan as this contractor's target for the month."""
    _check_transition(plan.status, STATUS_APPROVED)
    plan.status = STATUS_APPROVED
    plan.decided_by = user.id
    plan.decided_at = _now()
    db.flush()
    return plan


def return_plan(
    db: Session, *, plan: ContractorMonthlyPlan, user: User, comment: str
) -> ContractorMonthlyPlan:
    """Send a submitted plan back, with the reason attached.

    The comment is required and is the whole value of returning rather than
    rejecting: a number sent back without one tells the contractor that the PM
    disagreed and nothing about what to write instead.
    """
    comment = (comment or "").strip()
    if not comment:
        raise PlanError("A comment is required when returning a plan")
    if len(comment) > MAX_RETURN_COMMENT:
        raise PlanError(
            f"The comment cannot be longer than {MAX_RETURN_COMMENT} characters"
        )
    _check_transition(plan.status, STATUS_RETURNED)
    plan.status = STATUS_RETURNED
    plan.decided_by = user.id
    plan.decided_at = _now()
    plan.return_comment = comment
    db.flush()
    return plan


def audit_snapshot(plan: ContractorMonthlyPlan) -> dict:
    """The fields of a plan worth recording in the audit log."""
    return {
        "status": plan.status,
        "committed_count": plan.committed_count,
        "version": plan.version,
        "shamsi_year": plan.shamsi_year,
        "shamsi_month": plan.shamsi_month,
        "contractor_id": plan.contractor_id,
        "return_comment": plan.return_comment,
    }


def acts_for_contractor(user: User) -> int:
    """The contractor this account may read and write plans for.

    Raises rather than returning None, because every caller's next step is to
    scope a query by the result — a None that reached a query would widen it
    to every contractor, which is exactly the leak this guards.
    """
    if user.contractor_id is None:
        raise PermissionError(
            "Only a contractor account can work on a contractor's monthly plan"
        )
    return user.contractor_id

