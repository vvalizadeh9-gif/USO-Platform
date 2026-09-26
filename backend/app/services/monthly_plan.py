"""Contractor monthly plan (PIP): the rules.

Everything that writes ``contractor_monthly_plans`` goes through here. The API
layer checks who is asking and translates a rule violation into a 400; it holds
no rules of its own.

Two of the rules are load-bearing and neither is enforced by the database, so
they are worth naming before the code:

**One current version per contractor per stream per month.** Creating a new
version flips the previous one's ``is_current`` in the same transaction. A partial unique
index would say the same thing to PostgreSQL, but the test suite builds its
database on SQLite, which treats partial indexes differently — a guarantee that
production has and the tests cannot exercise is a guarantee nobody is checking.
So it lives here, where the tests reach it.

**The status transitions.** Anything not in :data:`ALLOWED_TRANSITIONS` is
refused. An ``Approved`` row is immutable: it is a target somebody is measured
against, and a target that can be edited afterwards measures nothing.

And one definition worth naming because two nearly-identical ones exist:
**current** is the latest version, whatever its status; **in force** is the
latest *approved* version, and is the PIP. They part company while a revision
is pending or after one was returned -- the approved number stays in force
until a revision of it is approved. :func:`in_force_plan` and
:func:`approved_pip_in_force` are the only places that decide which row that
is.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.monthly_plan import (
    PLAN_STREAMS,
    REASON_OTHER,
    REVISION_REASONS,
    STATUS_APPROVED,
    STATUS_DRAFT,
    STATUS_RETURNED,
    STATUS_REVISION_REQUESTED,
    STATUS_REVISION_RETURNED,
    STATUS_SUBMITTED,
    STREAM_DT,
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

#: The same limit for the contractor's side of a revision request.
MAX_REVISION_COMMENT = 1000

#: Revisions of an approved plan close at the end of this day of the month the
#: plan covers, on the Tehran clock. After it, the approved PIP is final.
REVISION_CUTOFF_DAY = 15

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
#: which is what :func:`request_revision` exists for. A revision request is
#: the PM's to decide, and once decided it is final either way: approved, it is
#: the new PIP in force; returned, it is the record of a request that was
#: turned down, and a second request is a new version.
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    STATUS_DRAFT: (STATUS_DRAFT, STATUS_SUBMITTED),
    STATUS_RETURNED: (STATUS_RETURNED, STATUS_SUBMITTED),
    STATUS_SUBMITTED: (STATUS_APPROVED, STATUS_RETURNED),
    STATUS_APPROVED: (),
    STATUS_REVISION_REQUESTED: (STATUS_APPROVED, STATUS_REVISION_RETURNED),
    STATUS_REVISION_RETURNED: (),
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


def validate_stream(stream: str) -> None:
    """Refuse a stream that is not one of :data:`PLAN_STREAMS`."""
    if stream not in PLAN_STREAMS:
        raise PlanError(f"Stream must be one of {', '.join(PLAN_STREAMS)}")


def validate_revision_reason(reason: str, comment: str | None) -> str | None:
    """Refuse a revision request whose reason is missing or unexplained.

    Returns the comment trimmed, or None when there is nothing in it.
    """
    if reason not in REVISION_REASONS:
        raise PlanError(
            f"The reason must be one of {', '.join(REVISION_REASONS)}"
        )
    comment = (comment or "").strip() or None
    if reason == REASON_OTHER and comment is None:
        raise PlanError("A comment is required when the reason is OTHER")
    if comment is not None and len(comment) > MAX_REVISION_COMMENT:
        raise PlanError(
            f"The comment cannot be longer than {MAX_REVISION_COMMENT} characters"
        )
    return comment


def _check_transition(current: str, target: str) -> None:
    if target not in ALLOWED_TRANSITIONS.get(current, ()):
        if current == STATUS_APPROVED:
            raise PlanError(
                "This month's plan is approved and cannot be edited. "
                "Request a revision instead."
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


def revision_window_open(year: int, month: int, today: date | None = None) -> bool:
    """Whether an approved plan for this month may still be revised.

    Only a plan for the month now running, and only up to the end of day
    :data:`REVISION_CUTOFF_DAY` of it -- both on the Tehran clock. A month
    that has not started yet has no approved plan to revise in the sense this
    rule means (its plan is still being agreed), and a month that has ended is
    closed.
    """
    ref_year, ref_month, ref_day = jalali.to_shamsi_date(
        today or jalali.tehran_today()
    )
    return (ref_year, ref_month) == (year, month) and ref_day <= REVISION_CUTOFF_DAY


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def current_plan(
    db: Session,
    contractor_id: int,
    year: int,
    month: int,
    stream: str = STREAM_DT,
) -> ContractorMonthlyPlan | None:
    """The latest version of one contractor's plan for one stream and month.

    Keyed by contractor rather than by user, which is the whole of decision 2:
    a second account at the same company opening this month finds the plan its
    colleague started, not an empty form.

    This is the row the contractor works on and the PM decides. It is *not*
    necessarily the PIP -- see :func:`in_force_plan`.
    """
    return db.execute(
        select(ContractorMonthlyPlan).where(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.stream == stream,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
            ContractorMonthlyPlan.is_current.is_(True),
        )
    ).scalar_one_or_none()


def in_force_plan(
    db: Session,
    contractor_id: int,
    year: int,
    month: int,
    stream: str = STREAM_DT,
) -> ContractorMonthlyPlan | None:
    """The approved version in force for one contractor, stream and month.

    The highest approved version. A pending or returned revision above it
    does not displace it: the approved number stays in force until a revision
    of it is approved, and then that revision is the highest approved version.
    """
    return db.execute(
        select(ContractorMonthlyPlan)
        .where(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.stream == stream,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
            ContractorMonthlyPlan.status == STATUS_APPROVED,
        )
        .order_by(ContractorMonthlyPlan.version.desc())
        .limit(1)
    ).scalar_one_or_none()


def approved_pip_in_force(
    db: Session,
    year: int,
    month: int,
    stream: str = STREAM_DT,
    contractor_id: int | None = None,
) -> dict[int, int]:
    """Every contractor's PIP in force for one stream and month, by id.

    The bulk form of :func:`in_force_plan`, for readers that want the whole
    month at once (the scorecard, the programme total). ``contractor_id``
    narrows it in the query, so a contractor-scoped caller never loads a
    competitor's number to throw it away afterwards.
    """
    stmt = (
        select(
            ContractorMonthlyPlan.contractor_id,
            ContractorMonthlyPlan.committed_count,
        )
        .where(
            ContractorMonthlyPlan.stream == stream,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
            ContractorMonthlyPlan.status == STATUS_APPROVED,
        )
        # Ascending, so the highest approved version is the one left standing
        # when the rows are folded into the dict below.
        .order_by(ContractorMonthlyPlan.version)
    )
    if contractor_id is not None:
        stmt = stmt.where(ContractorMonthlyPlan.contractor_id == contractor_id)
    out: dict[int, int] = {}
    for cid, count in db.execute(stmt).all():
        out[cid] = count or 0
    return out


def previous_approved_count(
    db: Session,
    contractor_id: int,
    year: int,
    month: int,
    stream: str = STREAM_DT,
) -> int | None:
    """Last month's approved commitment for this contractor, or None.

    The single most useful number to put in front of somebody filling in this
    month's: almost every plan is last month's figure adjusted.
    """
    prev_year, prev_month = jalali.previous_period(year, month)
    plan = in_force_plan(db, contractor_id, prev_year, prev_month, stream)
    return plan.committed_count if plan is not None else None


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
    db: Session, contractor_id: int, months: int, stream: str = STREAM_DT
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
        out.append((year, month, current_plan(db, contractor_id, year, month, stream)))
        year, month = jalali.previous_period(year, month)
    return out


# ---------------------------------------------------------------------------
# The three figures the contractor's screen is built on
#
# Assignment, PIP and Delivered mean one thing on every screen in the
# platform, and they mean it because they come from one place:
# ``DriveTestAnalytics.scorecard``, which is also what the Drive Test
# dashboard reads. Nothing here recomputes them. If the screen and the
# dashboard could disagree about a month, eventually they would, and the
# argument that followed would be about which one to believe rather than
# about the work.
#
# The vocabulary, once, so the rest of this section can use it plainly:
#
#   Assignment -- the sites the contractor holds in that month: carried in
#                 from earlier months plus newly assigned during it. A stock,
#                 not a flow, which is why two months' assignment cannot be
#                 added together.
#   PIP        -- the count the PM approved for that month. None, never 0,
#                 when nothing was approved: a contractor with no approved
#                 plan has not committed to nothing, they have not committed.
#   Delivered  -- drive tests completed in that month.
# ---------------------------------------------------------------------------

#: How many months the contractor's screen shows behind them, the running one
#: included. Six is what fits across the chart without the bars going thin.
MONTHS_ON_SCREEN = 6


def month_label(year: int, month: int) -> str:
    """"مرداد 1405" — a Shamsi period as a person reads it.

    Built here rather than in the browser so the month names have one source,
    the same reason ``shamsi_month_name`` is already on every response.
    """
    return f"{jalali.month_name(month)} {year}"


def days_remaining(year: int, month: int, today: date | None = None) -> int:
    """Days between today and this month's deadline. Negative once it is past.

    Signed rather than clamped at zero: "3 days late" and "on the day" are
    different things to be told, and a screen that only ever sees 0 cannot
    tell them apart. Computed here because the arithmetic needs the length of
    a Shamsi month, and that knowledge lives on the server.
    """
    return (deadline_for(year, month) - (today or date.today())).days


def pace_percent(year: int, month: int, today: date | None = None) -> float:
    """How far through that Shamsi month we are, as a percentage.

    Display only. Nothing decides anything from it: a contractor who does a
    month's work in its first week is not behind on day three, and this figure
    would say they were. It is on the screen as a marker against which the
    reader can place themselves, and for no other purpose.

    Clamped to 0..100 so a month that is not the running one — which nothing
    currently asks for, but which is one caller away — reads as finished
    rather than as 340%.
    """
    reference = today or date.today()
    ref_year, ref_month, ref_day = jalali.to_shamsi_date(reference)
    if (ref_year, ref_month) > (year, month):
        return 100.0
    if (ref_year, ref_month) < (year, month):
        return 0.0
    return round(min(100.0, ref_day / jalali.days_in_month(year, month) * 100), 1)


def trailing_periods(months: int) -> list[tuple[int, int]]:
    """The last *months* Shamsi periods, oldest first, ending with this one.

    Rolling rather than year-to-date: in فروردین a year-to-date window is one
    month long, and one month is not a record of anything.

    Here rather than in each caller because three of them wanted the same six
    lines -- the PIP scorecard, its export, and the contractor's own history --
    and a fourth (the DT workbook) would have made four. A window that differs
    between two files is two files that cannot be compared.
    """
    year, month = jalali.current_shamsi_period()
    periods: list[tuple[int, int]] = []
    for _ in range(max(1, months)):
        periods.append((year, month))
        year, month = jalali.previous_period(year, month)
    return list(reversed(periods))


def recent_months(
    db: Session, user: User, contractor_id: int, months: int = MONTHS_ON_SCREEN
) -> list[dict]:
    """This contractor's last *months* Shamsi periods, oldest first.

    Each entry carries the three figures and nothing else: no percentages,
    because a percentage is a way of drawing two numbers that are already
    here, and computing it twice — once for the screen and once for the export
    — is how the two come to disagree.

    One scorecard call for the whole window rather than one per month: the
    service loops the periods inside the work items, so a sixth month costs a
    comparison and not a scan.

    The caller is a contractor account, so the scorecard has already narrowed
    itself to their company on the way in; picking their row out below is
    finding the row, not filtering the response.
    """
    from app.services.drive_test_analytics import DriveTestAnalytics

    months = max(1, min(months, MAX_HISTORY_MONTHS))
    periods = trailing_periods(months)

    data = DriveTestAnalytics(db, user).scorecard(periods)
    out = []
    for index, entry in enumerate(data["months"]):
        row = next(
            (r for r in entry["rows"] if r["contractor_id"] == contractor_id), None
        )
        out.append(
            {
                "shamsi_year": entry["shamsi_year"],
                "shamsi_month": entry["shamsi_month"],
                "shamsi_month_name": entry["shamsi_month_name"],
                "label": month_label(entry["shamsi_year"], entry["shamsi_month"]),
                # A contractor who held nothing that month has no row at all,
                # which is a real answer and not a missing one: they were
                # assigned nothing and delivered nothing. ``pip`` stays None
                # through it, because not committing is still not committing.
                "assignment": row["available"] if row else 0,
                "carried_in": row["carried_in"] if row else 0,
                "newly_assigned": row["newly_assigned"] if row else 0,
                "pip": row["pip"] if row else None,
                "delivered": row["delivered"] if row else 0,
                # The window always ends with the month now running, so the
                # last entry is the one still being worked on.
                "in_progress": index == len(data["months"]) - 1,
            }
        )
    return out


def running_month(db: Session, user: User) -> dict:
    """The month now running, for every contractor the caller may see.

    The PM's side of the same question the contractor's screen asks about
    itself, and answered by the same service, so a figure on the queue and the
    figure on that contractor's own screen cannot disagree.

    Returns the month's totals with a ``rows`` mapping keyed by contractor id,
    because the queue is driven by the contractor list and looks each one up
    rather than iterating what the scorecard happened to return.
    """
    from app.services.drive_test_analytics import DriveTestAnalytics

    year, month = jalali.current_shamsi_period()
    data = DriveTestAnalytics(db, user).scorecard([(year, month)])
    entry = data["months"][0]
    return {
        "shamsi_year": entry["shamsi_year"],
        "shamsi_month": entry["shamsi_month"],
        "shamsi_month_name": entry["shamsi_month_name"],
        "label": month_label(entry["shamsi_year"], entry["shamsi_month"]),
        "assignment": entry["available"],
        "carried_in": entry["carried_in"],
        "newly_assigned": entry["newly_assigned"],
        # The programme's PIP is a sum of approved plans, so zero means nobody
        # was approved rather than "approved for none" -- the same distinction
        # the per-contractor figure makes, made once more at the top.
        "pip": entry["pip"] or None,
        "delivered": entry["delivered"],
        "pace_pct": pace_percent(entry["shamsi_year"], entry["shamsi_month"]),
        "rows": {r["contractor_id"]: r for r in entry["rows"]},
    }


def all_versions(
    db: Session,
    contractor_id: int,
    year: int,
    month: int,
    stream: str = STREAM_DT,
) -> list[ContractorMonthlyPlan]:
    """Every version of one contractor's plan for one stream and month, oldest first.

    Nothing is reconstructed and nothing is inferred: the append-on-revision
    rule already writes a row per version, so the revision history *is* the
    table, read in version order. That is the whole reason revising appends
    instead of updating in place.
    """
    return list(
        db.execute(
            select(ContractorMonthlyPlan)
            .where(
                ContractorMonthlyPlan.contractor_id == contractor_id,
                ContractorMonthlyPlan.stream == stream,
                ContractorMonthlyPlan.shamsi_year == year,
                ContractorMonthlyPlan.shamsi_month == month,
            )
            .order_by(ContractorMonthlyPlan.version)
        )
        .scalars()
        .all()
    )


def decider_names(
    db: Session, plans: list[ContractorMonthlyPlan]
) -> dict[int, str]:
    """Display names for the PMs who decided these versions, by user id.

    One query for the whole list rather than one per row: a plan revised four
    times is four rows and, more often than not, the same PM on all of them.
    """
    return user_names(db, {p.decided_by for p in plans})


def user_names(db: Session, ids: set[int | None]) -> dict[int, str]:
    """Display names for a set of user ids, in one query."""
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    rows = db.execute(select(User.id, User.full_name, User.username).where(User.id.in_(ids))).all()
    return {uid: (full or username) for uid, full, username in rows}


def queue_rows(
    db: Session, year: int, month: int, stream: str = STREAM_DT
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
    validate_stream(stream)

    with_a_plan = select(ContractorMonthlyPlan.contractor_id).where(
        ContractorMonthlyPlan.stream == stream,
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
        plan = current_plan(db, contractor.id, year, month, stream)
        previous = previous_approved_count(db, contractor.id, year, month, stream)
        rows.append((contractor, plan, previous))
    return rows


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def _clear_current(
    db: Session, contractor_id: int, year: int, month: int, stream: str
) -> None:
    """Take ``is_current`` off every row for this contractor, stream and month.

    Called immediately before a new version is inserted, in the same
    transaction, which is what keeps "exactly one current version" true
    without a partial index.
    """
    rows = (
        db.query(ContractorMonthlyPlan)
        .filter(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.stream == stream,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
            ContractorMonthlyPlan.is_current.is_(True),
        )
        .all()
    )
    for row in rows:
        row.is_current = False


def _next_version(
    db: Session, contractor_id: int, year: int, month: int, stream: str
) -> int:
    highest = (
        db.query(ContractorMonthlyPlan.version)
        .filter(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.stream == stream,
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
    stream: str = STREAM_DT,
) -> ContractorMonthlyPlan:
    """Create or update this month's plan, optionally submitting it.

    One entry point for both, because from the contractor's side they are one
    form with two buttons, and splitting them into two endpoints would mean
    two places that have to agree about which month is being written.

    A plan already awaiting a PM's decision is refused rather than silently
    edited: the number the PM is looking at has to be the number that was
    handed to them. An approved one is refused too — :func:`request_revision`
    is the way past that, and it is a deliberate, separate act. So is a plan
    whose revision is pending or was returned: there is an approved number in
    force behind it either way.
    """
    validate_period(year, month)
    validate_stream(stream)
    validate_count(committed_count, required=submit)

    plan = current_plan(db, contractor_id, year, month, stream)

    if plan is not None:
        # Two states this endpoint will not touch, spelled out here rather
        # than left to the transition table so each one can say what to do
        # instead. Both are refusals to edit a number somebody else is
        # already acting on.
        if plan.status in (
            STATUS_APPROVED, STATUS_REVISION_REQUESTED, STATUS_REVISION_RETURNED
        ):
            raise PlanError(
                "This month's plan is approved and cannot be edited. "
                "Request a revision instead."
            )
        if plan.status == STATUS_SUBMITTED:
            raise PlanError(
                "This month's plan has been submitted and is waiting on the "
                "PM. Ask for it to be returned before changing it."
            )

    if plan is None:
        plan = ContractorMonthlyPlan(
            contractor_id=contractor_id,
            stream=stream,
            shamsi_year=year,
            shamsi_month=month,
            version=_next_version(db, contractor_id, year, month, stream),
            is_current=True,
            status=STATUS_DRAFT,
            is_default=False,
        )
        # Defensive: nothing should be current if the read above found
        # nothing, but if a row ever were, two current versions would be
        # worse than a redundant update.
        _clear_current(db, contractor_id, year, month, stream)
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


def request_revision(
    db: Session,
    *,
    contractor_id: int,
    user: User,
    year: int,
    month: int,
    stream: str,
    committed_count: int,
    reason: str,
    comment: str | None,
    today: date | None = None,
) -> ContractorMonthlyPlan:
    """Ask the PM to change this month's approved number.

    Appends a new version with status ``RevisionRequested``. The approved row
    is left exactly as it was decided and stays in force -- it is still the
    contractor's PIP -- until the PM approves the request. Only
    ``is_current`` moves, because the request is now the latest version.

    Refused unless the plan is approved (directly, or with an earlier request
    already returned), no other request is pending, and the revision window
    for the month is still open.
    """
    validate_period(year, month)
    validate_stream(stream)
    validate_count(committed_count, required=True)
    comment = validate_revision_reason(reason, comment)

    if not revision_window_open(year, month, today):
        raise PlanError(
            "Revisions are only open for the running month, until the end of "
            f"day {REVISION_CUTOFF_DAY}. The approved plan is final."
        )

    latest = current_plan(db, contractor_id, year, month, stream)
    if latest is None or in_force_plan(db, contractor_id, year, month, stream) is None:
        raise PlanError("Only an approved plan can be revised")
    if latest.status == STATUS_REVISION_REQUESTED:
        raise PlanError("A revision of this plan is already waiting on the PM")
    if latest.status not in (STATUS_APPROVED, STATUS_REVISION_RETURNED):
        raise PlanError("Only an approved plan can be revised")

    _clear_current(db, contractor_id, year, month, stream)
    plan = ContractorMonthlyPlan(
        contractor_id=contractor_id,
        stream=stream,
        shamsi_year=year,
        shamsi_month=month,
        version=_next_version(db, contractor_id, year, month, stream),
        is_current=True,
        status=STATUS_REVISION_REQUESTED,
        is_default=False,
        committed_count=committed_count,
        submitted_by=user.id,
        submitted_at=_now(),
        revision_reason=reason,
        revision_comment=comment,
    )
    db.add(plan)
    db.flush()
    return plan


def approve(
    db: Session,
    *,
    plan: ContractorMonthlyPlan,
    user: User,
    today: date | None = None,
) -> ContractorMonthlyPlan:
    """Lock a submitted plan, or a revision, as the target for the month.

    Approving a revision makes it the highest approved version, which is what
    puts it in force; the version it replaces is not touched. A revision can
    only be approved while the revision window is open -- after the end of day
    15 the approved PIP is final, so a request still pending then can only be
    returned.
    """
    _check_transition(plan.status, STATUS_APPROVED)
    if plan.status == STATUS_REVISION_REQUESTED and not revision_window_open(
        plan.shamsi_year, plan.shamsi_month, today
    ):
        raise PlanError(
            f"Revisions closed at the end of day {REVISION_CUTOFF_DAY}. "
            "The approved plan is final; return this request instead."
        )
    plan.status = STATUS_APPROVED
    plan.decided_by = user.id
    plan.decided_at = _now()
    db.flush()
    return plan


def return_plan(
    db: Session, *, plan: ContractorMonthlyPlan, user: User, comment: str
) -> ContractorMonthlyPlan:
    """Send a submitted plan or a revision request back, with the reason.

    The comment is required and is the whole value of returning rather than
    rejecting: a number sent back without one tells the contractor that the PM
    disagreed and nothing about what to write instead.

    A returned revision becomes ``RevisionReturned`` rather than
    ``Returned``: it is not reopened for editing, because the approved number
    behind it is still in force and nothing is owed. A further request is a
    new version.
    """
    comment = (comment or "").strip()
    if not comment:
        raise PlanError("A comment is required when returning a plan")
    if len(comment) > MAX_RETURN_COMMENT:
        raise PlanError(
            f"The comment cannot be longer than {MAX_RETURN_COMMENT} characters"
        )
    target = (
        STATUS_REVISION_RETURNED
        if plan.status == STATUS_REVISION_REQUESTED
        else STATUS_RETURNED
    )
    _check_transition(plan.status, target)
    plan.status = target
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
        "stream": plan.stream,
        "shamsi_year": plan.shamsi_year,
        "shamsi_month": plan.shamsi_month,
        "contractor_id": plan.contractor_id,
        "return_comment": plan.return_comment,
        "revision_reason": plan.revision_reason,
        "revision_comment": plan.revision_comment,
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

