"""The 31 provinces, with their CRA region, PSO coordinator and regional manager.

This is the seed for ``province_mapping`` and nothing else. The table is the
system of record once it exists — a reassignment closes a row and opens a new
one, and this file is never consulted again for a province that already has an
open row, so an edit made in the product is never overwritten on restart.

Each province is named twice on purpose. ``fa`` is the exact string the CPM
workbook carries and the ``provinces`` table stores, and is what the KPI queries
join on; ``en`` is what the KPI page shows, because that page is English and
left-to-right. Keeping both here means the translation is one table rather than
a lookup scattered through the frontend.

The Persian names are the canonical 31 from ``services/cpm_columns.py``. If the
two lists ever disagree, ``tests/test_kpi_mapping.py`` fails — a province that
matches nothing in ``provinces`` would silently drop out of every KPI scope, and
the country totals would stop adding up with no error anywhere.
"""
from __future__ import annotations

from typing import NamedTuple


class ProvinceRow(NamedTuple):
    fa: str
    en: str
    cra_region: str
    pso_coordinator: str
    regional_manager: str


#: (Persian name, English name, CRA region, PSO coordinator, regional manager).
PROVINCE_DIRECTORY: tuple[ProvinceRow, ...] = (
    ProvinceRow("اردبیل", "Ardabil", "Azar", "Hossein", "Pirayesh"),
    ProvinceRow("آذربایجان شرقی", "East Azerbaijan", "Azar", "Hossein", "Pirayesh"),
    ProvinceRow("آذربایجان غربی", "West Azerbaijan", "Azar", "Hossein", "Pirayesh"),
    ProvinceRow(
        "چهارمحال و بختیاری", "Chaharmahal & Bakhtiari", "Central", "Hossein", "Rojhan"
    ),
    ProvinceRow("اصفهان", "Isfahan", "Central", "Hossein", "Rojhan"),
    ProvinceRow("مرکزی", "Markazi", "Central", "Hossein", "Rouhi"),
    ProvinceRow("قم", "Qom", "Central", "Hossein", "Allahyar"),
    ProvinceRow("یزد", "Yazd", "Central", "Hossein", "Rojhan"),
    ProvinceRow("البرز", "Alborz", "North", "Amir", "Allahyar"),
    ProvinceRow("مازندران", "Mazandaran", "North", "Amir", "Nobakht"),
    ProvinceRow("سمنان", "Semnan", "North", "Amir", "Allahyar"),
    ProvinceRow("تهران", "Tehran", "North", "Amir", "Allahyar"),
    ProvinceRow("گلستان", "Golestan", "North East", "Zohreh", "Nobakht"),
    ProvinceRow("خراسان شمالی", "North Khorasan", "North East", "Zohreh", "Bahramizadeh"),
    ProvinceRow("خراسان رضوی", "Razavi Khorasan", "North East", "Zohreh", "Bahramizadeh"),
    ProvinceRow("خراسان جنوبی", "South Khorasan", "North East", "Zohreh", "Bahramizadeh"),
    ProvinceRow("گیلان", "Gilan", "North West", "Amir", "Fazl Talab"),
    ProvinceRow("قزوین", "Qazvin", "North West", "Amir", "Rouhi"),
    ProvinceRow("زنجان", "Zanjan", "North West", "Amir", "Pirayesh"),
    ProvinceRow("بوشهر", "Bushehr", "South", "Zohreh", "Torabi"),
    ProvinceRow("فارس", "Fars", "South", "Zohreh", "Torabi"),
    ProvinceRow(
        "کهگیلویه و بویراحمد", "Kohgiluyeh & Boyer-Ahmad", "South", "Zohreh", "Torabi"
    ),
    ProvinceRow("هرمزگان", "Hormozgan", "South East", "Farid", "Bastegani"),
    ProvinceRow("کرمان", "Kerman", "South East", "Farid", "Bastegani"),
    ProvinceRow(
        "سیستان و بلوچستان", "Sistan & Baluchestan", "South East", "Farid", "Bastegani"
    ),
    ProvinceRow("ایلام", "Ilam", "South West", "Zohreh", "Rouhi"),
    ProvinceRow("خوزستان", "Khuzestan", "South West", "Zohreh", "Loveimi"),
    ProvinceRow("لرستان", "Lorestan", "South West", "Zohreh", "Rouhi"),
    ProvinceRow("همدان", "Hamadan", "West", "Hossein", "Rouhi"),
    ProvinceRow("کرمانشاه", "Kermanshah", "West", "Hossein", "Rouhi"),
    ProvinceRow("کردستان", "Kurdistan", "West", "Hossein", "Rouhi"),
)

#: Persian name -> English name, for labelling a province row on the KPI page.
ENGLISH_BY_PERSIAN: dict[str, str] = {row.fa: row.en for row in PROVINCE_DIRECTORY}

#: What a province with no recognised name is called on the page. A CPM cell
#: that matches none of the 31 leaves ``sites.province_id`` NULL, and those work
#: items still exist and still have villages. They are counted in the country
#: total and shown as one extra row, rather than quietly disappearing and making
#: the per-province rows fail to add up to the country figure.
UNKNOWN_PROVINCE_LABEL = "Unknown province"
