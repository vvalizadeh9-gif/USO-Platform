"""Reading a filled template: columns by header name, cells as text, dates.

A file is refused as a whole only when it cannot be a template at all (not a
workbook, or a key column missing). Everything else is a per-row problem,
reported by ``validate``.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from openpyxl import load_workbook

from app.core import jalali
from app.core.digits import to_latin

from . import columns as C


class FileRefused(ValueError):
    """The whole file cannot be read; the message says what to fix."""


@dataclass
class RawRow:
    row_no: int
    #: column key -> cell value as text ('' when blank), dates still raw.
    cells: dict[str, object] = field(default_factory=dict)

    def text(self, key: str) -> str:
        return as_text(self.cells.get(key))


@dataclass
class ReadResult:
    rows: list[RawRow]
    unknown_headers: list[str]
    present: set[str]


_INTEGRAL = re.compile(r"^-?\d+\.0+$")


def as_text(value: object) -> str:
    """A cell as the text a person typed: trimmed, ``900000.0`` -> ``900000``."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = " ".join(str(value).split())
    if _INTEGRAL.match(text):
        text = text.split(".", 1)[0]
    return text


def _sheet(workbook):
    if "Data" in workbook.sheetnames:
        return workbook["Data"]
    for ws in workbook.worksheets:
        if ws.sheet_state == "visible" and ws.title not in ("How to fill", "Lists"):
            return ws
    return workbook.worksheets[0]


def read(content: bytes) -> ReadResult:
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 -- any parse failure is "not a workbook"
        raise FileRefused(
            "That file could not be read as an Excel workbook. Download the template "
            "from UEP, fill it in Excel and upload the .xlsx file."
        ) from None
    try:
        sheet = _sheet(workbook)
        rows = sheet.iter_rows(values_only=True)
        header = next(rows, None)
        if header is None:
            raise FileRefused("The file is empty. Download the template from UEP and fill it in.")
        positions: dict[str, int] = {}
        unknown: list[str] = []
        for index, title in enumerate(header):
            name = C.normalize_header(title)
            if not name:
                continue
            key = C.HEADER_INDEX.get(name)
            if key is None:
                unknown.append(str(title).strip())
            elif key not in positions:
                positions[key] = index
        missing = [C.label(k) for k in C.KEY_COLUMNS if k not in positions]
        if missing:
            raise FileRefused(
                f"Column {', '.join(missing)} is missing. Site ID, Site type and Village "
                "code are required; download a fresh template from UEP."
            )

        out: list[RawRow] = []
        for number, values in enumerate(rows, start=2):
            if values is None or all(v is None or str(v).strip() == "" for v in values):
                continue
            cells = {
                key: (values[pos] if pos < len(values) else None)
                for key, pos in positions.items()
            }
            out.append(RawRow(number, cells))
        return ReadResult(out, unknown, set(positions))
    finally:
        workbook.close()


# --------------------------------------------------------------------------
# Dates
# --------------------------------------------------------------------------
class BadDate(ValueError):
    pass


_EXCEL_EPOCH = date(1899, 12, 30)


def parse_date(value: object, today: date) -> date | None:
    """A date cell: a real Excel date, ``yyyy-mm-dd`` (Gregorian) or
    ``yyyy/mm/dd`` with a year below 1500 (Shamsi). Never in the future."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, datetime):
        day = value.date()
    elif isinstance(value, date):
        day = value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        # A date typed into a cell formatted as a number: Excel's serial.
        if not 20000 <= float(value) <= 80000:
            raise BadDate(f"{as_text(value)} is not a date")
        day = _EXCEL_EPOCH + timedelta(days=int(value))
    else:
        day = _parse_text(to_latin(str(value)).strip())
    if day > today:
        raise BadDate(f"{day.isoformat()} is in the future")
    return day


def _parse_text(text: str) -> date:
    text = text.split(" ")[0].split("T")[0]
    parts = re.split(r"[-/.]", text)
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise BadDate(f"{text} is not a date (use 2026-10-15 or 1405/07/23)")
    year, month, day = (int(p) for p in parts)
    try:
        if year < 1500:
            return jalali.from_shamsi_date(year, month, day)
        return date(year, month, day)
    except ValueError:
        raise BadDate(f"{text} is not a real date") from None
