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
    """

    __slots__ = (
        "village_id",
        "site_id",
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
    ) -> None:
        self.village_id = village_id
        self.site_id = site_id
        self.province_id = province_id
        self.ict = ict
        self.cra = cra
        self.ict_status = ict_status
        self.cra_status = cra_status
        self.dt_age = dt_age
        self.bucket = flow.queue_bucket(ict_status, cra_status)


class AcceptanceAnalytics:
    """Encapsulates all Acceptance dashboard computations for one user."""

    def __init__(self, db: Session, user) -> None:
        self._db = db
        self._user = user
        self._units: list[_Unit] | None = None
        self._village_totals: dict[int | None, int] = {}

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
        # Every هدف village, drive-tested or not. Acceptance cannot start until
        # the drive test is done, so this is the larger number the DT-Done
        # universe is a share of — the funnel the province table now shows.
        village_totals: dict[int | None, int] = defaultdict(int)
        for wi in work_items:
            site_id = wi.site.id if wi.site else None
            province_id = wi.site.province_id if wi.site else None
            dt_done = wi.dt_status == _DT_DONE
            dt_age = flow.dt_age_days(wi) if dt_done else None
            for village in wi.villages:
                if village.deleted_at is not None:
                    continue
                if not C.is_pure_target(village.target_classification):
                    continue
                village_totals[province_id] += 1
                if not dt_done:
                    continue  # acceptance only applies once the drive test is done
                units.append(
                    _Unit(
                        village.id,
                        site_id,
                        province_id,
                        flow.authority_verdict(village, "ICT"),
                        flow.authority_verdict(village, "CRA"),
                        village.ict_status,
                        village.cra_status,
                        dt_age,
                    )
                )

        self._units = units
        self._village_totals = dict(village_totals)
        return units

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

    # ---------- assembly ----------
    def build(self) -> dict:
        return {
            "kpis": self.compute_kpis(),
            "analysis": self.compute_analysis(),
            "provinces": self.compute_provinces(),
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
    }


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
