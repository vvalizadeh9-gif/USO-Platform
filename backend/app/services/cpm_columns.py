"""Column index map for the CPM Excel file.

Header row is the 3rd row (index 2). Indices are 0-based positions.
Keeping this in one constant means a future CPM layout change is a
single-file edit (maintainability).
"""

# ----- Master block (A..AT) : refreshed monthly by import -----
COL = {
    "village_code": 2,          # کد آبادی
    "province": 3,              # استان
    "county": 4,                # شهرستان
    "district": 5,              # بخش
    "rural_district": 6,        # دهستان
    "village_name": 7,          # آبادی
    "households": 8,            # خانوار
    "population": 9,            # جمعیت
    "village_lat": 10,
    "village_lng": 11,
    "site_code": 12,            # کد سایت ایرانسل
    "temp_site_code": 13,       # کدسایت موقت
    "site_lat": 14,
    "site_lng": 15,
    "referral_letter": 16,      # شماره نامه ارجاع
    "referral_date_shamsi": 17,
    "referral_date_greg": 18,
    "site_type": 19,            # نوع سایت
    "requested_tech": 20,       # تکنولوژی درخواستی
    "deployed_tech": 21,        # تکنولوژی راه اندازی شده
    "launch_date_shamsi": 22,
    "last_stage": 23,           # آخرین مرحله انجام شده (on-air status: طراحی / راه_اندازی_موقت / راه_اندازی_دائم)
    "project_name": 25,         # نام پروژه اجرایی سایت
    "pm_name": 26,              # مدیر پروژه
    "launch_date_greg": 27,
    "region": 28,               # منطقه
    "target_flag": 29,          # هدف/ اقماری
    "overall_project": 30,      # پروژه کلی
    "site_contractor": 31,      # پیمانکار اجرایی سایت
    "monthly_plan": 33,         # پلن ماهیانه
    "equipment_type": 34,       # نوع تجهیزات
    "operator": 37,             # اپراتور
    "power_status": 38,         # Power Status
    "dt_contractor": 41,        # پیمانکار درایوتست
}

# ----- Execution block (AV..BQ) -----
# Boundary: A..AU = monthly master (AU 'Distance' is the last master col).
# AV onward = Drive Test Project + Acceptance.
#   * DT block (AV..AZ) is seeded ONCE and then app-owned.
#   * ICT/CRA acceptance columns (below) are re-applied on EVERY import so
#     approvals can be maintained by editing the CPM file — blank cells are
#     ignored, so an empty cell never downgrades an existing approval.
COL_HISTORY = {
    "dt_sc": 47,               # AV: DT SC — authoritative Drive Test contractor
    "dt_status": 48,            # AW: DT Status (Done|Problematic|blank)
    "dt_problem_category": 49,  # AX
    "dt_assignment": 50,        # AY
    "dt_date": 51,              # AZ: DT Date (Gregorian)
    "ict_status": 52,
    "ict_2g": 54,               # BC: ICT 2G status
    "ict_3g": 55,               # BD: ICT 3G status
    "ict_4g": 56,               # BE: ICT 4G status
    "ict_comment": 57,
    "ict_letter_date": 58,
    "ict_letter_number": 59,
    "cra_status": 60,
    "cra_2g": 62,
    "cra_3g": 63,
    "cra_4g": 64,
    "cra_comment": 65,
    "cra_letter_date": 66,
    "cra_letter_number": 67,
}

# Master fields that are diff-checked on monthly re-import.
DIFF_FIELDS = [
    "province",
    "site_type",
    "requested_tech",
    "deployed_tech",
    "project_name",
    "pm_name",
    "region",
    "power_status",
    "operator",
    "monthly_plan",
]

HEADER_ROW = 2  # 0-based (3rd row)
SHEET_NAME = "CPM"

# Junk placeholders treated as empty.
EMPTY_TOKENS = {"---", "#REF!", "", "nan", "None", "NaN"}


def clean(value: object) -> str | None:
    """Normalise a raw cell value; treat junk tokens as None."""
    if value is None:
        return None
    text = str(value).strip()
    if text in EMPTY_TOKENS:
        return None
    return text


# The only classification that is imported, and the only one the Acceptance
# dashboard counts — one gate, used in both places. Every other value in the
# column is ignored on import; the row is counted and dropped:
#
#     اقماری
#     اقماری جهت بررسی پوشش
#     اقماری (Removed Verbally)
#     هدف (Verbally)
#     هدف (Removed Verbally)
#
# The two "(…Verbally)" هدف variants used to be stored but were already
# excluded from every KPI, so they only inflated village counts and skewed
# village-quantity change requests. They are now dropped at the door.
TARGET_PURE = "هدف"


def is_pure_target(value: object) -> bool:
    """Return True only for the exact هدف classification — the import gate.

    Tolerant of Persian letter-form / zero-width / whitespace differences via
    ``normalize_persian`` so a plain هدف still matches regardless of how it was
    typed, while any parenthetical suffix ("(Verbally)" etc.) fails the match.
    """
    norm = normalize_persian(clean(value))
    return norm is not None and norm == normalize_persian(TARGET_PURE)


# ----- On-air status (column X: آخرین مرحله انجام شده) -----
# A work item is "on-air" when its last completed stage is temporary or
# permanent launch. Any other value (e.g. طراحی / design) is not on-air.
STAGE_TEMP_ONAIR = "راه_اندازی_موقت"
STAGE_PERM_ONAIR = "راه_اندازی_دائم"
ONAIR_STAGES = {STAGE_TEMP_ONAIR, STAGE_PERM_ONAIR}


def normalize_stage(value: object) -> str | None:
    """Normalise the last-stage cell, tolerating space/underscore variants."""
    text = clean(value)
    if text is None:
        return None
    # CPM sometimes uses spaces instead of underscores; unify them.
    return text.replace(" ", "_")


def is_onair_stage(value: object) -> bool:
    """Return True if the last-stage value counts as on-air."""
    return normalize_stage(value) in ONAIR_STAGES


# ----- Drive Test status (column AW: DT Status) -----
# The AW column carries Done / Problematic / Ongoing (or blank). These are
# seeded once on the first import and then owned by the app. Health-check
# basket eligibility excludes Done and Ongoing (see health_check service).
DT_STATUS_DONE = "Done"
DT_STATUS_ONGOING = "Ongoing"
DT_STATUS_PROBLEMATIC = "Problematic"
# Statuses that mean the site should NOT appear in the health-check basket.
DT_STATUS_EXCLUDED_FROM_HC = {DT_STATUS_DONE, DT_STATUS_ONGOING}


def normalize_dt_status(value: object) -> str | None:
    """Canonicalise a DT status cell to Done | Ongoing | Problematic | None.

    Tolerant of case/whitespace so 'done', ' Ongoing ', etc. all resolve.
    """
    text = clean(value)
    if text is None:
        return None
    low = text.strip().lower()
    if low == "done":
        return DT_STATUS_DONE
    if low == "ongoing":
        return DT_STATUS_ONGOING
    if low == "problematic":
        return DT_STATUS_PROBLEMATIC
    return text  # unknown — keep as-is rather than dropping data


# ----- Provinces (column D: استان) -----
# Iran has exactly 31 provinces. We seed this canonical set and resolve every
# CPM استان cell to one of them (see province normalisation below), so the
# provinces table can never accumulate stray non-province values (a site code
# or work-item string that slipped into the column). "Grant province access"
# then always shows exactly these 31, never junk.
IRAN_PROVINCES = (
    "آذربایجان شرقی",
    "آذربایجان غربی",
    "اردبیل",
    "اصفهان",
    "البرز",
    "ایلام",
    "بوشهر",
    "تهران",
    "چهارمحال و بختیاری",
    "خراسان جنوبی",
    "خراسان رضوی",
    "خراسان شمالی",
    "خوزستان",
    "زنجان",
    "سمنان",
    "سیستان و بلوچستان",
    "فارس",
    "قزوین",
    "قم",
    "کردستان",
    "کرمان",
    "کرمانشاه",
    "کهگیلویه و بویراحمد",
    "گلستان",
    "گیلان",
    "لرستان",
    "مازندران",
    "مرکزی",
    "هرمزگان",
    "همدان",
    "یزد",
)


def normalize_persian(text: str | None) -> str | None:
    """Normalise Persian text for tolerant matching.

    Unifies Arabic vs Persian letter forms (ي→ی, ك→ک), strips zero-width
    non-joiner and other zero-width marks, collapses internal whitespace, and
    trims. This lets province spellings vary slightly across monthly files
    while still resolving to the same canonical province.
    """
    if text is None:
        return None
    t = str(text)
    # Arabic → Persian letter forms.
    t = t.replace("\u064a", "\u06cc").replace("\u0643", "\u06a9")
    # Remove zero-width characters (ZWNJ, ZWJ, ZWSP, BOM).
    for zw in ("\u200c", "\u200d", "\u200b", "\ufeff"):
        t = t.replace(zw, " ")
    t = " ".join(t.split())  # collapse whitespace + strip
    return t or None


# Canonical lookup: normalised name -> canonical display name.
CANONICAL_PROVINCE_BY_NORM = {
    normalize_persian(name): name for name in IRAN_PROVINCES
}


def canonical_province(value: object) -> str | None:
    """Resolve a raw استان cell to a canonical province name, or None.

    Returns None when the cell doesn't match any of the 31 provinces, so junk
    values never create a province row.
    """
    norm = normalize_persian(clean(value))
    if norm is None:
        return None
    return CANONICAL_PROVINCE_BY_NORM.get(norm)
