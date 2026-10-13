"""Small shapes every Roles Performance payload shares.

Each comparison is ``{now, ref, delta, lower_is_better, recorded}``, and a
value that was not recorded is ``None`` with ``recorded: false``, never 0:
"nothing happened" and "nobody wrote it down" are different facts.
"""
from __future__ import annotations

from app.services import kpi
from app.services.performance import definitions as D
from app.services.performance.facts import Cell


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


def low_sample(cell: Cell) -> bool:
    return cell.villages_dt_done < D.LOW_SAMPLE_DT_DONE
