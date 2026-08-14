"""Monthly snapshot service.

Stores a per-Shamsi-month snapshot of the Drive Test KPIs so the dashboard
can show month-over-month deltas. Snapshots are created lazily on login:
the first user to log in during a new Shamsi month triggers creation for the
previous month's final state. Idempotent via the table's UNIQUE constraint.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance import MonthlySnapshot
from app.models.reference import Province, User
from app.services import cpm_columns as C
from app.services.drive_test_analytics import DriveTestAnalytics
from app.models.workitem import WorkItem


def ensure_current_month_snapshot(db: Session) -> None:
    """Create this month's global + per-province snapshot if missing.

    Safe to call on every login: it exits immediately once a snapshot for
    the current period exists.
    """
    year, month = jalali.current_shamsi_period()

    exists = db.execute(
        select(MonthlySnapshot.id).where(
            MonthlySnapshot.shamsi_year == year,
            MonthlySnapshot.shamsi_month == month,
            MonthlySnapshot.province_id.is_(None),
        )
    ).first()
    if exists:
        return

    # Compute global snapshot using a system-wide view (no province filter).
    _system_admin = _SystemScope()
    analytics = DriveTestAnalytics(db, _system_admin)
    global_kpis = analytics.compute_kpis()
    db.add(_snapshot_row(year, month, None, global_kpis))

    # Per-province snapshots.
    for prov in db.query(Province).all():
        prov_kpis = _province_kpis(db, prov.id)
        db.add(_snapshot_row(year, month, prov.id, prov_kpis))

    db.commit()


def get_month_over_month(db: Session, province_id: int | None) -> dict:
    """Return the previous period's snapshot totals for delta computation.

    Returns an empty dict when there is no prior snapshot (first month),
    so the caller renders a neutral delta.
    """
    year, month = jalali.current_shamsi_period()
    prev_year, prev_month = jalali.previous_period(year, month)
    row = db.execute(
        select(MonthlySnapshot).where(
            MonthlySnapshot.shamsi_year == prev_year,
            MonthlySnapshot.shamsi_month == prev_month,
            MonthlySnapshot.province_id.is_(province_id)
            if province_id is None
            else MonthlySnapshot.province_id == province_id,
        )
    ).scalar_one_or_none()
    if row is None:
        return {}
    return {
        "total_onair": row.total_onair,
        "total_dt_done": row.total_dt_done,
        "total_remaining": row.total_remaining,
        "total_ongoing": row.total_ongoing,
        "total_problematic": row.total_problematic,
        "current_month_dt_done": row.current_month_dt_done,
    }


def _snapshot_row(
    year: int, month: int, province_id: int | None, kpis: dict
) -> MonthlySnapshot:
    return MonthlySnapshot(
        shamsi_year=year,
        shamsi_month=month,
        province_id=province_id,
        total_onair=kpis["total_onair"],
        total_dt_done=kpis["total_dt_done"],
        total_remaining=kpis["total_remaining"],
        total_ongoing=kpis["total_ongoing"],
        total_problematic=kpis["total_problematic"],
        current_month_dt_done=kpis.get("current_month_dt_done", 0),
    )


def _province_kpis(db: Session, province_id: int) -> dict:
    """Compute KPIs restricted to a single province (for snapshots)."""
    scope = _SingleProvinceScope(province_id)
    return DriveTestAnalytics(db, scope).compute_kpis()


class _SystemScope:
    """A pseudo-user that sees all provinces (for global snapshot/analytics)."""

    sees_all_provinces = True
    contractor_id = None

    class role:  # noqa: N801 - mimic ORM attribute access
        name = "Admin"
        # Snapshots are system-wide, never scoped to one category owner's
        # queue. Mirrors Role.is_category_owner so visibility rules that read
        # the flag work against this stub too.
        is_category_owner = False


class _SingleProvinceScope:
    """A pseudo-user scoped to exactly one province (for per-province KPIs)."""

    sees_all_provinces = False
    contractor_id = None

    class role:  # noqa: N801
        name = "PM"
        is_category_owner = False

    def __init__(self, province_id: int) -> None:
        self._province_id = province_id

    @property
    def provinces(self):
        class _P:
            def __init__(self, pid: int) -> None:
                self.id = pid

        return [_P(self._province_id)]
