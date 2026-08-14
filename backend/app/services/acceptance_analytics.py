"""Acceptance dashboard analytics.

Computes the KPIs, work-item/village analysis and per-province status for the
Acceptance tab, reading the ICT/CRA approval data that was seeded from the CPM
execution block (columns AV..BQ) into the ``acceptances`` table. Every query is
province-scoped through ``apply_work_item_scope`` so the same row-level security
used everywhere else applies here too.

Business rules (agreed with the product owner):

* Village universe : every (site, village) row counts — duplicates are NOT
  removed. The same village listed under several site-types (or repeated on a
  site) is counted once per row, everywhere (KPIs, analysis, province status).
  Only villages classified exactly هدف (see ``cpm_columns.is_pure_target``)
  whose work item is DT-Done qualify. The import now applies that same gate, so
  the filter here only ever excludes rows left by an earlier, laxer import
  (اقماری, "هدف (Verbally)" and the other sub-flags).
* ICT approved   : a village row is ICT-approved when *every requested
  technology* (from the work item's ``requested_technology``) has
  ``ict_status == 'Approved'``. CRA is the mirror rule.
* Site rollup    : "work-item fully approved" is measured per *site* — a site is
  fully approved when all of its qualifying village rows are approved (the
  analysis area talks about "all villages related to one site").
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.reference import Province
from app.models.workitem import Village, WorkItem
from app.services import cpm_columns as C
from app.services.visibility import apply_work_item_scope

_TECHS = ("2G", "3G", "4G")
_DT_DONE = "Done"
_APPROVED = "Approved"


class _Unit:
    """One (site, village) row and its ICT/CRA verdict — never deduplicated."""

    __slots__ = ("site_id", "province_id", "ict", "cra")

    def __init__(
        self, site_id: int | None, province_id: int | None, ict: bool, cra: bool
    ) -> None:
        self.site_id = site_id
        self.province_id = province_id
        self.ict = ict
        self.cra = cra


class AcceptanceAnalytics:
    """Encapsulates all Acceptance dashboard computations for one user."""

    def __init__(self, db: Session, user) -> None:
        self._db = db
        self._user = user
        self._units: list[_Unit] | None = None

    # ---------- data loading ----------
    def _load_units(self) -> list[_Unit]:
        """Build the village-row universe once and cache it.

        One entry per qualifying Village row — duplicates across site-types are
        intentionally kept (product decision): every site-id/village-id row is
        counted independently in every metric.
        """
        if self._units is not None:
            return self._units

        stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
        stmt = apply_work_item_scope(stmt, self._user, self._db)
        stmt = stmt.options(
            selectinload(WorkItem.site),
            selectinload(WorkItem.villages).selectinload(Village.acceptances),
        )
        work_items = self._db.execute(stmt).scalars().all()

        units: list[_Unit] = []
        for wi in work_items:
            if wi.dt_status != _DT_DONE:
                continue  # acceptance only applies once the drive test is done
            techs = self._requested_techs(wi)
            site_id = wi.site.id if wi.site else None
            province_id = wi.site.province_id if wi.site else None
            for village in wi.villages:
                if village.deleted_at is not None:
                    continue
                if not C.is_pure_target(village.target_classification):
                    continue
                units.append(
                    _Unit(
                        site_id,
                        province_id,
                        self._instance_approved(village, techs, "ict"),
                        self._instance_approved(village, techs, "cra"),
                    )
                )

        self._units = units
        return units

    @staticmethod
    def _requested_techs(wi: WorkItem) -> set[str]:
        """Parse the work item's requested technologies into a {2G,3G,4G} set."""
        text = (wi.requested_technology or "").upper()
        return {t for t in _TECHS if t in text}

    @staticmethod
    def _instance_approved(
        village: Village, requested: set[str], authority: str
    ) -> bool:
        """Is this village row approved by ``authority`` (ict|cra)?

        Approved iff every requested technology has an Approved acceptance row.
        When the work item lists no recognisable requested tech, fall back to
        the technologies that actually have acceptance rows so the village
        isn't stuck un-approvable. A village with nothing to approve against is
        treated as not approved.
        """
        by_tech = {a.technology: a for a in village.acceptances}
        techs = requested or set(by_tech)
        if not techs:
            return False
        attr = f"{authority}_status"
        for tech in techs:
            acc = by_tech.get(tech)
            if acc is None or getattr(acc, attr) != _APPROVED:
                return False
        return True

    # ---------- KPI cards ----------
    def compute_kpis(self) -> dict:
        units = self._load_units()
        total = len(units)
        ict_ok = sum(1 for v in units if v.ict)
        cra_ok = sum(1 for v in units if v.cra)
        return {
            "total_dt_done_villages": total,
            "total_ict_approval": ict_ok,
            "total_ict_remained": total - ict_ok,
            "total_cra_approval": cra_ok,
            "total_cra_remained": total - cra_ok,
        }

    # ---------- analysis area ----------
    def compute_analysis(self) -> dict:
        units = self._load_units()

        # Village-level cross tabs (every row counts).
        villages_ict_not_cra = sum(1 for v in units if v.ict and not v.cra)
        villages_cra_not_ict = sum(1 for v in units if v.cra and not v.ict)

        # Site-level rollup: a site is fully approved when every one of its
        # qualifying village rows is approved.
        sites: dict[int | None, dict[str, bool]] = defaultdict(
            lambda: {"ict": True, "cra": True, "has": False}
        )
        for v in units:
            s = sites[v.site_id]
            s["has"] = True
            s["ict"] = s["ict"] and v.ict
            s["cra"] = s["cra"] and v.cra

        site_vals = [s for s in sites.values() if s["has"]]
        sites_ict_full = sum(1 for s in site_vals if s["ict"])
        sites_cra_full = sum(1 for s in site_vals if s["cra"])
        return {
            "sites_ict_full": sites_ict_full,
            "sites_cra_full": sites_cra_full,
            "sites_ict_and_cra_full": sum(
                1 for s in site_vals if s["ict"] and s["cra"]
            ),
            "sites_ict_not_cra": sum(
                1 for s in site_vals if s["ict"] and not s["cra"]
            ),
            "sites_cra_not_ict": sum(
                1 for s in site_vals if s["cra"] and not s["ict"]
            ),
            "villages_ict_not_cra": villages_ict_not_cra,
            "villages_cra_not_ict": villages_cra_not_ict,
        }

    # ---------- province status ----------
    def compute_provinces(self) -> list[dict]:
        units = self._load_units()
        totals: dict[int | None, dict[str, int]] = defaultdict(
            lambda: {"total": 0, "ict": 0, "cra": 0}
        )
        for v in units:
            bucket = totals[v.province_id]
            bucket["total"] += 1
            if v.ict:
                bucket["ict"] += 1
            if v.cra:
                bucket["cra"] += 1

        names = self._province_names(list(totals.keys()))
        rows = []
        for province_id, b in totals.items():
            total = b["total"]
            ict_ok, cra_ok = b["ict"], b["cra"]
            rows.append(
                {
                    "name": names.get(province_id, "—"),
                    "total": total,
                    "ict_approved": ict_ok,
                    "ict_remained": total - ict_ok,
                    "ict_approved_pct": _pct(ict_ok, total),
                    "ict_remained_pct": _pct(total - ict_ok, total),
                    "cra_approved": cra_ok,
                    "cra_remained": total - cra_ok,
                    "cra_approved_pct": _pct(cra_ok, total),
                    "cra_remained_pct": _pct(total - cra_ok, total),
                }
            )
        rows.sort(key=lambda r: r["total"], reverse=True)
        return rows

    def _province_names(self, ids: list[int | None]) -> dict[int, str]:
        clean_ids = [i for i in ids if i is not None]
        if not clean_ids:
            return {}
        rows = self._db.query(Province).filter(Province.id.in_(clean_ids)).all()
        return {p.id: p.name for p in rows}

    # ---------- assembly ----------
    def build(self) -> dict:
        return {
            "kpis": self.compute_kpis(),
            "analysis": self.compute_analysis(),
            "provinces": self.compute_provinces(),
        }


def _pct(part: int, whole: int) -> float:
    return round(part / whole * 100, 1) if whole else 0.0
