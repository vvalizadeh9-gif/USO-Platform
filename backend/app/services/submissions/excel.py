"""The ICT workbook: the exact 18-column format of the team's MTN letter list.

One sheet named ``#{n}``, formatted as an Excel table with a bold header row,
left-to-right, Persian text as-is. Rows sorted by Site ID, then village code.
Nothing else: no extra sheets, colours or notes.
"""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.reference import Region
from app.models.workitem import Site, Village, WorkItem
from app.services.submissions import scope

#: The headers, verbatim and in order.
HEADERS = (
    "ردیف", "کد آبادی", "استان", "شهرستان", "بخش", "دهستان",
    "آبادی های تحت پوشش", "خانوار", "جمعیت", "lat", "long", "نوع سایت",
    "تکنولوژی راه اندازی شده", "منطقه", "CRA Region", "هدف/ اقماری", "Site ID", "Comment",
)
TARGET = "هدف"


def filename(number: int | str) -> str:
    return f"MTN_Irancell_Drive_Test_{number}.xlsx"


def _rows(db: Session, village_ids: list[int]) -> list:
    if not village_ids:
        return []
    stmt = scope.village_select(
        func.coalesce(Village.county, Site.county).label("county"),
        func.coalesce(Village.district, Site.district).label("district"),
        func.coalesce(Village.rural_district, Site.rural_district).label("rural_district"),
        Village.households, Village.population, Village.latitude, Village.longitude,
        WorkItem.deployed_technology, Region.name.label("region"),
    ).where(Village.id.in_(village_ids))
    rows = db.execute(stmt).all()
    return sorted(rows, key=lambda r: (r.site_code or "", r.village_code or "", r.village_id))


def _values(index: int, r) -> list:
    return [
        index, r.village_code, r.province, r.county, r.district, r.rural_district,
        r.village_name, r.households, r.population, r.latitude, r.longitude,
        r.site_type, r.deployed_technology, r.region, r.cra_region, TARGET,
        r.site_code, None,
    ]


def build(db: Session, village_ids: list[int], sheet_number: int | str) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = f"#{sheet_number}"
    sheet.sheet_view.rightToLeft = False
    sheet.append(list(HEADERS))
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    rows = _rows(db, village_ids)
    for index, row in enumerate(rows, start=1):
        sheet.append(_values(index, row))
    last = get_column_letter(len(HEADERS))
    table = Table(displayName=f"Batch{str(sheet_number).replace('-', '_')}",
                  ref=f"A1:{last}{max(len(rows), 1) + 1}")
    table.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=False)
    sheet.add_table(table)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
