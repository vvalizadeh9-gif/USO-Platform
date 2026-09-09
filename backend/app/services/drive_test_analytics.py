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
* PIP        : the approved current-version monthly plans for a Shamsi month.
* Assigned   : work items handed to a contractor during that month.
* Actual     : DT-done work dated into that month by the rule the dashboard
               has always used, which this module does not change.

Contractor attribution prefers the live in-app assignment over the
CPM-seeded drive-test subcontractor: a site reassigned inside the app after
the last CPM import must show under its *current* contractor, not a stale
Excel value — see ``_effective_contractor_id``.
Counts are of unique work items (Site + Site Type), never de-duplicated
across site types.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core import jalali
from app.core.deps import CONTRACTOR
from app.models.monthly_plan import STATUS_APPROVED, ContractorMonthlyPlan
from app.models.reference import Contractor, Province
from app.models.workitem import WorkItem
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

    @staticmethod
    def _dated_into(wi: WorkItem, year: int, month: int) -> bool:
        """Whether this work item's drive test falls in a given Shamsi month.

        This is the platform's one rule for dating a drive test into a month,
        and it is unchanged: the DT date column converted to Shamsi, compared
        on year and month, with an item that carries no DT date counting into
        no month at all. It was inlined in
        :meth:`_current_month_done_count`; it is a named method now only so
        that the plan-and-delivery figures ask the same question through the
        same code rather than through a second copy of it that could drift.
        """
        if not wi.dt_date_gregorian:
            return False
        y, m = jalali.to_shamsi(wi.dt_date_gregorian)
        return y == year and m == month

    def _current_month_done_count(self, done_items: list) -> int:
        """Count DT-done work items whose DT date falls in the current Shamsi month."""
        cur_year, cur_month = jalali.current_shamsi_period()
        return sum(1 for w in done_items if self._dated_into(w, cur_year, cur_month))

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

    # ---------- plan and delivery (PIP vs actual) ----------
    def _own_contractor_id(self) -> int | None:
        """The contractor this caller *is*, or None for a staff account.

        The one place this section asks "who is asking". Everything that could
        name a contractor goes through it, so the rule that a contractor sees
        only their own row has a single point of enforcement rather than one
        per figure.
        """
        role = getattr(self._user, "role", None)
        if getattr(role, "name", None) != CONTRACTOR:
            return None
        return getattr(self._user, "contractor_id", None)

    def _plan_scope_items(self) -> list[WorkItem]:
        """The work items this section counts, for this caller.

        Staff get their whole visible set. A contractor account gets it
        narrowed once more, to the items attributed to *them* by
        :meth:`_effective_contractor_id`.

        That second narrowing is load-bearing, not decoration.
        ``apply_work_item_scope`` deliberately hands a contractor every work
        item they have *ever* held, so a site reassigned away does not vanish
        from their history. On this section that would be wrong twice over: it
        would measure them on a drive test another company delivered, and it
        would put that company's name on a row of their own dashboard.
        """
        own = self._own_contractor_id()
        if own is None:
            return self._load()
        return [w for w in self._load() if self._effective_contractor_id(w) == own]

    def _approved_pip(self, year: int, month: int) -> dict[int, int]:
        """Each contractor's approved commitment for the month, by contractor id.

        ``is_current`` and ``Approved`` together are what "the approved
        current-version plan" means: a superseded version is not current, and
        a revision that has not been approved yet is not approved. So a
        contractor revising an approved plan contributes nothing until the new
        number is approved — and shows up in the uncommitted count rather than
        silently keeping last version's target.

        The contractor filter is applied here, in the query, rather than to
        the rows afterwards: a filter on the way out is one refactor away from
        being dropped, and what it would leak is every competitor's number.
        """
        stmt = select(
            ContractorMonthlyPlan.contractor_id,
            ContractorMonthlyPlan.committed_count,
        ).where(
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
            ContractorMonthlyPlan.is_current.is_(True),
            ContractorMonthlyPlan.status == STATUS_APPROVED,
        )
        own = self._own_contractor_id()
        if own is not None:
            stmt = stmt.where(ContractorMonthlyPlan.contractor_id == own)
        return {cid: (count or 0) for cid, count in self._db.execute(stmt).all()}

    def _plan_universe(self, year: int, month: int) -> dict[int, str]:
        """The contractors who are expected to have a plan for this month.

        Same rule as the PM's PIP queue (``monthly_plan.queue_rows``): every
        active contractor, plus any inactive one that filed for this month —
        deactivating a company must not make its commitment disappear. Kept as
        its own query rather than borrowed from the queue because the queue
        returns a plan and a previous-month figure per contractor, neither of
        which this needs, at one query each.
        """
        with_a_plan = select(ContractorMonthlyPlan.contractor_id).where(
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
        )
        stmt = select(Contractor.id, Contractor.name).where(
            Contractor.active.is_(True) | Contractor.id.in_(with_a_plan)
        )
        own = self._own_contractor_id()
        if own is not None:
            stmt = stmt.where(Contractor.id == own)
        return {cid: name for cid, name in self._db.execute(stmt).all()}

    def _programme_achievement(self, year: int, month: int) -> float | None:
        """Programme-wide achievement for the month, unscoped, as a percentage.

        Returned to contractor accounts only. It is the single thing a
        contractor is shown about anybody but themselves, and it is an
        aggregate over every company with no name attached — a contractor can
        see whether they are ahead of or behind the programme without seeing
        who anyone else is. Staff get the per-contractor rows themselves, from
        which any average is already visible, and a province-scoped staff
        account has no business being handed a national figure it is scoped
        away from — so for staff this is None.

        The one query outside the cached pass, and deliberately narrow: the
        done drive tests of a single month, not a second scan of everything.
        The dating rule is then applied in Python exactly as everywhere else;
        the date window is only how the rows are fetched.
        """
        pip = self._db.execute(
            select(func.coalesce(func.sum(ContractorMonthlyPlan.committed_count), 0))
            .where(
                ContractorMonthlyPlan.shamsi_year == year,
                ContractorMonthlyPlan.shamsi_month == month,
                ContractorMonthlyPlan.is_current.is_(True),
                ContractorMonthlyPlan.status == STATUS_APPROVED,
            )
        ).scalar_one()
        if not pip:
            return None

        start, end = _shamsi_month_bounds(year, month)
        rows = self._db.execute(
            select(WorkItem).where(
                WorkItem.deleted_at.is_(None),
                WorkItem.dt_status == "Done",
                WorkItem.dt_date_gregorian >= start,
                WorkItem.dt_date_gregorian < end,
            )
        ).scalars().all()
        actual = sum(
            1 for w in rows if self._is_onair(w) and self._dated_into(w, year, month)
        )
        return _percent(actual, pip)

    def plan_and_delivery(self, year: int, month: int) -> dict:
        """PIP, Assigned, Actual and Achievement for one Shamsi month.

        Computed inside the pass that already loaded this user's work items,
        rather than by scanning them a second time.

        * **PIP** — the approved current-version commitments for the month.
          Contractors without one contribute nothing and are counted, so a
          total that is short says how short and why rather than reading as a
          smaller programme.
        * **Assigned** — work items handed to a contractor during the month,
          counted once per (work item, contractor): a site assigned twice to
          the same company in one month is one piece of work.
        * **Actual** — DT-done work dated into the month by the platform's
          existing rule (:meth:`_dated_into`), untouched.
        * **Achievement** — Actual over PIP. None, never zero, when there is
          no PIP: a contractor who committed to nothing has not achieved 0% of
          it, and rendering a zero would read as failure where there is no
          measurement.
        """
        own = self._own_contractor_id()
        items = self._plan_scope_items()

        actual_total = 0
        actual_by_contractor: dict[int, int] = defaultdict(int)
        assigned_pairs: set[tuple[int, int]] = set()

        for w in items:
            if self._is_onair(w) and w.dt_status == "Done" and self._dated_into(w, year, month):
                actual_total += 1
                cid = self._effective_contractor_id(w)
                if cid is not None:
                    actual_by_contractor[cid] += 1
            for assignment in w.assignments:
                # A contractor's own dashboard counts what was assigned to
                # *them*. Their visible set still contains sites they have
                # since handed on, and those sites' later assignments belong
                # to somebody else's month.
                if own is not None and assignment.contractor_id != own:
                    continue
                if assignment.assigned_at is None:
                    continue
                y, m = jalali.to_shamsi(assignment.assigned_at.date())
                if y == year and m == month:
                    assigned_pairs.add((w.id, assignment.contractor_id))

        pip_by_contractor = self._approved_pip(year, month)
        universe = self._plan_universe(year, month)
        pip_total = sum(pip_by_contractor.values())

        # A row for every contractor who owes a plan for the month, plus any
        # that delivered or committed without being in that set — an inactive
        # company that still finished sites this month is delivery, and
        # dropping it would take the work off the dashboard with it.
        row_ids = set(universe) | set(pip_by_contractor) | set(actual_by_contractor)
        if own is not None:
            row_ids = {cid for cid in row_ids if cid == own}
        names = self._contractor_names(row_ids, universe)

        rows = [
            {
                "contractor_id": cid,
                "name": names.get(cid, "—"),
                "pip": pip_by_contractor.get(cid, 0),
                "actual": actual_by_contractor.get(cid, 0),
                "achievement_percent": _percent(
                    actual_by_contractor.get(cid, 0), pip_by_contractor.get(cid, 0)
                ),
            }
            for cid in row_ids
        ]
        # Worst last. A contractor with no PIP has no achievement to rank, so
        # those rows sit after the ranked ones rather than at either extreme
        # of a scale they are not on.
        rows.sort(
            key=lambda r: (
                r["achievement_percent"] is None,
                -(r["achievement_percent"] or 0),
                r["name"],
            )
        )

        # Membership, not truthiness: an approved plan of zero is a commitment
        # somebody made and a PM agreed to, and counting it as "not committed"
        # would report a contractor as missing when they are not.
        committed = sum(1 for cid in universe if cid in pip_by_contractor)
        return {
            "shamsi_year": year,
            "shamsi_month": month,
            "month_label": f"{jalali.month_name(month)} {year}",
            "pip": pip_total,
            "assigned": len(assigned_pairs),
            "actual": actual_total,
            "achievement_percent": _percent(actual_total, pip_total),
            "committed_contractors": committed,
            "uncommitted_contractors": len(universe) - committed,
            "programme_achievement_percent": (
                self._programme_achievement(year, month) if own is not None else None
            ),
            "rows": rows,
        }

    def _contractor_names(
        self, ids: set[int], known: dict[int, str]
    ) -> dict[int, str]:
        """Names for a set of contractor ids, querying only the ones missing."""
        names = {cid: known[cid] for cid in ids if cid in known}
        missing = [cid for cid in ids if cid not in names]
        if missing:
            for c in self._db.query(Contractor).filter(Contractor.id.in_(missing)).all():
                names[c.id] = c.name
        return names

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


def _percent(part: int, whole: int) -> float | None:
    """``part`` as a percentage of ``whole``, or None when there is no whole.

    None rather than 0.0 on purpose, and the callers pass it straight through:
    "no commitment to measure against" and "achieved none of the commitment"
    are different facts, and a dashboard that renders both as 0% tells the
    reader the wrong one.
    """
    if not whole:
        return None
    return round(part / whole * 100, 1)


def _shamsi_month_bounds(year: int, month: int) -> tuple[date, date]:
    """The Gregorian half-open range ``[start, end)`` covering a Shamsi month.

    Only a fetch window — the dating rule itself stays :meth:`
    DriveTestAnalytics._dated_into`, which is applied to whatever comes back.
    """
    start = jalali.from_shamsi_date(year, month, 1)
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    return start, jalali.from_shamsi_date(next_year, next_month, 1)
