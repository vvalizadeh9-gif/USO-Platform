"""Gap & Performance: the acceptance pipeline drawn as a road, and who is
stopped on each stretch of it.

A village travels four stretches after its drive test is done:

    drive test done ──▶ ICT approved ──▶ CRA approved ──▶ in Mojri's tracker
                    │                │                 │
                    ICT              CRA               tracker      depreciation

A village is **stopped** on a stretch when it reached that stretch's *starting*
state and has not reached its *end* state. On the ICT stretch that is
"drive-test-done but not yet ICT-approved"; on the CRA stretch, "ICT-approved
but not yet CRA-approved". Nothing here is a snapshot or a delta: every figure
is current standing, read the same way the KPI page reads it.

Five lenses regroup the same villages: regional manager, PSO coordinator,
contractor, CRA region, province.

The one property that makes this page worth reading
---------------------------------------------------

**Every lens is a true partition of the same rows, so every lens sums back to
the same country total.** A design preview of this page showed a country figure
of 2,570 beside an owner list adding up to 445, because two of the five lenses
were built from a different query than the rest. Agreement between two
independently-run aggregates is not something a test can protect for long, so
it is not relied on here.

Instead there is **one query** -- :func:`_grid`, a single GROUP BY over
villages, grouped by (province, DT SC contractor) -- and every number on the
page is a fold of those same cells:

* an owner list is :func:`_fold` with a key function that names the owner;
* the country total is :func:`_fold` with a key function that answers
  "country" for every cell.

Two different groupings of one result set cannot disagree about their total.
The parity test in ``tests/test_gaps_road.py`` asserts it for every lens and
every stretch anyway, because the structure is the argument and the test is the
evidence.

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
This module calls both and filters the owner list to the key it is handed. PM
is the only role that may switch lens, and the only role that sees more than
one owner row.

The country total is shown to every role, as it is on the KPI page: it is an
aggregate of thirty-one provinces and identifies nobody, and ``% of gap`` --
an owner's share of the national gap -- cannot be computed without it.
"""
from __future__ import annotations

from dataclasses import dataclass, fields

from fastapi import HTTPException
from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.core.province_directory import UNKNOWN_PROVINCE_LABEL
from app.models.kpi import ProvinceMapping
from app.models.reference import Contractor, Province
from app.models.workitem import Site, Village, WorkItem
from app.services import kpi

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

#: What one row of each lens is called, for the sentence under the list.
LENS_PLURALS = {
    kpi.LENS_RM: "Regional managers",
    kpi.LENS_COORDINATOR: "Coordinators",
    kpi.LENS_CONTRACTOR: "Contractors",
    kpi.LENS_REGION: "CRA regions",
    LENS_PROVINCE: "Provinces",
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

# ----- Stretches ----------------------------------------------------------

STRETCH_ICT = "ict"
STRETCH_CRA = "cra"
STRETCH_TRACKER = "tracker"
STRETCH_DEP = "dep"


@dataclass(frozen=True)
class Stretch:
    """One stretch of the road.

    ``reached`` and ``stopped`` name the two counters on :class:`Cell` this
    stretch reads, so adding a stretch is a counter and a row here rather than
    a branch in three places.

    ``available`` is False for the two stretches that read the Mojri tracker
    table, which does not exist yet (it arrives with the tracker
    reconciliation). They are on the road, drawn, and report nothing: zero
    owners and a zero country total. Inventing a figure for them -- counting
    every CRA-approved village as "not in the tracker" because there is no
    tracker to look in -- would put a large, confident and wrong number on a
    page whose whole claim is that its numbers add up.
    """

    key: str
    label: str
    start: str
    end: str
    reached: str | None = None
    stopped: str | None = None
    available: bool = True
    pending: str | None = None


STRETCHES: tuple[Stretch, ...] = (
    Stretch(
        key=STRETCH_ICT,
        label="ICT approval",
        start="Drive test done",
        end="ICT approved",
        reached="ict_reached",
        stopped="ict_stopped",
    ),
    Stretch(
        key=STRETCH_CRA,
        label="CRA approval",
        start="ICT approved",
        end="CRA approved",
        reached="cra_reached",
        stopped="cra_stopped",
    ),
    Stretch(
        key=STRETCH_TRACKER,
        label="Mojri tracker registration",
        start="CRA approved",
        end="Registered in Mojri's tracker",
        available=False,
        pending="Waiting on the Mojri tracker reconciliation",
    ),
    Stretch(
        key=STRETCH_DEP,
        label="Depreciation",
        start="Registered in Mojri's tracker",
        end="Depreciated",
        available=False,
        pending="Waiting on the Mojri tracker reconciliation",
    ),
)

STRETCH_KEYS = tuple(s.key for s in STRETCHES)
_BY_KEY = {s.key: s for s in STRETCHES}


# ----- The one set of counters --------------------------------------------


@dataclass
class Cell:
    """The counters for one (province, contractor) cell of the grid.

    Every figure the endpoint returns is a sum of these, which is what makes
    the lenses agree.
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
    # ----- data-quality counters, reported rather than corrected -----
    #: CRA-approved with no ICT approval. The road assumes ICT precedes CRA;
    #: nothing in the platform enforces it, because the two authorities are
    #: deliberately parallel. Such a village is counted as stopped on the ICT
    #: stretch (it is: drive-test-done, not ICT-approved) and is not counted as
    #: having reached the CRA stretch, so it has a place on the road and is
    #: counted exactly once. The count is reported so nobody has to assume it
    #: is small.
    cra_approved_without_ict: int = 0
    #: No province on the site, and no DT SC on the work item.
    no_province: int = 0
    no_contractor: int = 0

    def add(self, other: Cell) -> None:
        for f in fields(self):
            setattr(self, f.name, getattr(self, f.name) + getattr(other, f.name))


def _grid(db: Session) -> dict[tuple[str | None, str | None], Cell]:
    """Every counter on the page, in one GROUP BY.

    Grouped by the finest grain any lens needs -- province and DT SC contractor
    -- so that each lens is a fold of these cells rather than a query of its
    own. A country with 31 provinces and a few dozen contractors makes a few
    hundred cells at most.

    Deliberately unscoped: the country total is the whole country for every
    role (as on the KPI page), and a scoped viewer's own row is a fold of a
    subset of these very cells. One query serves both, which is the point.
    """
    done = kpi.dt_done_values(db)
    targets = kpi.target_values(db)
    approved = kpi.APPROVED

    dt_done = WorkItem.dt_status.in_(done or [""])
    ict_approved = Village.ict_status == approved
    cra_approved = Village.cra_status == approved

    stmt: Select = (
        select(
            Province.name,
            Contractor.name,
            func.count(Village.id),
            kpi.count_if(dt_done),
            kpi.count_if(and_(dt_done, Village.ict_status != approved)),
            kpi.count_if(ict_approved),
            kpi.count_if(and_(ict_approved, Village.cra_status != approved)),
            kpi.count_if(and_(cra_approved, Village.ict_status != approved)),
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
    for province, contractor, villages, reached, stopped, ict_a, cra_stop, anomaly in (
        db.execute(stmt)
    ):
        grid[(province, contractor)] = Cell(
            villages=villages or 0,
            ict_reached=reached or 0,
            ict_stopped=stopped or 0,
            cra_reached=ict_a or 0,
            cra_stopped=cra_stop or 0,
            cra_approved_without_ict=anomaly or 0,
            no_province=(villages or 0) if province is None else 0,
            no_contractor=(villages or 0) if contractor is None else 0,
        )
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


def _fold(grid, key_of) -> dict[tuple[str, str], Cell]:
    """Regroup the grid under one key function.

    The owner list and the country total both come from here, over the same
    cells. That is the whole structural guarantee: one query, grouped different
    ways, never two independent counts that are supposed to agree.
    """
    out: dict[tuple[str, str], Cell] = {}
    for (province_fa, contractor), cell in grid.items():
        key = key_of(province_fa, contractor)
        out.setdefault(key, Cell()).add(cell)
    return out


# ----- The payload --------------------------------------------------------


def _figures(cell: Cell, stretch: Stretch) -> dict:
    """One stretch's three numbers for one owner (or for the country).

    ``rate`` is the stop rate -- stopped over reached -- as a percentage, and
    the two counts it came from travel beside it so the page never has to show
    a rate without the fraction behind it.
    """
    if not stretch.available:
        return {"stopped": 0, "reached": 0, "rate": None}
    stopped = getattr(cell, stretch.stopped)
    reached = getattr(cell, stretch.reached)
    return {"stopped": stopped, "reached": reached, "rate": kpi.pct(stopped, reached)}


def _rows(owners: dict[tuple[str, str], Cell], stretch: Stretch, only: str | None):
    """The owner rows for one stretch, biggest gap first.

    An owner with nothing on this stretch keeps its row, reading zero with no
    rate: "this coordinator has no villages past their drive test" and "this
    coordinator has none stopped" are different facts, and a filter that drops
    the row says the second when it means the first.
    """
    if not stretch.available:
        return []
    rows = []
    for (name, attribution), cell in owners.items():
        if only is not None and name.casefold() != only.casefold():
            continue
        rows.append(
            {
                "name": name,
                "attribution": attribution,
                "villages": cell.villages,
                **_figures(cell, stretch),
            }
        )
    # Name breaks the tie so the order is stable between two loads of the same
    # data, which matters for a list people read top-down.
    rows.sort(key=lambda row: (-row["stopped"], row["name"]))
    return rows


def _data_quality(country: Cell, grid, mapping) -> dict:
    """What the page must not hide about its own inputs.

    Three assumptions this design was handed, each reported on every load
    rather than assumed once: that ICT approval precedes CRA approval, that
    every village has a province, and that every province has a current owner
    in ``province_mapping``.
    """
    provinces = {province for province, _ in grid if province is not None}
    return {
        "cra_approved_without_ict": country.cra_approved_without_ict,
        "villages_without_province": country.no_province,
        "villages_without_contractor": country.no_contractor,
        "unmapped_provinces": sorted(
            kpi.province_label(name) for name in provinces - set(mapping)
        ),
    }


def road(db: Session, user, lens: str | None, stretch: str | None) -> dict:
    """The Gap & Performance road for one lens, and the country beside it.

    Reads only. No table, no migration, nothing written.
    """
    kpi.require_kpi_access(user)

    if lens not in LENSES:
        raise HTTPException(422, f"lens must be one of {', '.join(LENSES)}")
    if stretch is not None and stretch not in STRETCH_KEYS:
        raise HTTPException(422, f"stretch must be one of {', '.join(STRETCH_KEYS)}")

    is_pm = user.role.name == kpi.PM
    scope = None
    if not is_pm:
        # The KPI page's rule, unchanged and not re-implemented: a non-PM is
        # forced onto their own lens and their own key, and asking for another
        # owner's -- or for the province lens, which belongs to no role -- is a
        # 403 rather than a silent substitution.
        scope = kpi.resolve_scope(db, user, lens, None)
    only = None if is_pm else scope.key

    grid = _grid(db)
    mapping = _mapping(db)

    owners = _fold(grid, lambda province, contractor: _owner(
        lens, province, contractor, mapping
    ))
    # The same fold, with every cell answering to one key. Not a second query:
    # a different grouping of the rows the owner list was built from.
    country_cell = _fold(grid, lambda _province, _contractor: (_COUNTRY, OWNED)).get(
        (_COUNTRY, OWNED), Cell()
    )

    wanted = STRETCHES if stretch is None else (_BY_KEY[stretch],)

    return {
        "lens": lens,
        "lens_label": LENS_LABELS[lens],
        "lens_plural": LENS_PLURALS[lens],
        "selectable": is_pm,
        # False for PM, whose list is the whole country; True for everyone
        # else, whose list is their own row and therefore does not sum to the
        # country total. The page says which it is showing rather than
        # printing a sum that cannot balance.
        "scoped": not is_pm,
        "key": only,
        "lenses": [{"key": key, "label": LENS_LABELS[key]} for key in LENSES],
        "last_cpm_import": kpi.last_cpm_import(db),
        "country_villages": country_cell.villages,
        "stretches": [
            {
                "key": spec.key,
                "label": spec.label,
                "start": spec.start,
                "end": spec.end,
                "available": spec.available,
                "pending": spec.pending,
                "country": _figures(country_cell, spec),
                "owners": _rows(owners, spec, only),
            }
            for spec in wanted
        ],
        "data_quality": _data_quality(country_cell, grid, mapping),
    }
