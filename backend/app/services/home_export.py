"""Home's lists as Excel files (UEP-27 "Export to Excel").

``home_items`` decides *which* rows; this module only writes them, in
openpyxl's write-only mode, into a spooled temporary file (the
``gap_export`` pattern). Every cell goes through ``cell_value`` (no illegal
control characters) and ``formula_safe`` (no formula injection).

* a queue's list: the listed columns, one sheet per group when grouped;
* a summary panel: one row per line (queue, contractor, or finished act);
* every file ends with an **About** sheet saying what the list is, with which
  filter, when and by whom -- a list with no statement of what it is is the
  file that gets misread a week later.
"""
from __future__ import annotations

import re
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from app.core import jalali
from app.core.config import get_settings
from app.core.spreadsheet import formula_safe
from app.services.dt_site_export import cell_value

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_SPOOL_BYTES = 8 * 1024 * 1024
_BOLD = Font(bold=True)

STATUS_LABELS = {
    "late": "Late", "due_soon": "Due in 1 week", "on_time": "On time", "no_date": "No date",
}

#: (header, row key, width) -- the columns of a queue's list (UEP-27 §4.5).
ITEM_COLUMNS: list[tuple[str, str, int]] = [
    ("ID", "label", 16),
    ("Village name", "village_name", 26),
    ("Site ID", "site_id", 14),
    ("Province", "province", 18),
    ("CRA region", "cra_region", 16),
    ("Holder", "holder_name", 22),
    ("Status", "status_label", 14),
    ("Days waiting", "age_days", 12),
    ("SLA days", "sla_days", 10),
    ("Due date", "due_date", 12),
    ("Link", "link", 40),
]

#: Excel refuses these in a sheet name, and names over 31 characters.
_SHEET_BAD = re.compile(r"[\[\]:*?/\\]")
_SHEET_MAX = 31


@dataclass(frozen=True)
class Sheet:
    title: str
    columns: Sequence[tuple[str, str, int]]
    rows: list[dict]


@dataclass(frozen=True)
class About:
    """What the About sheet says."""

    title: str
    filter_text: str
    exported_by: str
    exported_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def _gregorian(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        value = value.astimezone(jalali.TEHRAN).date()
    return value.strftime("%d-%b-%Y")


def item_cells(row: dict) -> dict:
    """A list row with the export's derived columns."""
    base = get_settings().app_base_url.rstrip("/")
    return {
        **row,
        "status_label": STATUS_LABELS.get(row["status"], row["status"]),
        "due_date": _gregorian(row.get("due_at")),
        "link": f"{base}{row['url']}",
    }


def sheet_name(title: str, taken: set[str]) -> str:
    """A legal, unique sheet name."""
    base = (_SHEET_BAD.sub(" ", title).strip() or "Sheet")[:_SHEET_MAX]
    name, n = base, 2
    while name.casefold() in taken:
        suffix = f" ({n})"
        name = base[: _SHEET_MAX - len(suffix)] + suffix
        n += 1
    taken.add(name.casefold())
    return name


def _cell(value):
    return formula_safe(cell_value(value))


def _header(ws, title: str) -> WriteOnlyCell:
    cell = WriteOnlyCell(ws, value=title)
    cell.font = _BOLD
    return cell


def _write_sheet(ws, sheet: Sheet) -> None:
    ws.freeze_panes = "A2"
    for i, (_, _, width) in enumerate(sheet.columns, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.append([_header(ws, title) for title, _, _ in sheet.columns])
    for row in sheet.rows:
        ws.append([_cell(row.get(key)) for _, key, _ in sheet.columns])
    ws.auto_filter.ref = f"A1:{get_column_letter(len(sheet.columns))}{len(sheet.rows) + 1}"


def _write_about(ws, about: About, rows: int) -> None:
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 60
    for label, value in (
        ("List", about.title),
        ("Filter", about.filter_text or "None"),
        ("Rows", rows),
        ("Exported", about.exported_at.astimezone(timezone.utc).strftime("%d-%b-%Y %H:%M UTC")),
        ("Exported by", about.exported_by),
    ):
        ws.append([_header(ws, label), _cell(value)])


def build(sheets: list[Sheet], about: About) -> tempfile.SpooledTemporaryFile:
    """The workbook, rewound. The caller closes it."""
    wb = Workbook(write_only=True)
    taken: set[str] = {"about"}
    for sheet in sheets or [Sheet("List", ITEM_COLUMNS, [])]:
        _write_sheet(wb.create_sheet(sheet_name(sheet.title, taken)), sheet)
    _write_about(wb.create_sheet("About"), about, sum(len(s.rows) for s in sheets))
    target = tempfile.SpooledTemporaryFile(max_size=_SPOOL_BYTES)
    wb.save(target)
    target.seek(0)
    return target


def filename(title: str, on: date | None = None) -> str:
    """``UEP_DT-assignment_26-Nov-2026.xlsx``: ASCII only, safe in a header."""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-") or "List"
    return f"UEP_{slug}_{(on or jalali.tehran_today()).strftime('%d-%b-%Y')}.xlsx"


# --------------------------------------------------------------------------
# Summary panels: one row per line
# --------------------------------------------------------------------------
SUMMARY_COLUMNS = [
    ("Queue", "short_label", 26), ("Unit", "unit", 10), ("Count", "count", 10),
    ("Late", "late", 8), ("Due in 1 week", "due_soon", 14), ("On time", "on_time", 10),
    ("No date", "no_date", 10),
]
DONE_COLUMNS = [
    ("Date", "date", 14), ("Action", "action", 28), ("Item", "label", 18), ("Province", "province", 18),
]
PIP_COLUMNS = [("Contractor", "contractor", 28), ("Delivered", "delivered", 12), ("Target", "target", 12)]


def done_cells(row: dict) -> dict:
    return {**row, "date": _gregorian(row["closed_at"])}
