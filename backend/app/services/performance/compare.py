"""The Compare tab: owners of one kind ranked against each other. PM and
Viewer only (:func:`kpi.require_compare`).

One kind at a time, never mixed. Low-sample owners are listed as "Not
compared", unranked and last. For the four rate measures:

* **since start** (``period=all``) ranks today's rate;
* **one month** ranks that month's events, credited by who owned the province
  at the time, as a share of the owner's base today.

**Speed** is a median response time (``activity.SPEED_MEASURE``): DT done to
first filing for contractors, filing to validation for coordinators. Fastest
first. Kinds that do not act in UEP have no speed and fall back to ICT.
"""
from __future__ import annotations

from collections import defaultdict

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
    low_sample,
    month_entry,
    peer_cells,
    rate_of,
    role_average,
)
from app.services.performance.month import parse_month
from app.services.performance.ownership import UNATTRIBUTED, Ownership
from app.services.performance.periods import ShamsiMonth, Window, last_months

KINDS = {
    "contractor": kpi.LENS_CONTRACTOR,
    "coordinator": kpi.LENS_COORDINATOR,
    "rm": kpi.LENS_RM,
    "province": kpi.LENS_PROVINCE,
    "region": kpi.LENS_REGION,
}
KIND_LABELS = {
    "contractor": "Contractors",
    "coordinator": "Coordinators",
    "rm": "Regional managers",
    "province": "Provinces",
    "region": "CRA regions",
}
PERIOD_ALL = "all"
SERIES_MONTHS = 6


def payload(db: Session, user: User, kind: str, measure: str, period: str) -> dict:
    kpi.require_compare(user)
    if kind not in KINDS:
        raise HTTPException(422, f"kind must be one of {', '.join(KINDS)}")
    lens = KINDS[kind]
    if measure == D.SPEED and lens not in A.SPEED_MEASURE:
        measure = "ict"
    if measure != D.SPEED and measure not in D.COMPARE_MEASURES:
        raise HTTPException(
            422, f"measure must be one of {', '.join([*D.COMPARE_MEASURES, D.SPEED])}"
        )
    month = _parse_period(period)
    today = jalali.tehran_today()

    facts = F.load(db)
    ownership = Ownership.load(db)
    cells = facts.cells()
    series_months = last_months(today, SERIES_MONTHS)

    if measure == D.SPEED:
        body = _speed(A.load(db), lens, month, series_months)
    else:
        body = _rates(facts, ownership, cells, lens, D.RATES[D.COMPARE_MEASURES[measure]],
                      month, series_months)
    return {
        "kind": kind,
        "measure": measure,
        "period": PERIOD_ALL if month is None else f"month:{month.key}",
        "period_month": None if month is None else month.as_dict(),
        "kinds": [
            {"key": k, "label": KIND_LABELS[k],
             "count": len(peer_cells(cells, KINDS[k], ownership)),
             "speed": KINDS[k] in A.SPEED_MEASURE}
            for k in KINDS
        ],
        "series_months": [m.as_dict() for m in series_months],
        "low_sample_threshold": D.LOW_SAMPLE_PAIRS if measure == D.SPEED else D.LOW_SAMPLE_DT_DONE,
        **body,
        "last_cpm_import": kpi.last_cpm_import(db),
    }


def _parse_period(period: str) -> ShamsiMonth | None:
    if not period or period == PERIOD_ALL:
        return None
    if not period.startswith("month:"):
        raise HTTPException(422, "period must be 'all' or 'month:YYYY-MM'")
    month = parse_month(period.removeprefix("month:"))
    if month > ShamsiMonth.of(jalali.tehran_today()):
        raise HTTPException(422, "That month has not started yet")
    return month


def _window(month: ShamsiMonth | None) -> Window | None:
    return None if month is None else Window(month.start, month.end)


def _rank(rows: list[dict], value_key: str, *, ascending: bool) -> list[dict]:
    """Compared owners by value (best first), then "Not compared", by name."""
    def order(row):
        value = row[value_key]
        missing = value is None
        signed = 0 if missing else (value if ascending else -value)
        return (row["low_sample"], missing, signed, row["name"].casefold())

    rows.sort(key=order)
    rank = 0
    for row in rows:
        if row["low_sample"] or row[value_key] is None:
            row["rank"] = None
        else:
            rank += 1
            row["rank"] = rank
    return rows


def _headline(rows: list[dict], value_key: str, national, average) -> dict:
    ranked = [r for r in rows if r["rank"] is not None]
    return {
        "national": national,
        "average": average,
        "highest": {"name": ranked[0]["name"], "value": ranked[0][value_key]} if ranked else None,
        "lowest": {"name": ranked[-1]["name"], "value": ranked[-1][value_key]} if ranked else None,
    }


# ----- Rates ----------------------------------------------------------------


def _credited(facts, ownership, lens, measure_key, window) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for f in facts.dated(measure_key, D.VILLAGES, window):
        out[ownership.owner(lens, f.province_fa, f.contractor, f.day)] += 1
    return out


def _rates(facts, ownership, cells, lens, rate: D.Rate, month, series_months) -> dict:
    peers = peer_cells(cells, lens, ownership)
    national_cell = F.total(cells.values())
    window = _window(month)
    recorded = month is None or rate.measure.is_recorded(month.year, month.month)
    in_month = _credited(facts, ownership, lens, rate.measure.key, window) if month else None
    series = {
        m: _credited(facts, ownership, lens, rate.measure.key, Window(m.start, m.end))
        for m in series_months
    }

    if month is None:
        national = rate_of(national_cell, rate)
    else:
        national = D.pct(sum(in_month.values()), getattr(national_cell, rate.base)) if recorded else None

    names = set(peers) | ({n for n in in_month if n != UNATTRIBUTED} if in_month else set())
    rows = []
    for name in names:
        cell = peers.get(name, F.Cell())
        base = getattr(cell, rate.base)
        if month is None:
            count, value = getattr(cell, rate.count), rate_of(cell, rate)
        else:
            count = in_month.get(name, 0) if recorded else None
            value = D.pct(count, base) if recorded else None
        rows.append(
            {
                "name": name,
                "label": kpi.province_label(name) if lens == kpi.LENS_PROVINCE else name,
                "rate": value,
                "count": count,
                "base": base,
                "delta": gap(value, national),
                "low_sample": low_sample(cell),
                "current": name in peers,
                "series": [
                    month_entry(
                        m,
                        count=series[m].get(name, 0)
                        if rate.measure.is_recorded(m.year, m.month) else None,
                        recorded=rate.measure.is_recorded(m.year, m.month),
                    )
                    for m in series_months
                ],
            }
        )
    _rank(rows, "rate", ascending=False)
    average = role_average(peers.values(), rate, weighted=is_weighted(lens)) if month is None \
        else _mean([r["rate"] for r in rows if r["rank"] is not None])
    return {
        "unit": "%",
        "lower_is_better": False,
        "rows": rows,
        "headline": _headline(rows, "rate", national, average),
        "recorded": recorded,
    }


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


# ----- Speed ----------------------------------------------------------------


def _speed(acts: A.Activity, lens: str, month, series_months) -> dict:
    measure = A.SPEED_MEASURE[lens]
    owner_of = acts.owner_of(lens)
    window = _window(month)
    recorded = month is None or month >= ShamsiMonth(*D.RECORDED_FROM)

    by_owner: dict[str, list[A.Timed]] = defaultdict(list)
    for t in acts.timed:
        if t.measure == measure and (name := owner_of(t.user_id)):
            by_owner[name].append(t)
    # Every acting owner is listed, even one with no timed pair yet.
    for uid in acts.actors:
        if name := owner_of(uid):
            by_owner.setdefault(name, [])

    def in_window(items, w):
        return [t.days for t in items if w is None or t.day in w]

    rows = []
    for name, items in by_owner.items():
        mine = in_window(items, window)
        value = A.median_days(mine)
        rows.append(
            {
                "name": name,
                "label": name,
                "rate": value,
                "count": len(mine),
                "base": None,
                "delta": None,
                "low_sample": len(mine) < D.LOW_SAMPLE_PAIRS,
                "current": True,
                "series": [
                    month_entry(
                        m,
                        median_days=A.median_days(in_window(items, Window(m.start, m.end))),
                        count=len(in_window(items, Window(m.start, m.end))),
                        recorded=m >= ShamsiMonth(*D.RECORDED_FROM),
                    )
                    for m in series_months
                ],
            }
        )
    national = A.median_days(acts.durations(measure, None, window))
    for row in rows:
        row["delta"] = gap(row["rate"], national)
    _rank(rows, "rate", ascending=True)
    ranked = {r["name"] for r in rows if r["rank"] is not None}
    compared = [d for name in ranked for d in in_window(by_owner[name], window)]
    return {
        "unit": "days",
        "lower_is_better": True,
        "speed_measure": measure,
        "speed_label": D.RESPONSE_TIMES[measure],
        "rows": rows,
        "headline": _headline(rows, "rate", national, A.median_days(compared)),
        "recorded": recorded,
    }
