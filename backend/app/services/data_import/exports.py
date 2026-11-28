"""The error file (the refused rows as uploaded + an Error column) and the
change log of a batch."""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.spreadsheet import formula_safe
from app.models.data_import import KIND_EFFECT, ImportBatch, ImportChange, ImportRow

from . import columns as C

_HEAD = PatternFill("solid", fgColor="E5E7EB")


def _save(workbook: Workbook) -> bytes:
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _header(sheet, titles: list[str]) -> None:
    sheet.append(titles)
    for index in range(1, len(titles) + 1):
        cell = sheet.cell(row=1, column=index)
        cell.font = Font(bold=True)
        cell.fill = _HEAD
        sheet.column_dimensions[get_column_letter(index)].width = 18
    sheet.freeze_panes = "A2"


def errors_file(db: Session, batch: ImportBatch) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Data"
    _header(sheet, ["Row", *(c.header for c in C.COLUMNS), "Error"])
    rows = db.execute(
        select(ImportRow).where(ImportRow.batch_id == batch.id, ImportRow.status != "ok")
        .order_by(ImportRow.row_no)
    ).scalars()
    for r in rows:
        raw = r.raw or {}
        message = "; ".join(e.get("message", "") for e in (r.errors or []))
        sheet.append([r.row_no, *(formula_safe(raw.get(c.key) or "") for c in C.COLUMNS),
                      formula_safe(message)])
    for row in sheet.iter_rows(min_row=2):
        for cell in row[1:4]:
            cell.number_format = "@"
    return _save(workbook)


def changes_file(db: Session, batch: ImportBatch) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Changes"
    _header(sheet, ["Row", "Site ID", "Site type", "Village code", "Field", "UEP value",
                    "UEP value from", "File value", "Kind", "Decision", "Applied"])
    rows = {r.id: r for r in db.execute(select(ImportRow).where(ImportRow.batch_id == batch.id)).scalars()}
    for c in db.execute(
        select(ImportChange).where(ImportChange.batch_id == batch.id, ImportChange.kind != KIND_EFFECT)
        .order_by(ImportChange.id)
    ).scalars():
        row = rows.get(c.row_id)
        raw = (row.raw if row else None) or {}
        sheet.append([
            row.row_no if row else None, formula_safe(raw.get("site_id") or ""),
            formula_safe(raw.get("site_type") or ""),
            formula_safe(raw.get("village_code") or "") if c.entity_type != "drive_test" else "",
            C.label(c.field), formula_safe(str(c.old_value or "")), c.old_source or "",
            formula_safe(str(c.new_value or "")), c.kind,
            {"keep": "Keep UEP", "file": "Use file"}.get(c.decision or "", ""),
            "Yes" if c.applied else "No",
        ])
    log = workbook.create_sheet("Records")
    _header(log, ["Table", "Record", "What", "Before", "After"])
    for c in db.execute(
        select(ImportChange).where(ImportChange.batch_id == batch.id, ImportChange.kind == KIND_EFFECT)
        .order_by(ImportChange.id)
    ).scalars():
        log.append([c.entity_type, c.entity_id, c.field,
                    formula_safe(str(c.old_value)) if c.old_value is not None else "",
                    formula_safe(str(c.new_value)) if c.new_value is not None else ""])
    return _save(workbook)
