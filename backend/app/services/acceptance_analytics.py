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
* ICT verdict    : Approved when *every requested technology* (from the work
  item's ``requested_technology``) is Approved, Rejected as soon as **any** of
  them is rejected, Pending otherwise. CRA is the mirror rule. The rule itself
  lives in ``acceptance_workflow.authority_verdict`` — this module reads it
  rather than re-deriving it, so the dashboard and My Work can never disagree
  about a village.
* On-air villages : the head of the funnel, and the one figure here that is
  *not* gated on the drive test — every هدف village whose work item is on air
  (``cpm_columns.is_onair_stage``, the same test the Drive Test dashboard's On
  air card applies). Everything else on the dashboard is a share of something
  narrower than it.
* Remaining : everything not fully accepted, partitioned into a standing
  refusal from either authority and a wait. Approved + rejected + remained is
  the DT-Done universe exactly — see ``_remaining_split``.
* Rejected vs Pending : "remained" is kept as the sum of the two, because a
  province that has been told no needs a different conversation than one still
  waiting for an answer, but the old combined number is still what several
  consumers read.
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
from app.services import acceptance_workflow as flow
from app.services import cpm_columns as C
from app.services.visibility import apply_work_item_scope

_DT_DONE = "Done"
APPROVED = flow.APPROVED
REJECTED = flow.REJECTED
PENDING = flow.PENDING


class _Unit:
    """One (site, village) row and its ICT/CRA verdict — never deduplicated.

    ``ict`` / ``cra`` hold a verdict word (Approved / Rejected / Pending), not a
    flag: splitting a refusal out from a wait is the whole point of the cards
    above this, and a boolean cannot carry it.

    ``ict_status`` / ``cra_status`` are the *queue* statuses cached on the
    village row — a wider vocabulary that also knows about returned rounds.
    They are what the aging column is measured over, because a village is only
    "waiting on the authority" when its status is Pending.

    ``dt_age`` is how long the village has been *eligible* for acceptance —
    days since its drive test — which is the clock the programme is judged on
    and the only one defined for a village nobody has ever filed.

    ``bucket`` is where My Work would file it, so the dashboard's headline and
    the queue's chips count the same four groups.

    ``site_code`` / ``village_name`` are carried for one reason only: the
    drill-through list behind every figure names the sites it counted, and it
    is built from this same universe rather than from a second query — which
    is what makes the list's length equal to the figure that opened it.
    """

    __slots__ = (
        "village_id",
        "village_name",
        "site_id",
        "site_code",
        "province_id",
        "ict",
        "cra",
        "ict_status",
        "cra_status",
        "dt_age",
        "bucket",
    )

    def __init__(
        self,
        village_id: int,
        site_id: int | None,
        province_id: int | None,
        ict: str,
        cra: str,
        ict_status: str | None,
        cra_status: str | None,
        dt_age: int | None,
        *,
        village_name: str | None = None,
        site_code: str | None = None,
    ) -> None:
        self.village_id = village_id
        self.village_name = village_name
        self.site_id = site_id
        self.site_code = site_code
        self.province_id = province_id
        self.ict = ict
        self.cra = cra
        self.ict_status = ict_status
        self.cra_status = cra_status
        self.dt_age = dt_age
        self.bucket = flow.queue_bucket(ict_status, cra_status)


class _Row:
    """One هدف village row in the *whole* universe, drive-tested or not.

    The KPI band's first card counts on-air villages, which is a wider
    population than the DT-Done one every other figure is computed over: a
    village whose site is live but whose drive test is not finished has no
    acceptance status at all, and so no ``_Unit``. Keeping both in one pass
    means the funnel — on air → DT done → approved → remaining — is read off
    a single load, and every step of it can open the sites behind it.
    """

    __slots__ = ("village_name", "site_id", "site_code", "province_id",
                 "onair", "unit")

    def __init__(
        self,
        village_name: str | None,
        site_id: int | None,
        site_code: str | None,
        province_id: int | None,
        onair: bool,
        unit: "_Unit | None",
    ) -> None:
        self.village_name = village_name
        self.site_id = site_id
        self.site_code = site_code
        self.province_id = province_id
        self.onair = onair
        self.unit = unit

    @property
    def dt_done(self) -> bool:
        return self.unit is not None


class AcceptanceAnalytics:
    """Encapsulates all Acceptance dashboard computations for one user.

    ``province_ids`` and ``contractor_id`` narrow the universe *on top of*
    the user's own row-level scope — they never widen it. ``province_ids``
    is the resolved result of a coordinator/regional-manager filter (see
    ``api/acceptance.py``): neither role has a village-level attribution of
    its own, so the caller turns "this coordinator" into "the provinces
    Admin assigned them" before it ever reaches here. ``contractor_id``
    filters directly on ``WorkItem.dt_sc_contractor_id``, the same
    attribution the Drive Test site list already filters on.
    """

    def __init__(
        self,
        db: Session,
        user,
        *,
        province_ids: set[int] | None = None,
        contractor_id: int | None = None,
    ) -> None:
        self._db = db
        self._user = user
        self._province_ids = province_ids
        self._contractor_id = contractor_id
        self._units: list[_Unit] | None = None
        self._rows: list[_Row] | None = None
        self._village_totals: dict[int | None, int] = {}

    # ---------- data loading ----------
    def _load_units(self) -> list[_Unit]:
        """The DT-Done village rows — what every acceptance figure counts.

        One entry per qualifying Village row — duplicates across site-types are
        intentionally kept (product decision): every site-id/village-id row is
        counted independently in every metric.
        """
        if self._units is None:
            self._units = [r.unit for r in self._load_rows() if r.unit is not None]
        return self._units

    def _load_rows(self) -> list[_Row]:
        """Build the whole هدف village universe once and cache it.

        Wider than :meth:`_load_units` by exactly the villages whose drive test
        is not finished: the on-air card counts those, everything else does
        not. One pass builds both, so the funnel's steps can never be loaded
        from two differently-scoped queries.
        """
        if self._rows is not None:
            return self._rows

        stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
        stmt = apply_work_item_scope(stmt, self._user, self._db)
        stmt = stmt.options(
            selectinload(WorkItem.site),
            selectinload(WorkItem.villages).selectinload(Village.acceptances),
        )
        work_items = self._db.execute(stmt).scalars().all()

        rows: list[_Row] = []
        # Every هدف village, drive-tested or not. Acceptance cannot start until
        # the drive test is done, so this is the larger number the DT-Done
        # universe is a share of — the funnel the province table now shows.
        village_totals: dict[int | None, int] = defaultdict(int)
        for wi in work_items:
            site_id = wi.site.id if wi.site else None
            site_code = wi.site.site_code if wi.site else None
            province_id = wi.site.province_id if wi.site else None
            if self._province_ids is not None and province_id not in self._province_ids:
                continue
            if (
                self._contractor_id is not None
                and wi.dt_sc_contractor_id != self._contractor_id
            ):
                continue
            dt_done = wi.dt_status == _DT_DONE
            dt_age = flow.dt_age_days(wi) if dt_done else None
            # The same "live site" test the Drive Test dashboard's On air card
            # applies (``cpm_columns.is_onair_stage`` on the last completed
            # stage), so the two pages cannot disagree about which sites are
            # on air — they differ only in what they count on them, villages
            # here and sites there.
            onair = C.is_onair_stage(wi.last_stage)
            for village in wi.villages:
                if village.deleted_at is not None:
                    continue
                if not C.is_pure_target(village.target_classification):
                    continue
                village_totals[province_id] += 1
                unit = None
                if dt_done:  # acceptance only applies once the drive test is done
                    unit = _Unit(
                        village.id,
                        site_id,
                        province_id,
                        flow.authority_verdict(village, "ICT"),
                        flow.authority_verdict(village, "CRA"),
                        village.ict_status,
                        village.cra_status,
                        dt_age,
                        village_name=village.village_name,
                        site_code=site_code,
                    )
                rows.append(
                    _Row(
                        village.village_name,
                        site_id,
                        site_code,
                        province_id,
                        onair,
                        unit,
                    )
                )

        self._rows = rows
        self._village_totals = dict(village_totals)
        return rows

    # ---------- KPI cards ----------
    def compute_kpis(self) -> dict:
        """The headline counts, per authority, split three ways.

        ``*_remained`` stays exactly what it always was — rejected plus pending
        — because other consumers read it. The two new numbers split it, they
        do not replace it.
        """
        units = self._load_units()
        total = len(units)
        ict = _verdict_counts(v.ict for v in units)
        cra = _verdict_counts(v.cra for v in units)
        return {
            # The head of the funnel: every هدف village on a live site,
            # whether or not its drive test is finished. It is the only figure
            # in the band that is not a share of the DT-Done universe, and it
            # is what makes the rest legible — a programme with 1,000 villages
            # approved out of 1,200 drive-tested reads very differently when
            # 4,000 are on air.
            "total_onair_villages": sum(1 for r in self._load_rows() if r.onair),
            "total_dt_done_villages": total,
            "total_ict_approval": ict[APPROVED],
            "total_ict_remained": total - ict[APPROVED],
            "total_ict_rejected": ict[REJECTED],
            "total_ict_pending": ict[PENDING],
            "total_cra_approval": cra[APPROVED],
            "total_cra_remained": total - cra[APPROVED],
            "total_cra_rejected": cra[REJECTED],
            "total_cra_pending": cra[PENDING],
        }

    # ---------- analysis area ----------
    def compute_analysis(self) -> dict:
        units = self._load_units()

        # Village-level cross tabs (every row counts).
        villages_ict_not_cra = sum(
            1 for v in units if v.ict == APPROVED and v.cra != APPROVED
        )
        villages_cra_not_ict = sum(
            1 for v in units if v.cra == APPROVED and v.ict != APPROVED
        )
        # The number a programme manager is actually asked for: villages that
        # are finished with both authorities and need nothing further.
        villages_both_approved = sum(
            1 for v in units if v.ict == APPROVED and v.cra == APPROVED
        )

        # Site-level rollup: a site is fully approved when every one of its
        # qualifying village rows is approved.
        sites: dict[int | None, dict[str, bool]] = defaultdict(
            lambda: {"ict": True, "cra": True, "has": False}
        )
        for v in units:
            s = sites[v.site_id]
            s["has"] = True
            s["ict"] = s["ict"] and v.ict == APPROVED
            s["cra"] = s["cra"] and v.cra == APPROVED

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
            "villages_both_approved": villages_both_approved,
            **_village_partition(units),
        }

    # ---------- province status ----------
    def compute_provinces(self) -> list[dict]:
        """Per-province status, worst first, with each authority's backlog aged.

        The sort is deliberate: the table is read to decide which province
        office to call this week, and ordering by size answered a different
        question — it put the biggest province on top whether or not anything
        was outstanding there.

        Aging is measured from the drive test, over every *outstanding*
        village, so each authority's age bars sum to its outstanding count and
        the two can be read together. Measuring it from the last letter
        instead — the queue's clock — left a village nobody had ever filed
        with no age at all, rendered as a dash, which read as "nothing pending
        here" on the one row that most needed chasing.

        Outstanding is aged twice more, split into its two disjoint halves —
        refused, and nobody has answered. They are different conversations:
        a refusal is the programme's to resolve, a wait is the office's to
        finish. The two split bucket maps sum to the combined one, which is
        kept because "Needs attention" ranks on it. Rejected is NOT aged
        against remained as a second bar: it is a subset of it, and two bars
        where one contains the other cannot be read as a whole.

        ``total_villages`` is every هدف village in the province, drive-tested
        or not, so the row shows the funnel rather than only its tail. No
        province appears on the strength of it alone: a province with villages
        but nothing drive-tested has no acceptance status to report, and a row
        of zeroes and dashes would only push the provinces with work down the
        table.
        """
        units = self._load_units()
        totals: dict[int | None, dict[str, int]] = defaultdict(
            lambda: {"total": 0, "ict": 0, "cra": 0, "ict_rej": 0, "cra_rej": 0}
        )
        # Keyed by (province, authority, group) where group is "rejected" or
        # "pending" — the two halves of outstanding.
        ages: dict[tuple, dict[str, int]] = defaultdict(
            lambda: dict.fromkeys(flow.AGE_BUCKETS, 0)
        )
        oldest: dict[tuple, int | None] = {}
        # Villages still sitting with each authority — the queue's own clock,
        # kept beside the new one because it is what a person quotes to the
        # office they are telephoning.
        waiting: dict[int | None, dict[str, list[int]]] = defaultdict(
            lambda: {"ict": [], "cra": []}
        )

        for v in units:
            bucket = totals[v.province_id]
            bucket["total"] += 1
            for authority, verdict, status in (
                ("ict", v.ict, v.ict_status),
                ("cra", v.cra, v.cra_status),
            ):
                if verdict == APPROVED:
                    bucket[authority] += 1
                    continue
                # Outstanding with this authority: age it, under the half of
                # outstanding it belongs to.
                group = "rejected" if verdict == REJECTED else "pending"
                if group == "rejected":
                    bucket[f"{authority}_rej"] += 1
                key = (v.province_id, authority, group)
                ages[key][flow.dt_age_bucket(v.dt_age)] += 1
                if v.dt_age is not None:
                    current = oldest.get(key)
                    oldest[key] = v.dt_age if current is None else max(current, v.dt_age)
                if status == flow.STATUS_PENDING:
                    waiting[v.province_id][authority].append(v.village_id)

        waits = self._oldest_waiting_days(waiting)
        names = self._province_names(list(totals.keys()))
        rows = []
        for province_id, b in totals.items():
            total = b["total"]
            row = {
                "province_id": province_id,
                "name": names.get(province_id, "—"),
                "total": total,
                "total_villages": self._village_totals.get(province_id, total),
            }
            for authority in ("ict", "cra"):
                ok = b[authority]
                rejected = b[f"{authority}_rej"]
                by_group = {
                    group: ages.get(
                        (province_id, authority, group),
                        dict.fromkeys(flow.AGE_BUCKETS, 0),
                    )
                    for group in ("rejected", "pending")
                }
                row.update({
                    f"{authority}_approved": ok,
                    f"{authority}_rejected": rejected,
                    f"{authority}_pending": total - ok - rejected,
                    f"{authority}_remained": total - ok,
                    f"{authority}_approved_pct": _pct(ok, total),
                    f"{authority}_remained_pct": _pct(total - ok, total),
                    # The programme clock, and the distribution behind it —
                    # over all of outstanding, and over each half of it.
                    f"{authority}_oldest_age_days": _older(
                        oldest.get((province_id, authority, "rejected")),
                        oldest.get((province_id, authority, "pending")),
                    ),
                    f"{authority}_age_buckets": _merge_buckets(by_group.values()),
                    f"{authority}_rejected_oldest_age_days": oldest.get(
                        (province_id, authority, "rejected")
                    ),
                    f"{authority}_rejected_age_buckets": dict(by_group["rejected"]),
                    f"{authority}_pending_oldest_age_days": oldest.get(
                        (province_id, authority, "pending")
                    ),
                    f"{authority}_pending_age_buckets": dict(by_group["pending"]),
                    # The authority clock, unchanged — still the oldest wait
                    # among villages actually sitting with that office.
                    f"{authority}_oldest_days": waits.get((province_id, authority)),
                })
            rows.append(row)

        rows.sort(
            key=lambda r: (r["ict_remained"] + r["cra_remained"], r["total"]),
            reverse=True,
        )
        return rows

    def _oldest_waiting_days(self, waiting: dict) -> dict[tuple, int | None]:
        """The oldest wait per (province, authority), in one round trip.

        Reuses ``acceptance_workflow``'s aging — the same days My Work prints
        on a village row — rather than measuring time a second way here.
        """
        every_id = {
            village_id
            for by_authority in waiting.values()
            for ids in by_authority.values()
            for village_id in ids
        }
        if not every_id:
            return {}
        activity = flow.last_activity(self._db, every_id)

        out: dict[tuple, int | None] = {}
        for province_id, by_authority in waiting.items():
            for authority, ids in by_authority.items():
                days = [
                    d
                    for d in (flow.days_since(activity.get(i)) for i in ids)
                    if d is not None
                ]
                out[(province_id, authority)] = max(days) if days else None
        return out

    def _province_names(self, ids: list[int | None]) -> dict[int, str]:
        clean_ids = [i for i in ids if i is not None]
        if not clean_ids:
            return {}
        rows = self._db.query(Province).filter(Province.id.in_(clean_ids)).all()
        return {p.id: p.name for p in rows}

    # ---------- the sites behind one figure ----------
    def site_rows(self, metric: str) -> dict:
        """The sites behind one KPI figure, and the villages it counted on each.

        Every quantity on the dashboard opens this. It is computed from the
        same universe the figure itself was — :meth:`_load_rows` — rather than
        from a second query written to match, which is the only way the two can
        be guaranteed to agree. ``total`` is therefore the figure that was
        clicked, exactly, and the rows below it are the sites those villages
        sit on.

        Sites, not villages, because a site id is what a person acts on: it is
        what they look up, what they put in a mail to a contractor and what the
        drive test and health check screens are keyed by. The village count
        rides on the row so the list still adds up to the figure.
        """
        if metric not in SITE_METRICS:
            raise ValueError(f"metric must be one of: {', '.join(SITE_METRICS)}")
        selected = [r for r in self._load_rows() if _METRIC_PREDICATE[metric](r)]

        by_site: dict[tuple, dict] = {}
        for row in selected:
            key = (row.site_id, row.site_code)
            entry = by_site.get(key)
            if entry is None:
                entry = by_site[key] = {
                    "site_id": row.site_id,
                    "site_code": row.site_code,
                    "province_id": row.province_id,
                    "villages": 0,
                    "village_names": [],
                    "dt_done": 0,
                    "approved": 0,
                    "rejected": 0,
                    "pending": 0,
                }
            entry["villages"] += 1
            if row.village_name:
                entry["village_names"].append(row.village_name)
            unit = row.unit
            if unit is None:
                continue
            entry["dt_done"] += 1
            if unit.bucket == flow.BUCKET_CLOSED:
                entry["approved"] += 1
            elif REJECTED in (unit.ict, unit.cra):
                entry["rejected"] += 1
            else:
                entry["pending"] += 1

        names = self._province_names([e["province_id"] for e in by_site.values()])
        rows = []
        for entry in by_site.values():
            entry["province"] = names.get(entry["province_id"], "—")
            rows.append(entry)
        # By site code, which is the order a reader scans a list of ids in. A
        # site with no code sorts last rather than first, where it would be
        # the first thing read and the least useful.
        rows.sort(key=lambda r: (r["site_code"] is None, r["site_code"] or "", r["site_id"] or 0))
        return {
            "metric": metric,
            "label": METRIC_LABEL[metric],
            "total": len(selected),
            "site_count": len(rows),
            "rows": rows,
        }

    # ---------- assembly ----------
    def build(self) -> dict:
        return {
            "kpis": self.compute_kpis(),
            "analysis": self.compute_analysis(),
            "provinces": self.compute_provinces(),
        }


#: The KPI band's figures, as the drill-through list names them.
#:
#: One key per quantity on the page, because every quantity opens its own
#: list. They are not independent filters that could be combined: each is a
#: figure the band already shows, and naming them one-for-one is what keeps
#: the panel's count equal to the number that was clicked.
SITE_METRICS = ("onair", "dt_done", "approved", "remaining", "rejected", "remained")

#: What the panel calls each figure, in the words the card used.
METRIC_LABEL = {
    "onair": "on-air villages",
    "dt_done": "drive-test done villages",
    "approved": "approved villages",
    "remaining": "remaining villages",
    "rejected": "rejected villages",
    "remained": "villages still waiting",
}


def _is_remaining(row) -> bool:
    return row.dt_done and row.unit.bucket != flow.BUCKET_CLOSED


#: Which village rows each figure counted. Written once, here, and read by
#: both the figure and the list it opens.
_METRIC_PREDICATE = {
    "onair": lambda r: r.onair,
    "dt_done": lambda r: r.dt_done,
    "approved": lambda r: r.dt_done and r.unit.bucket == flow.BUCKET_CLOSED,
    "remaining": _is_remaining,
    "rejected": lambda r: _is_remaining(r) and REJECTED in (r.unit.ict, r.unit.cra),
    "remained": lambda r: _is_remaining(r) and REJECTED not in (r.unit.ict, r.unit.cra),
}


def _village_partition(units) -> dict[str, int]:
    """The four states a village can be in, counted so they sum to the whole.

    The card this feeds used to read "fully accepted N · still open M", and
    "still open" was a residual rather than a state: it merged villages an
    authority has refused, villages sitting with an authority, and villages
    nobody has ever filed. Those need three different responses from the
    programme, and nothing else on the dashboard could separate them — the two
    authority pending counts overlap (a village waiting on both is in both),
    so they cannot be added back into a village figure.

    The groups are ``queue_bucket``'s, not ``village_verdict``'s, for two
    reasons. They are exactly what My Work filters by, so every number here
    can link to the list it counted. And they distinguish a rejection nobody
    has answered from one already re-filed, which a verdict cannot: both are
    Rejected as a verdict, but only the first is work.
    """
    counts = dict.fromkeys(flow.QUEUE_BUCKETS, 0)
    for unit in units:
        counts[unit.bucket] += 1
    return {
        "villages_accepted": counts[flow.BUCKET_CLOSED],
        "villages_needs_attention": counts[flow.BUCKET_NEEDS_ATTENTION],
        "villages_in_review": counts[flow.BUCKET_AWAITING_REVIEW],
        "villages_not_filed": counts[flow.BUCKET_READY],
        **_remaining_split(units),
    }


def _remaining_split(units) -> dict[str, int]:
    """What is left, in the two halves the KPI band now shows: refused, waiting.

    "Remaining" is everything not fully accepted, and a reader given one
    number cannot tell the two situations in it apart. A refusal is the
    programme's to answer — somebody has to change something and re-file. A
    wait is the office's to finish, and chasing it is a phone call. They need
    different people on different days, so the card names both.

    Rejected is the *verdict*, not the queue status: one requested technology
    refused refuses the village (``authority_verdict``), by either authority.
    That is the same rule the ICT and CRA rejected figures already count by,
    and it is what the drill-through list filters on, so the two agree. A
    village already re-filed after a refusal still reads Rejected here,
    because the refusal is still the thing standing between it and approval.

    The two sum to remaining exactly — they are a partition of "not accepted",
    taken against the same ``villages_accepted`` the Approved card shows, so
    approved + rejected + remained is the DT-Done total with nothing left
    over and nothing counted twice.
    """
    rejected = 0
    remained = 0
    for unit in units:
        if unit.bucket == flow.BUCKET_CLOSED:
            continue
        if REJECTED in (unit.ict, unit.cra):
            rejected += 1
        else:
            remained += 1
    return {"villages_rejected": rejected, "villages_remained": remained}


def _verdict_counts(verdicts) -> dict[str, int]:
    """Tally a stream of verdict words into the three buckets."""
    counts = {APPROVED: 0, REJECTED: 0, PENDING: 0}
    for verdict in verdicts:
        counts[verdict] = counts.get(verdict, 0) + 1
    return counts


def _pct(part: int, whole: int) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


def _older(*ages: int | None) -> int | None:
    """The oldest of several ages, ignoring the ones nothing reported."""
    known = [a for a in ages if a is not None]
    return max(known) if known else None


def _merge_buckets(maps) -> dict[str, int]:
    """One bucket map from several, band by band."""
    merged = dict.fromkeys(flow.AGE_BUCKETS, 0)
    for one in maps:
        for band, n in one.items():
            merged[band] += n
    return merged
