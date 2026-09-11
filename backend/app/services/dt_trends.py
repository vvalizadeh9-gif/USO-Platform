"""Trailing-month series for the Drive Test dashboard.

Every figure this returns is already in the database. ``snapshots.py`` has
been writing a per-Shamsi-month row — balances at both ends of the month and
the four flows between them — since movement capture was added, and its own
docstring notes the movement columns exist "for a figure nothing displays
yet". This module is that figure. It reads; it never writes.

WHY A SERIES AT ALL. The dashboard's other numbers are all instantaneous: a
balance, and one scalar delta against last month. That answers "where are we"
and cannot answer "which way is this going" — whether problematic sites are
accumulating or clearing, whether the remaining backlog is bending, whether
this month is normal. Two months cannot show a trend; twelve can.

THREE HONESTY RULES, because the underlying capture is opportunistic rather
than scheduled and a chart that hides that would overstate what is known:

* **A month nobody signed in during was never captured.** It is returned as a
  point with ``captured=False`` and no figures, not silently skipped and not
  interpolated. The line is meant to break there.
* **A month whose row predates movement capture** has no ``closing_*``
  balance. Its ``total_*`` reading was taken when the row was created — near
  the *start* of that month — so it is returned with ``estimated=True``
  rather than presented as a closing balance it is not.
* **The current month has not closed.** Its balances are the last reading
  taken, and its flows are provisional. It carries ``is_open=True`` so the
  final point can be drawn as still moving.

SCOPE. Same rule the delta chips use (see ``api/drive_test._previous_totals``):
a user who sees everything reads the global snapshot; a user scoped to some
provinces reads the sum of those provinces' rows, never the national one.
Summing province rows is valid for every column here — balances and flows are
both counts of sites.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance import MonthlySnapshot

#: How many months the dashboard asks for by default.
#:
#: Twelve is one Shamsi year: it puts the same month a year ago at the far end
#: of the axis, which is the comparison a programme review actually makes, and
#: it is short enough that a month is still a readable unit on the chart.
DEFAULT_MONTHS = 12

#: The balance columns, in the order the dashboard reads them.
_BALANCES = ("onair", "dt_done", "remaining", "ongoing", "problematic")

#: The flow columns. ``flow_ongoing_adjustment`` is deliberately not here: it
#: is a reconciliation residual, not something that happened to a site, and
#: charting it beside real movements would give it a meaning it does not have.
#: It stays available on the row for anyone reconciling by hand.
_FLOWS = (
    "new_onair",
    "dt_completed",
    "newly_problematic",
    "problematic_resolved",
)


def _period_window(months: int) -> list[tuple[int, int]]:
    """The last ``months`` Shamsi periods, oldest first, ending on the current.

    Built by walking back from the current period rather than by arithmetic on
    month numbers, so the year boundary is handled by the one function that
    already knows how — and a caller cannot land on month 0 or month 13.
    """
    year, month = jalali.current_shamsi_period()
    periods = [(year, month)]
    for _ in range(months - 1):
        year, month = jalali.previous_period(year, month)
        periods.insert(0, (year, month))
    return periods


def _rows_for(
    db: Session, periods: list[tuple[int, int]], province_ids: list[int] | None
) -> dict[tuple[int, int], list[MonthlySnapshot]]:
    """Every snapshot row in the window, bucketed by period.

    One query for the whole window rather than one per month. ``province_ids``
    of ``None`` means the global row; a list means those provinces' rows,
    which the caller sums.
    """
    if not periods:
        return {}
    years = {y for y, _ in periods}
    stmt = select(MonthlySnapshot).where(MonthlySnapshot.shamsi_year.in_(years))
    if province_ids is None:
        stmt = stmt.where(MonthlySnapshot.province_id.is_(None))
    else:
        stmt = stmt.where(MonthlySnapshot.province_id.in_(province_ids))

    wanted = set(periods)
    buckets: dict[tuple[int, int], list[MonthlySnapshot]] = {}
    for row in db.execute(stmt).scalars().all():
        key = (row.shamsi_year, row.shamsi_month)
        if key in wanted:
            buckets.setdefault(key, []).append(row)
    return buckets


def _balance(rows: list[MonthlySnapshot], prefix: str, key: str) -> int | None:
    """Sum one balance column across rows, or ``None`` if any row lacks it.

    All-or-nothing on purpose. A partial sum — three provinces carrying a
    closing balance and one carrying NULL — is not a smaller number, it is a
    wrong one, and it would be indistinguishable from a real dip on the chart.
    """
    total = 0
    for row in rows:
        value = getattr(row, f"{prefix}_{key}")
        if value is None:
            return None
        total += value
    return total


def _balances(rows: list[MonthlySnapshot]) -> tuple[dict[str, int], bool]:
    """The month's closing balances, and whether they had to be estimated.

    Prefers ``closing_*``, which is a reading taken at the end of the month.
    Falls back to ``total_*`` — taken when the row was created, near the start
    of the month — for rows written before movement capture existed. The
    second return value says which happened, so the caller can mark the point
    rather than pass an opening balance off as a closing one.
    """
    closing = {key: _balance(rows, "closing", key) for key in _BALANCES}
    if all(value is not None for value in closing.values()):
        return closing, False
    return {key: sum(getattr(r, f"total_{key}") for r in rows) for key in _BALANCES}, True


def _flows(rows: list[MonthlySnapshot]) -> dict[str, int] | None:
    """The month's flows, or ``None`` when the month has none recorded.

    ``None`` rather than zeros: a month that predates movement capture did not
    have a quiet month, it has no ledger at all, and zeros would draw one.
    """
    flows: dict[str, int] = {}
    for key in _FLOWS:
        total = 0
        for row in rows:
            value = getattr(row, f"flow_{key}")
            if value is None:
                return None
            total += value
        flows[key] = total
    return flows


def month_series(
    db: Session,
    province_ids: list[int] | None,
    months: int = DEFAULT_MONTHS,
) -> list[dict]:
    """The trailing ``months`` Shamsi periods, oldest first.

    Always returns exactly ``months`` entries — one per period in the window,
    captured or not — so the caller renders a continuous time axis and the
    gaps stay visible as gaps. An uncaptured period carries ``captured=False``
    and nothing else; drawing it as a zero would invent a collapse.

    ``province_ids`` of ``None`` reads the global snapshot. An empty list is a
    user scoped to no provinces at all: every period comes back uncaptured,
    which is the honest answer for someone who can see nothing.
    """
    periods = _period_window(months)
    buckets = _rows_for(db, periods, province_ids) if province_ids != [] else {}
    current = jalali.current_shamsi_period()

    series: list[dict] = []
    for year, month in periods:
        point = {
            "shamsi_year": year,
            "shamsi_month": month,
            "label": jalali.month_name(month),
            "is_open": (year, month) == current,
            "captured": False,
            "estimated": False,
            "flows": None,
            # Seeded as None rather than left out, so every point has the same
            # keys whether or not it was captured. A caller reading
            # ``point["remaining"]`` then gets "not known" instead of a
            # KeyError, which is the answer an uncaptured month actually has.
            **{key: None for key in _BALANCES},
        }
        rows = buckets.get((year, month))
        if rows:
            balances, estimated = _balances(rows)
            point.update(balances)
            point["captured"] = True
            point["estimated"] = estimated
            point["flows"] = _flows(rows)
        series.append(point)
    return series


def latest_flows(series: list[dict]) -> dict | None:
    """The most recent month that has a ledger, with its opening balances.

    The flow view answers "what moved this month", and the current month is
    usually the one worth reading — but it is also the one most likely to be
    part-way through or, in a fresh deployment, to have no ledger yet. Walking
    back to the newest month that does have one means the section shows a real
    ledger or none at all, never an empty frame.

    The opening balance is reconstructed as ``closing - net flows`` rather
    than read from ``opening_*``: it is then guaranteed to be the number the
    ledger below it actually starts from, which is the property a waterfall
    has to have to be worth drawing.
    """
    for point in reversed(series):
        flows = point.get("flows")
        if not point.get("captured") or not flows:
            continue
        completed = flows["dt_completed"]
        arrived = flows["new_onair"]
        return {
            "shamsi_year": point["shamsi_year"],
            "shamsi_month": point["shamsi_month"],
            "label": point["label"],
            "is_open": point["is_open"],
            "opening_remaining": point["remaining"] - arrived + completed,
            "closing_remaining": point["remaining"],
            "new_onair": arrived,
            "dt_completed": completed,
            "newly_problematic": flows["newly_problematic"],
            "problematic_resolved": flows["problematic_resolved"],
        }
    return None
