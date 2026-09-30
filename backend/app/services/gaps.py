"""Lifecycle Gaps: where villages are stuck between drive test and the
authorities' approvals, and whose villages they are.

Two views, one module:

* **The overview** (:func:`overview`, ``GET /gaps/overview``) -- the Gaps tab.
  Six figures: pending ICT / CRA and one approved with the other remained,
  over the eligible (هدف, drive-test-done, on-air) villages; and approved
  villages missing from Mojri's tracker, over every approved هدف village
  (on air or not). ICT and CRA are parallel jobs.
* **The coverage map** (:func:`coverage_map`, ``GET /gaps/map``) -- ICT
  approval by province and CRA approval by CRA region.

Five lenses regroup the same villages: regional manager, PSO coordinator,
contractor, CRA region, province.

The one property that makes this page worth reading
---------------------------------------------------

**Every lens is a true partition of the same rows, so every lens sums back to
the same total.** A design preview of this page once showed a country figure
of 2,570 beside an owner list adding up to 445, because two of the five lenses
were built from a different query than the rest. Agreement between two
independently-run aggregates is not something a test can protect for long, so
it is not relied on here.

Instead each view has **one query** -- a single GROUP BY over villages, grouped
by (province, DT SC contractor) -- and every number is a fold of those same
cells:

* an owner list is :func:`_fold` with a key function that names the owner;
* the total is :func:`_fold` with a key function that answers "country" for
  every cell.

Two different groupings of one result set cannot disagree about their total.
The tests assert it for every lens anyway, because the structure is the
argument and the test is the evidence.

Villages nobody owns are named, never dropped
---------------------------------------------

The programme would like every village to have exactly one province, one CRA
region, one regional manager, one coordinator and one contractor. The schema
does not guarantee any of it: ``sites.province_id`` is nullable (a CPM
``استان`` cell matching none of the 31), ``work_items.dt_sc_contractor_id`` is
nullable, and ``province_mapping`` may simply have no current row for a
province. Dropping those villages would break the property above -- the owner
rows would quietly fail to add up -- so each case becomes a named row carrying
an ``attribution`` the page can flag:

    ``owned``            a real owner
    ``unknown_province`` the site's province cell matched none of the 31
    ``unmapped``         the province has no current province_mapping row
    ``unassigned``       the work item carries no DT SC contractor

This follows the "Unknown province" row the KPI page already shows, for the
same reason.

Who sees what
-------------

Access and scope are **not decided here**. ``services/kpi.py`` already answers
"may this account see delivery numbers, and whose?" -- :func:`kpi.resolve_scope`
forces a non-PM onto their own lens and their own key and answers 403 for
anybody else's, and :func:`kpi.require_kpi_access` keeps Admin out entirely.
This module calls both. PM is the only role that may switch lens, and the only
role that sees more than one owner row.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, fields

from fastapi import HTTPException
from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.province_directory import UNKNOWN_PROVINCE_LABEL
from app.models.acceptance import Acceptance
from app.models.kpi import ProvinceMapping
from app.models.mojri import (
    IN_TRACKER,
    NEEDS_LOOK,
    NOT_IN_TRACKER,
    MojriImportRun,
    MojriTrackerStatus,
)
from app.models.reference import Contractor, Province
from app.models.workitem import Site, Village, WorkItem
from app.services import kpi, mojri_tracker

# ----- Lenses -------------------------------------------------------------
#
# The four KPI lenses plus province. Province is not a KPI lens because the KPI
# page is one owner against the country and a province is not an owner; here
# every lens is a partition of the country, and province is the partition the
# other four are built from.

LENS_PROVINCE = "province"
LENSES = (*kpi.LENSES, LENS_PROVINCE)

LENS_LABELS = {
    kpi.LENS_RM: "Regional Manager",
    kpi.LENS_COORDINATOR: "PSO Coordinator",
    kpi.LENS_CONTRACTOR: "Contractor",
    kpi.LENS_REGION: "CRA Region",
    LENS_PROVINCE: "Province",
}

# ----- Attribution --------------------------------------------------------

OWNED = "owned"
UNKNOWN_PROVINCE = "unknown_province"
UNMAPPED = "unmapped"
UNASSIGNED = "unassigned"

UNMAPPED_LABEL = "Unmapped province"
#: The KPI contractor table already calls a missing DT SC this.
UNASSIGNED_LABEL = "Unassigned"

_COUNTRY = "__country__"

# ----- The coverage map's counters ----------------------------------------
#
# The map counts over every هدف village (no on-air rule) and reads each
# authority on its own stretch: ICT is "drive test done, not ICT approved"
# over "drive test done"; CRA is "ICT approved, not CRA approved" over "ICT
# approved". This is the counting the map has always had, kept unchanged when
# the Gaps tab moved to the overview.

STRETCH_ICT = "ict"
STRETCH_CRA = "cra"


@dataclass(frozen=True)
class Stretch:
    """One authority's figures on the map: which two :class:`Cell` counters
    are its stopped and reached."""

    key: str
    reached: str
    stopped: str


_BY_KEY = {
    STRETCH_ICT: Stretch(STRETCH_ICT, reached="ict_reached", stopped="ict_stopped"),
    STRETCH_CRA: Stretch(STRETCH_CRA, reached="cra_reached", stopped="cra_stopped"),
}


@dataclass
class Cell:
    """The map's counters for one (province, contractor) cell of the grid.

    Every figure the map returns is a sum of these, which is what makes a
    region agree with its provinces and the rows agree with the total.
    """

    villages: int = 0
    #: Reached drive-test-done, whatever happened next.
    ict_reached: int = 0
    #: Drive-test-done and not ICT-approved.
    ict_stopped: int = 0
    #: ICT-approved, whatever happened next.
    cra_reached: int = 0
    #: ICT-approved and not CRA-approved.
    cra_stopped: int = 0

    def add(self, other: Cell) -> None:
        for f in fields(self):
            setattr(self, f.name, getattr(self, f.name) + getattr(other, f.name))


def _grid(db: Session) -> dict[tuple[str | None, str | None], Cell]:
    """Every counter on the map, in one GROUP BY.

    Grouped by the finest grain any lens needs -- province and DT SC contractor
    -- so that each lens is a fold of these cells rather than a query of its
    own. A country with 31 provinces and a few dozen contractors makes a few
    hundred cells at most.

    Deliberately unscoped: a scoped viewer's figures are a fold of a subset of
    these very cells.
    """
    done = kpi.dt_done_values(db)
    targets = kpi.target_values(db)
    approved = kpi.APPROVED

    dt_done = WorkItem.dt_status.in_(done or [""])
    ict_approved = Village.ict_status == approved

    stmt: Select = (
        select(
            Province.name,
            Contractor.name,
            func.count(Village.id),
            kpi.count_if(dt_done),
            kpi.count_if(and_(dt_done, Village.ict_status != approved)),
            kpi.count_if(ict_approved),
            kpi.count_if(and_(ict_approved, Village.cra_status != approved)),
        )
        .select_from(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .outerjoin(Contractor, WorkItem.dt_sc_contractor_id == Contractor.id)
        .where(
            Village.deleted_at.is_(None),
            WorkItem.deleted_at.is_(None),
            # The same هدف rule as every other report: only pure target
            # villages are part of the obligation.
            Village.target_classification.in_(targets or [""]),
        )
        .group_by(Province.name, Contractor.name)
    )

    grid: dict[tuple[str | None, str | None], Cell] = {}
    for province, contractor, *counts in db.execute(stmt):
        grid[(province, contractor)] = Cell(*(value or 0 for value in counts))
    return grid


def _mapping(db: Session) -> dict[str, dict[str, str]]:
    """Who currently owns each province, by lens.

    The current row only (``effective_to IS NULL``). ``province_mapping`` is
    effective-dated so that a figure computed for a past month stays with
    whoever held the province then -- but this page has no month dimension at
    all: every counter on it is current standing, so the current owner is the
    only correct answer. When "vs last month" is built (it needs a snapshot job
    that does not exist), that is the change that will need the history, and it
    is where reading ``effective_from``/``effective_to`` belongs.

    A province with no current row is not given to anybody: its villages become
    an ``unmapped`` row rather than disappearing.
    """
    rows = db.execute(
        select(
            ProvinceMapping.province_fa,
            ProvinceMapping.cra_region,
            ProvinceMapping.pso_coordinator,
            ProvinceMapping.regional_manager,
        ).where(ProvinceMapping.effective_to.is_(None))
    ).all()
    return {
        province_fa: {
            kpi.LENS_REGION: region,
            kpi.LENS_COORDINATOR: coordinator,
            kpi.LENS_RM: manager,
        }
        for province_fa, region, coordinator, manager in rows
    }


def _owner(
    lens: str,
    province_fa: str | None,
    contractor: str | None,
    mapping: dict[str, dict[str, str]],
) -> tuple[str, str]:
    """The (name, attribution) one cell rolls up to under one lens.

    Total by construction: every cell gets exactly one owner for every lens, so
    no cell can be counted twice or dropped.
    """
    if lens == kpi.LENS_CONTRACTOR:
        if contractor is None:
            return UNASSIGNED_LABEL, UNASSIGNED
        return contractor, OWNED
    if province_fa is None:
        return UNKNOWN_PROVINCE_LABEL, UNKNOWN_PROVINCE
    if lens == LENS_PROVINCE:
        return kpi.province_label(province_fa), OWNED
    owners = mapping.get(province_fa)
    if owners is None:
        return UNMAPPED_LABEL, UNMAPPED
    return owners[lens], OWNED


def _owned_by(lens: str, key: str, mapping: dict[str, dict[str, str]]):
    """A predicate on a (province, contractor) cell: does it roll up to
    ``key`` under ``lens``? Case-insensitive, like the KPI scope.

    The one way this module narrows cells to an owner -- a non-PM's scope, the
    drawer's row and the export's filter all use it -- so a scoped figure and
    its spreadsheet cannot disagree about whose villages they are.
    """
    wanted = key.casefold()

    def test(province_fa: str | None, contractor: str | None) -> bool:
        return _owner(lens, province_fa, contractor, mapping)[0].casefold() == wanted

    return test


def _fold(grid, key_of, empty=Cell) -> dict:
    """Regroup the grid under one key function.

    The owner list and the total both come from here, over the same cells.
    That is the whole structural guarantee: one query, grouped different ways,
    never two independent counts that are supposed to agree.

    ``empty`` is the counter class of the grid being folded: :class:`Cell` for
    the map, :class:`GapCell` for the overview.
    """
    out: dict = {}
    for (province_fa, contractor), cell in grid.items():
        key = key_of(province_fa, contractor)
        out.setdefault(key, empty()).add(cell)
    return out


def _scored(cell: Cell, stretch: Stretch) -> dict:
    """One authority's figures for one map row, plus the low-sample flag.

    ``rate`` is the stop rate -- stopped over reached -- as a percentage, and
    the two counts it came from travel beside it so the page never has to show
    a rate without the fraction behind it. The low-sample threshold is the KPI
    page's, not a second one.
    """
    stopped = getattr(cell, stretch.stopped)
    reached = getattr(cell, stretch.reached)
    return {
        "stopped": stopped,
        "reached": reached,
        "rate": kpi.pct(stopped, reached),
        "low_sample": reached < kpi.LOW_SAMPLE_DT_DONE,
    }


# ----- Overview: where villages are stuck --------------------------------
#
# The Gaps tab's counting. It replaced an earlier "road" view (ICT then CRA,
# drawn as a sequence) and differs from it, and from the map, in three
# intended ways:
#
# * **ICT and CRA are parallel jobs.** Neither is counted "after" the other, so
#   a village CRA-approved without ICT is not an anomaly any more: it is simply
#   "ICT remained". The road's ``cra_approved_without_ict`` note is gone.
# * **Cards 1 and 2 count on-air villages only.** هدف, drive test done *and*
#   the site's ``last_stage`` is temporary or permanent launch -- the same
#   on-air reading the Acceptance dashboard splits on. The map does not apply
#   the on-air rule.
# * **The Mojri card counts every approved village.** Every هدف village ICT or
#   CRA approved, on air or not, drive test done or not
#   (:func:`mojri_tracker.comparison_scope`): the same villages the Mojri
#   template lists, so the figure is read against the rows the PM filled in.
#   The universe (:func:`_universe`) is therefore on-air villages *plus* every
#   approved village, and each counter carries its own on-air condition.
# * **A non-PM's figures are their own.** Totals, every gap and every base are
#   computed over the cells that roll up to their own key, so the one row they
#   see adds up to the totals they see.
#
# What stays the same: one GROUP BY (:func:`_gap_grid`), every figure a fold of
# it, every lens a partition that sums back to the total, nobody-owns rows
# named rather than dropped, and no de-duplication (ARCHITECTURE.md,
# "Acceptance counting does not deduplicate").
#
# "Approved" is the village roll-up (``Village.ict_status == Approved``, i.e.
# every requested technology approved). Everything else -- Pending, Rejected,
# not filed -- is not approved.
#
# A village with no ``mojri_tracker_status`` row is "not in the tracker", and a
# ``needs_look`` village is counted as missing too (it is not ``in_tracker``);
# the needs-look count travels separately so the page can show it later.


@dataclass
class GapCell:
    """The overview's counters for one (province, contractor) cell.

    Each gap is counted directly in SQL rather than derived by subtraction, so
    the identities the tests check (``approved + pending = eligible`` and the
    rest) are evidence, not arithmetic that holds by construction.
    """

    #: On air (هدف, drive test done, on-air stage): cards 1 and 2's base.
    eligible: int = 0
    #: On air and approved.
    ict_approved: int = 0
    cra_approved: int = 0
    #: Approved, on air or not: the Mojri card's base.
    ict_approved_all: int = 0
    cra_approved_all: int = 0
    pending_ict: int = 0
    pending_cra: int = 0
    #: CRA approved, ICT not.
    ict_remained: int = 0
    #: ICT approved, CRA not.
    cra_remained: int = 0
    #: ICT approved (on air or not), and Mojri's ICT tracker has it / does
    #: not / needs a look.
    ict_in_tracker: int = 0
    ict_missing: int = 0
    ict_needs_look: int = 0
    cra_in_tracker: int = 0
    cra_missing: int = 0
    cra_needs_look: int = 0
    no_province: int = 0

    def add(self, other: GapCell) -> None:
        for f in fields(self):
            setattr(self, f.name, getattr(self, f.name) + getattr(other, f.name))


@dataclass(frozen=True)
class Gap:
    """One of the six figures: which counter is the gap and which its base.

    ``authority`` is set on the two tracker gaps, which also report Mojri's
    in-tracker and needs-look counts.
    """

    key: str
    count: str
    base: str
    authority: str | None = None


GAPS: tuple[Gap, ...] = (
    Gap("pending_ict", count="pending_ict", base="eligible"),
    Gap("pending_cra", count="pending_cra", base="eligible"),
    Gap("ict_remained", count="ict_remained", base="cra_approved"),
    Gap("cra_remained", count="cra_remained", base="ict_approved"),
    Gap("ict_missing_in_mojri", count="ict_missing", base="ict_approved_all", authority="ict"),
    Gap("cra_missing_in_mojri", count="cra_missing", base="cra_approved_all", authority="cra"),
)
GAP_KEYS = tuple(g.key for g in GAPS)


def _on_air(db: Session) -> ColumnElement[bool]:
    """Drive test done and the site on air: the condition cards 1 and 2 count
    over. The هدف and not-deleted rules are the universe's."""
    return and_(
        WorkItem.dt_status.in_(kpi.dt_done_values(db) or [""]),
        WorkItem.last_stage.in_(kpi.onair_values(db) or [""]),
    )


def _universe(db: Session, stmt: Select) -> Select:
    """Put the overview's villages under ``stmt``: every live هدف village that
    is on air (cards 1-2) or approved by either authority (the Mojri card).

    **The one definition of the overview's universe.** The grid
    (:func:`_gap_grid`) aggregates over it and the export
    (:func:`export_villages`) lists rows from it, so a village is in a figure
    if and only if it is in that figure's spreadsheet. A second query with its
    own joins and filters would be two answers that are supposed to agree --
    the failure this module is built to rule out.

    Each counter narrows it further (:func:`_counter_conditions`): cards 1-2
    to on air, the Mojri card to approved -- which, within this universe, is
    exactly :func:`mojri_tracker.comparison_scope`.

    The Mojri tracker join is an outer join on a unique ``village_id``, so it
    cannot double a village.
    """
    return (
        stmt.select_from(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .outerjoin(Contractor, WorkItem.dt_sc_contractor_id == Contractor.id)
        .outerjoin(MojriTrackerStatus, MojriTrackerStatus.village_id == Village.id)
        .where(
            *mojri_tracker.live_target_village(db),
            or_(_on_air(db), mojri_tracker.approved_by_either()),
        )
    )


def _counter_conditions(db: Session) -> dict[str, ColumnElement[bool]]:
    """Each :class:`GapCell` counter, as the condition a village meets to be
    counted in it. The grid counts them; the export filters by them.

    Cards 1 and 2 are ANDed with on-air, so widening the universe for the
    Mojri card leaves their figures exactly as they were. The Mojri counters
    carry no on-air rule: they compare every approved village.

    "Approved" is the village roll-up (every requested technology approved);
    anything else -- Pending, Rejected, not filed -- is not approved. No
    tracker row reads as "not in the tracker", and ``needs_look`` counts as
    missing (it is not ``in_tracker``).
    """
    approved = kpi.APPROVED
    on_air = _on_air(db)
    ict_ok = Village.ict_status == approved
    cra_ok = Village.cra_status == approved
    ict_not = Village.ict_status != approved
    cra_not = Village.cra_status != approved
    ict_tracked = func.coalesce(MojriTrackerStatus.ict_status, NOT_IN_TRACKER)
    cra_tracked = func.coalesce(MojriTrackerStatus.cra_status, NOT_IN_TRACKER)
    return {
        "eligible": on_air,
        "ict_approved": and_(on_air, ict_ok),
        "cra_approved": and_(on_air, cra_ok),
        "ict_approved_all": ict_ok,
        "cra_approved_all": cra_ok,
        "pending_ict": and_(on_air, ict_not),
        "pending_cra": and_(on_air, cra_not),
        "ict_remained": and_(on_air, cra_ok, ict_not),
        "cra_remained": and_(on_air, ict_ok, cra_not),
        "ict_in_tracker": and_(ict_ok, ict_tracked == IN_TRACKER),
        "ict_missing": and_(ict_ok, ict_tracked != IN_TRACKER),
        "ict_needs_look": and_(ict_ok, ict_tracked == NEEDS_LOOK),
        "cra_in_tracker": and_(cra_ok, cra_tracked == IN_TRACKER),
        "cra_missing": and_(cra_ok, cra_tracked != IN_TRACKER),
        "cra_needs_look": and_(cra_ok, cra_tracked == NEEDS_LOOK),
    }


def _gap_grid(db: Session) -> dict[tuple[str | None, str | None], GapCell]:
    """Every overview counter, in one GROUP BY over the overview's universe.

    Grouped by (province, DT SC contractor) for the same reason as
    :func:`_grid`: each lens is a fold of these cells, never a query of its
    own. Unscoped; a non-PM's figures are a fold of a subset of these cells.

    Each counter is counted directly in SQL rather than derived by
    subtraction, so the identities the tests check are evidence.
    """
    conditions = _counter_conditions(db)
    names = list(conditions)
    stmt = _universe(
        db,
        select(
            Province.name,
            Contractor.name,
            *(kpi.count_if(condition) for condition in conditions.values()),
        ),
    ).group_by(Province.name, Contractor.name)

    grid: dict[tuple[str | None, str | None], GapCell] = {}
    for province, contractor, *counts in db.execute(stmt):
        cell = GapCell(**{name: value or 0 for name, value in zip(names, counts, strict=True)})
        cell.no_province = cell.eligible if province is None else 0
        grid[(province, contractor)] = cell
    return grid


def last_mojri_import(db: Session):
    """When Mojri's tracker was last imported, or None if it never was -- in
    which case the page shows the tracker block empty rather than a guess."""
    return db.execute(
        select(func.max(MojriImportRun.created_at))
    ).scalar_one_or_none()


def _managers_by_coordinator(mapping: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    """The regional manager(s) each coordinator works under, from the same
    current mapping the lenses fold by. A coordinator whose provinces sit
    under two managers lists both."""
    out: dict[str, set[str]] = {}
    for owners in mapping.values():
        out.setdefault(owners[kpi.LENS_COORDINATOR], set()).add(owners[kpi.LENS_RM])
    return {name: sorted(managers) for name, managers in out.items()}


def _gap_rows(
    owners: dict[tuple[str, str], GapCell],
    gap: Gap,
    managers: dict[str, list[str]] | None = None,
) -> list[dict]:
    """One gap's owner rows, biggest first, name breaking ties.

    An owner with none in this gap keeps its row, reading zero, so the rows
    always add up to the gap's total. ``managers`` (coordinator lens only)
    adds each owned row's regional manager(s), which the drawer prints under
    the coordinator's name.
    """
    rows = []
    for (name, attribution), cell in owners.items():
        row = {
            "name": name,
            "count": getattr(cell, gap.count),
            "base": getattr(cell, gap.base),
            "attribution": attribution,
        }
        if managers is not None:
            row["managers"] = managers.get(name, []) if attribution == OWNED else []
        rows.append(row)
    rows.sort(key=lambda row: (-row["count"], row["name"]))
    return rows


def _gap_figure(cell: GapCell, gap: Gap) -> dict:
    figure = {"count": getattr(cell, gap.count), "base": getattr(cell, gap.base)}
    if gap.authority is not None:
        figure["in_tracker"] = getattr(cell, f"{gap.authority}_in_tracker")
        figure["needs_look"] = getattr(cell, f"{gap.authority}_needs_look")
    return figure


def overview(db: Session, user, lens: str | None) -> dict:
    """The Gaps tab: six figures, and who is behind each one under one lens.

    Reads only. PM sees the country under any lens (province by default);
    every other role sees only their own villages, under their own lens.
    """
    kpi.require_kpi_access(user)

    if lens is not None and lens not in LENSES:
        raise HTTPException(422, f"lens must be one of {', '.join(LENSES)}")

    is_pm = user.role.name == kpi.PM
    scope = None
    if is_pm:
        lens = lens or LENS_PROVINCE
    else:
        # The KPI page's rule: the lens and key are the account's own, and
        # asking for another lens is a 403. Nothing the client sends widens it.
        scope = kpi.resolve_scope(db, user, lens, None)
        lens = scope.lens

    grid = _gap_grid(db)
    mapping = _mapping(db)

    if scope is not None:
        mine = _owned_by(scope.lens, scope.key, mapping)
        grid = {cell_key: cell for cell_key, cell in grid.items() if mine(*cell_key)}

    owners = _fold(
        grid,
        lambda province, contractor: _owner(lens, province, contractor, mapping),
        GapCell,
    )
    if scope is not None and not owners:
        # Nothing eligible yet: still their own row, reading zero, rather than
        # an empty list that reads like somebody else's page.
        owners = {(scope.key, OWNED): GapCell()}
    total = _fold(grid, lambda _p, _c: (_COUNTRY, OWNED), GapCell).get(
        (_COUNTRY, OWNED), GapCell()
    )

    provinces = {province for province, _ in grid if province is not None}
    managers = (
        _managers_by_coordinator(mapping) if lens == kpi.LENS_COORDINATOR else None
    )
    return {
        "last_cpm_import": kpi.last_cpm_import(db),
        "last_mojri_import": last_mojri_import(db),
        "scoped": not is_pm,
        "lens": lens,
        "key": None if is_pm else scope.key,
        "lenses": [{"key": key, "label": LENS_LABELS[key]} for key in LENSES]
        if is_pm
        else [{"key": lens, "label": LENS_LABELS[lens]}],
        "totals": {
            "eligible": total.eligible,
            "ict_approved": total.ict_approved,
            "cra_approved": total.cra_approved,
            "ict_approved_all": total.ict_approved_all,
            "cra_approved_all": total.cra_approved_all,
        },
        "gaps": {gap.key: _gap_figure(total, gap) for gap in GAPS},
        "rows": {gap.key: _gap_rows(owners, gap, managers) for gap in GAPS},
        "data_quality": {
            "villages_without_province": total.no_province,
            "unmapped_provinces": sorted(
                kpi.province_label(name) for name in provinces - set(mapping)
            ),
        },
    }


# ----- Export: the villages behind a figure ------------------------------
#
# ``GET /gaps/villages.xlsx``. Every village count on the page is a button
# that downloads exactly the villages it counts. The rows come from the same
# selection the overview folds (:func:`_universe`), filtered by the
# same counter condition (:func:`_counter_conditions`) and narrowed to an
# owner by the same function the folds group by (:func:`_owner`, through
# :func:`_owned_by`). So the file for a figure has that figure's row count,
# by construction; the tests check it for every gap and every lens anyway.

#: What may be exported: the six gaps; the on-air approved counts card 2 and
#: the map show; and the approved-in-UEP counts the Mojri tiles show (every
#: approved village, the Mojri card's base). Key -> the GapCell counter it
#: lists.
EXPORTS: dict[str, str] = {
    **{gap.key: gap.count for gap in GAPS},
    "ict_approved": "ict_approved",
    "cra_approved": "cra_approved",
    "ict_approved_all": "ict_approved_all",
    "cra_approved_all": "cra_approved_all",
}

EXPORT_TITLES = {
    "pending_ict": "Pending ICT approval",
    "pending_cra": "Pending CRA approval",
    "ict_remained": "ICT pending, CRA approved",
    "cra_remained": "CRA pending, ICT approved",
    "ict_missing_in_mojri": "ICT approved, missing in Mojri",
    "cra_missing_in_mojri": "CRA approved, missing in Mojri",
    "ict_approved": "ICT approved",
    "cra_approved": "CRA approved",
    "ict_approved_all": "ICT approved in UEP (vs Mojri)",
    "cra_approved_all": "CRA approved in UEP (vs Mojri)",
}

SCOPE_PROVINCE = "province"
SCOPE_REGION = "region"

_MOJRI_WORDS = {IN_TRACKER: "in tracker", NOT_IN_TRACKER: "missing", NEEDS_LOOK: "needs a look"}


@dataclass(frozen=True)
class VillageExport:
    """One export, validated and ready to write. ``rows`` is lazy: villages
    are read from the database as the workbook is written, so a large export
    is never held in memory whole."""

    gap: str
    title: str
    #: "Coordinator = V. Hashemi · Province = Tehran", or "All villages".
    filter_text: str
    #: The part of the filename after the gap: an ASCII slug of the filter.
    file_key: str
    rows: object  # Iterator[dict]


def export_villages(
    db: Session,
    user,
    *,
    gap: str,
    lens: str | None = None,
    key: str | None = None,
    scope: str | None = None,
) -> VillageExport:
    """The villages behind one figure, for the spreadsheet.

    Access is the overview's: :func:`kpi.require_kpi_access` (Admin is a 403)
    and :func:`kpi.resolve_scope` (a non-PM is confined to their own villages,
    and naming another person under their own lens is a 403). A non-PM may
    narrow further -- by another lens or a map scope -- only to owners inside
    their own villages; naming anybody else is a 403 too, never an empty file
    that reads like "nothing pending".

    Everything is validated before the first row is read, so a refusal is a
    clean HTTP error rather than a broken download.
    """
    kpi.require_kpi_access(user)
    counter = EXPORTS.get(gap)
    if counter is None:
        raise HTTPException(422, f"gap must be one of {', '.join(EXPORTS)}")
    if lens is not None and lens not in LENSES:
        raise HTTPException(422, f"lens must be one of {', '.join(LENSES)}")
    if (lens is None) != (key is None or not key.strip()):
        raise HTTPException(422, "lens and key go together: send both or neither")
    key = key.strip() if key else None

    mapping = _mapping(db)
    tests: list = []
    labels: list[str] = []
    # Whether the viewer's own confinement already is the lens/key asked for.
    lens_covered = False

    if user.role.name != kpi.PM:
        lens_covered = lens == kpi.LENS_BY_ROLE[user.role.name]
        own = kpi.resolve_scope(
            db, user, lens if lens_covered else None, key if lens_covered else None
        )
        tests.append(_owned_by(own.lens, own.key, mapping))
        labels.append(f"{LENS_LABELS[own.lens]} = {own.key}")
        if lens is not None and not lens_covered:
            _require_own_owner(db, lens, key, tests, mapping)

    if lens is not None and not lens_covered:
        tests.append(_owned_by(lens, key, mapping))
        labels.append(f"{LENS_LABELS[lens]} = {key}")

    if scope is not None:
        scope_test, scope_label = _scope_filter(scope, mapping)
        tests.append(scope_test)
        labels.append(scope_label)

    return VillageExport(
        gap=gap,
        title=EXPORT_TITLES[gap],
        filter_text=" · ".join(labels) or "All villages",
        file_key=_file_key(lens, key, scope),
        rows=_village_rows(db, counter, tests, mapping),
    )


def _require_own_owner(db: Session, lens: str, key: str, tests: list, mapping) -> None:
    """403 unless ``key`` owns at least one of the viewer's own cells under
    ``lens``: a non-PM may narrow their own villages, not look at anyone
    else's."""
    wanted = key.casefold()
    for province_fa, contractor in _gap_grid(db):
        if all(test(province_fa, contractor) for test in tests) and (
            _owner(lens, province_fa, contractor, mapping)[0].casefold() == wanted
        ):
            return
    raise HTTPException(403, "You may only export your own villages")


def _scope_filter(scope: str, mapping) -> tuple:
    """``province:<Persian name>`` or ``region:<CRA region>``, as a cell test
    and a label. The map's two kinds of shape."""
    kind, _, value = scope.partition(":")
    value = value.strip()
    if not value or kind not in (SCOPE_PROVINCE, SCOPE_REGION):
        raise HTTPException(422, "scope must be province:<name> or region:<name>")
    if kind == SCOPE_PROVINCE:
        return (lambda province_fa, _c: province_fa == value), (
            f"Province = {kpi.province_label(value)}"
        )
    return _owned_by(kpi.LENS_REGION, value, mapping), f"CRA region = {value}"


def _file_key(lens: str | None, key: str | None, scope: str | None) -> str:
    """The filename's filter part, ASCII-safe. Farsi names do not survive a
    Content-Disposition header everywhere, so a name with no ASCII letters in
    it becomes a short stable hash of itself."""
    parts = []
    if scope:
        kind, _, value = scope.partition(":")
        name = kpi.province_label(value) if kind == SCOPE_PROVINCE else value
        parts.append(f"{kind}-{_slug(name)}")
    if lens and key:
        parts.append(f"{lens}-{_slug(key)}")
    return "-".join(parts) or "all"


def _slug(text: str) -> str:
    ascii_only = re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")
    if ascii_only:
        return ascii_only[:40]
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]


def _village_rows(db: Session, counter: str, tests: list, mapping):
    """The universe's villages in ``counter``, narrowed by ``tests``, one dict per
    village, in province then village order. A generator: rows are read in
    batches as the workbook is written."""
    tracked = last_mojri_import(db) is not None
    ict_date = (
        select(func.max(Acceptance.ict_date))
        .where(Acceptance.village_id == Village.id)
        .scalar_subquery()
    )
    cra_date = (
        select(func.max(Acceptance.cra_date))
        .where(Acceptance.village_id == Village.id)
        .scalar_subquery()
    )
    stmt = (
        _universe(
            db,
            select(
                Province.name,
                Contractor.name,
                Village.village_code,
                Village.village_name,
                Village.ict_status,
                ict_date,
                Village.cra_status,
                cra_date,
                MojriTrackerStatus.ict_status,
                MojriTrackerStatus.cra_status,
            ),
        )
        .where(_counter_conditions(db)[counter])
        .order_by(Province.name, Village.village_code, Village.id)
        .execution_options(yield_per=2000)
    )
    for (
        province_fa, contractor, code, name, ict, ict_on, cra, cra_on, ict_m, cra_m
    ) in db.execute(stmt):
        if not all(test(province_fa, contractor) for test in tests):
            continue
        yield {
            "village_code": code,
            "village_name": name,
            "province": kpi.province_label(province_fa),
            "region": _owner(kpi.LENS_REGION, province_fa, contractor, mapping)[0],
            "rm": _owner(kpi.LENS_RM, province_fa, contractor, mapping)[0],
            "coordinator": _owner(kpi.LENS_COORDINATOR, province_fa, contractor, mapping)[0],
            "contractor": _owner(kpi.LENS_CONTRACTOR, province_fa, contractor, mapping)[0],
            "ict_status": ict,
            "ict_date": ict_on,
            "cra_status": cra,
            "cra_date": cra_on,
            "mojri": _mojri_words(ict_m, cra_m) if tracked else "No Mojri import yet",
            "attribution": _attribution(province_fa, contractor, mapping),
        }


def _mojri_words(ict: str | None, cra: str | None) -> str:
    ict_word = _MOJRI_WORDS.get(ict or NOT_IN_TRACKER, ict)
    cra_word = _MOJRI_WORDS.get(cra or NOT_IN_TRACKER, cra)
    return f"ICT {ict_word} · CRA {cra_word}"


def _attribution(province_fa: str | None, contractor: str | None, mapping) -> str:
    """Why nobody owns this village under some lens, in the page's own terms
    (``unknown_province``, ``unmapped``, ``unassigned``), or ``owned``."""
    reasons = []
    if province_fa is None:
        reasons.append(UNKNOWN_PROVINCE)
    elif province_fa not in mapping:
        reasons.append(UNMAPPED)
    if contractor is None:
        reasons.append(UNASSIGNED)
    return ", ".join(reasons) or OWNED


# ----- Coverage map -------------------------------------------------------
#
# The same figures, drawn on Iran: ICT approval by province, CRA approval by
# CRA region.
#
# A village's province is the one its site carries from CPM -- the same
# ``provinces`` row every figure on this page is grouped by. Nothing is placed
# by coordinates. Each province row is keyed by that Persian name, which is
# what the page's map asset (``frontend/src/pages/reports/iranMap.json``, built
# by ``scripts/build-iran-map.py``) is keyed by too, so the join is the same
# string on both sides.
#
# CRA regions are the nine of ``province_mapping``: a region's figures are
# the fold of its provinces' cells, so a region can never disagree with the
# provinces inside it.
#
# Scope: PM sees the country; anyone else only the cells
# that roll up to their own key under their own lens.


#: The owner lists the map's detail panel offers. A province is one CRA
#: region, so only a region's panel lists by province.
PROVINCE_DETAIL_LENSES = (kpi.LENS_COORDINATOR, kpi.LENS_CONTRACTOR, kpi.LENS_RM)
REGION_DETAIL_LENSES = (LENS_PROVINCE, *PROVINCE_DETAIL_LENSES)


def _stretch_figures(cell: GapCell) -> dict:
    """One shape's detail figures, both authorities, in the Gaps tab's
    counting: approved, pending and remained, each over the drive-tested
    base. Every one of them is a count the export can list."""
    return {
        "ict": {
            "approved": cell.ict_approved,
            "base": cell.eligible,
            "pending": cell.pending_ict,
            "remained": cell.ict_remained,
        },
        "cra": {
            "approved": cell.cra_approved,
            "base": cell.eligible,
            "pending": cell.pending_cra,
            "remained": cell.cra_remained,
        },
    }


def _detail(cells: dict, lenses: tuple[str, ...], mapping) -> dict:
    """The detail panel for one shape: its figures and, under each lens, its
    owners -- all folds of the same cells, so the owner rows sum to the
    shape's own figures."""
    total = _fold(cells, lambda _p, _c: (_COUNTRY, OWNED), GapCell).get(
        (_COUNTRY, OWNED), GapCell()
    )
    owners = {}
    for lens in lenses:
        def owner_of(province_fa, contractor, lens=lens):
            # A province row also carries its Persian name, which is the key
            # the map and the export's province scope use.
            name, attribution = _owner(lens, province_fa, contractor, mapping)
            return name, attribution, province_fa if lens == LENS_PROVINCE else None

        folded = _fold(cells, owner_of, GapCell)
        owners[lens] = sorted(
            (
                {
                    "name": name,
                    "attribution": attribution,
                    **({"key": province_fa} if lens == LENS_PROVINCE else {}),
                    **_stretch_figures(cell),
                }
                for (name, attribution, province_fa), cell in folded.items()
            ),
            key=lambda row: row["name"],
        )
    return {**_stretch_figures(total), "owners": owners}


def coverage_map(db: Session, user) -> dict:
    """Every province and CRA region, with ICT and CRA figures. Reads only."""
    kpi.require_kpi_access(user)

    is_pm = user.role.name == kpi.PM
    scope = None if is_pm else kpi.resolve_scope(db, user, None, None)

    grid = _grid(db)
    mapping = _mapping(db)

    in_scope = (
        (lambda _p, _c: True)
        if scope is None
        else _owned_by(scope.lens, scope.key, mapping)
    )

    mine = {key: cell for key, cell in grid.items() if in_scope(*key)}
    # The detail panel counts like the Gaps tab (and its export), so it folds
    # the overview's grid -- the same scope, the same cells.
    gap_mine = {key: cell for key, cell in _gap_grid(db).items() if in_scope(*key)}
    ict, cra = _BY_KEY[STRETCH_ICT], _BY_KEY[STRETCH_CRA]

    def both(cell: Cell) -> dict:
        return {"ict": _scored(cell, ict), "cra": _scored(cell, cra)}

    by_province = _fold(mine, lambda province_fa, _c: province_fa)
    # PM's map is the whole programme: every province in the mapping has a row,
    # reading zero if nothing there has reached a stretch yet, so the map has no
    # blank province that might be read as "no gap".
    wanted = set(by_province) | (set(mapping) if is_pm else set())

    provinces = []
    for province_fa in sorted(wanted, key=lambda fa: (fa is None, fa or "")):
        name, attribution = _owner(LENS_PROVINCE, province_fa, None, mapping)
        owners = mapping.get(province_fa) if province_fa else None
        provinces.append(
            {
                "key": province_fa,
                "name": name,
                "attribution": attribution,
                "region": owners[kpi.LENS_REGION] if owners else None,
                "managers": [owners[kpi.LENS_RM]] if owners else [],
                "villages": by_province.get(province_fa, Cell()).villages,
                **both(by_province.get(province_fa, Cell())),
                "detail": _detail(
                    {k: c for k, c in gap_mine.items() if k[0] == province_fa},
                    PROVINCE_DETAIL_LENSES,
                    mapping,
                ),
            }
        )

    by_region = _fold(
        mine, lambda province_fa, contractor: _owner(
            kpi.LENS_REGION, province_fa, contractor, mapping
        )
    )
    region_keys = set(by_region)
    if is_pm:
        region_keys |= {(owners[kpi.LENS_REGION], OWNED) for owners in mapping.values()}

    regions = []
    for name, attribution in sorted(region_keys, key=lambda key: (key[1] != OWNED, key[0])):
        cell = by_region.get((name, attribution), Cell())
        members = [
            row["key"]
            for row in provinces
            if row["key"] is not None and row["region"] == name
        ]
        in_region = _owned_by(kpi.LENS_REGION, name, mapping)
        regions.append(
            {
                "name": name,
                "attribution": attribution,
                "provinces": members,
                "managers": sorted(
                    {
                        mapping[fa][kpi.LENS_RM]
                        for fa in members
                        if fa in mapping
                    }
                ),
                "villages": cell.villages,
                **both(cell),
                "detail": _detail(
                    {k: c for k, c in gap_mine.items() if in_region(*k)},
                    REGION_DETAIL_LENSES,
                    mapping,
                ),
            }
        )

    total = _fold(mine, lambda _p, _c: (_COUNTRY, OWNED)).get((_COUNTRY, OWNED), Cell())

    return {
        "scoped": not is_pm,
        "lens_label": None if is_pm else LENS_LABELS[scope.lens],
        "key": None if is_pm else scope.key,
        "last_cpm_import": kpi.last_cpm_import(db),
        "low_sample_threshold": kpi.LOW_SAMPLE_DT_DONE,
        "provinces": provinces,
        "regions": regions,
        "total": {"villages": total.villages, **both(total)},
    }
