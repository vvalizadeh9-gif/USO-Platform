"""The overdue rule, at its boundaries, and the 1 Mehr 1405 tracking epoch.

* a configured queue is overdue strictly *after* its SLA: 14 days exactly is
  on time, a second more is late;
* an item with no clock start, or one from before tracking began, is measured
  from 1 Mehr 1405 -- never from an older CPM date, and never "age unknown";
* fixes and deadline queues are overdue strictly after their own due date,
  whatever the configured days say.
"""
import os
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("APP_ENV", "development")

from app.services.action_queues import sla  # noqa: E402
from app.services.action_queues.types import PendingItem, SlaKind  # noqa: E402

EPOCH = sla.TRACKING_EPOCH


def _overdue(started=None, due=None, kind=SlaKind.CONFIGURED, days=14, now=None):
    return sla.is_overdue(PendingItem(1, started, due_at=due), kind, days, now)


def test_the_epoch_is_1_mehr_1405_midnight_in_tehran():
    assert EPOCH == datetime(2026, 9, 22, 20, 30, tzinfo=timezone.utc)


def test_fourteen_days_exactly_is_on_time_and_a_second_more_is_late():
    start = datetime(2026, 10, 1, 8, tzinfo=timezone.utc)
    assert not _overdue(start, now=start + timedelta(days=14))
    assert _overdue(start, now=start + timedelta(days=14, seconds=1))


def test_the_configured_days_are_what_counts():
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    now = start + timedelta(days=8)
    assert not _overdue(start, days=14, now=now)
    assert _overdue(start, days=7, now=now)


def test_undated_items_start_at_the_epoch():
    assert sla.effective_start(None) == EPOCH
    assert not _overdue(None, now=EPOCH + timedelta(days=14))
    assert _overdue(None, now=EPOCH + timedelta(days=14, seconds=1))


def test_dates_before_the_epoch_are_floored_to_it():
    years_ago = date(2023, 5, 1)
    assert sla.effective_start(years_ago) == EPOCH
    assert not _overdue(years_ago, now=EPOCH + timedelta(days=1))


def test_a_date_starts_at_midnight_in_tehran():
    assert sla.as_datetime(date(2026, 10, 5)) == datetime(2026, 10, 4, 20, 30, tzinfo=timezone.utc)


def test_naive_datetimes_are_read_as_utc():
    naive = datetime(2026, 10, 2, 9, 0)
    assert sla.as_datetime(naive) == datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc)


def test_a_fix_is_late_after_its_own_category_due_date_not_the_days():
    due = datetime(2026, 10, 10, tzinfo=timezone.utc)
    start = due - timedelta(days=60)
    assert not _overdue(start, due, SlaKind.CATEGORY, days=1, now=due)
    assert _overdue(start, due, SlaKind.CATEGORY, days=365, now=due + timedelta(seconds=1))


def test_a_fix_without_a_due_date_is_never_late():
    assert not _overdue(None, None, SlaKind.CATEGORY, now=EPOCH + timedelta(days=400))


def test_a_deadline_queue_is_late_only_after_the_deadline():
    due = datetime(2026, 10, 25, 20, 30, tzinfo=timezone.utc)
    assert not _overdue(None, due, SlaKind.DEADLINE, now=due)
    assert _overdue(None, due, SlaKind.DEADLINE, now=due + timedelta(seconds=1))
