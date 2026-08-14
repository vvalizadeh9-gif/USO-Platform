"""Generate the synthetic CPM workbook the test suite imports.

    cd backend && python tests/fixtures/generate_sample_cpm.py

Why this exists
---------------

The CPM tests used to import a real monthly workbook from a path that only
existed inside one person's working environment. Anywhere else, thirteen tests
failed. Worse, they failed rather than skipped, because of a bug in how the path
was chosen (see the "unreachable skip" note in FINDINGS.md), so a fresh checkout
looked broken.

This script builds a small workbook that is *structurally* a CPM file --
the same sheet name, the same header row position, the same column positions,
the same Persian classification values and status vocabulary -- but contains no
real data. Village names are invented. Site codes are invented. Operators are
made up. Nothing here corresponds to a real place, contract or person, so it is
safe to commit and safe to share.

The generated file is committed as sample_cpm.xlsx. This script is kept beside
it so the fixture can be extended or rebuilt later, rather than being an opaque
binary nobody dares touch.

To run the tests against a genuine workbook instead:

    UEP_TEST_CPM_XLSX=/path/to/real/CPM.xlsx pytest
"""
from pathlib import Path

from openpyxl import Workbook

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services import cpm_columns as C  # noqa: E402

OUTPUT = Path(__file__).resolve().parent / "sample_cpm.xlsx"

# One past the highest index the importer reads (cra_letter_number is 67).
COLUMN_COUNT = 68

# Human-readable headers at the positions the importer actually uses. The
# importer reads by position, not by name, so these are documentation -- but
# they make the fixture readable to someone opening it in Excel, which is the
# whole point of it being faithful.
HEADERS = {
    C.COL["village_code"]: "کد آبادی",
    C.COL["province"]: "استان",
    C.COL["county"]: "شهرستان",
    C.COL["district"]: "بخش",
    C.COL["rural_district"]: "دهستان",
    C.COL["village_name"]: "آبادی",
    C.COL["households"]: "خانوار",
    C.COL["population"]: "جمعیت",
    C.COL["village_lat"]: "عرض جغرافیایی آبادی",
    C.COL["village_lng"]: "طول جغرافیایی آبادی",
    C.COL["site_code"]: "کد سایت ایرانسل",
    C.COL["temp_site_code"]: "کدسایت موقت",
    C.COL["site_lat"]: "عرض جغرافیایی سایت",
    C.COL["site_lng"]: "طول جغرافیایی سایت",
    C.COL["referral_letter"]: "شماره نامه ارجاع",
    C.COL["referral_date_shamsi"]: "تاریخ نامه ارجاع",
    C.COL["referral_date_greg"]: "تاریخ میلادی ارجاع",
    C.COL["site_type"]: "نوع سایت",
    C.COL["requested_tech"]: "تکنولوژی درخواستی",
    C.COL["deployed_tech"]: "تکنولوژی راه اندازی شده",
    C.COL["launch_date_shamsi"]: "تاریخ راه اندازی",
    C.COL["last_stage"]: "آخرین مرحله انجام شده",
    C.COL["project_name"]: "نام پروژه اجرایی سایت",
    C.COL["pm_name"]: "مدیر پروژه",
    C.COL["launch_date_greg"]: "تاریخ میلادی راه اندازی",
    C.COL["region"]: "منطقه",
    C.COL["target_flag"]: "هدف/ اقماری",
    C.COL["overall_project"]: "پروژه کلی",
    C.COL["site_contractor"]: "پیمانکار اجرایی سایت",
    C.COL["monthly_plan"]: "پلن ماهیانه",
    C.COL["equipment_type"]: "نوع تجهیزات",
    C.COL["operator"]: "اپراتور",
    C.COL["power_status"]: "Power Status",
    C.COL["dt_contractor"]: "پیمانکار درایوتست",
    C.COL_HISTORY["dt_sc"]: "DT SC",
    C.COL_HISTORY["dt_status"]: "DT Status",
    C.COL_HISTORY["dt_problem_category"]: "DT Problem Category",
    C.COL_HISTORY["dt_assignment"]: "DT Assignment",
    C.COL_HISTORY["dt_date"]: "DT Date",
    C.COL_HISTORY["ict_status"]: "ICT Status",
    C.COL_HISTORY["ict_2g"]: "ICT 2G",
    C.COL_HISTORY["ict_3g"]: "ICT 3G",
    C.COL_HISTORY["ict_4g"]: "ICT 4G",
    C.COL_HISTORY["ict_comment"]: "ICT Comment",
    C.COL_HISTORY["ict_letter_date"]: "ICT Letter Date",
    C.COL_HISTORY["ict_letter_number"]: "ICT Letter Number",
    C.COL_HISTORY["cra_status"]: "CRA Status",
    C.COL_HISTORY["cra_2g"]: "CRA 2G",
    C.COL_HISTORY["cra_3g"]: "CRA 3G",
    C.COL_HISTORY["cra_4g"]: "CRA 4G",
    C.COL_HISTORY["cra_comment"]: "CRA Comment",
    C.COL_HISTORY["cra_letter_date"]: "CRA Letter Date",
    C.COL_HISTORY["cra_letter_number"]: "CRA Letter Number",
}

# Invented village names. Deliberately not real places -- they are transparently
# synthetic ("Test Village One" and so on) so nobody can mistake this for real
# CPM data.
VILLAGE_NAMES = [
    "آبادی آزمایشی یک", "آبادی آزمایشی دو", "آبادی آزمایشی سه",
    "آبادی آزمایشی چهار", "آبادی آزمایشی پنج", "آبادی آزمایشی شش",
    "آبادی آزمایشی هفت", "آبادی آزمایشی هشت", "آبادی آزمایشی نه",
    "آبادی آزمایشی ده", "آبادی آزمایشی یازده", "آبادی آزمایشی دوازده",
]

# Real province names, because the importer resolves every استان cell against
# the canonical list of 31 and a made-up province would simply be dropped.
# These are public administrative names, not data about anyone.
PROVINCES = ["تهران", "اصفهان", "فارس", "خراسان رضوی", "گیلان"]

# Every classification the column carries. Only the bare هدف is imported; the
# other five are counted and dropped. Having all six here is what makes the
# fixture able to test the filter rather than just the happy path.
PURE_TARGET = "هدف"
IGNORED_CLASSIFICATIONS = [
    "اقماری",
    "اقماری جهت بررسی پوشش",
    "هدف  (Removed Verbally)",   # double space, exactly as the real file has it
    "هدف (Verbally)",
    "اقماری (Removed Verbally)",
]

TECHNOLOGIES = ["2G", "2G3G", "2G3G4G", "3G4G", "4G"]
SITE_TYPES = ["Macro", "Micro", "Rooftop"]
OPERATORS = ["اپراتور الف", "اپراتور ب"]
CONTRACTORS = ["پیمانکار آزمایشی الف", "پیمانکار آزمایشی ب", "پیمانکار آزمایشی ج"]


def _row(
    index: int,
    *,
    site_code: str,
    classification: str,
    last_stage: str,
    dt_status: str | None = None,
    requested_tech: str = "2G3G4G",
    village_suffix: str = "",
    province: str | None = None,
) -> list:
    """Build one CPM row, positioned exactly as the importer expects."""
    row: list = [None] * COLUMN_COUNT
    province = province or PROVINCES[index % len(PROVINCES)]

    row[C.COL["village_code"]] = f"9{index:05d}"
    row[C.COL["province"]] = province
    row[C.COL["county"]] = f"شهرستان آزمایشی {index % 4 + 1}"
    row[C.COL["district"]] = f"بخش آزمایشی {index % 3 + 1}"
    row[C.COL["rural_district"]] = f"دهستان آزمایشی {index % 2 + 1}"
    row[C.COL["village_name"]] = (
        VILLAGE_NAMES[index % len(VILLAGE_NAMES)] + village_suffix
    )
    row[C.COL["households"]] = 40 + (index * 7) % 300
    row[C.COL["population"]] = 150 + (index * 23) % 900
    row[C.COL["village_lat"]] = round(32.0 + (index % 50) * 0.05, 5)
    row[C.COL["village_lng"]] = round(52.0 + (index % 50) * 0.05, 5)
    row[C.COL["site_code"]] = site_code
    row[C.COL["temp_site_code"]] = f"T{site_code}"
    row[C.COL["site_lat"]] = round(32.0 + (index % 50) * 0.05, 5)
    row[C.COL["site_lng"]] = round(52.0 + (index % 50) * 0.05, 5)
    row[C.COL["referral_letter"]] = f"TEST/{1000 + index}"
    row[C.COL["referral_date_shamsi"]] = "1404/01/15"
    row[C.COL["site_type"]] = SITE_TYPES[index % len(SITE_TYPES)]
    row[C.COL["requested_tech"]] = requested_tech
    row[C.COL["deployed_tech"]] = requested_tech
    row[C.COL["last_stage"]] = last_stage
    row[C.COL["project_name"]] = "پروژه آزمایشی"
    row[C.COL["pm_name"]] = f"مدیر پروژه آزمایشی {index % 3 + 1}"
    row[C.COL["region"]] = f"منطقه {index % 3 + 1}"
    row[C.COL["target_flag"]] = classification
    row[C.COL["overall_project"]] = "پروژه کلی آزمایشی"
    row[C.COL["site_contractor"]] = CONTRACTORS[index % len(CONTRACTORS)]
    row[C.COL["monthly_plan"]] = "1404/02"
    row[C.COL["equipment_type"]] = "تجهیزات آزمایشی"
    row[C.COL["operator"]] = OPERATORS[index % len(OPERATORS)]
    row[C.COL["power_status"]] = "OK" if index % 3 else "Pending"
    row[C.COL["dt_contractor"]] = CONTRACTORS[index % len(CONTRACTORS)]

    row[C.COL_HISTORY["dt_sc"]] = CONTRACTORS[index % len(CONTRACTORS)]
    row[C.COL_HISTORY["dt_status"]] = dt_status
    return row


def build_rows() -> list[list]:
    """The fixture's data rows.

    Composed so the suite has what it needs:

    * enough on-air sites with a blank or Problematic drive-test status to fill
      the health-check basket several times over (Done and Ongoing are excluded
      from the basket, so both appear here to prove the exclusion works),
    * a site that is not on-air at all, which must never reach the basket,
    * every technology combination, so the health check asks about exactly the
      requested ones,
    * all five ignored classifications alongside the pure هدف, so the import
      filter is genuinely exercised,
    * two villages sharing one site code, because that is how the real file
      represents a site serving more than one village.
    """
    rows: list[list] = []
    index = 0

    # --- Twelve on-air, health-check-eligible sites -------------------------
    for i in range(12):
        rows.append(
            _row(
                index,
                site_code=f"TST{100 + i:04d}",
                classification=PURE_TARGET,
                last_stage=(
                    C.STAGE_PERM_ONAIR if i % 2 else C.STAGE_TEMP_ONAIR
                ),
                # Blank and Problematic both stay in the basket.
                dt_status=None if i % 3 else C.DT_STATUS_PROBLEMATIC,
                requested_tech=TECHNOLOGIES[i % len(TECHNOLOGIES)],
            )
        )
        index += 1

    # --- One site serving two villages -------------------------------------
    # The real file repeats the site row per village; village quantity is what
    # re-import change requests are computed from.
    rows.append(
        _row(
            index,
            site_code="TST0200",
            classification=PURE_TARGET,
            last_stage=C.STAGE_PERM_ONAIR,
            village_suffix=" الف",
        )
    )
    index += 1
    rows.append(
        _row(
            index,
            site_code="TST0200",
            classification=PURE_TARGET,
            last_stage=C.STAGE_PERM_ONAIR,
            village_suffix=" ب",
        )
    )
    index += 1

    # --- On-air but excluded from the basket by drive-test status -----------
    for i, status in enumerate((C.DT_STATUS_DONE, C.DT_STATUS_ONGOING)):
        rows.append(
            _row(
                index,
                site_code=f"TST03{i:02d}",
                classification=PURE_TARGET,
                last_stage=C.STAGE_PERM_ONAIR,
                dt_status=status,
            )
        )
        index += 1

    # --- Imported, but not on-air, so never in the basket -------------------
    for i in range(2):
        rows.append(
            _row(
                index,
                site_code=f"TST04{i:02d}",
                classification=PURE_TARGET,
                last_stage="طراحی",
            )
        )
        index += 1

    # --- Every classification that must be skipped --------------------------
    # Two of each, so a test can tell "the filter ran" from "there was one row".
    for i, classification in enumerate(IGNORED_CLASSIFICATIONS):
        for repeat in range(2):
            rows.append(
                _row(
                    index,
                    site_code=f"TST05{i}{repeat}",
                    classification=classification,
                    last_stage=C.STAGE_PERM_ONAIR,
                )
            )
            index += 1

    # --- Unusable rows, which the importer must survive ---------------------
    # A row with no site code, and one with CPM's own junk placeholders.
    blank = [None] * COLUMN_COUNT
    blank[C.COL["province"]] = PROVINCES[0]
    blank[C.COL["target_flag"]] = PURE_TARGET
    rows.append(blank)

    junk = _row(
        index,
        site_code="---",
        classification=PURE_TARGET,
        last_stage=C.STAGE_PERM_ONAIR,
    )
    junk[C.COL["site_type"]] = "#REF!"
    rows.append(junk)

    return rows


def main() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = C.SHEET_NAME

    # The importer reads with header=2, so two rows come before the headers.
    # The real file uses them for a title and a spacer; mirror that.
    sheet.append(["گزارش CPM — نمونه آزمایشی (داده واقعی نیست)"])
    sheet.append([])

    header_row: list = [None] * COLUMN_COUNT
    for position, label in HEADERS.items():
        header_row[position] = label
    sheet.append(header_row)

    rows = build_rows()
    for row in rows:
        sheet.append(row)

    workbook.save(OUTPUT)

    importable = sum(
        1
        for r in rows
        if C.is_pure_target(r[C.COL["target_flag"]])
        and C.clean(r[C.COL["site_code"]])
        and C.clean(r[C.COL["site_type"]])
    )
    print(f"Wrote {OUTPUT}")
    print(f"  {len(rows)} data rows")
    print(f"  {importable} importable (pure هدف with a usable site code and type)")
    print(f"  {len(rows) - importable} skipped or unusable")


if __name__ == "__main__":
    main()
