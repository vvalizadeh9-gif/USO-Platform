"""Drive Test Project dashboard endpoint.

One combined endpoint returns all KPIs and chart datasets for the current
user's province scope, plus month-over-month deltas from the latest snapshot.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core import jalali
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas import (
    ChartPoint,
    DriveTestKpis,
    DriveTestOverview,
    KpiWithDelta,
    ProvinceProgressPoint,
)
from app.services.drive_test_analytics import DriveTestAnalytics
from app.services.snapshots import get_month_over_month
from app.services.visibility import visible_province_ids

router = APIRouter(prefix="/drive-test", tags=["drive-test"])


@router.get("/overview", response_model=DriveTestOverview)
def drive_test_overview(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> DriveTestOverview:
    """Return the full Drive Test Project dashboard payload for this user."""
    analytics = DriveTestAnalytics(db, user)
    kpis = analytics.compute_kpis()

    # Month-over-month deltas. Use the global snapshot when the user sees all
    # provinces; otherwise fall back to the global one (per-province delta only
    # applies cleanly to single-province users, handled below).
    prev = _previous_totals(db, user)

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
    )


def _previous_totals(db: Session, user: User) -> dict:
    """Pick the right prior-month snapshot for this user's scope."""
    province_ids = visible_province_ids(user)
    # Single-province user → that province's snapshot; everyone else → global.
    if province_ids is not None and len(province_ids) == 1:
        return get_month_over_month(db, province_ids[0])
    return get_month_over_month(db, None)


def _points(rows: list[dict]) -> list[ChartPoint]:
    return [ChartPoint(name=r["name"], value=r["value"]) for r in rows]
