"""Acceptance plan: the PM's monthly target, and the trend it is measured against.

The target table also carries a second, separate number: the PM's DT
"MTN internal PIP" (``stream="DT"``), read and written through the same three
functions with ``stream`` set. Every function defaults to ``ACCEPTANCE``.
Both streams are monthly amounts; see ``models/acceptance_plan.py``.

**A contractor never sees the MTN target.** In the trend, a contractor (or a
staff view filtered to one contractor) gets that contractor's own approved
Acceptance PIP as the plan line instead.

Two responsibilities live here because they are two sides of one dashboard
widget: a target a PM sets (``set_target`` / ``get_current_target`` /
``recent_targets``), and the actual monthly pace of acceptance to plot it
against (``monthly_approval_trend``). Neither is meaningful alone -- a target
with nothing to compare it to is a number nobody can act on, and a trend with
no target drawn over it cannot say whether the programme is ahead or behind.

The target side follows the exact append-on-revision pattern
``services/monthly_plan.py`` uses for ``ContractorMonthlyPlan``: the query
that finds the current row, and the write that flips it and inserts the next
version, are the same shape for the same reason -- see
``models/acceptance_plan.py`` for why editing in place was rejected.

The trend side answers a harder question: *when* did a village actually
become ICT-approved, CRA-approved, or fully accepted? Not "how many are
approved today" (``AcceptanceAnalytics`` already answers that) but "which
month did each one clear in" -- because a target is only checkable against a
month-by-month pace, not a single snapshot.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance_plan import (
    STREAM_ACCEPTANCE,
    TARGET_STREAMS,
    AcceptanceMonthlyTarget,
)
from app.models.monthly_plan import STATUS_APPROVED, ContractorMonthlyPlan
from app.models.reference import User
from app.services import acceptance_universe
from app.services import acceptance_workflow as flow
from app.services import cpm_columns as C
from app.core.deps import CONTRACTOR

_DT_DONE = "Done"

#: How many months of target history a caller may ask for in one call. The
#: widget shows a trend, not an archive -- the same bound
#: ``monthly_plan.MAX_HISTORY_MONTHS`` applies for the same reason.
MAX_HISTORY_MONTHS = 36


# ---------------------------------------------------------------------------
# Plan CRUD
# ---------------------------------------------------------------------------
def _check_stream(stream: str) -> None:
    if stream not in TARGET_STREAMS:
        raise ValueError(f"Unknown stream {stream!r}")


def get_current_target(
    db: Session, year: int, month: int, stream: str = STREAM_ACCEPTANCE
) -> AcceptanceMonthlyTarget | None:
    """The ``is_current=True`` row for this stream and Shamsi month, or None.

    *stream* defaults to ``ACCEPTANCE`` so every caller that predates the DT
    target reads exactly what it always read.
    """
    _check_stream(stream)
    return db.execute(
        select(AcceptanceMonthlyTarget).where(
            AcceptanceMonthlyTarget.stream == stream,
            AcceptanceMonthlyTarget.shamsi_year == year,
            AcceptanceMonthlyTarget.shamsi_month == month,
            AcceptanceMonthlyTarget.is_current.is_(True),
        )
    ).scalar_one_or_none()


def _next_version(db: Session, year: int, month: int, stream: str) -> int:
    highest = (
        db.query(AcceptanceMonthlyTarget.version)
        .filter(
            AcceptanceMonthlyTarget.stream == stream,
            AcceptanceMonthlyTarget.shamsi_year == year,
            AcceptanceMonthlyTarget.shamsi_month == month,
        )
        .order_by(AcceptanceMonthlyTarget.version.desc())
        .limit(1)
        .scalar()
    )
    return (highest or 0) + 1


def set_target(
    db: Session,
    *,
    year: int,
    month: int,
    target_count: int,
    user: User,
    note: str | None = None,
    stream: str = STREAM_ACCEPTANCE,
) -> AcceptanceMonthlyTarget:
    """Set one stream's MTN internal target for one month. Caller commits.

    A monthly amount for both streams: villages to be fully accepted in that
    month (``ACCEPTANCE``, the default), or drive tests (``DT``).

    Always appends: an existing current row for the stream and period is
    flipped to ``is_current=False`` in the same call, and the new one is
    inserted at ``version = previous + 1``. There is no separate "revise"
    entry point the way ``ContractorMonthlyPlan`` has one, because there is
    no workflow state to distinguish a first target from a later change -- a
    PM may set this month's number as often as the programme's plan
    actually changes.
    """
    _check_stream(stream)
    if target_count < 0:
        raise ValueError("The target count cannot be negative")

    existing = get_current_target(db, year, month, stream)
    if existing is not None:
        existing.is_current = False

    target = AcceptanceMonthlyTarget(
        stream=stream,
        shamsi_year=year,
        shamsi_month=month,
        version=_next_version(db, year, month, stream),
        is_current=True,
        target_count=target_count,
        set_by=user.id,
        set_at=datetime.now(timezone.utc),
        note=(note or "").strip() or None,
    )
    db.add(target)
    db.flush()
    return target


def recent_targets(
    db: Session,
    *,
    upto_year: int,
    upto_month: int,
    months: int = 12,
    stream: str = STREAM_ACCEPTANCE,
) -> list[AcceptanceMonthlyTarget]:
    """One stream's current-version targets for the *months* periods ending here.

    Oldest first, and periods with no target set are skipped rather than
    synthesized as placeholder rows -- a month nobody set a target for has no
    target, and a zero row would misstate that as a target of zero.
    """
    months = max(1, min(months, MAX_HISTORY_MONTHS))
    year, month = upto_year, upto_month
    periods: list[tuple[int, int]] = []
    for _ in range(months):
        periods.append((year, month))
        year, month = jalali.previous_period(year, month)
    periods.reverse()

    out: list[AcceptanceMonthlyTarget] = []
    for y, m in periods:
        target = get_current_target(db, y, m, stream)
        if target is not None:
            out.append(target)
    return out


# ---------------------------------------------------------------------------
# The plan line: MTN's target for staff, a contractor's own PIP otherwise
# ---------------------------------------------------------------------------
def _internal_monthly_targets(db: Session) -> dict[tuple[int, int], int]:
    """Every month's current ACCEPTANCE internal target, all history."""
    rows = db.execute(
        select(
            AcceptanceMonthlyTarget.shamsi_year,
            AcceptanceMonthlyTarget.shamsi_month,
            AcceptanceMonthlyTarget.target_count,
        ).where(
            AcceptanceMonthlyTarget.stream == STREAM_ACCEPTANCE,
            AcceptanceMonthlyTarget.is_current.is_(True),
        )
    ).all()
    return {(y, m): count for y, m, count in rows}


def _contractor_monthly_pips(
    db: Session, contractor_id: int
) -> dict[tuple[int, int], int]:
    """One contractor's approved Acceptance PIP in force, per month, all history.

    Narrowed to the contractor in the query. "In force" is the highest
    approved version, the same rule as ``monthly_plan.in_force_plan``:
    ordered ascending, so the highest version is the one left in the dict.
    """
    rows = db.execute(
        select(
            ContractorMonthlyPlan.shamsi_year,
            ContractorMonthlyPlan.shamsi_month,
            ContractorMonthlyPlan.committed_count,
        )
        .where(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.stream == STREAM_ACCEPTANCE,
            ContractorMonthlyPlan.status == STATUS_APPROVED,
        )
        .order_by(ContractorMonthlyPlan.version)
    ).all()
    return {(y, m): count or 0 for y, m, count in rows}


def _all_contractor_monthly_pips(db: Session) -> dict[tuple[int, int], int]:
    """Every contractor's approved Acceptance PIP in force, summed per month.

    Folded per contractor first (highest approved version wins), then summed,
    so a revised plan is counted once, at its approved number.
    """
    rows = db.execute(
        select(
            ContractorMonthlyPlan.contractor_id,
            ContractorMonthlyPlan.shamsi_year,
            ContractorMonthlyPlan.shamsi_month,
            ContractorMonthlyPlan.committed_count,
        )
        .where(
            ContractorMonthlyPlan.stream == STREAM_ACCEPTANCE,
            ContractorMonthlyPlan.status == STATUS_APPROVED,
        )
        .order_by(ContractorMonthlyPlan.version)
    ).all()
    in_force: dict[tuple[int, int, int], int] = {}
    for cid, y, m, count in rows:
        in_force[(cid, y, m)] = count or 0
    out: dict[tuple[int, int], int] = {}
    for (_, y, m), count in in_force.items():
        out[(y, m)] = out.get((y, m), 0) + count
    return out


def plan_contractor(user: User, contractor_id: int | None) -> int | None:
    """Whose PIP is the plan line, or None for MTN's internal target.

    A contractor account is always its own contractor, whatever it asked
    for -- so a contractor never reaches the internal target, nor another
    company's PIP. Staff get a contractor's PIP when they filtered to one.
    """
    if user.role.name == CONTRACTOR:
        # -1 matches no contractor: an account with no company has no plan,
        # and must still not fall through to the internal target.
        return user.contractor_id if user.contractor_id is not None else -1
    return contractor_id


def _cumulative_plan(
    monthly: dict[tuple[int, int], int],
    actual_cumulative_before: Callable[[tuple[int, int]], int],
) -> dict[tuple[int, int], int]:
    """The plan's running total, for every month from its first planned one.

    Anchored on reality: it starts from the villages actually fully accepted
    before the first planned month, then adds each month's plan (0 for a
    month inside the run that has none). So the cumulative plan line and the
    cumulative actual line start from the same point, and the gap between
    them is exactly what the plan promised and was not delivered.
    """
    if not monthly:
        return {}
    first = min(monthly)
    last = max(max(monthly), jalali.current_shamsi_period())
    out: dict[tuple[int, int], int] = {}
    running = actual_cumulative_before(first)
    period = first
    while period <= last:
        running += monthly.get(period, 0)
        out[period] = running
        period = jalali.next_period(*period)
    return out


# ---------------------------------------------------------------------------
# Monthly approval trend
# ---------------------------------------------------------------------------
def _load_scoped_villages(
    db: Session,
    user: User,
    *,
    province_ids: set[int] | None,
    contractor_id: int | None,
) -> list:
    """The DT-Done, pure-هدف villages this user (and these filters) may see.

    The same universe ``AcceptanceAnalytics._load_units`` builds -- same
    scope call, same province/contractor narrowing, same هدف and DT-Done
    gates -- replicated here rather than reused through that class because it
    is request-scoped and coupled to resolving ids the API layer has already
    resolved by the time this is called. This is the reusable core of that
    loading logic, at the level of "given a scoped list of WorkItem/Village".

    Read through ``acceptance_universe`` -- plain columns, not ORM objects --
    for the reason that module gives.
    """
    villages: list = []
    for wi in acceptance_universe.load(db, user):
        if province_ids is not None and wi.province_id not in province_ids:
            continue
        if contractor_id is not None and wi.dt_sc_contractor_id != contractor_id:
            continue
        if wi.dt_status != _DT_DONE:
            continue  # acceptance only applies once the drive test is done
        for village in wi.villages:
            if village.deleted_at is not None:
                continue
            if not C.is_pure_target(village.target_classification):
                continue
            villages.append(village)
    return villages


def _trailing_periods(upto_year: int, upto_month: int, months: int) -> list[tuple[int, int]]:
    """The *months* Shamsi periods ending at (upto_year, upto_month), oldest first."""
    year, month = upto_year, upto_month
    periods: list[tuple[int, int]] = []
    for _ in range(max(1, months)):
        periods.append((year, month))
        year, month = jalali.previous_period(year, month)
    return list(reversed(periods))


def monthly_approval_trend(
    db: Session,
    user: User,
    *,
    province_ids: set[int] | None,
    contractor_id: int | None,
    months: int = 9,
) -> list[dict]:
    """Per-Shamsi-month counts of villages newly ICT/CRA/fully approved,
    with the plan they are measured against.

    The plan is MTN's monthly internal target for staff, and the approved
    Acceptance PIP of one contractor when the caller is that contractor (or
    staff filtered to it) -- see ``plan_contractor``. ``target_monthly`` is
    the month's plan; ``target_cumulative`` its running total, anchored on
    what was actually accepted before the first planned month
    (``_cumulative_plan``). ``target_count`` repeats the cumulative figure
    for the dashboard that reads that name today.

    ``pip_monthly`` / ``pip_cumulative`` are the contractors' approved
    Acceptance PIPs: every contractor's summed for an unfiltered staff view,
    the one contractor's otherwise (then equal to the target figures).

    For each qualifying village, ``authority_verdict_date`` says which month
    ICT cleared it and which month CRA cleared it (None if not yet approved
    by that authority). A village counts as "fully accepted" in whichever
    month is later of the two -- the month the *second* authority cleared it,
    which is when the village actually finished, not when the first one did.

    Cumulative totals are computed over the *entire* history of dated
    approvals, not just the returned window, so a 9-month view still reports
    a correct running total rather than one that resets at the edge of the
    chart. The window is applied last, purely to decide which periods to
    return.

    HONESTY NOTE, in the tradition of ``dt_trends.py``: a village whose
    ``ict_source`` / ``cra_source`` is ``"CPM"`` was seeded from the original
    spreadsheet import rather than entered in-app, and its ``ict_date`` /
    ``cra_date`` may reflect when that import happened rather than the true
    historical approval date. Early months in this series can therefore be
    noisier than later ones, where every date was entered through the
    workflow. Those villages are not filtered out -- doing so would silently
    understate the totals -- only flagged here for whoever reads this code.
    """
    villages = _load_scoped_villages(
        db, user, province_ids=province_ids, contractor_id=contractor_id
    )

    # (year, month) -> counts, built over every dated approval in the whole
    # history, never windowed -- the cumulative totals below depend on that.
    new_counts: dict[tuple[int, int], dict[str, int]] = {}

    def _bump(period: tuple[int, int], key: str) -> None:
        bucket = new_counts.setdefault(
            period, {"ict_new": 0, "cra_new": 0, "fully_accepted_new": 0}
        )
        bucket[key] += 1

    for village in villages:
        ict_date = flow.authority_verdict_date(village, "ICT")
        cra_date = flow.authority_verdict_date(village, "CRA")
        if ict_date is not None:
            _bump(jalali.to_shamsi(ict_date), "ict_new")
        if cra_date is not None:
            _bump(jalali.to_shamsi(cra_date), "cra_new")
        if ict_date is not None and cra_date is not None:
            _bump(jalali.to_shamsi(max(ict_date, cra_date)), "fully_accepted_new")

    # Walk the whole history chronologically to build the running totals,
    # from the earliest month any approval landed in.
    all_periods = sorted(new_counts.keys())
    cumulative: dict[tuple[int, int], dict[str, int]] = {}
    running = {"ict_new": 0, "cra_new": 0, "fully_accepted_new": 0}
    for period in all_periods:
        counts = new_counts[period]
        running = {k: running[k] + counts[k] for k in running}
        cumulative[period] = dict(running)

    upto_year, upto_month = jalali.current_shamsi_period()
    window = _trailing_periods(upto_year, upto_month, months)

    # The plan line: MTN's monthly target, or one contractor's own PIP.
    whose = plan_contractor(user, contractor_id)
    monthly_plan = (
        _internal_monthly_targets(db)
        if whose is None
        else _contractor_monthly_pips(db, whose)
    )

    def _actual_before(period: tuple[int, int]) -> int:
        total = 0
        for p in all_periods:
            if p >= period:
                break
            total = cumulative[p]["fully_accepted_new"]
        return total

    cumulative_plan = _cumulative_plan(monthly_plan, _actual_before)

    # The contractors' own commitment: the one contractor's PIP when the plan
    # is already that, otherwise every contractor's PIP summed -- so staff
    # see MTN's target and what the contractors signed up to side by side.
    monthly_pip = monthly_plan if whose is not None else _all_contractor_monthly_pips(db)
    cumulative_pip = _cumulative_plan(monthly_pip, _actual_before)

    out: list[dict] = []
    # The running cumulative total as of just before the window starts, so a
    # period inside the window that itself has no new approvals still shows
    # the correct carried-forward cumulative rather than zero.
    carried = {"ict_new": 0, "cra_new": 0, "fully_accepted_new": 0}
    for period in all_periods:
        if period >= window[0]:
            break
        carried = cumulative[period]

    for period in window:
        counts = new_counts.get(period, {"ict_new": 0, "cra_new": 0, "fully_accepted_new": 0})
        if period in cumulative:
            carried = cumulative[period]
        year, month = period
        out.append(
            {
                "shamsi_year": year,
                "shamsi_month": month,
                "label": jalali.month_name(month),
                "ict_new": counts["ict_new"],
                "cra_new": counts["cra_new"],
                "fully_accepted_new": counts["fully_accepted_new"],
                "ict_cumulative": carried["ict_new"],
                "cra_cumulative": carried["cra_new"],
                "fully_accepted_cumulative": carried["fully_accepted_new"],
                "target_monthly": monthly_plan.get(period),
                "target_cumulative": cumulative_plan.get(period),
                "pip_monthly": monthly_pip.get(period),
                "pip_cumulative": cumulative_pip.get(period),
                # The name the dashboard reads today: the cumulative plan, so
                # its Cumulative view is right and its Monthly view (which
                # differences consecutive months) gives the monthly plan.
                "target_count": cumulative_plan.get(period),
            }
        )
    return out
