"""The template UEP hands out: one sheet, one row per village, keys as text.

Generated at download time so the keys are always the ones UEP will match on.
Three sheets: ``How to fill`` (seven rules and the colour legend), ``Data``
and a hidden ``Lists`` the dropdowns read from.
"""
from __future__ import annotations

import io
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter, quote_sheetname
from openpyxl.worksheet.datavalidation import DataValidation
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.spreadsheet import formula_safe
from app.models.acceptance_case import AcceptanceRejectionCategory
from app.models.reference import ProblemCategory, User

from . import columns as C
from . import current

#: Header fills: grey keys and info, cobalt drive test, ICT plum, CRA sky
#: (the UEP tokens --uep-accent, --uep-ict, --uep-cra).
_FILL = {
    C.GROUP_KEY: ("E5E7EB", "111827"),
    C.GROUP_INFO: ("E5E7EB", "111827"),
    C.GROUP_DT: ("1D4ED8", "FFFFFF"),
    C.GROUP_ICT: ("8E2F74", "FFFFFF"),
    C.GROUP_CRA: ("0369A1", "FFFFFF"),
}
_KEY_CELL = PatternFill("solid", fgColor="F3F4F6")

RULES = (
    "UEP bulk data import",
    "",
    "Colours",
    "Grey columns: filled by UEP. Do not change them. UEP uses them to find each village.",
    "Blue, plum and sky columns: you fill them. Fill only what you know.",
    "",
    "Rules",
    "1. An empty cell changes nothing in UEP.",
    "2. One row per village. Drive test columns are per site: repeat them on every village of the site, or fill one village.",
    "3. Dates: Gregorian (2026-10-15) or Shamsi (1405/07/23). UEP understands both.",
    "4. Dates must be in order: assignment, DT date, SSV submission, DT approved.",
    "5. Problematic needs a problem category. Approved or Rejected needs a letter number and date; Rejected also a rejection category.",
    "6. Acceptance only for villages whose site has DT result = Done (in this file or in UEP).",
    "7. Where UEP already holds a different value you choose which one to keep before anything is saved.",
)


def filename(today: date) -> str:
    return f"UEP_import_template_{today.isoformat()}.xlsx"


def _lists(db: Session) -> dict[str, list[str]]:
    return {
        "dt_contractor": current.dt_contractor_names(db),
        "dt_result": list(C.DT_RESULTS),
        "problem_category": list(db.execute(
            select(ProblemCategory.name).where(ProblemCategory.active).order_by(ProblemCategory.name)
        ).scalars()),
        "acc_result": list(C.ACC_RESULTS),
        "rejection_category": list(db.execute(
            select(AcceptanceRejectionCategory.label).where(AcceptanceRejectionCategory.active)
            .order_by(AcceptanceRejectionCategory.sort)
        ).scalars()),
    }


_LIST_OF_FIELD = {
    "dt_contractor": "dt_contractor",
    "dt_result": "dt_result",
    "problem_category": "problem_category",
    "ict_result": "acc_result",
    "cra_result": "acc_result",
    "ict_rejection_category": "rejection_category",
    "cra_rejection_category": "rejection_category",
}


def build(db: Session, user: User, *, with_current: bool) -> bytes:
    universe = current.load_universe(db, user)
    workbook = Workbook()

    guide = workbook.active
    guide.title = "How to fill"
    for text in RULES:
        guide.append([text])
    guide["A1"].font = Font(bold=True, size=14)
    for row in (3, 7):
        guide.cell(row=row, column=1).font = Font(bold=True)
    guide.column_dimensions["A"].width = 110

    sheet = workbook.create_sheet("Data")
    lists_sheet = workbook.create_sheet("Lists")
    lists_sheet.sheet_state = "hidden"

    for index, column in enumerate(C.COLUMNS, start=1):
        cell = sheet.cell(row=1, column=index, value=column.header)
        fill, ink = _FILL[column.group]
        cell.fill = PatternFill("solid", fgColor=fill)
        cell.font = Font(bold=True, color=ink)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        sheet.column_dimensions[get_column_letter(index)].width = column.width
    sheet.freeze_panes = "D2"

    lists = _lists(db)
    ranges = {}
    for col_index, (name, values) in enumerate(lists.items(), start=1):
        lists_sheet.cell(row=1, column=col_index, value=name)
        for row_index, value in enumerate(values, start=2):
            lists_sheet.cell(row=row_index, column=col_index, value=formula_safe(value))
        letter = get_column_letter(col_index)
        last = max(len(values) + 1, 2)
        ranges[name] = f"{quote_sheetname('Lists')}!${letter}$2:${letter}${last}"

    work_items = sorted(
        universe.work_items.values(), key=lambda w: (w.site_code, w.site_type)
    )
    dt_now = current.dt_values(db, [w.id for w in work_items], universe) if with_current else {}
    villages = [v for w in work_items for v in w.villages]
    acc_now = current.acceptance_values(db, [v.id for v in villages]) if with_current else {}

    row_no = 1
    for wi in work_items:
        for village in sorted(wi.villages, key=lambda v: (v.village_code or "", v.id)):
            row_no += 1
            values = {
                "site_id": wi.site_code,
                "site_type": wi.site_type,
                "village_code": village.village_code or "",
                "province": wi.province or "",
                "village_name": village.village_name or "",
                "requested_tech": "/".join(wi.requested),
            }
            if with_current:
                for key, value in dt_now.get(wi.id, {}).items():
                    values[key] = value.value
                for authority in ("ICT", "CRA"):
                    for key, value in acc_now.get((village.id, authority), {}).items():
                        values[C.acc_key(authority, key)] = value.value
            for index, column in enumerate(C.COLUMNS, start=1):
                value = values.get(column.key)
                if value in (None, ""):
                    continue
                cell = sheet.cell(row=row_no, column=index, value=formula_safe(str(value)))
                if column.group in (C.GROUP_KEY, C.GROUP_INFO):
                    cell.number_format = "@"
                    cell.fill = _KEY_CELL

    last_row = max(row_no, 2) + 500
    for index, column in enumerate(C.COLUMNS, start=1):
        letter = get_column_letter(index)
        if column.group == C.GROUP_KEY:
            continue
        list_name = _LIST_OF_FIELD.get(column.key)
        if list_name:
            dv = DataValidation(type="list", formula1=ranges[list_name], allow_blank=True)
            dv.error = "Pick a value from the list"
            dv.showErrorMessage = True
            sheet.add_data_validation(dv)
            dv.add(f"{letter}2:{letter}{last_row}")
        elif column.kind in (C.KIND_DATE,) or column.kind == C.KIND_TEXT:
            for r in range(2, row_no + 1):
                sheet.cell(row=r, column=index).number_format = "@"

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
