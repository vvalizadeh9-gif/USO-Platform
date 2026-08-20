"""Jalali (Shamsi) calendar helpers.

Single place for Gregorian <-> Shamsi conversion so the rest of the code
never depends directly on the calendar library (easy to swap later).
"""
from __future__ import annotations

from datetime import date

import jdatetime

# Shamsi month names in order (index 1..12).
SHAMSI_MONTHS = [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
]


def to_shamsi(gregorian: date) -> tuple[int, int]:
    """Convert a Gregorian date to a (shamsi_year, shamsi_month) tuple."""
    j = jdatetime.date.fromgregorian(date=gregorian)
    return j.year, j.month


def current_shamsi_period() -> tuple[int, int]:
    """Return the current (shamsi_year, shamsi_month)."""
    j = jdatetime.date.today()
    return j.year, j.month


def previous_period(year: int, month: int) -> tuple[int, int]:
    """Return the (year, month) immediately before the given Shamsi period."""
    if month == 1:
        return year - 1, 12
    return year, month - 1


def month_name(month: int) -> str:
    """Return the Shamsi month name for month number 1..12."""
    if 1 <= month <= 12:
        return SHAMSI_MONTHS[month - 1]
    return str(month)


def to_shamsi_date(gregorian: date) -> tuple[int, int, int]:
    """Convert a Gregorian date to a (year, month, day) Shamsi tuple."""
    j = jdatetime.date.fromgregorian(date=gregorian)
    return j.year, j.month, j.day


def from_shamsi_date(year: int, month: int, day: int) -> date:
    """Convert a Shamsi (year, month, day) to a Gregorian ``date``.

    Raises ``ValueError`` for a date that does not exist — 31 Esfand in a
    common year, for example. Letter dates are typed by hand, so the invalid
    ones have to fail loudly rather than be silently shifted.
    """
    return jdatetime.date(year, month, day).togregorian()


def format_shamsi(gregorian: date | None) -> str | None:
    """Render a Gregorian date as a zero-padded Shamsi string, ``1404/05/29``."""
    if gregorian is None:
        return None
    y, m, d = to_shamsi_date(gregorian)
    return f"{y:04d}/{m:02d}/{d:02d}"


def parse_shamsi(text: str | None) -> date | None:
    """Parse ``1404/05/29`` (or ``1404-5-29``) into a Gregorian ``date``.

    Persian and Arabic-Indic digits are accepted, because a user typing on a
    Persian keyboard produces them and rejecting the input would be an
    unhelpful surprise.
    """
    if text is None:
        return None
    cleaned = str(text).strip().translate(_DIGIT_MAP)
    if not cleaned:
        return None
    parts = cleaned.replace("-", "/").replace(".", "/").split("/")
    if len(parts) != 3:
        raise ValueError("Date must be in the form 1404/05/29")
    try:
        year, month, day = (int(p) for p in parts)
    except ValueError:
        raise ValueError("Date must be in the form 1404/05/29") from None
    return from_shamsi_date(year, month, day)


# Persian (\u06f0..) and Arabic-Indic (\u0660..) digits mapped to ASCII.
_DIGIT_MAP = {
    **{0x06F0 + i: ord(str(i)) for i in range(10)},
    **{0x0660 + i: ord(str(i)) for i in range(10)},
}
