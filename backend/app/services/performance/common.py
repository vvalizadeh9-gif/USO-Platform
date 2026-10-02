"""Small shapes every Roles Performance payload shares.

Each comparison is ``{now, ref, delta, lower_is_better, recorded}``, and a
value that was not recorded is ``None`` with ``recorded: false``, never 0:
"nothing happened" and "nobody wrote it down" are different facts.
"""
from __future__ import annotations

from collections.abc import Iterable

from app.services import kpi
from app.services.performance import definitions as D
from app.services.performance.facts import Cell, CellKey
from app.services.performance.ownership import UNATTRIBUTED, Ownership
from app.services.performance.periods import ShamsiMonth


def scope_for(db, user, lens: str | None, key: str | None) -> kpi.Scope:
    """The scope a Roles Performance tab shows.

    :func:`kpi.resolve_scope` decides, as it does everywhere: PM and Viewer
    may choose, anybody else gets their own and a 403 for anything else. The
    only difference here is the default: PM and Viewer open on the whole
    country rather than on the first regional manager.
    """
    if lens is None and key is None and kpi.may_compare(user):
        lens = kpi.LENS_COUNTRY
    return kpi.resolve_scope(db, user, lens, key)


def scope_dict(scope: kpi.Scope) -> dict:
    return {
        "lens": scope.lens,
        "key": scope.key,
        "label": scope.label,
        "chip": scope.chip,
        "selectable": scope.selectable,
        "past": scope.past,
        "provinces": len(scope.province_names_fa),
        "cra_regions": len(scope.cra_regions),
    }


def comparison(
    now: float | None,
    ref: float | None,
    *,
    lower_is_better: bool = False,
    recorded: bool = True,
    ref_recorded: bool = True,
) -> dict:
    now = now if recorded else None
    ref = ref if ref_recorded else None
    delta = None if now is None or ref is None else round(now - ref, 1)
    return {
        "now": now,
        "ref": ref,
        "delta": delta,
        "lower_is_better": lower_is_better,
        "recorded": recorded,
        "ref_recorded": ref_recorded,
    }


def rate_of(cell: Cell, rate: D.Rate) -> float | None:
    return D.pct(getattr(cell, rate.count), getattr(cell, rate.base))


def peer_cells(
    cells: dict[CellKey, Cell], kind: str, ownership: Ownership
) -> dict[str, Cell]:
    """Today's cells folded by owner of one kind, unattributed left out: the
    owners a role average is taken over, and the owners Compare lists."""
    out: dict[str, Cell] = {}
    for (province_fa, contractor), cell in cells.items():
        name = ownership.owner(kind, province_fa, contractor, None)
        if name != UNATTRIBUTED:
            out.setdefault(name, Cell()).add(cell)
    return out


def low_sample(cell: Cell) -> bool:
    return cell.villages_dt_done < D.LOW_SAMPLE_DT_DONE


def role_average(cells: Iterable[Cell], rate: D.Rate, *, weighted: bool) -> float | None:
    """The average owner of one kind, over the **compared** owners only.

    Contractors are weighted (numerators over denominators): they do not
    partition the country, so a weighted average says something the national
    rate does not. Regional managers, coordinators, regions and provinces do
    partition it, so their weighted average would be the national rate again;
    for them it is the plain mean, each owner counting once.
    """
    compared = [c for c in cells if not low_sample(c)]
    if weighted:
        return D.pct(
            sum(getattr(c, rate.count) for c in compared),
            sum(getattr(c, rate.base) for c in compared),
        )
    values = [v for c in compared if (v := rate_of(c, rate)) is not None]
    return round(sum(values) / len(values), 1) if values else None


def is_weighted(kind: str) -> bool:
    return kind == kpi.LENS_CONTRACTOR


def gap(value: float | None, benchmark: float | None) -> float | None:
    if value is None or benchmark is None:
        return None
    return round(value - benchmark, 1)


def month_entry(month: ShamsiMonth, **values) -> dict:
    return {**month.as_dict(), "key": month.key, **values}
