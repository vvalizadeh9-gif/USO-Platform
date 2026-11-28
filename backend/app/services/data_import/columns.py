"""The template's columns, in order, and what each one is.

Headers are matched **by name** when reading (case and spacing ignored), so a
moved or inserted column never shifts data. The keys below are the stable
names everything else uses.
"""
from __future__ import annotations

from dataclasses import dataclass

GROUP_KEY = "key"
GROUP_INFO = "info"
GROUP_DT = "dt"
GROUP_ICT = "ict"
GROUP_CRA = "cra"

KIND_TEXT = "text"
KIND_DATE = "date"
KIND_LIST = "list"


@dataclass(frozen=True)
class Column:
    key: str
    header: str
    group: str
    kind: str = KIND_TEXT
    width: int = 16


COLUMNS: tuple[Column, ...] = (
    Column("site_id", "Site ID", GROUP_KEY, width=14),
    Column("site_type", "Site type", GROUP_KEY, width=12),
    Column("village_code", "Village code", GROUP_KEY, width=14),
    Column("province", "Province", GROUP_INFO, width=14),
    Column("village_name", "Village name", GROUP_INFO, width=20),
    Column("requested_tech", "Requested tech", GROUP_INFO, width=12),
    Column("dt_contractor", "DT contractor", GROUP_DT, KIND_LIST, 18),
    Column("assignment_date", "Assignment date", GROUP_DT, KIND_DATE, 14),
    Column("dt_date", "DT date", GROUP_DT, KIND_DATE, 12),
    Column("ssv_date", "SSV submission date", GROUP_DT, KIND_DATE, 14),
    Column("dt_result", "DT result", GROUP_DT, KIND_LIST, 12),
    Column("dt_approved_date", "DT approved date", GROUP_DT, KIND_DATE, 14),
    Column("problem_category", "Problem category", GROUP_DT, KIND_LIST, 20),
    Column("dt_comment", "DT comment", GROUP_DT, KIND_TEXT, 24),
    Column("ict_result", "ICT result", GROUP_ICT, KIND_LIST, 12),
    Column("ict_letter_number", "ICT letter number", GROUP_ICT, KIND_TEXT, 16),
    Column("ict_letter_date", "ICT letter date", GROUP_ICT, KIND_DATE, 14),
    Column("ict_rejection_category", "ICT rejection category", GROUP_ICT, KIND_LIST, 18),
    Column("ict_comment", "ICT comment", GROUP_ICT, KIND_TEXT, 24),
    Column("cra_result", "CRA result", GROUP_CRA, KIND_LIST, 12),
    Column("cra_letter_number", "CRA letter number", GROUP_CRA, KIND_TEXT, 16),
    Column("cra_letter_date", "CRA letter date", GROUP_CRA, KIND_DATE, 14),
    Column("cra_rejection_category", "CRA rejection category", GROUP_CRA, KIND_LIST, 18),
    Column("cra_comment", "CRA comment", GROUP_CRA, KIND_TEXT, 24),
)

BY_KEY = {c.key: c for c in COLUMNS}
KEY_COLUMNS = tuple(c.key for c in COLUMNS if c.group == GROUP_KEY)
DT_FIELDS = tuple(c.key for c in COLUMNS if c.group == GROUP_DT)
#: The per-authority fields, without the ``ict_`` / ``cra_`` prefix.
ACC_FIELDS = ("result", "letter_number", "letter_date", "rejection_category", "comment")
AUTHORITY_PREFIX = {"ICT": "ict", "CRA": "cra"}
DATE_FIELDS = frozenset(c.key for c in COLUMNS if c.kind == KIND_DATE)

DT_DONE = "Done"
DT_PROBLEMATIC = "Problematic"
DT_RESULTS = (DT_DONE, DT_PROBLEMATIC)
ACC_APPROVED = "Approved"
ACC_REJECTED = "Rejected"
ACC_RESULTS = (ACC_APPROVED, ACC_REJECTED)

#: Rows whose site ID starts with this are the template's example: skipped.
EXAMPLE_PREFIX = "EXAMPLE"

MAX_COMMENT = 1000

#: The letter number written for a historical verdict that has none (agreed
#: with the PM for UEP-29). The letter date is still required.
NO_LETTER = "NO-LETTER"


def label(field: str) -> str:
    """The header people see for a field key (``ict_result`` -> ``ICT result``)."""
    column = BY_KEY.get(field)
    return column.header if column else field


def acc_key(authority: str, field: str) -> str:
    return f"{AUTHORITY_PREFIX[authority]}_{field}"


def normalize_header(text: object) -> str:
    return " ".join(str(text or "").split()).casefold()


HEADER_INDEX = {normalize_header(c.header): c.key for c in COLUMNS}
