"""The Area tab (PM, Viewer) and My area (everyone else): where things stand
today, against national.

The pipeline of the scope (villages, and five measures each with its count
and rate), and every member of one breakdown with the same five measures, so
the screen can rank them against the national rate. Every figure is a fold of
the same (province, contractor) cells (:meth:`facts.Facts.cells`), so the
breakdown rows add up to the scope, and the national figure is the same fold
over every cell. The ownership used is today's: Area has no month.
"""
from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import CONTRACTOR
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
from app.services.performance.ownership import UNATTRIBUTED, Ownership

BREAKDOWN_PROVINCE = "province"
BREAKDOWN_REGION = "region"
BREAKDOWN_CONTRACTOR = "contractor"
BREAKDOWN_COORDINATOR = "coordinator"
BREAKDOWN_RM = "rm"
#: Every breakdown, in the order the screen offers them.
BREAKDOWNS = (
    BREAKDOWN_PROVINCE,
    BREAKDOWN_REGION,
    BREAKDOWN_CONTRACTOR,
    BREAKDOWN_COORDINATOR,
    BREAKDOWN_RM,
)

UNMAPPED_LABEL = "Unmapped province"
UNASSIGNED_LABEL = "Unassigned"

#: The five measures, keyed as the screen keys them, to the rate behind each.
#: On air, DT done and Fully approved divide by villages; ICT and CRA by
#: DT-done villages (:data:`definitions.RATES`).
MEASURES: dict[str, D.Rate] = {
    "onair": D.RATES["on_air"],
    "dt": D.RATES["dt_done"],
    "full": D.RATES["fully"],
    "ict": D.RATES["ict"],
    "cra": D.RATES["cra"],
}


def allowed_breakdowns(user: User) -> tuple[str, ...]:
    """What a role may break its area down by. PM and Viewer: everything.
    Regional managers and coordinators: no other people. Contractors: no
    contractors either (their area is their own sites; a list of contractors
    in it would be a list of one, or a look at somebody else's)."""
    if kpi.may_compare(user):
        return BREAKDOWNS
    if user.role.name == CONTRACTOR:
        return (BREAKDOWN_PROVINCE, BREAKDOWN_REGION)
    return (BREAKDOWN_PROVINCE, BREAKDOWN_REGION, BREAKDOWN_CONTRACTOR)


def offered_breakdowns(user: User, scope: kpi.Scope) -> list[str]:
    """The breakdowns the screen offers: the allowed ones, minus the scope's
    own kind (one coordinator broken down by coordinator is a list of one)."""
    return [b for b in allowed_breakdowns(user) if b != scope.lens]


def payload(
    db: Session,
    user: User,
    lens: str | None,
    key: str | None,
    breakdown: str | None,
) -> dict:
    scope = scope_for(db, user, lens, key)
    offered = offered_breakdowns(user, scope)
    breakdown = breakdown or offered[0]
    if breakdown not in BREAKDOWNS:
        raise HTTPException(422, f"breakdown must be one of {', '.join(BREAKDOWNS)}")
    if breakdown not in allowed_breakdowns(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"Your role has no {breakdown} breakdown"
        )

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
        "totals": {"villages": here.villages, **_measures(here)},
        "national": {k: rate_of(national, rate) for k, rate in MEASURES.items()},
        "breakdown": breakdown,
        "breakdowns": offered,
        "rows": _rows(mine, _key_fn(breakdown, ownership)),
        "low_sample_threshold": D.LOW_SAMPLE_DT_DONE,
    }


def _measures(cell: F.Cell) -> dict:
    return {
        k: {"count": getattr(cell, rate.count), "rate": rate_of(cell, rate)}
        for k, rate in MEASURES.items()
    }


# ----- Breakdown ------------------------------------------------------------

KeyFn = Callable[[str | None, str | None], tuple[str, str | None]]


def _key_fn(breakdown: str, ownership: Ownership) -> KeyFn:
    """``(province_fa, contractor) -> (row name, gaps key)`` for one breakdown."""
    if breakdown == BREAKDOWN_CONTRACTOR:
        return lambda _p, c: (c, c) if c else (UNASSIGNED_LABEL, None)
    if breakdown == BREAKDOWN_PROVINCE:
        return lambda p, _c: (kpi.province_label(p), p) if p else (UNKNOWN_PROVINCE_LABEL, None)

    def owned(province_fa: str | None, contractor: str | None) -> tuple[str, str | None]:
        if province_fa is None:
            return UNKNOWN_PROVINCE_LABEL, None
        name = ownership.owner(breakdown, province_fa, contractor, None)
        return (name, name) if name != UNATTRIBUTED else (UNMAPPED_LABEL, None)

    return owned


def _rows(cells: dict[F.CellKey, F.Cell], key_fn: KeyFn) -> list[dict]:
    """One row per member, in a stable order (the screen ranks them)."""
    grouped: dict[tuple[str, str | None], F.Cell] = {}
    for (province_fa, contractor), cell in cells.items():
        grouped.setdefault(key_fn(province_fa, contractor), F.Cell()).add(cell)

    rows = [
        {
            "name": name,
            "gaps_key": gaps_key,
            "villages": cell.villages,
            "measures": _measures(cell),
            "low_sample": low_sample(cell),
        }
        for (name, gaps_key), cell in grouped.items()
        if cell.villages
    ]
    rows.sort(key=lambda r: (r["gaps_key"] is None, r["name"].casefold()))
    return rows
