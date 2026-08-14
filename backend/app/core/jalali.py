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
