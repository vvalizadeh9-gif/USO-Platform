"""Digits as people type them, read as digits the system compares.

A user on a Persian keyboard types ۱۴۰۵; one pasting from an Arabic-locale
document brings ١٤٠٥; everyone else types 1405. They are the same number, and
anything the platform matches on -- a letter number shared by a hundred
villages, a pasted village code, a Shamsi date -- has to treat them as one.
Stored and compared values are always Latin digits; this is the one place
that says how the other two are read.

The browser's twin is ``frontend/src/lib/persianDigits.js``; both are tested
against the same vectors.
"""
from __future__ import annotations

PERSIAN_ZERO = 0x06F0
ARABIC_INDIC_ZERO = 0x0660

#: Persian and Arabic-Indic digits mapped to their Latin digit.
DIGIT_MAP = {
    **{PERSIAN_ZERO + i: ord(str(i)) for i in range(10)},
    **{ARABIC_INDIC_ZERO + i: ord(str(i)) for i in range(10)},
}


def to_latin(text: str) -> str:
    """``text`` with every Persian or Arabic-Indic digit replaced by Latin."""
    return text.translate(DIGIT_MAP)


def normalize_code(text: str | None) -> str:
    """A typed or pasted identifier as it is compared: trimmed, Latin, upper."""
    return to_latin(text or "").strip().upper()
