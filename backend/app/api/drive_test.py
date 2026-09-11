"""Drive Test Project dashboard endpoints.

``/overview`` returns all KPIs and chart datasets for the current user's
province scope, plus month-over-month deltas from the latest snapshot, plus
the ongoing, problematic and per-province breakdowns that split those totals
up. The breakdowns ride on this endpoint rather than on one of their own
because they are the same totals seen from closer up, computed from the same
cached pass: a second endpoint would re-read the database and could answer
with figures the cards on the same screen disagree with.

``/plan-delivery`` returns one month's commitment against its delivery. It is
a second endpoint rather than more fields on the overview because it answers a
different question over a different period — the overview is a running state
of the whole programme, this is one month closing — and because it is the one
payload on this dashboard that can name a contractor, which is worth keeping
where it can be read in one place.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import Province, User
from app.schemas import (
    ChartPoint,
    ContractorAchievementRow,
    ContractorScorecardRow,
    DriveTestKpis,
    DriveTestOverview,
    DriveTestTrend,
    KpiWithDelta,
    MonthFlows,
    OngoingBreakdown,
    PlanAndDelivery,
    ProblematicBreakdown,
    ProvinceBreakdownRow,
    ProvinceOption,
    ProvinceProgressPoint,
    TrendPoint,
)
from app.services import dt_trends, monthly_plan as plans
from app.services.drive_test_analytics import DriveTestAnalytics
from app.services.snapshots import get_month_over_month
from app.services.visibility import visible_province_ids

router = APIRouter(prefix="/drive-test", tags=["drive-test"])


def _resolve_province(user: User, province_id: int | None) -> int | None:
    """Validate a requested province against the caller's own scope.

    Returns the id to filter on, or ``None`` for the caller's full scope. A
    province outside the caller's grants is rejected here with a 404 rather
    than silently ignored: quietly widening the answer back to everything
    would show a user national figures they asked to narrow, and quietly
    returning nothing would look like a province with no sites.

    The analytics layer applies the same rule again as a ``WHERE`` on top of
    the scoped query, so this check is the readable error, not the barrier.
    """
    if province_id is None:
        return None
    allowed = visible_province_ids(user)
    if allowed is not None and province_id not in allowed:
        raise HTTPException(404, "Province not found in your scope")
    return province_id


def _province_options(db: Session, user: User) -> list[ProvinceOption]:
    """The provinces this caller may narrow to, alphabetically.

    A contractor is scoped by what is assigned to them rather than by
    geography, so ``visible_province_ids`` returns every province for them the
    same as it does for an unrestricted staff account. Offering the full list
    is still correct: the filter only ever removes rows from what the caller
    could already see, so a province holding none of their sites narrows the
    dashboard to zero rather than revealing anything.
    """
    allowed = visible_province_ids(user)
    stmt = select(Province).order_by(Province.name)
    if allowed is not None:
        if not allowed:
            return []
        stmt = stmt.where(Province.id.in_(allowed))
    return [
        ProvinceOption(id=p.id, name=p.name) for p in db.execute(stmt).scalars().all()
    ]


@router.get("/overview", response_model=DriveTestOverview)
def drive_test_overview(
    province_id: int | None = Query(
        None, description="Narrow every figure to one province inside your scope"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DriveTestOverview:
    """Return the full Drive Test Project dashboard payload for this user."""
    province_id = _resolve_province(user, province_id)
    analytics = DriveTestAnalytics(db, user, province_id=province_id)
    kpis = analytics.compute_kpis()
    # Off the same cached work items the KPIs were counted from, so the
    # breakdowns reconcile to the cards rather than to a second reading of the
    # database taken a moment later.
    breakdowns = analytics.breakdowns()

    # Month-over-month deltas. Use the global snapshot when the user sees all
    # provinces; otherwise fall back to the global one (per-province delta only
    # applies cleanly to single-province users, handled below).
    prev = _previous_totals(db, user, province_id)

    total_onair = kpis["total_onair"]

    def pct(n: int) -> float | None:
        return round(n / total_onair * 100, 1) if total_onair else None

    def delta(key: str) -> int | None:
        return kpis[key] - prev[key] if key in prev else None

    dt_kpis = DriveTestKpis(
        total_onair=KpiWithDelta(value=total_onair, delta=delta("total_onair")),
        total_dt_done=KpiWithDelta(
            value=kpis["total_dt_done"],
            delta=delta("total_dt_done"),
            percent_of_onair=pct(kpis["total_dt_done"]),
        ),
        total_remaining=KpiWithDelta(
            value=kpis["total_remaining"],
            delta=delta("total_remaining"),
            percent_of_onair=pct(kpis["total_remaining"]),
        ),
        total_ongoing=KpiWithDelta(
            value=kpis["total_ongoing"],
            delta=delta("total_ongoing"),
            percent_of_onair=pct(kpis["total_ongoing"]),
        ),
        total_problematic=KpiWithDelta(
            value=kpis["total_problematic"],
            delta=delta("total_problematic"),
            percent_of_onair=pct(kpis["total_problematic"]),
        ),
        current_month_dt_done=KpiWithDelta(
            value=kpis["current_month_dt_done"],
            delta=delta("current_month_dt_done"),
        ),
    )

    year, month = jalali.current_shamsi_period()
    return DriveTestOverview(
        kpis=dt_kpis,
        ongoing_by_contractor=_points(analytics.chart_ongoing_by_contractor()),
        problematic_by_category=_points(analytics.chart_problematic_by_category()),
        dt_done_by_contractor=_points(analytics.chart_dt_done_by_contractor()),
        dt_done_yearly=_points(analytics.chart_dt_done_yearly()),
        dt_done_monthly=analytics.chart_dt_done_monthly(shamsi_year=year),
        progress_by_province=[
            ProvinceProgressPoint(**row)
            for row in analytics.chart_progress_by_province()
        ],
        current_month_label=f"{jalali.month_name(month)} {year}",
        ongoing_breakdown=_ongoing_breakdown(breakdowns["ongoing"]),
        problematic_breakdown=_problematic_breakdown(breakdowns["problematic"]),
        province_breakdown=[
            ProvinceBreakdownRow(**row) for row in breakdowns["provinces"]
        ],
        contractor_scorecard=[
            ContractorScorecardRow(**row) for row in breakdowns["contractors"]
        ],
        generated_at=datetime.now(timezone.utc),
        provinces=_province_options(db, user),
        province_id=province_id,
    )


@router.get("/trend", response_model=DriveTestTrend)
def drive_test_trend(
    months: int = Query(
        dt_trends.DEFAULT_MONTHS, ge=2, le=36, description="How many Shamsi months"
    ),
    province_id: int | None = Query(
        None, description="Narrow the series to one province inside your scope"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DriveTestTrend:
    """The trailing-month series, and the newest month that has a flow ledger.

    A second endpoint rather than more fields on ``/overview`` because it
    reads an entirely different source. The overview counts live work items;
    this reads the monthly snapshot table, which is written on the login path
    and can be older, thinner, or — in a deployment where nobody signed in for
    a month — missing periods outright. Merging the two would put figures of
    two different vintages behind one loading state, and a snapshot table with
    gaps would take the live dashboard down with it.

    ``months`` is capped at 36 rather than unbounded: past three years the
    axis stops being readable long before the query stops being cheap, so the
    limit is about the chart, not the database.
    """
    province_id = _resolve_province(user, province_id)
    if province_id is not None:
        scope: list[int] | None = [province_id]
    else:
        scope = visible_province_ids(user)

    series = dt_trends.month_series(db, scope, months=months)
    flows = dt_trends.latest_flows(series)
    return DriveTestTrend(
        months=[TrendPoint(**point) for point in _trend_payload(series)],
        latest_flows=MonthFlows(**flows) if flows else None,
        province_id=province_id,
    )


def _trend_payload(series: list[dict]) -> list[dict]:
    """Drop the raw flow dict from each point before it becomes a TrendPoint.

    The flows are returned once, on ``latest_flows``, where they are paired
    with the opening balance that makes them a ledger. Repeating them on every
    point would put the same figures on the wire twice in two shapes, and the
    second shape has no opening balance to close against.
    """
    return [{k: v for k, v in point.items() if k != "flows"} for point in series]


@router.get("/plan-delivery", response_model=PlanAndDelivery)
def plan_delivery(
    year: int | None = Query(None, description="Shamsi year; defaults to the current one"),
    month: int | None = Query(None, ge=1, le=12, description="Shamsi month 1-12"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PlanAndDelivery:
    """PIP, Assigned, Actual and Achievement for one Shamsi month.

    Open to every signed-in role, because the answer is already scoped to the
    caller: staff see the contractors their work-item scope reaches, and a
    contractor sees one row — their own — plus an unnamed programme average.
    That narrowing happens in the service's queries, not in this layer.

    The period defaults to the current Shamsi month, which is what the
    dashboard asks for; it is a parameter so the same figures can be read for
    a month that has closed without waiting for the calendar.
    """
    if year is None or month is None:
        year, month = jalali.current_shamsi_period()
    try:
        plans.validate_period(year, month)
    except plans.PlanError as exc:
        raise HTTPException(400, str(exc)) from None

    data = DriveTestAnalytics(db, user).plan_and_delivery(year, month)
    return PlanAndDelivery(
        **{k: v for k, v in data.items() if k != "rows"},
        rows=[ContractorAchievementRow(**row) for row in data["rows"]],
    )


def _previous_totals(db: Session, user: User, province_id: int | None = None) -> dict:
    """Pick the right prior-month snapshot for this user's scope.

    A user who sees everything gets the global snapshot. A user scoped to some
    provinces gets the sum of those provinces' snapshots. A user who has
    narrowed the dashboard to one province gets that province's row alone —
    without this the delta chips would compare one province's current figures
    against the whole scope's baseline, which is the same arithmetic mistake
    the province summing below exists to prevent, one level down.

    Summing matters: this used to hand the *global* snapshot to anyone with
    more than one province, so a user granted three provinces out of
    thirty-one saw current values for three and a baseline for thirty-one. The
    deltas were not merely imprecise, they were arithmetically meaningless --
    and they leaked the national totals to a user scoped away from them.

    Returning ``{}`` where there is no snapshot is deliberate: the caller reads
    ``key in prev`` and renders no delta at all, which is honest about not
    knowing rather than showing a change of zero.
    """
    if province_id is not None:
        return get_month_over_month(db, province_id)

    province_ids = visible_province_ids(user)
    if province_ids is None:
        return get_month_over_month(db, None)
    if not province_ids:
        return {}

    totals: dict = {}
    for province_id in province_ids:
        for key, value in get_month_over_month(db, province_id).items():
            totals[key] = totals.get(key, 0) + value
    return totals


def _ongoing_breakdown(data: dict) -> OngoingBreakdown:
    return OngoingBreakdown(
        total=data["total"],
        by_stage=_points(data["by_stage"]),
        by_contractor=_points(data["by_contractor"]),
        without_contractor=data["without_contractor"],
        by_province=_points(data["by_province"]),
        by_age=_points(data["by_age"]),
        without_launch_date=data["without_launch_date"],
    )


def _problematic_breakdown(data: dict) -> ProblematicBreakdown:
    return ProblematicBreakdown(
        total=data["total"],
        by_category=_points(data["by_category"]),
        by_province=_points(data["by_province"]),
    )


def _points(rows: list[dict]) -> list[ChartPoint]:
    return [ChartPoint(name=r["name"], value=r["value"]) for r in rows]
