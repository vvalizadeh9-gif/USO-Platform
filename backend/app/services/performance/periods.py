"""Shamsi months, and the same-day comparison every "vs last month" uses.

The running month is compared from its first day up to today with the
previous month up to the **same day of the month**, capped at that month's
length (Mehr 10 against Shahrivar 10, Esfand 30 against Bahman 30). Comparing
ten days of Mehr with the whole of Shahrivar would show every running month
as a collapse. A closed month is compared whole against whole.

Every window is half-open, ``[start, end)``, in Tehran calendar days.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from app.core import jalali
from app.core.digits import to_latin, to_persian


@dataclass(frozen=True, order=True)
class ShamsiMonth:
    year: int
    month: int

    @classmethod
    def parse(cls, text: str) -> ShamsiMonth:
        """``1405-07`` (or ``1405/7``) into a month. ``ValueError`` otherwise."""
        cleaned = to_latin(str(text)).strip().replace("/", "-")
        parts = cleaned.split("-")
        if len(parts) != 2:
            raise ValueError("month must look like 1405-07")
        year, month = (int(p) for p in parts)
        if not 1 <= month <= 12:
            raise ValueError("month must be between 1 and 12")
        return cls(year, month)

    @classmethod
    def of(cls, day: date) -> ShamsiMonth:
        return cls(*jalali.to_shamsi(day))

    @property
    def start(self) -> date:
        return jalali.from_shamsi_date(self.year, self.month, 1)

    @property
    def end(self) -> date:
        """The first day of the next month: the window is ``[start, end)``."""
        return self.next().start

    @property
    def days(self) -> int:
        return jalali.days_in_month(self.year, self.month)

    def previous(self) -> ShamsiMonth:
        return ShamsiMonth(*jalali.previous_period(self.year, self.month))

    def next(self) -> ShamsiMonth:
        return ShamsiMonth(*jalali.next_period(self.year, self.month))

    @property
    def key(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"

    @property
    def label_fa(self) -> str:
        return f"{jalali.month_name(self.month)} {to_persian(str(self.year))}"

    def as_dict(self) -> dict:
        return {"year": self.year, "month": self.month, "label_fa": self.label_fa}


@dataclass(frozen=True)
class Window:
    """``[start, end)`` in calendar days."""

    start: date
    end: date

    def __contains__(self, day: date | None) -> bool:
        return day is not None and self.start <= day < self.end

    @classmethod
    def whole(cls, month: ShamsiMonth) -> Window:
        return cls(month.start, month.end)

    @classmethod
    def first_days(cls, month: ShamsiMonth, days: int) -> Window:
        return cls(month.start, month.start + timedelta(days=min(days, month.days)))


@dataclass(frozen=True)
class Comparison:
    """One month against the one before it, cut where the brief says."""

    month: ShamsiMonth
    ref_month: ShamsiMonth
    now: Window
    ref: Window
    #: The day of the month the running month is cut at; None when closed.
    day: int | None

    @property
    def running(self) -> bool:
        return self.day is not None

    def as_dict(self) -> dict:
        return {
            "month": self.month.as_dict(),
            "ref_month": self.ref_month.as_dict(),
            "running": self.running,
            "day": self.day,
            "days_in_month": self.month.days,
            "ref_day": (self.ref.end - self.ref.start).days,
        }


def compare(month: ShamsiMonth, today: date) -> Comparison:
    """The window pair for ``month``. A month after today's is a ``ValueError``."""
    current = ShamsiMonth.of(today)
    if month > current:
        raise ValueError("That month has not started yet")
    previous = month.previous()
    if month == current:
        day = jalali.to_shamsi_date(today)[2]
        return Comparison(
            month,
            previous,
            Window.first_days(month, day),
            Window.first_days(previous, day),
            day,
        )
    return Comparison(month, previous, Window.whole(month), Window.whole(previous), None)


def months_between(first: ShamsiMonth, last: ShamsiMonth) -> list[ShamsiMonth]:
    """Every month from ``first`` to ``last`` inclusive, oldest first."""
    out = []
    month = first
    while month <= last:
        out.append(month)
        month = month.next()
    return out


def last_months(today: date, count: int) -> list[ShamsiMonth]:
    """The ``count`` months up to and including today's, oldest first."""
    last = ShamsiMonth.of(today)
    first = last
    for _ in range(count - 1):
        first = first.previous()
    return months_between(first, last)


def tehran_day(moment: datetime | date | None) -> date | None:
    """A timestamp as the Tehran calendar day it fell on.

    A tz-aware ``reviewed_at`` of 22:00 UTC is already the next day in Tehran,
    and a month boundary has to be the one the people it measures live in.
    A naive datetime (SQLite in tests) is taken as UTC.
    """
    if moment is None:
        return None
    if isinstance(moment, datetime):
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment.astimezone(jalali.TEHRAN).date()
    return moment
