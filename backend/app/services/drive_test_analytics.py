"""Drive Test Project analytics.

Computes the KPIs and chart datasets for the Drive Test dashboard. All
queries are province-scoped through ``apply_work_item_scope`` so the same
row-level security used everywhere else applies here too (no duplication).

Definitions (agreed with the business):
* On-air     : work item whose ``last_stage`` is temporary or permanent launch.
* DT Done    : on-air work item with ``dt_status == 'Done'``.
* Problematic: on-air work item with ``dt_status == 'Problematic'`` (CPM-
               imported) OR whose in-app Health Check workflow has flagged it
               Problematic (``current_stage == 'Problematic'``). A site can
               become problematic entirely inside the app, before the next
               CPM import ever sees it — this KPI must reflect that.
* Ongoing    : on-air, not DT-Done, and not Problematic by either signal.
* Remaining  : on-air minus DT done  ( == ongoing + problematic + others ).

Contractor attribution prefers the live in-app assignment over the
CPM-seeded drive-test subcontractor: a site reassigned inside the app after
the last CPM import must show under its *current* contractor, not a stale
Excel value — see ``_effective_contractor_id``.
Counts are of unique work items (Site + Site Type), never de-duplicated
across site types.
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import jalali
from app.models.reference import Contractor, Province
from app.models.workitem import Site, WorkItem
from app.services import cpm_columns as C
from app.services.visibility import apply_work_item_scope
from app.services.workflow import STAGE_HEALTH_PROBLEM, latest_problem_category_name


class DriveTestAnalytics:
    """Encapsulates all Drive Test dashboard computations for one user."""

    def __init__(self, db: Session, user) -> None:
        self._db = db
        self._user = user
        self._work_items: list[WorkItem] | None = None

    # ---------- data loading ----------
    def _load(self) -> list[WorkItem]:
        """Load the user's visible work items once and cache them.

        Eager-loads ``site`` (needed by ``chart_progress_by_province``),
        ``assignments`` (needed for live contractor attribution), and the HC
        workflow relations (needed to detect in-app Problematic status and
        its category) — all in the same query, avoiding N+1 lazy loads.
        """
        if self._work_items is None:
            stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
            stmt = apply_work_item_scope(stmt, self._user, self._db)
            stmt = stmt.options(
                selectinload(WorkItem.site),
                selectinload(WorkItem.assignments),
                selectinload(WorkItem.hc_tasks),
                selectinload(WorkItem.health_checks),
            )
            self._work_items = list(self._db.execute(stmt).scalars().all())
        return self._work_items

    # ---------- KPI helpers ----------
    @staticmethod
    def _is_onair(wi: WorkItem) -> bool:
        return C.normalize_stage(wi.last_stage) in C.ONAIR_STAGES

    @staticmethod
    def _is_problematic(wi: WorkItem) -> bool:
        """CPM-imported Problematic status OR an in-app HC Problematic flag."""
        return wi.dt_status == "Problematic" or wi.current_stage == STAGE_HEALTH_PROBLEM

    def _is_ongoing(self, wi: WorkItem) -> bool:
        """On-air, not DT-Done, and not Problematic by either signal."""
        return wi.dt_status != "Done" and not self._is_problematic(wi)

    def _onair_items(self) -> list[WorkItem]:
        return [w for w in self._load() if self._is_onair(w)]

    @staticmethod
    def _effective_contractor_id(wi: WorkItem) -> int | None:
        """Prefer the live in-app assignment's contractor over the CPM-seeded
        drive-test subcontractor, which goes stale the moment a site is
        reassigned inside the app after the last CPM import."""
        active = next((a for a in wi.assignments if a.is_active), None)
        if active is not None:
            return active.contractor_id
        return wi.dt_sc_contractor_id

    @staticmethod
    def _effective_problem_category(wi: WorkItem) -> str:
        """Prefer the Admin/PM/Coordinator-selected category over CPM free
        text — the dropdown value is validated and app-controlled; the CPM
        column is whatever the field team typed into Excel."""
        return (
            latest_problem_category_name(wi)
            or wi.dt_problem_category
            or "Uncategorized"
        )

    def compute_kpis(self) -> dict:
        """Return the KPI counts for the user's scope."""
        onair = self._onair_items()
        done = [w for w in onair if w.dt_status == "Done"]
        problematic = [w for w in onair if self._is_problematic(w)]
        ongoing = [w for w in onair if self._is_ongoing(w)]
        total_onair = len(onair)
        total_done = len(done)
        return {
            "total_onair": total_onair,
            "total_dt_done": total_done,
            "total_remaining": total_onair - total_done,
            "total_ongoing": len(ongoing),
            "total_problematic": len(problematic),
            "current_month_dt_done": self._current_month_done_count(done),
        }

    def _current_month_done_count(self, done_items: list) -> int:
        """Count DT-done work items whose DT date falls in the current Shamsi month."""
        cur_year, cur_month = jalali.current_shamsi_period()
        count = 0
        for w in done_items:
            if w.dt_date_gregorian:
                y, m = jalali.to_shamsi(w.dt_date_gregorian)
                if y == cur_year and m == cur_month:
                    count += 1
        return count

    # ---------- charts ----------
    def chart_ongoing_by_contractor(self) -> list[dict]:
        """Ongoing sites grouped by their *current* contractor.

        Uses live assignment attribution (see ``_effective_contractor_id``),
        not the CPM-seeded snapshot — otherwise a site reassigned in-app
        after the last import still shows under its old contractor. Sites
        with no contractor at all (never assigned, no CPM subcontractor) are
        dropped rather than surfaced as an "Unassigned" bucket: an unassigned
        site isn't a contractor workload data point, it's a Ready-for-
        Assignment item and belongs in that queue, not this chart.
        """
        counts: dict[int, int] = defaultdict(int)
        for w in self._onair_items():
            if self._is_ongoing(w):
                cid = self._effective_contractor_id(w)
                if cid is not None:
                    counts[cid] += 1
        return self._label_contractors(counts)

    def chart_problematic_by_category(self) -> list[dict]:
        counts: dict[str, int] = defaultdict(int)
        for w in self._onair_items():
            if self._is_problematic(w):
                counts[self._effective_problem_category(w)] += 1
        return [{"name": k, "value": v} for k, v in _sorted_desc(counts)]

    def chart_dt_done_by_contractor(self) -> list[dict]:
        counts: dict[int, int] = defaultdict(int)
        for w in self._onair_items():
            if w.dt_status == "Done":
                cid = self._effective_contractor_id(w)
                if cid is not None:
                    counts[cid] += 1
        return self._label_contractors(counts)

    def chart_dt_done_yearly(self) -> list[dict]:
        """DT Done grouped by Shamsi year (from dt_date_gregorian)."""
        counts: dict[int, int] = defaultdict(int)
        for w in self._onair_items():
            if w.dt_status == "Done" and w.dt_date_gregorian:
                year, _ = jalali.to_shamsi(w.dt_date_gregorian)
                counts[year] += 1
        return [{"name": str(y), "value": counts[y]} for y in sorted(counts)]

    def chart_dt_done_monthly(self, shamsi_year: int | None = None) -> list[dict]:
        """DT Done grouped by Shamsi month (farvardin..esfand).

        If ``shamsi_year`` is given, only that year's DTs are counted;
        otherwise every year is aggregated per month.
        """
        counts: dict[int, int] = defaultdict(int)
        for w in self._onair_items():
            if w.dt_status == "Done" and w.dt_date_gregorian:
                year, month = jalali.to_shamsi(w.dt_date_gregorian)
                if shamsi_year is None or year == shamsi_year:
                    counts[month] += 1
        return [
            {"name": jalali.month_name(m), "month": m, "value": counts.get(m, 0)}
            for m in range(1, 13)
        ]

    def chart_progress_by_province(self) -> list[dict]:
        """Per-province on-air vs DT-done, for a progress comparison."""
        onair_by_prov: dict[int | None, int] = defaultdict(int)
        done_by_prov: dict[int | None, int] = defaultdict(int)
        for w in self._onair_items():
            prov_id = w.site.province_id if w.site else None
            onair_by_prov[prov_id] += 1
            if w.dt_status == "Done":
                done_by_prov[prov_id] += 1

        names = self._province_names(list(onair_by_prov.keys()))
        rows = []
        for prov_id, onair in onair_by_prov.items():
            done = done_by_prov.get(prov_id, 0)
            rows.append(
                {
                    "name": names.get(prov_id, "—"),
                    "onair": onair,
                    "done": done,
                    "remaining": onair - done,
                    "done_percent": round(done / onair * 100, 1) if onair else 0.0,
                }
            )
        rows.sort(key=lambda r: r["done"], reverse=True)
        return rows

    # ---------- label helpers ----------
    def _label_contractors(self, counts: dict[int | None, int]) -> list[dict]:
        ids = [cid for cid in counts if cid is not None]
        names = {}
        if ids:
            for c in self._db.query(Contractor).filter(Contractor.id.in_(ids)).all():
                names[c.id] = c.name
        out = [
            {"name": names.get(cid, "Unassigned"), "value": v}
            for cid, v in counts.items()
        ]
        out.sort(key=lambda r: r["value"], reverse=True)
        return out

    def _province_names(self, ids: list[int | None]) -> dict[int, str]:
        clean_ids = [i for i in ids if i is not None]
        if not clean_ids:
            return {}
        rows = self._db.query(Province).filter(Province.id.in_(clean_ids)).all()
        return {p.id: p.name for p in rows}


# ---------- module-level helpers ----------
def _sorted_desc(counts: dict) -> list[tuple]:
    return sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
