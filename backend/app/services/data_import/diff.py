"""New / No change / Conflict, per field (§6.1).

A cell that is empty is not compared at all. A comment is never a conflict:
a new one is simply added to the history.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.models.data_import import ENTITY_CRA, ENTITY_DT, ENTITY_ICT, KIND_CONFLICT, KIND_NEW

from . import columns as C
from .current import Value
from .validate import Checked, Row

ENTITY_OF = {"ICT": ENTITY_ICT, "CRA": ENTITY_CRA}
SAME = "same"


@dataclass
class Change:
    row: Row
    entity_type: str
    entity_id: int
    field: str
    old: str | None
    new: str
    kind: str
    old_source: str | None


def _norm(value: str | None) -> str:
    return " ".join(str(value or "").split()).casefold()


def compare(field: str, now: Value, new: str) -> str:
    if not now.value:
        return KIND_NEW
    if _norm(now.value) == _norm(new):
        return SAME
    if field.endswith("comment"):
        return KIND_NEW
    return KIND_CONFLICT


def _unit(kinds: list[str]) -> str:
    if KIND_CONFLICT in kinds:
        return "conflicts"
    if KIND_NEW in kinds:
        return "new"
    return "same"


def build(checked: Checked, dt_now: dict, acc_now: dict) -> tuple[list[Change], dict]:
    changes: list[Change] = []
    counts = {g: {"new": 0, "same": 0, "conflicts": 0, "errors": 0} for g in ("dt", "ict", "cra")}

    for site in checked.sites.values():
        if site.refused:
            counts["dt"]["errors"] += 1
            continue
        if not site.values:
            continue
        now = dt_now.get(site.work_item_id, {})
        kinds = []
        first_row = site.rows[0]
        for field in C.DT_FIELDS:
            new = site.values.get(field)
            if new is None:
                continue
            current = now.get(field, Value(None))
            kind = compare(field, current, new)
            kinds.append(kind)
            if kind != SAME:
                changes.append(Change(first_row, ENTITY_DT, site.work_item_id, field,
                                      current.value, new, kind, current.source))
        counts["dt"][_unit(kinds)] += 1

    for row in checked.rows:
        for authority, group in (("ICT", "ict"), ("CRA", "cra")):
            prefix = f"{group}_"
            filled = any(row.raw.text(C.acc_key(authority, f)) for f in C.ACC_FIELDS)
            if not filled:
                continue
            if authority not in row.acc:
                if row.errors:
                    counts[group]["errors"] += 1
                continue
            village_id = row.village_ids[0]
            now = acc_now.get((village_id, authority), {})
            kinds = []
            for field in C.ACC_FIELDS:
                new = row.acc[authority].get(field)
                if new is None:
                    continue
                current = now.get(field, Value(None))
                kind = compare(field, current, new)
                kinds.append(kind)
                if kind != SAME:
                    changes.append(Change(row, ENTITY_OF[authority], village_id, prefix + field,
                                          current.value, new, kind, current.source))
            counts[group][_unit(kinds)] += 1
    return changes, counts
