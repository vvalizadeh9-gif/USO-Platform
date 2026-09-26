"""The PM's Monthly Plan overview: both streams, one period, one read.

Built only from services that already exist, so no figure here can disagree
with the screen it came from:

* DT: ``DriveTestAnalytics.scorecard`` (Assignment, PIP in force, Delivered).
* Acceptance: ``acceptance_plan.acceptance_scorecard`` (PIP in force,
  Delivered = villages fully accepted that month; no Assignment).
* MTN internal target: ``acceptance_plan.get_current_target`` per stream.
* Plan states: ``monthly_plan.queue_rows`` / ``in_force_plan``.

Staff only (the API enforces it): the response carries MTN's internal
target and every contractor's numbers.

Three rules hold everywhere below:

* **No plan is ``None``, never 0.** A contractor with no approved plan has not
  committed to nothing, they have not committed.
* **A period's percentage is total Delivered / total PIP**, never an average
  of monthly percentages.
* **Assignment over several months is not a sum of monthly balances** (a site
  held in two months would count twice). It is what was held at the start of
  the period plus everything newly assigned during it.

The clock is ``jalali.tehran_today``, so "the running month", the pace line
and the deadlines all agree with the revision window on the Tehran day.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance_plan import AcceptanceMonthlyTarget
from app.models.monthly_plan import (
    STATUS_APPROVED,
    STATUS_DRAFT,
    STATUS_RETURNED,
    STATUS_REVISION_REQUESTED,
    STATUS_REVISION_RETURNED,
    STATUS_SUBMITTED,
    STREAM_ACCEPTANCE,
    STREAM_DT,
    ContractorMonthlyPlan,
)
from app.models.reference import User
from app.services import acceptance_plan
from app.services import monthly_plan as plans

PERIODS = ("month", "year", "since_start")

#: How far back "since start" may reach. A bound, not a policy: well past the
#: programme's age, and it keeps one request from scanning decades.
MAX_SINCE_START_MONTHS = 60

#: How many closed months "hit" is counted over.
HIT_WINDOW = 6

#: Months on the trend chart.
TREND_MONTHS = 12

STREAM_KEYS = {STREAM_DT: "dt", STREAM_ACCEPTANCE: "acceptance"}


class OverviewError(ValueError):
    """A request the overview cannot answer (bad period)."""


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------
def _walk(start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    out = []
    period = start
    while period <= end:
        out.append(period)
        period = jalali.next_period(*period)
    return out


def _back(period: tuple[int, int], n: int) -> tuple[int, int]:
    for _ in range(n):
        period = jalali.previous_period(*period)
    return period


def _earliest_period(db: Session) -> tuple[int, int] | None:
    """The first month anything was planned for: a PIP or an internal target."""
    candidates = []
    for model in (ContractorMonthlyPlan, AcceptanceMonthlyTarget):
        key = db.execute(
            select(func.min(model.shamsi_year * 100 + model.shamsi_month))
        ).scalar()
        if key is not None:
            candidates.append(divmod(int(key), 100))
    return min(candidates) if candidates else None


def period_months(
    db: Session,
    period: str,
    year: int,
    month: int,
    running: tuple[int, int],
) -> list[tuple[int, int]]:
    """The Shamsi months a period covers, oldest first."""
    if period == "month":
        return [(year, month)]
    if period == "year":
        # The running year stops at the running month: later months have
        # nothing to show yet.
        last = (year, running[1]) if year == running[0] else (year, 12)
        return _walk((year, 1), last)
    if period == "since_start":
        floor = _back(running, MAX_SINCE_START_MONTHS - 1)
        start = _earliest_period(db) or running
        start = max(start, floor)
        return _walk(min(start, running), running)
    raise OverviewError(f"period must be one of: {', '.join(PERIODS)}")


def _elapsed_fraction(period: tuple[int, int], today: date) -> float:
    """How much of a month is behind us: 1 for a closed month, 0 for a future one."""
    ty, tm, td = jalali.to_shamsi_date(today)
    if (ty, tm) > period:
        return 1.0
    if (ty, tm) < period:
        return 0.0
    return td / jalali.days_in_month(*period)


# ---------------------------------------------------------------------------
# Per-stream figures, indexed by (period, contractor)
# ---------------------------------------------------------------------------
def _figures(db: Session, user: User, stream: str, periods: list[tuple[int, int]]):
    """{period: {"total": month, "rows": {cid: row}}} from the stream's scorecard."""
    if not periods:
        return {}
    if stream == STREAM_DT:
        from app.services.drive_test_analytics import DriveTestAnalytics

        data = DriveTestAnalytics(db, user).scorecard(periods)
    else:
        data = acceptance_plan.acceptance_scorecard(db, user, periods)
    out = {}
    for entry in data["months"]:
        out[(entry["shamsi_year"], entry["shamsi_month"])] = {
            "total": entry,
            "rows": {r["contractor_id"]: r for r in entry["rows"]},
        }
    return out


def _assignment(entries: list[dict]) -> int | None:
    """Sites held over several months: the opening balance plus new ones.

    ``entries`` are one contractor's (or the total's) scorecard rows for the
    period's months, oldest first. DT only; Acceptance rows have no
    ``carried_in`` and answer None.
    """
    if not entries or "carried_in" not in entries[0]:
        return None
    return entries[0]["carried_in"] + sum(e["newly_assigned"] for e in entries)


def _sum_pip(values: list[int | None]) -> int | None:
    """A period's PIP: the sum of the months that had one; None if none did."""
    present = [v for v in values if v is not None]
    return sum(present) if present else None


def _hit(pairs: list[tuple[int | None, int]]) -> dict:
    """``{"hit": h, "of": n}`` over (pip, delivered) pairs. A month with no
    plan is skipped, not counted as a miss."""
    counted = [(p, d) for p, d in pairs if p]
    return {"hit": sum(1 for p, d in counted if d >= p), "of": len(counted)}


def _diff(delivered: int | None, pip: int | None) -> int | None:
    if delivered is None or pip is None:
        return None
    return delivered - pip


# ---------------------------------------------------------------------------
# Plan status
# ---------------------------------------------------------------------------
def plan_status(plan: ContractorMonthlyPlan | None, in_force: ContractorMonthlyPlan | None) -> dict:
    """What the page shows for one contractor's plan in one month.

    ``approved`` (with the version in force), ``awaiting_approval``,
    ``returned``, ``revision_requested`` (from the number in force to the one
    asked for), or ``not_submitted``. A returned revision leaves the approved
    number in force, so it reads as ``approved``.
    """
    status = plan.status if plan is not None else None
    base = {
        "plan_id": plan.id if plan is not None else None,
        "plan_status": status,
        "committed_count": plan.committed_count if plan is not None else None,
        "version": plan.version if plan is not None else None,
        "in_force_count": in_force.committed_count if in_force is not None else None,
        "in_force_version": in_force.version if in_force is not None else None,
        "revision_reason": plan.revision_reason if plan is not None else None,
        "revision_comment": plan.revision_comment if plan is not None else None,
        "return_comment": plan.return_comment if plan is not None else None,
        "is_late": plans.is_late(plan) if plan is not None else False,
        "revision_from": None,
        "revision_to": None,
    }
    if status is None or status == STATUS_DRAFT:
        kind = "not_submitted"
    elif status == STATUS_SUBMITTED:
        kind = "awaiting_approval"
    elif status == STATUS_RETURNED:
        kind = "returned"
    elif status == STATUS_REVISION_REQUESTED:
        kind = "revision_requested"
        base["revision_from"] = base["in_force_count"]
        base["revision_to"] = plan.committed_count
    elif status in (STATUS_APPROVED, STATUS_REVISION_RETURNED):
        kind = "approved"
    else:
        kind = "not_submitted"
    base["status"] = kind
    return base


def _plan_states(db: Session, year: int, month: int, stream: str):
    """[(contractor, status dict)] for every contractor the queue lists."""
    out = []
    for contractor, plan, _previous in plans.queue_rows(db, year, month, stream):
        in_force = plans.in_force_plan(db, contractor.id, year, month, stream)
        out.append((contractor, plan_status(plan, in_force)))
    return out


# ---------------------------------------------------------------------------
# The overview
# ---------------------------------------------------------------------------
def _internal_target(db: Session, stream: str, months: list[tuple[int, int]]) -> int | None:
    values = []
    for y, m in months:
        target = acceptance_plan.get_current_target(db, y, m, stream)
        values.append(target.target_count if target is not None else None)
    return _sum_pip(values)


def _stream(
    db: Session,
    user: User,
    stream: str,
    *,
    view: str,
    months: list[tuple[int, int]],
    status_month: tuple[int, int],
    trend: list[tuple[int, int]],
    hit_months: list[tuple[int, int]],
    running: tuple[int, int],
    today: date,
) -> dict:
    is_dt = stream == STREAM_DT
    figures = _figures(db, user, stream, sorted(set(months) | set(trend) | set(hit_months)))
    states = _plan_states(db, *status_month, stream)

    # Every contractor the queue lists, plus any that did work in the period
    # without being in it (a company deactivated mid-year).
    names = {c.id: c.name for c, _ in states}
    for p in months:
        for cid, row in figures.get(p, {}).get("rows", {}).items():
            names.setdefault(cid, row.get("name"))
    state_by_id = {c.id: s for c, s in states}

    def _rows_for(cid):
        return [figures[p]["rows"][cid] for p in months if cid in figures.get(p, {}).get("rows", {})]

    rows = []
    for cid, name in names.items():
        entries = _rows_for(cid)
        pip = _sum_pip([e.get("pip") for e in entries])
        delivered = sum(e["delivered"] for e in entries)
        assignment = _assignment(entries) if is_dt else None
        if is_dt and assignment is None:
            assignment = 0
        state = state_by_id.get(cid) or plan_status(None, None)
        hit = _hit([
            (figures[p]["rows"].get(cid, {}).get("pip"), figures[p]["rows"].get(cid, {}).get("delivered", 0))
            for p in hit_months
            if p in figures
        ])
        rows.append(
            {
                "contractor_id": cid,
                "name": name,
                "assignment": assignment,
                "pip": pip,
                "delivered": delivered,
                "diff": _diff(delivered, pip),
                "pip_above_assignment": (
                    bool(is_dt and pip is not None and assignment is not None and pip > assignment)
                    if is_dt else None
                ),
                "hit_last_6": hit,
                **state,
            }
        )
    rows.sort(key=lambda r: (r["name"] or "").lower())

    totals = [figures[p]["total"] for p in months if p in figures]
    total_pip = _sum_pip([r["pip"] for r in rows])
    total_delivered = sum(r["delivered"] for r in rows)
    total_assignment = _assignment(totals) if is_dt else None
    internal = _internal_target(db, stream, months)

    kpis = {
        "assignment": total_assignment,
        "internal_pip": internal,
        "contractor_pip": total_pip,
        "gap_vs_internal": (
            total_pip - internal if total_pip is not None and internal is not None else None
        ),
        "delivered": total_delivered,
        "achievement_percent": (
            round(100.0 * total_delivered / total_pip, 1) if total_pip else None
        ),
        "expected_by_today": None,
        "pace_diff": None,
    }
    if view == "month" and total_pip is not None:
        expected = round(total_pip * _elapsed_fraction(months[0], today))
        kpis["expected_by_today"] = expected
        kpis["pace_diff"] = total_delivered - expected

    approved = sum(1 for _, s in states if s["status"] in ("approved", "revision_requested"))
    all_contractors = {
        "assignment": total_assignment,
        "pip": total_pip,
        "delivered": total_delivered,
        "diff": _diff(total_delivered, total_pip),
        "plans_approved": approved,
        "plans_total": len(states),
        "hit_last_6": _hit([
            (figures[p]["total"]["pip"] or None, figures[p]["total"]["delivered"])
            for p in hit_months
            if p in figures
        ]),
    }

    trend_points = []
    for p in trend:
        total = figures.get(p, {}).get("total")
        pip = (total["pip"] or None) if total else None
        done = total["delivered"] if total else 0
        trend_points.append(
            {
                "shamsi_year": p[0],
                "shamsi_month": p[1],
                "shamsi_month_name": jalali.month_name(p[1]),
                "pip": pip,
                "delivered": done,
                "hit": bool(pip is not None and done >= pip),
                "in_progress": p == running,
            }
        )

    return {
        "stream": stream,
        "kpis": kpis,
        "all_contractors": all_contractors,
        "rows": rows,
        "trend": trend_points,
    }


def _needs_attention(db: Session, user: User, running: tuple[int, int], today: date, dt_rows_running: dict) -> list[dict]:
    """What the PM should act on now, across both streams.

    * ``not_submitted`` -- the running month, past its deadline (day 3 of the
      month a plan covers), and no plan filed.
    * ``awaiting_approval`` -- a plan ``Submitted`` for the planning month
      (next month) or, filed late, for the running month.
    * ``revision_requested`` -- a revision pending on the running month.
    * ``pip_above_assignment`` -- DT, running month: the approved PIP is above
      what the contractor holds.
    """
    planning = jalali.next_period(*running)
    out = []
    deadline_passed = plans.deadline_has_passed(*running, today=today)

    for stream in (STREAM_DT, STREAM_ACCEPTANCE):
        name = "DT" if stream == STREAM_DT else "Acceptance"
        for month in (running, planning):
            for contractor, state in _plan_states(db, *month, stream):
                month_name = jalali.month_name(month[1])
                base = {
                    "contractor_id": contractor.id,
                    "name": contractor.name,
                    "stream": stream,
                    "shamsi_year": month[0],
                    "shamsi_month": month[1],
                    "plan_id": state["plan_id"],
                }
                if state["status"] == "awaiting_approval":
                    out.append({**base, "kind": "awaiting_approval",
                                "label": f"{name} {month_name} · {state['committed_count']} awaiting approval"})
                if month != running:
                    continue
                if state["status"] == "not_submitted" and deadline_passed:
                    out.append({**base, "kind": "not_submitted",
                                "label": f"{name} {month_name} · not submitted"})
                elif state["status"] == "revision_requested":
                    out.append({**base, "kind": "revision_requested",
                                "label": f"{name} · revision {state['revision_from']}→{state['revision_to']}"})
                if stream == STREAM_DT and state["in_force_count"] is not None:
                    held = dt_rows_running.get(contractor.id, {}).get("available", 0)
                    if state["in_force_count"] > held:
                        out.append({**base, "kind": "pip_above_assignment",
                                    "label": f"DT · PIP {state['in_force_count']} > assignment {held}"})
    return out


def overview(
    db: Session,
    user: User,
    *,
    period: str = "month",
    year: int | None = None,
    month: int | None = None,
    today: date | None = None,
) -> dict:
    """Everything the PM's Monthly Plan page reads, in one response."""
    today = today or jalali.tehran_today()
    ry, rm, day = jalali.to_shamsi_date(today)
    running = (ry, rm)
    if (year is None) != (month is None):
        raise OverviewError("Give both year and month, or neither")
    if year is None:
        year, month = running
    plans.validate_period(year, month)
    if period not in PERIODS:
        raise OverviewError(f"period must be one of: {', '.join(PERIODS)}")

    months = period_months(db, period, year, month, running)
    status_month = months[-1]
    if period == "month":
        trend = list(reversed([_back((year, month), i) for i in range(TREND_MONTHS)]))
    else:
        trend = months[-TREND_MONTHS:]
    last_closed = min(status_month, jalali.previous_period(*running))
    hit_months = list(reversed([_back(last_closed, i) for i in range(HIT_WINDOW)]))

    common = dict(view=period, months=months, status_month=status_month,
                  trend=trend, hit_months=hit_months, running=running, today=today)
    dt = _stream(db, user, STREAM_DT, **common)
    acc = _stream(db, user, STREAM_ACCEPTANCE, **common)

    from app.services.drive_test_analytics import DriveTestAnalytics

    running_dt = DriveTestAnalytics(db, user).scorecard([running])["months"][0]
    dt_rows_running = {r["contractor_id"]: r for r in running_dt["rows"]}

    sy, sm = status_month
    return {
        "period": period,
        "shamsi_year": year,
        "shamsi_month": month,
        "shamsi_month_name": jalali.month_name(month),
        "months": [
            {"shamsi_year": y, "shamsi_month": m, "shamsi_month_name": jalali.month_name(m)}
            for y, m in months
        ],
        "running_year": ry,
        "running_month": rm,
        "day_of_month": day if (year, month) == running else None,
        "days_in_month": jalali.days_in_month(year, month),
        "revision_window_open": plans.revision_window_open(sy, sm, today=today),
        "revisions_close_on": jalali.format_shamsi(
            jalali.from_shamsi_date(sy, sm, plans.REVISION_CUTOFF_DAY)
        ),
        "dt": dt,
        "acceptance": acc,
        "needs_attention": _needs_attention(db, user, running, today, dt_rows_running),
    }
