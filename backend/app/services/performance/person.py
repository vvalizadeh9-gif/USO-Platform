"""The Performance tab (PM, Viewer) and My performance (everyone else): what
one owner delivered, month by month, and how fast.

* **Result tiles**: four rates today, this month's movement, and the gap to
  the national rate and to the role average.
* **Delivered per month**: DT done, ICT and CRA per Shamsi month, credited by
  who owned the province at the time, with the role average for ICT.
* **Activity in UEP**: filings and validations, and the three median response
  times, for the owners who act in UEP (contractors, coordinators, PM).

Scope differences, from the brief: the whole country (PM's own view) shows
activity only, because its results are the national figures. Regional
managers, provinces and CRA regions show results only, because they do not
act in UEP.
"""
from __future__ import annotations

from collections import Counter

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.reference import User
from app.services import kpi
from app.services.performance import activity as A
from app.services.performance import definitions as D
from app.services.performance import facts as F
from app.services.performance.common import (
    gap,
    is_weighted,
    month_entry,
    peer_cells,
    rate_of,
    role_average,
    scope_dict,
    scope_for,
)
from app.services.performance.ownership import UNATTRIBUTED, Ownership
from app.services.performance.periods import (
    ShamsiMonth,
    Window,
    last_months,
    months_between,
)

TILES = ("dt_done", "on_air", "ict", "cra")
SERIES = (D.DT_DONE, D.ICT_APPROVED, D.CRA_APPROVED)
DEFAULT_MONTHS = 6
MAX_MONTHS = 24
TREND_MONTHS = 5


def month_range(start: str | None, end: str | None) -> list[ShamsiMonth]:
    """``from``..``to`` inclusive; the last six months by default."""
    today = jalali.tehran_today()
    current = ShamsiMonth.of(today)
    try:
        last = ShamsiMonth.parse(end) if end else current
        first = ShamsiMonth.parse(start) if start else last_months(last.start, DEFAULT_MONTHS)[0]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if last > current:
        last = current
    if first > last:
        raise HTTPException(422, "from must not be after to")
    months = months_between(first, last)
    if len(months) > MAX_MONTHS:
        raise HTTPException(422, f"At most {MAX_MONTHS} months at a time")
    return months


def payload(
    db: Session,
    user: User,
    lens: str | None,
    key: str | None,
    start: str | None,
    end: str | None,
) -> dict:
    scope = scope_for(db, user, lens, key)
    months = month_range(start, end)
    today = jalali.tehran_today()

    facts = F.load(db)
    ownership = Ownership.load(db)
    cells = facts.cells()
    national = F.total(cells.values())
    today_scope = ownership.in_scope(scope, dated=False)
    here = F.total(c for k, c in cells.items() if today_scope(*k))
    peers = None if scope.is_country else peer_cells(cells, scope.lens, ownership)
    belongs = ownership.in_scope(scope, dated=True)

    acts = A.load(db) if scope.lens in A.ACTOR_ROLE else None
    return {
        "scope": scope_dict(scope),
        "months": [m.as_dict() for m in months],
        "current_month": ShamsiMonth.of(today).as_dict(),
        "results": None if scope.is_country else {
            "tiles": _tiles(facts, here, national, peers, scope, belongs, today),
            "series": _series(facts, months, scope, ownership, belongs, peers, today),
        },
        "activity": None if acts is None else _activity(acts, scope, months, today),
        "last_cpm_import": kpi.last_cpm_import(db),
    }


# ----- Results --------------------------------------------------------------


def _tiles(facts, here, national, peers, scope, belongs, today) -> list[dict]:
    month = ShamsiMonth.of(today)
    this_month = Window(month.start, month.end)
    tiles = []
    for key in TILES:
        rate = D.RATES[key]
        value = rate_of(here, rate)
        national_rate = rate_of(national, rate)
        average = (
            role_average(peers.values(), rate, weighted=is_weighted(scope.lens))
            if peers else None
        )
        moved = sum(
            1 for f in facts.dated(rate.measure.key, D.VILLAGES, this_month)
            if belongs(f.province_fa, f.contractor, f.day)
        )
        tiles.append(
            {
                "key": key,
                "label": rate.label,
                "rate": value,
                "count": getattr(here, rate.count),
                "base": getattr(here, rate.base),
                "movement": moved if rate.measure.is_recorded(month.year, month.month) else None,
                "movement_month": month.as_dict(),
                "national_rate": national_rate,
                "national_gap": gap(value, national_rate),
                "role_average": average,
                "role_gap": gap(value, average),
            }
        )
    return tiles


def _series(facts, months, scope, ownership, belongs, peers, today) -> list[dict]:
    current = ShamsiMonth.of(today)
    out = []
    for month in months:
        window = Window(month.start, month.end)
        entry = month_entry(month, running=month == current)
        for measure in SERIES:
            recorded = measure.is_recorded(month.year, month.month)
            count = sum(
                1 for f in facts.dated(measure.key, D.VILLAGES, window)
                if belongs(f.province_fa, f.contractor, f.day)
            )
            entry[measure.key] = {"count": count if recorded else None, "recorded": recorded}
        entry["ict_role_average"] = _monthly_role_average(
            facts, D.ICT_APPROVED, window, month, scope.lens, ownership, peers
        )
        out.append(entry)
    return out


def _monthly_role_average(facts, measure, window, month, kind, ownership, peers):
    """The average owner's monthly count: everything credited to an owner of
    this kind that month, over how many such owners there are."""
    if not peers or not measure.is_recorded(month.year, month.month):
        return None
    credited = sum(
        1 for f in facts.dated(measure.key, D.VILLAGES, window)
        if ownership.owner(kind, f.province_fa, f.contractor, f.day) != UNATTRIBUTED
    )
    return round(credited / len(peers), 1)


# ----- Activity -------------------------------------------------------------


def _activity(acts: A.Activity, scope: kpi.Scope, months, today) -> dict:
    users = acts.users_for(scope.lens, scope.key)
    role_users = {uid for uid in acts.actors if acts.owner_of(scope.lens)(uid)}
    trend_months = last_months(today, TREND_MONTHS)
    span = Window(months[0].start, months[-1].end)

    trend = []
    for month in trend_months:
        recorded = month >= ShamsiMonth(*D.RECORDED_FROM)
        window = Window(month.start, month.end)
        trend.append(
            month_entry(
                month,
                recorded=recorded,
                filed=acts.count("filed", users, window) if recorded else None,
                validated=acts.count("validated", users, window) if recorded else None,
            )
        )

    times = []
    for measure, label in D.RESPONSE_TIMES.items():
        mine = acts.durations(measure, users, span)
        times.append(
            {
                "key": measure,
                "label": label,
                "median_days": A.median_days(mine),
                "pairs": len(mine),
                "low_sample": len(mine) < D.LOW_SAMPLE_PAIRS,
                "role_median_days": A.median_days(acts.durations(measure, role_users, span)),
            }
        )
    return {
        "accounts": len(users),
        "trend": trend,
        "totals": dict(Counter(a.kind for a in acts.acts if a.user_id in users and a.day in span)),
        "response_times": times,
    }
