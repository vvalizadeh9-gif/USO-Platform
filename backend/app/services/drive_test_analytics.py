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
from app.models.workitem import Site, WorkItem
from app.services import cpm_columns as C
from app.services.visibility import apply_work_item_scope
from app.services.workflow import (
    STAGE_ASSIGNED,
    STAGE_DT_SUBMITTED,
    STAGE_HC_IN_PROGRESS,
    STAGE_HC_REVIEW,
    STAGE_HEALTH_PROBLEM,
    STAGE_NEW,
    STAGE_READY,
    STAGE_RETURNED,
    latest_problem_category_name,
)

#: The stages an *ongoing* site can be sitting in, in workflow order.
#:
#: Ongoing excludes Problematic by definition, and a site whose drive test is
#: approved is DT-Done rather than ongoing, so neither of those stages appears
#: here. Every other stage a work item can hold does, which is what makes the
#: stage tab a partition rather than a selection: read in order it says how far
#: each ongoing site has got — never health-checked, out with a checker,
#: waiting on a reviewer's decision, ready but unassigned, with a contractor,
#: handed back, or waiting on approval.
ONGOING_STAGE_ORDER = (
    STAGE_NEW,
    STAGE_HC_IN_PROGRESS,
    STAGE_HC_REVIEW,
    STAGE_READY,
    STAGE_ASSIGNED,
    STAGE_RETURNED,
    STAGE_DT_SUBMITTED,
)

#: Catch-all bucket for an ongoing site whose stage is not in the list above.
#:
#: Nothing should land here, and it exists precisely because "should" is not a
#: guarantee: a stage added to the workflow without being added to the tuple
#: above, or a row written by an older build, would otherwise be dropped
#: silently and the buckets would quietly stop summing to the total. Better a
#: visible bucket nobody can explain than a total that is wrong by a number
#: nobody can see. It is emitted only when it is non-zero.
STAGE_OTHER = "Other"

#: The label a contractor account sees in place of every other company's name.
#: See :meth:`DriveTestAnalytics._label_ongoing_contractors`.
OTHER_CONTRACTORS = "Other contractors"

#: Stands in for a name that cannot be resolved — a work item whose site
#: carries no province, or a contractor row whose company has since been
#: deleted. An em dash rather than "Unknown" or "None" because it reads as an
#: absent value in both the Farsi and English column layouts on this page, and
#: matches what the existing province table already renders.
NO_LABEL = "\u2014"

#: The label the contractor scorecard gives on-air sites no company holds.
UNATTRIBUTED = "Unattributed"

#: Age bands for ongoing sites, as ``(upper bound in days, label)`` read in
#: order, with the final ``None`` bound catching everything above the last.
#:
#: The clock is the site's launch date \u2014 the day it went on air and a drive
#: test started being owed on it. That date is recorded, which is the whole
#: reason these bands can exist where the problematic ones cannot: nothing
#: records when a site *became* problematic, so bands off any other date would
#: be a different fact wearing the same label. See :meth:`breakdowns`.
#:
#: The bounds are a month, a quarter, half a year and a year. They are
#: deliberately unequal \u2014 the question changes as a site ages, from "is this
#: moving" to "has this been forgotten" \u2014 and equal buckets would put every
#: long-overdue site into one indistinguishable tail.
AGE_BANDS: tuple[tuple[int | None, str], ...] = (
    (30, "Under a month"),
    (90, "1\u20133 months"),
    (180, "3\u20136 months"),
    (365, "6\u201312 months"),
    (None, "Over a year"),
)


class DriveTestAnalytics:
    """Encapsulates all Drive Test dashboard computations for one user."""

    def __init__(self, db: Session, user, province_id: int | None = None) -> None:
        self._db = db
        self._user = user
        self._province_id = province_id
        self._work_items: list[WorkItem] | None = None

    # ---------- data loading ----------
    def _load(self) -> list[WorkItem]:
        """Load the user's visible work items once and cache them.

        Eager-loads ``site`` (needed by ``chart_progress_by_province``),
        ``assignments`` (needed for live contractor attribution), and the HC
        workflow relations (needed to detect in-app Problematic status and
        its category) — all in the same query, avoiding N+1 lazy loads.

        A ``province_id`` narrows the result *after* ``apply_work_item_scope``
        has run, and is applied as an additional ``WHERE`` on the same
        statement. Order is the whole point: the province filter can only ever
        remove rows the scope already allowed, so a caller cannot reach a
        province they were not granted by asking for it by id. The filter is a
        view control, never an access one.
        """
        if self._work_items is None:
            stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
            stmt = apply_work_item_scope(stmt, self._user, self._db)
            if self._province_id is not None:
                stmt = stmt.where(
                    WorkItem.site_id.in_(
                        select(Site.id).where(Site.province_id == self._province_id)
                    )
                )
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

    # ---------- monthly movement (see services/snapshots.py) ----------
    #
    # The KPIs above are balances: where the project stands. These are flows:
    # what moved during a given month. Both are asked of the same loaded set
    # through the same rules -- ``_dated_into`` decides which month a drive
    # test lands in here exactly as it does for ``current_month_dt_done``, so
    # the movement figures and the dashboard can never disagree about it.

    def month_dt_completed(self, year: int, month: int) -> int:
        """Drive tests completed in a Shamsi month, by the existing date rule."""
        return sum(
            1
            for w in self._onair_items()
            if w.dt_status == "Done" and self._dated_into(w, year, month)
        )

    def month_dt_completed_by_contractor(
        self, year: int, month: int
    ) -> dict[int | None, int]:
        """The same count, split by the contractor it is attributable to.

        Keyed by contractor id, with ``None`` for work no contractor can be
        attributed to. That key is kept rather than dropped -- unlike
        :meth:`chart_dt_done_by_contractor`, which drops it because an
        unassigned site is not a workload data point -- so that the values sum
        to :meth:`month_dt_completed`. A ledger whose parts do not add up to
        its total cannot be checked against anything.
        """
        counts: dict[int | None, int] = defaultdict(int)
        for w in self._onair_items():
            if w.dt_status == "Done" and self._dated_into(w, year, month):
                counts[self._effective_contractor_id(w)] += 1
        return dict(counts)

    def month_problematic_transitions(self, year: int, month: int) -> tuple[int, int]:
        """``(flagged, resolved)`` for a Shamsi month, from dated evidence.

        Counts the times a site crossed into or out of Problematic during the
        month, by replaying the dated events the platform records against it.
        A site flagged, fixed and flagged again inside one month counts twice
        on each side, which is the point: net movement is what hides that.

        Only transitions the platform *dates* are visible here. A site whose
        Problematic status arrives in a CPM workbook carries no transition
        date -- the import overwrites ``dt_status`` and there is nothing to
        say when the change happened -- so that movement is not counted here.
        The caller reconciles it against the balances; see
        :func:`app.services.snapshots.reconcile`.
        """
        flagged = 0
        resolved = 0
        for wi in self._onair_items():
            problematic = False
            for event_date, _, now_problematic in self._problem_events(wi):
                if now_problematic == problematic:
                    continue
                problematic = now_problematic
                if jalali.to_shamsi(event_date) == (year, month):
                    if now_problematic:
                        flagged += 1
                    else:
                        resolved += 1
        return flagged, resolved

    @staticmethod
    def _problem_events(wi: WorkItem) -> list[tuple[date, int, bool]]:
        """This site's dated Problematic-state changes, oldest first.

        Each entry is ``(date, tie-break, is_problematic_after)``. The
        tie-break orders events that share a date in the order the workflow
        would apply them: a legacy health check first, the HC workflow's
        verdict over it, and an approved drive test last, because approval is
        terminal.

        The three sources mirror :func:`app.services.workflow.derive_stage`
        exactly, so a replay ends in the state that function would report:

        * ``hc_tasks`` -- a Not-Ready result only reads as Problematic once a
          Coordinator or PM has validated it, so ``reviewed_at`` (not
          ``completed_at``) is when the state actually changed.
        * ``health_checks`` -- the superseded single-flag table, still
          replayed so pre-migration history is not silently dropped.
        * an approved drive test, which writes ``dt_status = 'Done'`` and ends
          any Problematic state. Dated by ``dt_date_gregorian``, the same
          column every other DT date in this module is read from.
        """
        events: list[tuple[date, int, bool]] = []
        for hc in wi.health_checks:
            if hc.checked_at is not None:
                events.append((hc.checked_at.date(), 0, hc.status == "Problematic"))
        for task in wi.hc_tasks:
            if task.completed_at is not None and task.reviewed_at is not None:
                events.append(
                    (task.reviewed_at.date(), 1, task.overall_result == "NotReady")
                )
        if wi.dt_status == "Done" and wi.dt_date_gregorian is not None:
            events.append((wi.dt_date_gregorian, 2, False))
        events.sort(key=lambda e: (e[0], e[1]))
        return events

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

    # ---------- breakdowns ----------
    def breakdowns(self) -> dict:
        """Ongoing, Problematic and per-province breakdowns, in one pass.

        Every figure here comes off the *same* iteration of the same cached
        work items the KPI cards are computed from — deliberately, and for two
        reasons. The cheap one is cost: three sections asking the same
        questions of the same rows is one loop, not three scans. The one that
        matters is that it makes the page reconcile by construction rather
        than by coincidence. The stage buckets sum to the ongoing card, the
        contractor rows plus the sites with no contractor sum to the same
        figure, the category rows sum to the problematic card, and the
        province rows sum to the programme totals, because all of them are
        incremented from one visit to one work item under the very predicates
        (:meth:`_is_problematic`, :meth:`_is_ongoing`) the cards use. A second
        pass with its own copy of those predicates is how two numbers for one
        fact get onto a dashboard.

        There is no problematic *aging* here, and there is ongoing aging. The
        difference is not an inconsistency, it is the whole rule: an ongoing
        site has a recorded launch date, so "how long has this live site gone
        untested" is a real measurement. Nothing records when a site *became*
        problematic — the CPM-imported signal is a bare status column and the
        in-app signal is a stage — so the same bands over there would be a
        different fact wearing the same label. They stay absent rather than
        approximated. See :data:`AGE_BANDS`.
        """
        stage_counts: dict[str, int] = defaultdict(int)
        ongoing_by_contractor: dict[int, int] = defaultdict(int)
        ongoing_without_contractor = 0
        ongoing_by_province: dict[int | None, int] = defaultdict(int)
        age_counts: dict[str, int] = defaultdict(int)
        ongoing_without_launch = 0
        problem_categories: dict[str, int] = defaultdict(int)
        problem_by_province: dict[int | None, int] = defaultdict(int)
        province_rows: dict[int | None, dict[str, int]] = defaultdict(
            lambda: {"onair": 0, "done": 0, "ongoing": 0, "problematic": 0}
        )
        contractor_rows: dict[int | None, dict[str, int]] = defaultdict(
            lambda: {"onair": 0, "done": 0, "ongoing": 0, "problematic": 0}
        )
        ongoing_total = 0
        problematic_total = 0
        today = date.today()

        for w in self._onair_items():
            province_id = w.site.province_id if w.site else None
            row = province_rows[province_id]
            row["onair"] += 1

            # The scorecard attributes every on-air site, done or not — that
            # denominator is the entire reason it can be compared across
            # companies of different sizes.
            book = contractor_rows[self._effective_contractor_id(w)]
            book["onair"] += 1

            if w.dt_status == "Done":
                row["done"] += 1
                book["done"] += 1

            if self._is_problematic(w):
                problematic_total += 1
                row["problematic"] += 1
                book["problematic"] += 1
                problem_categories[self._effective_problem_category(w)] += 1
                problem_by_province[province_id] += 1

            if self._is_ongoing(w):
                ongoing_total += 1
                row["ongoing"] += 1
                book["ongoing"] += 1
                ongoing_by_province[province_id] += 1
                stage = w.current_stage
                stage_counts[stage if stage in ONGOING_STAGE_ORDER else STAGE_OTHER] += 1
                contractor_id = self._effective_contractor_id(w)
                if contractor_id is None:
                    ongoing_without_contractor += 1
                else:
                    ongoing_by_contractor[contractor_id] += 1

                band = self._age_band(w.launch_date_gregorian, today)
                if band is None:
                    ongoing_without_launch += 1
                else:
                    age_counts[band] += 1

        names = self._province_names(list(province_rows))
        return {
            "ongoing": {
                "total": ongoing_total,
                "by_stage": self._stage_points(stage_counts),
                "by_contractor": self._label_ongoing_contractors(ongoing_by_contractor),
                "without_contractor": ongoing_without_contractor,
                "by_province": _province_points(ongoing_by_province, names),
                "by_age": self._age_points(age_counts),
                "without_launch_date": ongoing_without_launch,
            },
            "problematic": {
                "total": problematic_total,
                "by_category": [
                    {"name": k, "value": v} for k, v in _sorted_desc(problem_categories)
                ],
                "by_province": _province_points(problem_by_province, names),
            },
            "provinces": _province_table(province_rows, names),
            "contractors": self._contractor_scorecard(contractor_rows),
        }

    @staticmethod
    def _age_band(launch: date | None, today: date) -> str | None:
        """Which age band a site falls in, or ``None`` with no launch date.

        ``None`` rather than a "0 days" bucket: a missing launch date is an
        unknown age, not a young site, and quietly filing it under the newest
        band would make an untested backlog look fresher than it is.
        """
        if launch is None:
            return None
        days = (today - launch).days
        for bound, label in AGE_BANDS:
            if bound is None or days <= bound:
                return label
        return AGE_BANDS[-1][1]

    @staticmethod
    def _age_points(counts: dict[str, int]) -> list[dict]:
        """Age bands in age order, zeros included.

        Same reasoning as :meth:`_stage_points`: these are an ordered scale,
        not a ranking, and a band that vanishes when it empties would change
        what the row of bands means between one reading and the next. "Nothing
        has been waiting over a year" is an answer worth showing.
        """
        return [{"name": label, "value": counts.get(label, 0)} for _, label in AGE_BANDS]

    def _contractor_scorecard(
        self, books: dict[int | None, dict[str, int]]
    ) -> list[dict]:
        """Each contractor's book of on-air work, ranked by completion.

        Ranked by ``done_percent`` rather than by size, which is the point of
        carrying the denominator at all — see
        :class:`app.schemas.ContractorScorecardRow`.

        The unattributed row sorts last regardless of its rate. It is not a
        company and cannot be compared with one; leaving it in the ranking
        would put a bucket above or below real contractors as though it had
        outperformed them.

        A contractor account gets its own row and nothing else. The unnamed
        aggregate that the ongoing breakdown offers is not available here: a
        rate over other companies' books is a comparison against named
        competitors with the name removed, which is exactly what
        :meth:`_label_ongoing_contractors` is careful not to publish.
        """
        own = self._own_contractor_id()
        if own is not None:
            books = {cid: book for cid, book in books.items() if cid == own}

        ids = {cid for cid in books if cid is not None}
        names = self._contractor_names(ids, {})

        rows = [
            {
                "contractor_id": cid,
                "name": names.get(cid, NO_LABEL) if cid is not None else UNATTRIBUTED,
                "onair": book["onair"],
                "done": book["done"],
                "ongoing": book["ongoing"],
                "problematic": book["problematic"],
                "done_percent": (
                    round(book["done"] / book["onair"] * 100, 1) if book["onair"] else 0.0
                ),
            }
            for cid, book in books.items()
        ]
        rows.sort(key=lambda r: (r["contractor_id"] is None, -r["done_percent"]))
        return rows

    @staticmethod
    def _stage_points(counts: dict[str, int]) -> list[dict]:
        """Stage buckets in workflow order, zeros included.

        Sorting these by size, the way the contractor and province views are
        sorted, would destroy what the tab is for. The reader's question is
        "how far have the ongoing sites got", and the answer is only legible
        if the buckets stay in the order the work moves through them. A zero
        is kept for the same reason: "nothing is waiting on approval" is an
        answer, and a bucket that disappears when it empties makes the row of
        buckets mean something different every time it is read.
        """
        points = [
            {"name": stage, "value": counts.get(stage, 0)}
            for stage in ONGOING_STAGE_ORDER
        ]
        if counts.get(STAGE_OTHER):
            points.append({"name": STAGE_OTHER, "value": counts[STAGE_OTHER]})
        return points

    def _label_ongoing_contractors(self, counts: dict[int, int]) -> list[dict]:
        """Ongoing-per-contractor rows, with other companies hidden from a
        contractor account.

        Staff get named rows, the same as everywhere else on this dashboard.

        A contractor gets their own row and a single unnamed ``Other
        contractors`` row. That second row is not padding: ``apply_work_item_scope``
        hands a contractor every site they have *ever* held, so a site they
        have since handed on is still in this set and is now attributed to
        whoever holds it. Naming that company would put a competitor's
        workload on their dashboard; dropping the site would break the one
        property this section is built to have. Folding it into an unnamed
        aggregate keeps the arithmetic and gives away nothing — the same
        trade already made for ``programme_achievement_percent``.
        """
        own = self._own_contractor_id()
        if own is None:
            return self._label_contractors(counts)

        others = sum(value for cid, value in counts.items() if cid != own)
        rows = [
            {
                "name": self._contractor_names({own}, {}).get(own, NO_LABEL),
                "value": counts.get(own, 0),
            }
        ]
        if others:
            rows.append({"name": OTHER_CONTRACTORS, "value": others})
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

    # ---------- the PIP scorecard: many months, as a ledger ----------
    #
    # :meth:`plan_and_delivery` answers "how did this month go". This answers
    # "how have the last N months gone", and the difference is not only the
    # loop.
    #
    # A month's workload is not what was handed over during it. A contractor
    # given twenty sites in فروردین and none in خرداد is still carrying the
    # fifteen they have not finished, and a figure that reports خرداد as zero
    # assigned says the PM gave them nothing when the truth is that they were
    # already full. So the workload figure here is what they could actually
    # have worked on:
    #
    #     available = carried in + newly assigned
    #
    # The cost of that choice is that ``available`` and the two balances
    # either side of it cannot be added up: a site open for three months is in
    # all three of them, and a twelve-month total would count it three times.
    # Only the flows -- newly assigned, delivered, released -- sum. Both facts
    # are stated in the payload (``summable``) rather than left for the screen
    # to rediscover.
    #
    # What makes the figures checkable is the same property the drive-test
    # snapshot rests on (services/snapshots.py): the ledger closes.
    #
    #     carried_in + newly_assigned - delivered - released == carried_out
    #     carried_out(M) == carried_in(M+1)
    #
    # It closes by construction rather than by arithmetic -- ``carried_out``
    # is computed as "held at the end of the month", which is the same
    # question ``carried_in`` asks of the next one -- and the tests assert it
    # anyway, because a ledger nobody checks is a ledger that has already
    # stopped balancing.

    def _holdings(self, wi: WorkItem) -> list[tuple[int, date, date | None]]:
        """When each contractor held this work item, as ``(id, from, until)``.

        A contractor holds a site from the moment it is assigned to them until
        one of two things happens: the drive test is done, or the site is
        assigned to somebody else. Reassignment is what ends the first
        company's holding, which is why this is derived from the assignment
        list in order rather than from ``is_active`` -- the flag says which
        assignment is live *now*, and this section is asked about فروردین.

        ``until`` is None for a holding that has not ended. Dates, not
        datetimes: every boundary in this section is a Shamsi month, and the
        drive-test date the platform dates work by is itself a date.
        """
        ordered = sorted(
            (a for a in wi.assignments if a.assigned_at is not None),
            key=lambda a: a.assigned_at,
        )
        done_on = wi.dt_date_gregorian if wi.dt_status == "Done" else None

        spans: list[tuple[int, date, date | None]] = []
        for i, a in enumerate(ordered):
            start = a.assigned_at.date()
            # Whichever comes first: the next company taking it, or the drive
            # test being finished. A site finished before it was handed on is
            # not still in the first company's hands.
            end = ordered[i + 1].assigned_at.date() if i + 1 < len(ordered) else None
            if done_on is not None and (end is None or done_on < end):
                end = done_on if done_on >= start else start
            spans.append((a.contractor_id, start, end))
        return spans

    def scorecard(self, periods: list[tuple[int, int]]) -> dict:
        """PIP against delivery for several Shamsi months, per contractor.

        One pass over the work items for every month asked about, rather than
        one pass per month: the loop is over the (few) periods inside the
        (many) items, so adding a month costs a comparison and not a scan.

        A contractor account gets only its own figures -- ``_plan_scope_items``
        and ``_approved_pip`` are both already narrowed to them, and no row
        for another company is built at all, so there is nothing here to leak
        by forgetting to filter it afterwards.
        """
        own = self._own_contractor_id()
        items = self._plan_scope_items()
        bounds = [(_shamsi_month_bounds(y, m)) for y, m in periods]

        # (period index, contractor id) -> count, for each of the five figures.
        carried_in: dict[tuple[int, int], int] = defaultdict(int)
        carried_out: dict[tuple[int, int], int] = defaultdict(int)
        newly: dict[tuple[int, int], int] = defaultdict(int)
        delivered: dict[tuple[int, int], int] = defaultdict(int)
        released: dict[tuple[int, int], int] = defaultdict(int)

        for w in items:
            if not self._is_onair(w):
                continue
            spans = self._holdings(w)
            for cid, held_from, held_until in spans:
                # A contractor's own scorecard measures what was theirs. Their
                # visible set still holds sites they have since handed on, and
                # those sites' later holdings are another company's months.
                if own is not None and cid != own:
                    continue
                for i, (start, end) in enumerate(bounds):
                    if held_from < start and (held_until is None or held_until >= start):
                        carried_in[(i, cid)] += 1
                    if held_from < end and (held_until is None or held_until >= end):
                        carried_out[(i, cid)] += 1
                    if start <= held_from < end:
                        newly[(i, cid)] += 1
                    # Released: the holding ended inside the month for a
                    # reason other than the drive test being done -- the site
                    # went to another company. Counted so the ledger's
                    # outflows explain the fall in the balance.
                    if (
                        held_until is not None
                        and start <= held_until < end
                        and not self._dated_into(w, *periods[i])
                    ):
                        released[(i, cid)] += 1

            if w.dt_status == "Done":
                cid = self._effective_contractor_id(w)
                if cid is None or (own is not None and cid != own):
                    continue
                for i, (year, month) in enumerate(periods):
                    if self._dated_into(w, year, month):
                        delivered[(i, cid)] += 1

        return {
            "months": [
                self._scorecard_month(
                    i, year, month, carried_in, carried_out, newly, delivered, released
                )
                for i, (year, month) in enumerate(periods)
            ],
            # Spelled out rather than implied: the screen and the export both
            # need to know which columns may be totalled, and guessing wrong
            # produces a footer that counts the same site several times.
            "summable": ["newly_assigned", "delivered", "released", "pip"],
            "balances": ["carried_in", "available", "carried_out"],
            "is_contractor": own is not None,
        }

    def _scorecard_month(
        self, i, year, month, carried_in, carried_out, newly, delivered, released
    ) -> dict:
        """One month of the scorecard, with a row per contractor inside it."""
        pip = self._approved_pip(year, month)
        universe = self._plan_universe(year, month)

        # Every contractor the month touches: one that owes a plan, one that
        # committed, and one that merely carried or delivered work. A company
        # deactivated mid-year still did the drive tests it did.
        ids = set(universe) | set(pip)
        for book in (carried_in, carried_out, newly, delivered, released):
            ids |= {cid for (idx, cid) in book if idx == i}

        # Resolved once for the month, not once per row: the names not already
        # in ``universe`` belong to companies that carried or delivered work
        # without owing a plan, and there are never many of them.
        names = self._contractor_names(ids, universe)

        rows = []
        for cid in ids:
            available = carried_in[(i, cid)] + newly[(i, cid)]
            rows.append(
                {
                    "contractor_id": cid,
                    "name": names.get(cid),
                    # None, never 0: a contractor with no approved plan has not
                    # committed to nothing, they have not committed.
                    "pip": pip.get(cid),
                    "carried_in": carried_in[(i, cid)],
                    "newly_assigned": newly[(i, cid)],
                    "available": available,
                    "delivered": delivered[(i, cid)],
                    "released": released[(i, cid)],
                    "carried_out": carried_out[(i, cid)],
                    "achievement_percent": _percent(delivered[(i, cid)], pip.get(cid) or 0),
                    "execution_percent": _percent(delivered[(i, cid)], available),
                    "coverage_percent": _percent(available, pip.get(cid) or 0),
                }
            )
        rows.sort(key=lambda r: (r["name"] or ""))

        total_pip = sum(r["pip"] or 0 for r in rows)
        total_available = sum(r["available"] for r in rows)
        total_delivered = sum(r["delivered"] for r in rows)
        return {
            "shamsi_year": year,
            "shamsi_month": month,
            "shamsi_month_name": jalali.SHAMSI_MONTHS[month - 1],
            "pip": total_pip,
            "carried_in": sum(r["carried_in"] for r in rows),
            "newly_assigned": sum(r["newly_assigned"] for r in rows),
            "available": total_available,
            "delivered": total_delivered,
            "released": sum(r["released"] for r in rows),
            "carried_out": sum(r["carried_out"] for r in rows),
            "achievement_percent": _percent(total_delivered, total_pip),
            "coverage_percent": _percent(total_available, total_pip),
            "execution_percent": _percent(total_delivered, total_available),
            "committed_contractors": sum(1 for r in rows if r["pip"] is not None),
            "uncommitted_contractors": sum(
                1 for cid in universe if pip.get(cid) is None
            ),
            "rows": rows,
        }


# ---------- module-level helpers ----------
def _sorted_desc(counts: dict) -> list[tuple]:
    return sorted(counts.items(), key=lambda kv: kv[1], reverse=True)


def _province_points(
    counts: dict[int | None, int], names: dict[int, str]
) -> list[dict]:
    """Province counts as chart points, biggest first, zeros dropped.

    Zeros are dropped here and kept in :meth:`DriveTestAnalytics._stage_points`
    because the two lists answer different questions. Stage buckets are a
    fixed sequence whose empty members are informative; a province with no
    ongoing sites is simply not part of this answer, and thirty-one rows of
    which twenty are zero would bury the ones that are not.
    """
    rows = [
        {"name": names.get(province_id, NO_LABEL), "value": value}
        for province_id, value in counts.items()
        if value
    ]
    rows.sort(key=lambda r: (-r["value"], r["name"]))
    return rows


def _province_table(
    rows: dict[int | None, dict[str, int]], names: dict[int, str]
) -> list[dict]:
    """The per-province table, worst first.

    Sorted by *remaining* rather than by name or by done: the table exists to
    say where the outstanding drive tests are, and alphabetical order answers
    a question nobody asked while burying the answer to the one they did.
    Ties break on name so the order is stable between requests.
    """
    out = []
    for province_id, row in rows.items():
        onair, done = row["onair"], row["done"]
        out.append(
            {
                "name": names.get(province_id, NO_LABEL),
                "onair": onair,
                "done": done,
                "remaining": onair - done,
                "ongoing": row["ongoing"],
                "problematic": row["problematic"],
                "done_percent": round(done / onair * 100, 1) if onair else 0.0,
            }
        )
    out.sort(key=lambda r: (-r["remaining"], r["name"]))
    return out


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
