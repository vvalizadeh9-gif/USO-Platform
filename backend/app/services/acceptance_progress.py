"""Acceptance progress: approvals per month against both plans, three streams.

What the Acceptance Dashboard's chart and month panel read
(``GET /acceptance/progress``). One payload serves all three tabs, so
switching tab never refetches:

* ``village`` -- villages fully accepted (ICT **and** CRA approved), plan
  stream ``ACCEPTANCE``;
* ``ict`` -- villages approved by ICT, plan stream ``ICT``;
* ``cra`` -- villages approved by CRA, plan stream ``CRA``.

Each month carries what was approved and two plans: the **Internal PIP**
(the PM's own number, ``AcceptanceMonthlyTarget``) and the **Contractor PIP**
(the contractors' approved PIPs, ``ContractorMonthlyPlan``).

Nothing here decides anything new. The universe and its scope are
``acceptance_plan.load_scoped_villages`` -- the same DT-Done, pure-هدف set
the overview counts -- the month a village cleared a stream is
``acceptance_plan.approval_period``, and the plan lines are the same lookups
and the same ``cumulative_plan`` anchoring the older trend uses.

**Undated approvals are an opening balance.** A village approved without a
verdict date (seeded that way) has no month to be counted in. It is counted
in every month's ``approved_cumulative`` from the first month of the window,
and in no month's ``approved``. That is what makes the last month's running
total equal the overview's approved figure for the same scope.

**Plans are None, never 0**, when there is no plan for that month and stream,
when the view is narrowed to a province (plans are programme-wide), and --
for the Internal PIP -- when the caller may not see it (a contractor, or staff
narrowed to one contractor).
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy.orm import Session

from app.core import jalali
from app.core.deps import CONTRACTOR
from app.models.monthly_plan import STREAM_ACCEPTANCE, STREAM_CRA, STREAM_ICT
from app.models.reference import User
from app.services import acceptance_plan

Period = tuple[int, int]

#: The payload's key for each stream, in tab order, and the plan stream behind it.
STREAM_KEYS: dict[str, str] = {
    "village": STREAM_ACCEPTANCE,
    "ict": STREAM_ICT,
    "cra": STREAM_CRA,
}

DEFAULT_MONTHS = 12
MAX_MONTHS = 24


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _Scope:
    """Who is asking, narrowed to what, and which plans that lets them see."""

    province_id: int | None
    #: The contractor the villages and the Contractor PIP are narrowed to.
    #: Always the caller's own company for a contractor account.
    contractor_id: int | None
    plans_available: bool
    internal_visible: bool


def _resolve_scope(user: User, province_id: int | None, contractor_id: int | None) -> _Scope:
    is_contractor = user.role.name == CONTRACTOR
    contractor_id = acceptance_plan.plan_contractor(user, contractor_id)
    return _Scope(
        province_id=province_id,
        contractor_id=contractor_id,
        plans_available=province_id is None,
        internal_visible=not is_contractor and contractor_id is None,
    )


# ---------------------------------------------------------------------------
# Month window
# ---------------------------------------------------------------------------
def _window(today: date, months: int) -> list[Period]:
    """The *months* Shamsi periods ending with today's, oldest first."""
    year, month, _ = jalali.to_shamsi_date(today)
    periods: list[Period] = []
    period: Period = (year, month)
    for _ in range(max(1, min(months, MAX_MONTHS))):
        periods.append(period)
        period = jalali.previous_period(*period)
    return list(reversed(periods))


# ---------------------------------------------------------------------------
# Actuals: every stream bucketed in one pass over the villages
# ---------------------------------------------------------------------------
@dataclass
class _Actuals:
    """One stream's approvals: undated ones, and dated ones per month."""

    opening: int = 0
    monthly: dict[Period, int] = field(default_factory=dict)

    def before(self, period: Period) -> int:
        """Approved before *period* began, the opening balance included."""
        return self.opening + sum(n for p, n in self.monthly.items() if p < period)

    def through(self, period: Period) -> int:
        """Approved by the end of *period*."""
        return self.before(jalali.next_period(*period))


def _bucket(villages: Iterable) -> dict[str, _Actuals]:
    """Each stream's approvals, from one walk over the scoped villages."""
    actuals = {key: _Actuals() for key in STREAM_KEYS}
    for village in villages:
        for key, stream in STREAM_KEYS.items():
            if not acceptance_plan.is_approved(village, stream):
                continue
            period = acceptance_plan.approval_period(village, stream)
            bucket = actuals[key]
            if period is None:
                bucket.opening += 1
            else:
                bucket.monthly[period] = bucket.monthly.get(period, 0) + 1
    return actuals


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _Plan:
    """One plan line for one stream: monthly amounts and their running total."""

    monthly: dict[Period, int]
    cumulative: dict[Period, int]

    def at(self, period: Period) -> tuple[int | None, int | None]:
        """(monthly, cumulative) for a month, both None where nothing was planned."""
        if period not in self.monthly:
            return None, None
        return self.monthly[period], self.cumulative.get(period)


_NO_PLAN = _Plan({}, {})


def _anchored(monthly: dict[Period, int], actuals: _Actuals) -> _Plan:
    """A plan line whose running total starts from what was actually approved."""
    return _Plan(monthly, acceptance_plan.cumulative_plan(monthly, actuals.before))


def _internal_plan(db: Session, scope: _Scope, stream: str, actuals: _Actuals) -> _Plan:
    if not (scope.plans_available and scope.internal_visible):
        return _NO_PLAN
    return _anchored(acceptance_plan.internal_monthly_targets(db, stream), actuals)


def _contractor_plan(db: Session, scope: _Scope, stream: str, actuals: _Actuals) -> _Plan:
    if not scope.plans_available:
        return _NO_PLAN
    if scope.contractor_id is None:
        monthly = acceptance_plan.all_contractor_monthly_pips(db, stream)
    else:
        monthly = acceptance_plan.contractor_monthly_pips(db, scope.contractor_id, stream)
    return _anchored(monthly, actuals)


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
def _stream_month(period: Period, actuals: _Actuals, internal: _Plan, contractor: _Plan) -> dict:
    internal_plan, internal_cumulative = internal.at(period)
    contractor_plan, contractor_cumulative = contractor.at(period)
    return {
        "approved": actuals.monthly.get(period, 0),
        "approved_cumulative": actuals.through(period),
        "internal_plan": internal_plan,
        "internal_plan_cumulative": internal_cumulative,
        "contractor_plan": contractor_plan,
        "contractor_plan_cumulative": contractor_cumulative,
    }


def progress(
    db: Session,
    user: User,
    *,
    months: int = DEFAULT_MONTHS,
    province_id: int | None = None,
    contractor_id: int | None = None,
    today: date | None = None,
) -> dict:
    """Approvals against plan, month by month, for all three streams.

    Shaped as ``schemas.AcceptanceProgress``. *today* is the Tehran day by
    default; tests pin it.
    """
    today = today or jalali.tehran_today()
    scope = _resolve_scope(user, province_id, contractor_id)
    villages = acceptance_plan.load_scoped_villages(
        db,
        user,
        province_ids={province_id} if province_id is not None else None,
        contractor_id=scope.contractor_id,
    )
    actuals = _bucket(villages)
    plans = {
        key: (
            _internal_plan(db, scope, stream, actuals[key]),
            _contractor_plan(db, scope, stream, actuals[key]),
        )
        for key, stream in STREAM_KEYS.items()
    }

    year, month, day = jalali.to_shamsi_date(today)
    current: Period = (year, month)
    out_months = [
        {
            "shamsi_year": p[0],
            "shamsi_month": p[1],
            "label": jalali.month_name(p[1]),
            "is_current": p == current,
            "days_in_month": jalali.days_in_month(*p),
            **{
                key: _stream_month(p, actuals[key], *plans[key])
                for key in STREAM_KEYS
            },
        }
        for p in _window(today, months)
    ]
    return {
        "today": {
            "shamsi_year": year,
            "shamsi_month": month,
            "day": day,
            "days_in_month": jalali.days_in_month(year, month),
        },
        "plans_available": scope.plans_available,
        "internal_visible": scope.internal_visible,
        "months": out_months,
    }
