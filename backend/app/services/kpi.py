"""KPI & Performance: delivery and acceptance progress, by whoever owns it.

One page, four lenses — Regional Manager, PSO Coordinator, Contractor, CRA
Region — each compared against the country. The rules it implements were given
by the product owner and are followed exactly:

* **Final status only.** A village rejected and later approved counts as
  approved. That falls out of reading ``villages.ict_status`` /
  ``cra_status``, which are the current standing and are maintained in the same
  transaction as every change that could alter them.
* **ICT and CRA run in parallel**, so neither gates the other.
* **Percentages have two different bases, on purpose.** On air and DT done are
  measured against the scope's total; ICT and CRA approval and rejection are
  measured against *DT-done villages*, because a village whose drive test is
  not finished was never eligible for acceptance and counting it as an
  outstanding approval would blame a team for work that is not theirs yet.
  The "remained" counts keep the total-villages base, which is what the
  programme reports against. The two bases are why an approval rate can read
  high while a large "remained" number stands beside it.
* **The country average is weighted** — the sum of every province's numerator
  over the sum of their denominators, never the mean of 31 percentages. A mean
  of percentages gives Ilam the same weight as Tehran.
* **The country average is the whole country, always**, whatever the viewer can
  see. A contractor's benchmark is the national rate, not the rate across the
  provinces they happen to work in. It is the one figure on the page computed
  outside the viewer's scope, and it is an aggregate of thirty-one provinces —
  it identifies nobody.
* **No ranking of people.** The heatmap ranks provinces; nothing on the page
  ranks the four kinds of owner against each other.

Everything is aggregated with ``GROUP BY`` in the database. The only work done
in Python is over the handful of rows a province-level GROUP BY returns.

Where a province cannot be worked out — a CPM ``استان`` cell that matches none
of the 31, which leaves ``sites.province_id`` NULL — its work items and
villages are still counted in the country total and shown as one extra
"Unknown province" row. Dropping them would make the per-province rows quietly
fail to add up to the country figure, which is the one property that makes this
page checkable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from app.core.deps import ADMIN, COORDINATOR, CONTRACTOR, PM, REGIONAL
from app.core.province_directory import ENGLISH_BY_PERSIAN, UNKNOWN_PROVINCE_LABEL
from app.models.acceptance import CpmImportBatch
from app.models.kpi import ProvinceMapping
from app.models.reference import Contractor, Province, User
from app.models.workitem import Site, Village, WorkItem
from app.services import cpm_columns as C

# ----- Lenses -------------------------------------------------------------

LENS_RM = "rm"
LENS_COORDINATOR = "coordinator"
LENS_CONTRACTOR = "contractor"
LENS_REGION = "region"
LENSES = (LENS_RM, LENS_COORDINATOR, LENS_CONTRACTOR, LENS_REGION)

#: Which lens each role is confined to. PM is absent because PM has all four.
#: Admin is absent because Admin has none — see :func:`require_kpi_access`.
LENS_BY_ROLE = {
    REGIONAL: LENS_RM,
    COORDINATOR: LENS_COORDINATOR,
    CONTRACTOR: LENS_CONTRACTOR,
}

#: Fewer DT-done villages than this and a province is shown but not compared:
#: grey, uncoloured, sorted last. Two approvals out of three is not a 67%
#: better than the country, it is three villages.
LOW_SAMPLE_DT_DONE = 10

APPROVED = "Approved"
REJECTED = "Rejected"

_FORBIDDEN = "You do not have permission to view KPI & Performance"


# ----- Scope --------------------------------------------------------------


@dataclass
class Scope:
    """Which slice of the data one request is allowed to see, and how it is
    labelled. Built only by :func:`resolve_scope`, which is the single place
    the access rules live."""

    lens: str
    key: str
    #: Province ids for the three geographic lenses; None for the contractor
    #: lens, which is not geographic (a contractor works across provinces).
    province_ids: list[int] | None = None
    contractor_id: int | None = None
    province_names_fa: list[str] = field(default_factory=list)
    cra_regions: list[str] = field(default_factory=list)
    #: True when the signed-in user chose this scope (PM); False when it was
    #: forced from their own account. The page hides the lens row when forced.
    selectable: bool = False

    @property
    def chip(self) -> str:
        if self.lens == LENS_CONTRACTOR:
            return f"{len(self.province_names_fa)} provinces"
        provinces = len(self.province_ids or [])
        regions = len(self.cra_regions)
        return f"{provinces} provinces · {regions} CRA regions"


def require_kpi_access(user: User) -> None:
    """Admin has no access to this page or its data; nor has any role that is
    not one of the four the brief names.

    Enforced here rather than only in the sidebar, because a hidden link is not
    an access rule — the same check runs on every endpoint in this module,
    including the exports.
    """
    role = user.role.name
    if role == ADMIN or role not in (PM, REGIONAL, COORDINATOR, CONTRACTOR):
        raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN)


def _own_key(db: Session, user: User) -> str:
    """The one lens key a non-PM user is allowed to ask for."""
    role = user.role.name
    if role == CONTRACTOR:
        if user.contractor_id is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This contractor account is not linked to a contractor",
            )
        contractor = db.get(Contractor, user.contractor_id)
        if contractor is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This contractor account is not linked to a contractor",
            )
        return contractor.name
    if not user.kpi_person_name:
        # Deliberately not "show them everything" and not "show them nothing":
        # an unlinked account is a configuration mistake, and saying so is the
        # only answer that leads anywhere.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account is not linked to a name in the province mapping. "
            "Ask the PM to link it on the KPI mapping screen.",
        )
    return user.kpi_person_name


def resolve_scope(
    db: Session, user: User, lens: str | None, key: str | None
) -> Scope:
    """Turn a requested lens and key into a scope this user may actually see.

    PM may ask for any lens and any person. Everyone else gets their own, and
    asking for somebody else's is a 403 rather than a silent substitution — a
    silent substitution would show a regional manager a page headed with
    another manager's name and let them believe it.
    """
    require_kpi_access(user)
    role = user.role.name

    if role == PM:
        lens = lens or LENS_RM
        if lens not in LENSES:
            raise HTTPException(422, f"Unknown lens {lens!r}")
        key = key or _first_key(db, lens)
        if key is None:
            raise HTTPException(404, "There is nothing to show for that lens yet")
        return _build_scope(db, lens, key, selectable=True)

    own_lens = LENS_BY_ROLE[role]
    own_key = _own_key(db, user)
    if lens is not None and lens != own_lens:
        raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN)
    if key is not None and key.strip().casefold() != own_key.casefold():
        raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN)
    return _build_scope(db, own_lens, own_key, selectable=False)


def _first_key(db: Session, lens: str) -> str | None:
    """A sensible default person for PM's first visit: the first, by name."""
    options = lens_options(db, lens)
    return options[0] if options else None


def lens_options(db: Session, lens: str) -> list[str]:
    """Every person (or region, or contractor) this lens can be pointed at."""
    if lens == LENS_CONTRACTOR:
        names = db.execute(
            select(Contractor.name)
            .join(WorkItem, WorkItem.dt_sc_contractor_id == Contractor.id)
            .where(WorkItem.deleted_at.is_(None))
            .distinct()
            .order_by(Contractor.name)
        ).scalars().all()
        return list(names)

    column = {
        LENS_RM: ProvinceMapping.regional_manager,
        LENS_COORDINATOR: ProvinceMapping.pso_coordinator,
        LENS_REGION: ProvinceMapping.cra_region,
    }[lens]
    return list(
        db.execute(
            select(column)
            .where(ProvinceMapping.effective_to.is_(None))
            .distinct()
            .order_by(column)
        ).scalars().all()
    )


def _build_scope(db: Session, lens: str, key: str, *, selectable: bool) -> Scope:
    if lens == LENS_CONTRACTOR:
        contractor = db.execute(
            select(Contractor).where(func.lower(Contractor.name) == key.lower())
        ).scalars().first()
        if contractor is None:
            raise HTTPException(404, f"No contractor named {key!r}")
        province_names = db.execute(
            select(Province.name)
            .join(Site, Site.province_id == Province.id)
            .join(WorkItem, WorkItem.site_id == Site.id)
            .where(
                WorkItem.dt_sc_contractor_id == contractor.id,
                WorkItem.deleted_at.is_(None),
            )
            .distinct()
        ).scalars().all()
        return Scope(
            lens=lens,
            key=contractor.name,
            contractor_id=contractor.id,
            province_names_fa=sorted(province_names),
            cra_regions=_regions_for(db, province_names),
            selectable=selectable,
        )

    column = {
        LENS_RM: ProvinceMapping.regional_manager,
        LENS_COORDINATOR: ProvinceMapping.pso_coordinator,
        LENS_REGION: ProvinceMapping.cra_region,
    }[lens]
    rows = db.execute(
        select(ProvinceMapping.province_fa, ProvinceMapping.cra_region).where(
            ProvinceMapping.effective_to.is_(None),
            func.lower(column) == key.lower(),
        )
    ).all()
    if not rows:
        raise HTTPException(404, f"No provinces are mapped to {key!r}")

    province_names = [r[0] for r in rows]
    province_ids = list(
        db.execute(
            select(Province.id).where(Province.name.in_(province_names))
        ).scalars().all()
    )
    return Scope(
        lens=lens,
        key=_canonical_key(db, column, key),
        province_ids=province_ids,
        province_names_fa=sorted(province_names),
        cra_regions=sorted({r[1] for r in rows}),
        selectable=selectable,
    )


def _canonical_key(db: Session, column, key: str) -> str:
    """The name as the mapping spells it, not as the query string spelled it."""
    found = db.execute(
        select(column).where(
            ProvinceMapping.effective_to.is_(None), func.lower(column) == key.lower()
        )
    ).scalars().first()
    return found or key


def _regions_for(db: Session, province_names_fa) -> list[str]:
    if not province_names_fa:
        return []
    return sorted(
        set(
            db.execute(
                select(ProvinceMapping.cra_region).where(
                    ProvinceMapping.effective_to.is_(None),
                    ProvinceMapping.province_fa.in_(list(province_names_fa)),
                )
            ).scalars().all()
        )
    )


# ----- Value sets, resolved once per request ------------------------------
#
# ``last_stage``, ``dt_status`` and ``target_classification`` are free text
# that the import normalises on the way in, but rows written by earlier imports
# carry spacing and letter-form variants of the same value. The Python helpers
# in ``cpm_columns`` know how to read all of them; SQL does not.
#
# So the distinct values are read first -- there are a few dozen across the
# whole table -- and turned into an IN list. The aggregation itself stays a
# single GROUP BY, and it agrees exactly with what the rest of the platform
# considers on air, DT done and a target village.


def _onair_values(db: Session) -> list[str]:
    values = db.execute(select(WorkItem.last_stage).distinct()).scalars().all()
    return [v for v in values if v is not None and C.is_onair_stage(v)]


def _dt_done_values(db: Session) -> list[str]:
    values = db.execute(select(WorkItem.dt_status).distinct()).scalars().all()
    return [
        v
        for v in values
        if v is not None and C.normalize_dt_status(v) == C.DT_STATUS_DONE
    ]


def _target_values(db: Session) -> list[str]:
    values = db.execute(select(Village.target_classification).distinct()).scalars().all()
    return [v for v in values if C.is_pure_target(v)]


def _count_if(condition) -> object:
    return func.sum(case((condition, 1), else_=0))


def _scope_conditions(scope: Scope | None) -> list:
    if scope is None:
        return []
    if scope.lens == LENS_CONTRACTOR:
        return [WorkItem.dt_sc_contractor_id == scope.contractor_id]
    return [Site.province_id.in_(scope.province_ids or [-1])]


def _province_label(name_fa: str | None) -> str:
    if name_fa is None:
        return UNKNOWN_PROVINCE_LABEL
    return ENGLISH_BY_PERSIAN.get(name_fa, name_fa)


# ----- Aggregation --------------------------------------------------------


@dataclass
class Totals:
    """One scope's raw counts. Percentages are derived, never stored, so the
    numerator and denominator behind every figure on the page stay visible."""

    work_items: int = 0
    work_items_on_air: int = 0
    work_items_dt_done: int = 0
    villages: int = 0
    villages_on_air: int = 0
    villages_dt_done: int = 0
    ict_approved: int = 0
    ict_rejected: int = 0
    cra_approved: int = 0
    cra_rejected: int = 0

    def add(self, other: Totals) -> None:
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))


def _village_aggregate(db: Session, scope: Scope | None) -> dict[str | None, Totals]:
    """Per-province village counts, in one GROUP BY."""
    onair = _onair_values(db)
    done = _dt_done_values(db)
    targets = _target_values(db)

    stmt: Select = (
        select(
            Province.name,
            func.count(Village.id),
            _count_if(WorkItem.last_stage.in_(onair or [""])),
            _count_if(WorkItem.dt_status.in_(done or [""])),
            _count_if(Village.ict_status == APPROVED),
            _count_if(Village.ict_status == REJECTED),
            _count_if(Village.cra_status == APPROVED),
            _count_if(Village.cra_status == REJECTED),
        )
        .select_from(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(
            Village.deleted_at.is_(None),
            WorkItem.deleted_at.is_(None),
            Village.target_classification.in_(targets or [""]),
            *_scope_conditions(scope),
        )
        .group_by(Province.name)
    )

    out: dict[str | None, Totals] = {}
    for name, total, on_air, dt_done, ict_a, ict_r, cra_a, cra_r in db.execute(stmt):
        out[name] = Totals(
            villages=total or 0,
            villages_on_air=on_air or 0,
            villages_dt_done=dt_done or 0,
            ict_approved=ict_a or 0,
            ict_rejected=ict_r or 0,
            cra_approved=cra_a or 0,
            cra_rejected=cra_r or 0,
        )
    return out


def _work_item_aggregate(db: Session, scope: Scope | None) -> dict[str | None, Totals]:
    """Per-province work-item counts, in one GROUP BY."""
    onair = _onair_values(db)
    done = _dt_done_values(db)

    stmt: Select = (
        select(
            Province.name,
            func.count(WorkItem.id),
            _count_if(WorkItem.last_stage.in_(onair or [""])),
            _count_if(WorkItem.dt_status.in_(done or [""])),
        )
        .select_from(WorkItem)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(WorkItem.deleted_at.is_(None), *_scope_conditions(scope))
        .group_by(Province.name)
    )

    out: dict[str | None, Totals] = {}
    for name, total, on_air, dt_done in db.execute(stmt):
        out[name] = Totals(
            work_items=total or 0,
            work_items_on_air=on_air or 0,
            work_items_dt_done=dt_done or 0,
        )
    return out


def _combined(db: Session, scope: Scope | None) -> dict[str | None, Totals]:
    """Village and work-item counts for the same scope, merged per province."""
    villages = _village_aggregate(db, scope)
    work_items = _work_item_aggregate(db, scope)
    merged: dict[str | None, Totals] = {}
    for name in set(villages) | set(work_items):
        row = Totals()
        if name in villages:
            row.add(villages[name])
        if name in work_items:
            row.add(work_items[name])
        merged[name] = row
    return merged


def _sum(rows) -> Totals:
    total = Totals()
    for row in rows:
        total.add(row)
    return total


# ----- Percentages --------------------------------------------------------


def pct(numerator: int, denominator: int) -> float | None:
    """A percentage, or None when there is nothing to divide by.

    None rather than 0.0, because "no villages yet" and "none of them approved"
    are different facts and a chart that shows both as a flat zero says the
    wrong one.
    """
    if not denominator:
        return None
    return round(numerator * 100.0 / denominator, 1)


def _delta(value: float | None, benchmark: float | None) -> float | None:
    if value is None or benchmark is None:
        return None
    return round(value - benchmark, 1)


def _rates(totals: Totals) -> dict[str, float | None]:
    """Every percentage the page shows, from one set of counts.

    The two bases are deliberate and are the product owner's definition: the
    funnel rates divide by the scope's total, the acceptance rates divide by
    DT-done villages.
    """
    return {
        "wi_on_air": pct(totals.work_items_on_air, totals.work_items),
        "wi_dt_done": pct(totals.work_items_dt_done, totals.work_items),
        "on_air": pct(totals.villages_on_air, totals.villages),
        "dt_done": pct(totals.villages_dt_done, totals.villages),
        "ict_approved": pct(totals.ict_approved, totals.villages_dt_done),
        "ict_rejected": pct(totals.ict_rejected, totals.villages_dt_done),
        "cra_approved": pct(totals.cra_approved, totals.villages_dt_done),
        "cra_rejected": pct(totals.cra_rejected, totals.villages_dt_done),
    }


# ----- The page -----------------------------------------------------------


def last_cpm_import(db: Session) -> datetime | None:
    return db.execute(
        select(func.max(CpmImportBatch.created_at))
    ).scalar_one_or_none()


def _cell(
    count: int, base: int, benchmark: float | None, *, lower_is_better: bool = False
) -> dict:
    value = pct(count, base)
    return {
        "count": count,
        "pct": value,
        "delta": _delta(value, benchmark),
        "lower_is_better": lower_is_better,
    }


def _province_row(name_fa: str | None, totals: Totals, country: dict) -> dict:
    base = totals.villages_dt_done
    return {
        "province_fa": name_fa,
        "province": _province_label(name_fa),
        "cra_region": None,  # filled by the caller, which holds the mapping
        "villages": totals.villages,
        "dt_done_villages": totals.villages_dt_done,
        "low_sample": base < LOW_SAMPLE_DT_DONE,
        "on_air": _cell(totals.villages_on_air, totals.villages, country["on_air"]),
        "dt_done": _cell(totals.villages_dt_done, totals.villages, country["dt_done"]),
        "ict_approved": _cell(totals.ict_approved, base, country["ict_approved"]),
        "ict_rejected": _cell(
            totals.ict_rejected, base, country["ict_rejected"], lower_is_better=True
        ),
        "cra_approved": _cell(totals.cra_approved, base, country["cra_approved"]),
        "cra_rejected": _cell(
            totals.cra_rejected, base, country["cra_rejected"], lower_is_better=True
        ),
    }


def _sort_key(row: dict) -> tuple:
    """ICT approved, best first — with every low-sample province after every
    compared one, whatever its percentage. A province with three DT-done
    villages and all three approved must not head the table."""
    value = row["ict_approved"]["pct"]
    return (1 if row["low_sample"] else 0, -(value if value is not None else -1))


def summary(db: Session, user: User, lens: str | None, key: str | None) -> dict:
    """The whole KPI page for one scope, plus the country benchmark."""
    scope = resolve_scope(db, user, lens, key)

    country_rows = _combined(db, None)
    country_totals = _sum(country_rows.values())
    country = _rates(country_totals)

    scope_rows = _combined(db, scope)
    scope_totals = _sum(scope_rows.values())
    scope_rates = _rates(scope_totals)

    regions_by_province = dict(
        db.execute(
            select(ProvinceMapping.province_fa, ProvinceMapping.cra_region).where(
                ProvinceMapping.effective_to.is_(None)
            )
        ).all()
    )

    provinces = []
    for name_fa, totals in scope_rows.items():
        if totals.villages == 0 and totals.work_items == 0:
            continue
        row = _province_row(name_fa, totals, country)
        row["cra_region"] = regions_by_province.get(name_fa)
        provinces.append(row)
    provinces.sort(key=_sort_key)

    country_row = _province_row(None, country_totals, country)
    country_row["province"] = "Country average"
    country_row["cra_region"] = None
    country_row["low_sample"] = False

    return {
        "lens": scope.lens,
        "key": scope.key,
        "selectable": scope.selectable,
        "scope": {
            "provinces": len(scope.province_names_fa),
            "cra_regions": len(scope.cra_regions),
            "chip": scope.chip,
            "province_names": [_province_label(n) for n in scope.province_names_fa],
        },
        "last_cpm_import": last_cpm_import(db),
        "work_items": {
            "total": scope_totals.work_items,
            "on_air": scope_totals.work_items_on_air,
            "dt_done": scope_totals.work_items_dt_done,
            "remain_on_air": scope_totals.work_items - scope_totals.work_items_on_air,
            "remain_dt": scope_totals.work_items - scope_totals.work_items_dt_done,
            "on_air_pct": scope_rates["wi_on_air"],
            "dt_done_pct": scope_rates["wi_dt_done"],
            "country_on_air_pct": country["wi_on_air"],
            "country_dt_done_pct": country["wi_dt_done"],
        },
        "villages": {
            "total": scope_totals.villages,
            "on_air": scope_totals.villages_on_air,
            "dt_done": scope_totals.villages_dt_done,
            "ict_approved": scope_totals.ict_approved,
            "ict_rejected": scope_totals.ict_rejected,
            "cra_approved": scope_totals.cra_approved,
            "cra_rejected": scope_totals.cra_rejected,
            "remain_on_air": scope_totals.villages - scope_totals.villages_on_air,
            "remain_dt": scope_totals.villages - scope_totals.villages_dt_done,
            "ict_remained": scope_totals.villages - scope_totals.ict_approved,
            "cra_remained": scope_totals.villages - scope_totals.cra_approved,
            "on_air_pct": scope_rates["on_air"],
            "dt_done_pct": scope_rates["dt_done"],
            "ict_approved_pct": scope_rates["ict_approved"],
            "cra_approved_pct": scope_rates["cra_approved"],
            "country_on_air_pct": country["on_air"],
            "country_dt_done_pct": country["dt_done"],
            "country_ict_approved_pct": country["ict_approved"],
            "country_cra_approved_pct": country["cra_approved"],
        },
        "country": {
            "villages": country_totals.villages,
            "villages_on_air": country_totals.villages_on_air,
            "villages_dt_done": country_totals.villages_dt_done,
            "work_items": country_totals.work_items,
            "work_items_on_air": country_totals.work_items_on_air,
            "work_items_dt_done": country_totals.work_items_dt_done,
            "ict_approved": country_totals.ict_approved,
            "ict_rejected": country_totals.ict_rejected,
            "cra_approved": country_totals.cra_approved,
            "cra_rejected": country_totals.cra_rejected,
            **{f"{k}_pct": v for k, v in country.items()},
        },
        "provinces": provinces,
        "country_row": country_row,
        "low_sample_threshold": LOW_SAMPLE_DT_DONE,
    }


# ----- Contractors, under the coordinator lens ----------------------------


def contractors(db: Session, user: User, key: str | None, mode: str) -> dict:
    """Per-contractor acceptance progress inside a coordinator's regions.

    PM and PSO Coordinator only. A Regional Manager is refused outright — the
    brief hides contractor comparison from that role, and hiding it in the
    interface alone would leave the numbers one URL away.
    """
    require_kpi_access(user)
    role = user.role.name
    if role not in (PM, COORDINATOR):
        raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN)
    if mode not in ("ict", "cra"):
        raise HTTPException(422, "mode must be 'ict' or 'cra'")

    if role == COORDINATOR:
        own = _own_key(db, user)
        if key is not None and key.strip().casefold() != own.casefold():
            raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN)
        key = own

    scope = _build_scope(db, LENS_COORDINATOR, key, selectable=role == PM) if key else None

    approved_column = Village.ict_status if mode == "ict" else Village.cra_status
    targets = _target_values(db)

    stmt = (
        select(
            Contractor.name,
            func.count(Village.id),
            _count_if(approved_column == APPROVED),
        )
        .select_from(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Contractor, WorkItem.dt_sc_contractor_id == Contractor.id)
        .where(
            Village.deleted_at.is_(None),
            WorkItem.deleted_at.is_(None),
            Village.target_classification.in_(targets or [""]),
            *_scope_conditions(scope),
        )
        .group_by(Contractor.name)
        .order_by(Contractor.name)
    )

    rows = []
    total_villages = total_approved = 0
    for name, villages, approved in db.execute(stmt):
        villages = villages or 0
        approved = approved or 0
        total_villages += villages
        total_approved += approved
        rows.append(
            {
                # A work item can carry no DT SC at all. Those villages are
                # kept and labelled rather than dropped, so the rows still add
                # up to the coordinator's total -- which is what makes the
                # table checkable against the heatmap above it.
                "contractor": name or "Unassigned",
                "villages": villages,
                "approved": approved,
                "remained": villages - approved,
                "pct": pct(approved, villages),
            }
        )
    rows.sort(key=lambda r: (-(r["pct"] if r["pct"] is not None else -1), r["contractor"]))

    return {
        "mode": mode,
        "key": scope.key if scope else None,
        "selectable": role == PM,
        "last_cpm_import": last_cpm_import(db),
        "rows": rows,
        "total": {
            "contractor": "Total",
            "villages": total_villages,
            "approved": total_approved,
            "remained": total_villages - total_approved,
            "pct": pct(total_approved, total_villages),
        },
    }
