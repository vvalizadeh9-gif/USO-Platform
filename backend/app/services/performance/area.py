"""The Area tab (PM, Viewer) and My area (everyone else): where things stand
today.

Six headline cards, a breakdown by province, CRA region or contractor, and
the open work. Every figure is a fold of the same (province, contractor)
cells (:meth:`facts.Facts.cells`), so the breakdown rows add up to the
headline, and the national figure is the same fold over every cell. The
ownership used is today's: Area has no month.
"""
from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import CONTRACTOR, COORDINATOR, REGIONAL
from app.core.province_directory import UNKNOWN_PROVINCE_LABEL
from app.models.reference import User
from app.services import kpi
from app.services.performance import definitions as D
from app.services.performance import facts as F
from app.services.performance.common import (
    low_sample,
    rate_of,
    scope_dict,
    scope_for,
)
from app.services.performance.ownership import Ownership

BREAKDOWN_PROVINCE = "province"
BREAKDOWN_REGION = "region"
BREAKDOWN_CONTRACTOR = "contractor"
BREAKDOWNS = (BREAKDOWN_PROVINCE, BREAKDOWN_REGION, BREAKDOWN_CONTRACTOR)

UNMAPPED_LABEL = "Unmapped province"
UNASSIGNED_LABEL = "Unassigned"


def default_breakdown(user: User) -> str:
    role = user.role.name
    if kpi.may_compare(user):
        return BREAKDOWN_REGION
    if role in (COORDINATOR, REGIONAL):
        return BREAKDOWN_CONTRACTOR
    return BREAKDOWN_PROVINCE


def payload(
    db: Session,
    user: User,
    lens: str | None,
    key: str | None,
    breakdown: str | None,
) -> dict:
    scope = scope_for(db, user, lens, key)
    breakdown = breakdown or default_breakdown(user)
    if breakdown not in BREAKDOWNS:
        raise HTTPException(422, f"breakdown must be one of {', '.join(BREAKDOWNS)}")
    if breakdown == BREAKDOWN_CONTRACTOR and user.role.name == CONTRACTOR:
        # A contractor's area is their own sites; a list of contractors in it
        # would be a list of one, or a look at somebody else's.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Contractors have no contractor breakdown")

    facts = F.load(db)
    ownership = Ownership.load(db)
    cells = facts.cells()
    national = F.total(cells.values())
    in_scope = ownership.in_scope(scope, dated=False)
    mine = {k: c for k, c in cells.items() if in_scope(*k)}
    here = F.total(mine.values())

    return {
        "scope": scope_dict(scope),
        "as_of": kpi.last_cpm_import(db),
        "read_only": user.role.name == kpi.VIEWER,
        "cards": _cards(here, national, comparer=kpi.may_compare(user)),
        "breakdown": breakdown,
        "breakdowns": [b for b in BREAKDOWNS
                       if not (b == BREAKDOWN_CONTRACTOR and user.role.name == CONTRACTOR)],
        "rows": _rows(mine, national, _key_fn(breakdown, ownership), breakdown),
        "open_work": _open_work(here),
        "low_sample_threshold": D.LOW_SAMPLE_DT_DONE,
    }


# ----- Headline -------------------------------------------------------------


def _rate_card(key: str, here: F.Cell, national: F.Cell) -> dict:
    rate = D.RATES[key]
    return {
        "key": key,
        "label": rate.label,
        "count": getattr(here, rate.count),
        "rate": rate_of(here, rate),
        "base": getattr(here, rate.base),
        "base_label": "DT-done villages" if rate.base == "villages_dt_done" else "villages",
        "national_rate": rate_of(national, rate),
    }


def _cards(here: F.Cell, national: F.Cell, *, comparer: bool) -> list[dict]:
    """Six cards. PM and Viewer read the programme; everyone else reads their
    own patch, starting from how many villages it has."""
    rated = [_rate_card(k, here, national) for k in ("on_air", "dt_done", "ict", "cra", "fully")]
    rated[-1]["remaining"] = here.remaining
    if comparer:
        problematic = {
            "key": "problematic",
            "label": "Problematic",
            "count": here.problematic,
            "rate": D.pct(here.problematic, here.sites_on_air),
            "base": here.sites_on_air,
            "base_label": "sites on air",
            "national_rate": D.pct(national.problematic, national.sites_on_air),
        }
        return [*rated, problematic]
    villages = {
        "key": "villages",
        "label": "Villages in scope",
        "count": here.villages,
        "rate": None,
        "base": here.sites,
        "base_label": "sites",
        "national_rate": None,
    }
    return [villages, *rated]


# ----- Breakdown ------------------------------------------------------------

KeyFn = Callable[[str | None, str | None], tuple[str, str | None]]


def _key_fn(breakdown: str, ownership: Ownership) -> KeyFn:
    """``(province_fa, contractor) -> (row name, gaps key)`` for one breakdown."""
    if breakdown == BREAKDOWN_CONTRACTOR:
        return lambda _p, c: (c, c) if c else (UNASSIGNED_LABEL, None)
    if breakdown == BREAKDOWN_PROVINCE:
        return lambda p, _c: (kpi.province_label(p), p) if p else (UNKNOWN_PROVINCE_LABEL, None)

    def region(province_fa: str | None, _c: str | None) -> tuple[str, str | None]:
        if province_fa is None:
            return UNKNOWN_PROVINCE_LABEL, None
        owners = ownership.at(province_fa, None)
        return (owners.region, owners.region) if owners else (UNMAPPED_LABEL, None)

    return region


def _rows(
    cells: dict[F.CellKey, F.Cell],
    national: F.Cell,
    key_fn: KeyFn,
    breakdown: str,
) -> list[dict]:
    grouped: dict[tuple[str, str | None], F.Cell] = {}
    for (province_fa, contractor), cell in cells.items():
        grouped.setdefault(key_fn(province_fa, contractor), F.Cell()).add(cell)

    ict, cra = D.RATES["ict"], D.RATES["cra"]
    rows = []
    for (name, gaps_key), cell in grouped.items():
        if cell.villages == 0:
            continue
        on_air_only = max(cell.villages_on_air - cell.villages_dt_done, 0)
        rows.append(
            {
                "name": name,
                "gaps_key": gaps_key,
                "attributed": gaps_key is not None,
                "villages": cell.villages,
                "dt_done": cell.villages_dt_done,
                "on_air_only": on_air_only,
                "not_on_air": cell.villages - cell.villages_dt_done - on_air_only,
                "ict": {"rate": rate_of(cell, ict), "count": cell.ict_approved,
                        "national": rate_of(national, ict)},
                "cra": {"rate": rate_of(cell, cra), "count": cell.cra_approved,
                        "national": rate_of(national, cra)},
                "remaining": cell.remaining,
                "low_sample": low_sample(cell),
            }
        )
    # Not a ranking: a breakdown, in a stable order, unowned rows last.
    rows.sort(key=lambda r: (not r["attributed"], r["name"].casefold()))
    return rows


def _open_work(here: F.Cell) -> list[dict]:
    """The four kinds of unfinished work, each linking to Lifecycle Gaps."""
    return [
        {"key": "not_on_air", "label": "Not on air", "count": here.not_on_air},
        {"key": "waiting_dt", "label": "On air, waiting for DT", "count": here.waiting_dt},
        {"key": "ict_open", "label": "DT done, ICT not approved", "count": here.ict_open,
         "gap": "pending_ict"},
        {"key": "cra_open", "label": "DT done, CRA not approved", "count": here.cra_open,
         "gap": "pending_cra"},
    ]

