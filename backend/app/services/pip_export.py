"""The PIP scorecard as a workbook.

Built from the same payload the screen renders, passed in rather than
recomputed here, so the file and the page cannot disagree about a number. The
scoping that decided which contractors are in that payload has already
happened; nothing in this module widens it.

Two sheets, because they answer different questions:

``Summary``     one row per month, the programme total. What a PM prints.
``Contractors`` one row per contractor per month. What anyone reconciling a
                particular company's month needs.

The full ledger is written out on both -- carried in, newly assigned,
available, delivered, released, carried out -- even though the screen folds
the middle three into one column. A spreadsheet has the width, and these are
exactly the columns that let a reader check the balances close for themselves.

The total row totals only the flows. ``carried_in``, ``available`` and
``carried_out`` are balances: a site open for three months appears in three
months' worth of them, and a column sum would count it three times. Those
cells carry an em dash and a note says why, because a blank invites somebody
to fill it in with ``=SUM()``.
"""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

#: Matches the platform's own three achievement bands (services/… and the
#: dashboard's ``bandColor``): at or above target, close to it, short of it.
_GREEN = PatternFill("solid", fgColor="D6EFE2")
_AMBER = PatternFill("solid", fgColor="FBECD2")
_RED = PatternFill("solid", fgColor="F8DADA")

_HEAD = Font(bold=True, color="FFFFFF")
_HEAD_FILL = PatternFill("solid", fgColor="0B8477")
_TOTAL = Font(bold=True)
_NOTE = Font(italic=True, size=9, color="55637A")

#: A balance, which must never be summed down the page.
_DASH = "—"

SUMMARY_COLUMNS = [
    ("Month", 18),
    ("PIP", 9),
    ("Carried in", 11),
    ("Newly assigned", 15),
    ("Available", 11),
    ("Delivered", 11),
    ("Released", 10),
    ("Carried out", 12),
    ("Achievement %", 14),
    ("Coverage %", 12),
    ("Execution %", 12),
]

CONTRACTOR_COLUMNS = [("Month", 18), ("Subcontractor", 24)] + SUMMARY_COLUMNS[1:]


def _band(percent: float | None) -> PatternFill | None:
    if percent is None:
        return None
    if percent >= 100:
        return _GREEN
    if percent >= 80:
        return _AMBER
    return _RED


def _header(ws, columns) -> None:
    for i, (title, width) in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=i, value=title)
        cell.font = _HEAD
        cell.fill = _HEAD_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"


def _figures(source: dict) -> list:
    """The eleven columns of one row, in header order."""
    return [
        source["pip"],
        source["carried_in"],
        source["newly_assigned"],
        source["available"],
        source["delivered"],
        source["released"],
        source["carried_out"],
        source["achievement_percent"],
        source["coverage_percent"],
        source["execution_percent"],
    ]


def _write_row(ws, row: int, leading: list, source: dict) -> None:
    values = leading + _figures(source)
    for i, value in enumerate(values, start=1):
        # A None percentage is "there was no plan to measure against", which is
        # not zero. It is written as a dash for the same reason the screen
        # renders one.
        ws.cell(row=row, column=i, value=_DASH if value is None else value)
    fill = _band(source["achievement_percent"])
    if fill is not None:
        ws.cell(row=row, column=len(leading) + 8).fill = fill


def scorecard_workbook(data: dict) -> bytes:
    """The scorecard payload as .xlsx bytes."""
    wb = Workbook()

    summary = wb.active
    summary.title = "Summary"
    _header(summary, SUMMARY_COLUMNS)

    months = data["months"]
    for r, month in enumerate(months, start=2):
        _write_row(
            summary,
            r,
            [f"{month['shamsi_month_name']} {month['shamsi_year']}"],
            month,
        )

    total_row = len(months) + 2
    pip = sum(m["pip"] for m in months)
    delivered = sum(m["delivered"] for m in months)
    summary.cell(row=total_row, column=1, value="Total").font = _TOTAL
    totals = [
        pip,
        _DASH,
        sum(m["newly_assigned"] for m in months),
        _DASH,
        delivered,
        sum(m["released"] for m in months),
        _DASH,
        round(delivered / pip * 100, 1) if pip else _DASH,
        _DASH,
        _DASH,
    ]
    for i, value in enumerate(totals, start=2):
        cell = summary.cell(row=total_row, column=i, value=value)
        cell.font = _TOTAL

    summary.cell(
        row=total_row + 2,
        column=1,
        value=(
            "Carried in, Available and Carried out are balances, not flows: a site "
            "open for three months appears in all three. Summing them down this "
            "column would count that site three times, so they are left as —."
        ),
    ).font = _NOTE
    summary.cell(
        row=total_row + 3,
        column=1,
        value=(
            "Available = Carried in + Newly assigned. "
            "Carried in + Newly assigned − Delivered − Released = Carried out, "
            "and each month's Carried out is the next month's Carried in."
        ),
    ).font = _NOTE

    detail = wb.create_sheet("Contractors")
    _header(detail, CONTRACTOR_COLUMNS)
    r = 2
    for month in months:
        label = f"{month['shamsi_month_name']} {month['shamsi_year']}"
        for row in month["rows"]:
            _write_row(detail, r, [label, row["name"] or _DASH], row)
            r += 1

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
