"""The Month tab: what happened this month, against last month. PM and Viewer.

Four sections (:data:`definitions.MONTH_SECTIONS`), each row a count in the
month against the previous month cut at the same day (:mod:`periods`). With
``by`` set, every row also carries one entry per owner, credited by who owned
the province on the event date (:mod:`ownership`), sorted high to low, and
summing to the row total: anything nobody owned is "Unattributed".
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.reference import User
from app.services import kpi
from app.services.performance import definitions as D
from app.services.performance import facts as F
from app.services.performance.common import comparison
from app.services.performance.ownership import UNATTRIBUTED, Ownership
from app.services.performance.periods import Comparison, ShamsiMonth, Window, compare

BY_ALL = "all"
BY_LENSES = {
    "coordinator": kpi.LENS_COORDINATOR,
    "contractor": kpi.LENS_CONTRACTOR,
    "rm": kpi.LENS_RM,
}


def parse_month(text: str | None) -> ShamsiMonth:
    if not text:
        return ShamsiMonth.of(jalali.tehran_today())
    try:
        return ShamsiMonth.parse(text)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


def window_pair(month: ShamsiMonth) -> Comparison:
    try:
        return compare(month, jalali.tehran_today())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


def payload(db: Session, user: User, month: str | None, by: str = BY_ALL) -> dict:
    kpi.require_compare(user)
    if by != BY_ALL and by not in BY_LENSES:
        raise HTTPException(422, f"by must be one of all, {', '.join(BY_LENSES)}")

    pair = window_pair(parse_month(month))
    facts = F.load(db)
    ownership = Ownership.load(db) if by != BY_ALL else None
    lens = BY_LENSES.get(by)

    sections = [
        {
            "key": section.key,
            "title": section.title,
            "block": {"value": section.block, "unit": section.block_unit},
            "rows": [_row(m, facts, pair, lens, ownership) for m in section.measures],
        }
        for section in D.MONTH_SECTIONS
    ]
    return {
        **pair.as_dict(),
        "by": by,
        "sections": sections,
        "recorded_from": ShamsiMonth(*D.RECORDED_FROM).as_dict(),
        "undated_on_air": facts.undated_on_air,
        "last_cpm_import": kpi.last_cpm_import(db),
    }


def _row(
    measure: D.Measure,
    facts: F.Facts,
    pair: Comparison,
    lens: str | None,
    ownership: Ownership | None,
) -> dict:
    recorded = measure.is_recorded(pair.month.year, pair.month.month)
    ref_recorded = measure.is_recorded(pair.ref_month.year, pair.ref_month.month)

    def count(unit: str, window: Window) -> int:
        return sum(1 for _ in facts.dated(measure.key, unit, window))

    row = {
        "key": measure.key,
        "label": measure.label,
        "unit": measure.unit,
        **comparison(
            count(measure.unit, pair.now),
            count(measure.unit, pair.ref),
            lower_is_better=measure.lower_is_better,
            recorded=recorded,
            ref_recorded=ref_recorded,
        ),
        "villages": None,
        "owners": None,
    }
    if measure.villages_too:
        row["villages"] = comparison(
            count(D.VILLAGES, pair.now),
            count(D.VILLAGES, pair.ref),
            lower_is_better=measure.lower_is_better,
            recorded=recorded,
            ref_recorded=ref_recorded,
        )
    if lens is not None and recorded:
        row["owners"] = owner_split(
            facts.dated(measure.key, measure.unit),
            pair,
            lens,
            ownership,
            lower_is_better=measure.lower_is_better,
            ref_recorded=ref_recorded,
        )
    return row


def owner_split(
    events: Iterable[F.Fact],
    pair: Comparison,
    lens: str,
    ownership: Ownership,
    *,
    lower_is_better: bool = False,
    ref_recorded: bool = True,
) -> list[dict]:
    """One entry per owner, highest first, summing to the row's total.

    An owner is listed when they have something in either window, so a row
    reads as a short ranked line rather than a roll-call of zeros; one who
    did something last month and nothing this month still shows, at 0, with
    their drop. "Unattributed" appears only when something was, always last.
    """
    now: Counter[str] = Counter()
    ref: Counter[str] = Counter()
    for fact in events:
        for window, counter in ((pair.now, now), (pair.ref, ref)):
            if fact.day in window:
                counter[ownership.owner(lens, fact.province_fa, fact.contractor, fact.day)] += 1

    names = set(now) | set(ref)
    names.discard(UNATTRIBUTED)
    entries = [
        {
            "name": name,
            **comparison(now[name], ref[name], lower_is_better=lower_is_better,
                         ref_recorded=ref_recorded),
        }
        for name in names
    ]
    entries.sort(key=lambda e: (-e["now"], e["name"].casefold()))
    if now[UNATTRIBUTED] or ref[UNATTRIBUTED]:
        entries.append(
            {
                "name": UNATTRIBUTED,
                **comparison(now[UNATTRIBUTED], ref[UNATTRIBUTED],
                             lower_is_better=lower_is_better, ref_recorded=ref_recorded),
            }
        )
    return entries
