"""Roles Performance workbooks, built from the payload the screen receives.

Never from a second query: a number in the file cannot differ from the one on
screen, and the main sheet has one row per row the screen shows (the tests
compare the counts). Written in openpyxl's write-only mode into a spooled
file, so a large one is streamed exactly as the Lifecycle Gaps exports are.
"""
from __future__ import annotations

import re
import tempfile
from collections.abc import Iterable
from datetime import date

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font

from app.core import jalali
from app.services.gap_export import BuiltWorkbook

_BOLD = Font(bold=True)
_SPOOL_BYTES = 8 * 1024 * 1024

Sheet = tuple[str, list[str], Iterable[list]]


def _write(sheets: list[Sheet]) -> BuiltWorkbook:
    """Write the sheets; ``rows`` is the first (main) sheet's row count."""
    wb = Workbook(write_only=True)
    main_rows = None
    for title, header, rows in sheets:
        ws = wb.create_sheet(title)
        ws.freeze_panes = "A2"
        ws.append([_bold(ws, h) for h in header])
        count = 0
        for row in rows:
            ws.append(row)
            count += 1
        if main_rows is None:
            main_rows = count
    target = tempfile.SpooledTemporaryFile(max_size=_SPOOL_BYTES)
    wb.save(target)
    target.seek(0)
    return BuiltWorkbook(file=target, rows=main_rows or 0)


def _bold(ws, value) -> WriteOnlyCell:
    cell = WriteOnlyCell(ws, value=value)
    cell.font = _BOLD
    return cell


def _about(lines: list[tuple[str, object]]) -> Sheet:
    exported = jalali.format_shamsi(jalali.tehran_today())
    return ("About", ["Field", "Value"], [[k, v] for k, v in [*lines, ("Exported", exported)]])


def filename(tab: str, label: str, *, on: date | None = None) -> str:
    """``uep-roles-month-whole-country-1405-07-10.xlsx``: ASCII only."""
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "scope"
    day = jalali.format_shamsi(on or jalali.tehran_today()).replace("/", "-")
    return f"uep-roles-{tab}-{slug}-{day}.xlsx"


# ----- One builder per tab --------------------------------------------------


def month(payload: dict) -> BuiltWorkbook:
    by_owner = payload["by"] != "all"
    figures = ["This month", "Last month (same day)", "Change"]
    if by_owner:
        header = ["Section", "Measure", "Owner", *figures]
    else:
        header = ["Section", "Measure", "Unit", *figures,
                  "Villages this month", "Villages last month", "Villages change"]

    def rows():
        for section in payload["sections"]:
            for row in section["rows"]:
                if by_owner:
                    for owner in row["owners"] or []:
                        yield [section["title"], row["label"], owner["name"],
                               owner["now"], owner["ref"], owner["delta"]]
                    continue
                v = row["villages"] or {}
                yield [section["title"], row["label"], row["unit"],
                       row["now"], row["ref"], row["delta"],
                       v.get("now"), v.get("ref"), v.get("delta")]

    m = payload["month"]
    return _write([
        ("Month", header, rows()),
        _about([
            ("Month", f"{m['year']}-{m['month']:02d}"),
            ("Compared with", f"{payload['ref_month']['year']}-{payload['ref_month']['month']:02d}"),
            ("Cut at day", payload["day"] or "whole month"),
            ("View", payload["by"]),
            ("Empty cells", "Not recorded (before Mehr 1405)"),
        ]),
    ])


def area(payload: dict) -> BuiltWorkbook:
    header = ["Name", "Villages", "DT done", "On air, no DT", "Not on air",
              "ICT %", "ICT approved", "CRA %", "CRA approved", "Remaining", "Compared"]
    rows = (
        [r["name"], r["villages"], r["dt_done"], r["on_air_only"], r["not_on_air"],
         r["ict"]["rate"], r["ict"]["count"], r["cra"]["rate"], r["cra"]["count"],
         r["remaining"], "Not compared" if r["low_sample"] else "Yes"]
        for r in payload["rows"]
    )
    cards = (
        [c["label"], c["count"], c["rate"], c["base"], c["base_label"], c["national_rate"]]
        for c in payload["cards"]
    )
    return _write([
        ("Breakdown", header, rows),
        ("Headline", ["Figure", "Count", "Rate %", "Base", "Base is", "National %"], cards),
        _about([("Scope", payload["scope"]["label"]), ("Breakdown", payload["breakdown"]),
                ("As of", "today")]),
    ])


def performance(payload: dict) -> BuiltWorkbook:
    def count(entry, key):
        return entry[key]["count"]

    series = (
        [f"{m['year']}-{m['month']:02d}", count(m, "dt_done"), count(m, "ict_approved"),
         count(m, "cra_approved"), m["ict_role_average"]]
        for m in (payload["results"] or {}).get("series", [])
    )
    sheets: list[Sheet] = [
        ("Delivered", ["Month", "DT done", "ICT approved", "CRA approved", "ICT role average"],
         series),
    ]
    if payload["results"]:
        sheets.append((
            "Results",
            ["Measure", "Rate %", "Count", "Base", "This month", "National %", "Gap",
             "Role average %", "Gap to role"],
            ([t["label"], t["rate"], t["count"], t["base"], t["movement"], t["national_rate"],
              t["national_gap"], t["role_average"], t["role_gap"]]
             for t in payload["results"]["tiles"]),
        ))
    if payload["activity"]:
        sheets.append((
            "Response times",
            ["Measure", "Median days", "Pairs", "Role median days"],
            ([t["label"], t["median_days"], t["pairs"], t["role_median_days"]]
             for t in payload["activity"]["response_times"]),
        ))
        sheets.append((
            "Activity",
            ["Month", "Filed", "Validated"],
            ([f"{m['year']}-{m['month']:02d}", m["filed"], m["validated"]]
             for m in payload["activity"]["trend"]),
        ))
    sheets.append(_about([("Scope", payload["scope"]["label"])]))
    return _write(sheets)


def compare(payload: dict) -> BuiltWorkbook:
    unit = payload["unit"]
    value = "Median days" if unit == "days" else "Rate %"
    months = [f"{m['year']}-{m['month']:02d}" for m in payload["series_months"]]
    header = ["Rank", "Name", value, "Count", "Delta vs national", "Compared", *months]

    def series_value(entry):
        return entry.get("median_days") if unit == "days" else entry.get("count")

    rows = (
        [r["rank"], r["label"], r["rate"], r["count"], r["delta"],
         "Not compared" if r["low_sample"] else "Yes",
         *(series_value(e) for e in r["series"])]
        for r in payload["rows"]
    )
    head = payload["headline"]
    return _write([
        ("Ranking", header, rows),
        _about([
            ("Kind", payload["kind"]),
            ("Measure", payload["measure"]),
            ("Period", payload["period"]),
            ("National", head["national"]),
            ("Average", head["average"]),
        ]),
    ])
