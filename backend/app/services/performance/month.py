"""The Month tab: what happened in a month, and who it belongs to. PM and
Viewer.

Four sections (:data:`definitions.MONTH_SECTIONS`), each row a count in the
month. The screen shows no comparison; the previous month cut at the same day
(:mod:`periods`) is still computed for the Excel export.

``by=owners`` (the screen) gives every recorded row three owner lists at once,
contractors, regional managers and coordinators, credited by who owned the
province on the event date (:mod:`ownership`). ``by=coordinator|contractor|rm``
(the export) gives one. Every list is sorted high to low and sums to the row
total: anything nobody owned is "Unattributed", always last.
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import date

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
BY_OWNERS = "owners"
BY_LENSES = {
    "coordinator": kpi.LENS_COORDINATOR,
    "contractor": kpi.LENS_CONTRACTOR,
    "rm": kpi.LENS_RM,
}
#: The three ``owners_by`` lists, in the order the screen shows them.
OWNER_LENSES = (kpi.LENS_CONTRACTOR, kpi.LENS_RM, kpi.LENS_COORDINATOR)


def default_month(today: date) -> ShamsiMonth:
    """The last closed month; the running month while the last closed month
    is from before UEP recorded approvals (it would read "Not recorded" for
    most measures)."""
    running = ShamsiMonth.of(today)
    closed = running.previous()
    if (closed.year, closed.month) < D.RECORDED_FROM:
        return running
    return closed


def parse_month(text: str | None) -> ShamsiMonth:
    if not text:
        return default_month(jalali.tehran_today())
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
    if by not in (BY_ALL, BY_OWNERS) and by not in BY_LENSES:
        raise HTTPException(
            422, f"by must be one of {BY_ALL}, {BY_OWNERS}, {', '.join(BY_LENSES)}"
        )

    pair = window_pair(parse_month(month))
    facts = F.load(db)
    ownership = Ownership.load(db) if by != BY_ALL else None
    if by == BY_OWNERS:
        lenses: tuple[str, ...] = OWNER_LENSES
        known = _known_owners(facts, ownership, pair.now)
    else:
        lenses = (BY_LENSES[by],) if by in BY_LENSES else ()
        known = {}

    sections = [
        {
            "key": section.key,
            "title": section.title,
            "block": {"value": section.block, "unit": section.block_unit},
            "rows": [
                _row(m, facts, pair, lenses, ownership, known, grouped=by == BY_OWNERS)
                for m in section.measures
            ],
        }
        for section in D.MONTH_SECTIONS
    ]
    return {
        **pair.as_dict(),
        "by": by,
        "sections": sections,
        "recorded_from": ShamsiMonth(*D.RECORDED_FROM).as_dict(),
        "current_month": ShamsiMonth.of(jalali.tehran_today()).as_dict(),
        "first_year": _first_year(facts, pair.month),
        "undated_on_air": facts.undated_on_air,
        "last_cpm_import": kpi.last_cpm_import(db),
    }


def _first_year(facts: F.Facts, shown: ShamsiMonth) -> int:
    """The first Shamsi year with any dated event: where the picker starts."""
    first = min((fact.day for fact in facts.events), default=None)
    year = ShamsiMonth.of(first).year if first else shown.year
    return min(year, shown.year, D.RECORDED_FROM[0])


def _known_owners(
    facts: F.Facts, ownership: Ownership, window: Window
) -> dict[str, set[str]]:
    """Everyone who could have been credited in the month, so a list can say
    who had none: contractors with a live site, and the regional managers and
    coordinators who held a province at any point in the window."""
    known: dict[str, set[str]] = {
        kpi.LENS_CONTRACTOR: {s.contractor for s in facts.sites if s.contractor},
        kpi.LENS_RM: set(),
        kpi.LENS_COORDINATOR: set(),
    }
    for owners in ownership.spans():
        if owners.start < window.end and (owners.end is None or owners.end > window.start):
            known[kpi.LENS_RM].add(owners.rm)
            known[kpi.LENS_COORDINATOR].add(owners.coordinator)
    return known


def _row(
    measure: D.Measure,
    facts: F.Facts,
    pair: Comparison,
    lenses: tuple[str, ...],
    ownership: Ownership | None,
    known: dict[str, set[str]],
    *,
    grouped: bool,
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
        "owners_by": None,
    }
    if measure.villages_too:
        row["villages"] = comparison(
            count(D.VILLAGES, pair.now),
            count(D.VILLAGES, pair.ref),
            lower_is_better=measure.lower_is_better,
            recorded=recorded,
            ref_recorded=ref_recorded,
        )
    if lenses and recorded:
        events = list(facts.dated(measure.key, measure.unit))
        splits = {
            lens: owner_split(
                events,
                pair,
                lens,
                ownership,
                lower_is_better=measure.lower_is_better,
                ref_recorded=ref_recorded,
                known=known.get(lens, ()),
            )
            for lens in lenses
        }
        if grouped:
            row["owners_by"] = splits
        else:
            row["owners"] = splits[lenses[0]]
    return row


def owner_split(
    events: Iterable[F.Fact],
    pair: Comparison,
    lens: str,
    ownership: Ownership,
    *,
    lower_is_better: bool = False,
    ref_recorded: bool = True,
    known: Iterable[str] = (),
) -> list[dict]:
    """One entry per owner, highest first, summing to the row's total.

    An owner is listed when they have something in either window, or is in
    ``known`` (then at 0, so the screen can say who had none). "Unattributed"
    appears only when something was, always last.
    """
    now: Counter[str] = Counter()
    ref: Counter[str] = Counter()
    for fact in events:
        for window, counter in ((pair.now, now), (pair.ref, ref)):
            if fact.day in window:
                counter[ownership.owner(lens, fact.province_fa, fact.contractor, fact.day)] += 1

    names = set(now) | set(ref) | set(known)
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
