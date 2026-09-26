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


def write_contractor_sheet(ws, months: list[dict]) -> None:
    """One row per contractor per month, header included, on *ws*.

    Lifted out of :func:`scorecard_workbook` unchanged so the DT delivery
    workbook can carry the same ledger sheet without a second copy of these
    columns. Two exports whose ledgers are written by different code are two
    exports that will one day disagree about a column.
    """
    _header(ws, CONTRACTOR_COLUMNS)
    r = 2
    for month in months:
        label = f"{month['shamsi_month_name']} {month['shamsi_year']}"
        for row in month["rows"]:
            _write_row(ws, r, [label, row["name"] or _DASH], row)
            r += 1


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

    write_contractor_sheet(wb.create_sheet("Contractors"), months)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# The Monthly Plan export: both streams, for the period on the page
# ---------------------------------------------------------------------------
_MONTH_TOTAL_FILL = PatternFill("solid", fgColor="EEF1F6")
_INTERNAL_FONT = Font(italic=True, color="1F5E8C")

PLAN_COLUMNS_DT = [
    ("Contractor", 26),
    ("Shamsi month", 16),
    ("Assignment", 12),
    ("PIP", 9),
    ("Revisions", 10),
    ("Delivered", 11),
    ("+/−", 8),
    ("Achievement %", 14),
]
#: Acceptance has no Assignment (and no Available): the same shape without it.
PLAN_COLUMNS_ACCEPTANCE = [c for c in PLAN_COLUMNS_DT if c[0] != "Assignment"]


def _pct(delivered: int, pip: int | None):
    """Period % is total Delivered / total PIP; a dash where there is no PIP."""
    return round(delivered / pip * 100, 1) if pip else _DASH


def _plan_sheet(
    ws,
    months: list[dict],
    *,
    has_assignment: bool,
    revisions: dict[tuple[int, int, int], int],
    internal: dict[tuple[int, int], int | None] | None,
) -> None:
    """One stream's sheet: a row per contractor per month, a total per month,
    the MTN internal PIP per month (staff only), and a grand total."""
    columns = PLAN_COLUMNS_DT if has_assignment else PLAN_COLUMNS_ACCEPTANCE
    _header(ws, columns)

    def _write(r, values, font=None, fill=None, pct=None):
        for i, value in enumerate(values, start=1):
            cell = ws.cell(row=r, column=i, value=_DASH if value is None else value)
            if font is not None:
                cell.font = font
            if fill is not None:
                cell.fill = fill
        band = _band(pct if isinstance(pct, (int, float)) else None)
        if band is not None:
            ws.cell(row=r, column=len(values)).fill = band

    def _values(name, label, assignment, pip, revs, delivered):
        diff = delivered - pip if pip is not None else None
        pct = _pct(delivered, pip)
        lead = [name, label]
        if has_assignment:
            lead.append(assignment)
        return lead + [pip, revs, delivered, diff, pct], pct

    r = 2
    grand_pip: list[int] = []
    grand_delivered = 0
    for month in months:
        y, m = month["shamsi_year"], month["shamsi_month"]
        label = f"{month['shamsi_month_name']} {y}"
        for row in month["rows"]:
            values, pct = _values(
                row["name"] or _DASH,
                label,
                row.get("available"),
                row["pip"],
                revisions.get((row["contractor_id"], y, m), 0),
                row["delivered"],
            )
            _write(r, values, pct=pct)
            r += 1

        month_pip = sum(row["pip"] or 0 for row in month["rows"]) if any(
            row["pip"] is not None for row in month["rows"]
        ) else None
        month_delivered = sum(row["delivered"] for row in month["rows"])
        values, _ = _values(
            f"Total — {label}",
            label,
            month.get("available"),
            month_pip,
            sum(revisions.get((row["contractor_id"], y, m), 0) for row in month["rows"]),
            month_delivered,
        )
        _write(r, values, font=_TOTAL, fill=_MONTH_TOTAL_FILL)
        r += 1
        if month_pip is not None:
            grand_pip.append(month_pip)
        grand_delivered += month_delivered

        if internal is not None:
            target = internal.get((y, m))
            lead = ["MTN internal PIP", label] + ([None] if has_assignment else [])
            _write(r, lead + [target, None, None, None, None], font=_INTERNAL_FONT)
            r += 1

    total_pip = sum(grand_pip) if grand_pip else None
    assignment = None
    if has_assignment and months:
        # Held over the period: the opening balance plus everything newly
        # assigned. A sum of monthly balances would count a site once per month.
        assignment = months[0].get("carried_in", 0) + sum(
            mo.get("newly_assigned", 0) for mo in months
        )
    values, _ = _values(
        "Grand total",
        f"{months[0]['shamsi_month_name']} {months[0]['shamsi_year']} – "
        f"{months[-1]['shamsi_month_name']} {months[-1]['shamsi_year']}" if months else "",
        assignment,
        total_pip,
        sum(revisions.values()),
        grand_delivered,
    )
    _write(r, values, font=_TOTAL)
    ws.cell(
        row=r + 2,
        column=1,
        value=(
            "Achievement % = Delivered ÷ PIP. Over several months it is total "
            "Delivered ÷ total PIP, never an average of monthly percentages. "
            "A dash means there was no approved PIP to measure against."
        ),
    ).font = _NOTE


def plan_workbook(
    dt: dict,
    acceptance: dict,
    *,
    revisions: dict[str, dict[tuple[int, int, int], int]],
    internal: dict[str, dict[tuple[int, int], int | None]] | None,
) -> bytes:
    """The Monthly Plan export: a "DT Delivery" and an "Acceptance" sheet.

    ``dt`` and ``acceptance`` are the two scorecards for the period, already
    scoped to the caller. ``revisions`` counts revisions per stream, keyed by
    (contractor, year, month). ``internal`` is MTN's internal PIP per stream
    and month, or None -- and it must be None for a contractor, who never
    sees MTN's target.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "DT Delivery"
    _plan_sheet(
        ws, dt["months"], has_assignment=True,
        revisions=revisions.get("DT", {}),
        internal=internal.get("DT") if internal is not None else None,
    )
    _plan_sheet(
        wb.create_sheet("Acceptance"), acceptance["months"], has_assignment=False,
        revisions=revisions.get("ACCEPTANCE", {}),
        internal=internal.get("ACCEPTANCE") if internal is not None else None,
    )
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
