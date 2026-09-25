"""Acceptance plan: the PM's monthly target, and the trend it is measured against.

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

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import jalali
from app.models.acceptance_plan import AcceptanceMonthlyTarget
from app.models.reference import User
from app.models.workitem import Village, WorkItem
from app.services import acceptance_workflow as flow
from app.services import cpm_columns as C
from app.services.visibility import apply_work_item_scope

_DT_DONE = "Done"

#: How many months of target history a caller may ask for in one call. The
#: widget shows a trend, not an archive -- the same bound
#: ``monthly_plan.MAX_HISTORY_MONTHS`` applies for the same reason.
MAX_HISTORY_MONTHS = 36


# ---------------------------------------------------------------------------
# Plan CRUD
# ---------------------------------------------------------------------------
def get_current_target(
    db: Session, year: int, month: int
) -> AcceptanceMonthlyTarget | None:
    """The ``is_current=True`` row for this Shamsi month, or None."""
    return db.execute(
        select(AcceptanceMonthlyTarget).where(
            AcceptanceMonthlyTarget.shamsi_year == year,
            AcceptanceMonthlyTarget.shamsi_month == month,
            AcceptanceMonthlyTarget.is_current.is_(True),
        )
    ).scalar_one_or_none()


def _next_version(db: Session, year: int, month: int) -> int:
    highest = (
        db.query(AcceptanceMonthlyTarget.version)
        .filter(
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
) -> AcceptanceMonthlyTarget:
    """Set this month's cumulative acceptance target. Caller commits.

    Always appends: an existing current row for the period is flipped to
    ``is_current=False`` in the same call, and the new one is inserted at
    ``version = previous + 1``. There is no separate "revise" entry point the
    way ``ContractorMonthlyPlan`` has one, because there is no workflow state
    to distinguish a first target from a later change -- a PM may set this
    month's number as often as the programme's plan actually changes.
    """
    if target_count < 0:
        raise ValueError("The target count cannot be negative")

    existing = get_current_target(db, year, month)
    if existing is not None:
        existing.is_current = False

    target = AcceptanceMonthlyTarget(
        shamsi_year=year,
        shamsi_month=month,
        version=_next_version(db, year, month),
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
    db: Session, *, upto_year: int, upto_month: int, months: int = 12
) -> list[AcceptanceMonthlyTarget]:
    """The current-version targets for the *months* periods ending here.

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
        target = get_current_target(db, y, m)
        if target is not None:
            out.append(target)
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
) -> list[Village]:
    """The DT-Done, pure-هدف villages this user (and these filters) may see.

    The same universe ``AcceptanceAnalytics._load_units`` builds -- same
    scope call, same province/contractor narrowing, same هدف and DT-Done
    gates -- replicated here rather than reused through that class because it
    is request-scoped and coupled to resolving ids the API layer has already
    resolved by the time this is called. This is the reusable core of that
    loading logic, at the level of "given a scoped list of WorkItem/Village".
    """
    stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
    stmt = apply_work_item_scope(stmt, user, db)
    stmt = stmt.options(
        selectinload(WorkItem.site),
        selectinload(WorkItem.villages).selectinload(Village.acceptances),
    )
    work_items = db.execute(stmt).scalars().all()

    villages: list[Village] = []
    for wi in work_items:
        province_id = wi.site.province_id if wi.site else None
        if province_ids is not None and province_id not in province_ids:
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
    """Per-Shamsi-month counts of villages newly ICT/CRA/fully approved.

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

    targets = {
        (t.shamsi_year, t.shamsi_month): t.target_count
        for t in recent_targets(
            db, upto_year=upto_year, upto_month=upto_month, months=months
        )
    }

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
                "target_count": targets.get(period),
            }
        )
    return out
