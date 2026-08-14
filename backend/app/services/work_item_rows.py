"""Flatten a WorkItem's workflow graph into a single list row.

The Work Items screen shows a different column set per stage tab (assignment
date & user for Assigned, returned date for Returned, DT + approval metadata
and aging for Coordinator Approved, ...). Rather than one endpoint per tab,
the list endpoint returns the union of those columns and the frontend renders
the subset it needs.

Keeping the flattening here — not in the API layer — means the stage tabs, any
future export, and any report all derive these values identically.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.models.workitem import Assignment, DriveTest, WorkItem


def _as_aware(dt: datetime | None) -> datetime | None:
    """Coerce a possibly-naive datetime to UTC-aware.

    Postgres stores these tz-aware, but SQLite (tests) and older rows can be
    naive; normalising keeps the aging subtraction below from raising.
    """
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _relevant_assignment(work_item: WorkItem) -> Assignment | None:
    """The assignment whose metadata the row should show.

    Prefers the currently-active one; falls back to the most recent historical
    assignment so a contractor's completed/reassigned sites still show who
    they were assigned to and when, rather than an empty row.
    """
    active = [a for a in work_item.assignments if a.is_active]
    pool = active or list(work_item.assignments)
    return max(pool, key=lambda a: a.id) if pool else None


def active_drive_test(work_item: WorkItem) -> DriveTest | None:
    """The work item's current drive test, if one is in flight or decided."""
    active = [dt for dt in work_item.drive_tests if dt.is_active]
    return max(active, key=lambda d: d.id) if active else None


def _active_drive_test(work_item: WorkItem) -> DriveTest | None:
    return active_drive_test(work_item)


def _aging_days(
    assignment: Assignment | None, drive_test: DriveTest | None
) -> int | None:
    """Whole days between assignment and drive-test submission.

    Returns None unless both endpoints exist. Never negative — a DT dated
    before its assignment is bad data, not negative aging.
    """
    if assignment is None or drive_test is None:
        return None
    assigned_at = _as_aware(assignment.assigned_at)
    if assigned_at is None or drive_test.execution_date is None:
        return None
    delta = drive_test.execution_date - assigned_at.date()
    return max(delta.days, 0)


def build_list_row(work_item: WorkItem, user_names: dict[int, str]) -> dict:
    """Flatten one work item into the Work Items list-row shape.

    ``user_names`` maps user id -> full name, resolved in one query by the
    caller so this stays free of per-row database access (no N+1).
    """
    assignment = _relevant_assignment(work_item)
    drive_test = _active_drive_test(work_item)

    approval_date = None
    approval_user = None
    dt_submission_date = None
    if drive_test is not None:
        dt_submission_date = drive_test.execution_date
        if drive_test.status == "Approved":
            approval_date = _as_aware(drive_test.coordinator_reviewed_at)
            approval_user = user_names.get(drive_test.coordinator_reviewed_by)

    return {
        "id": work_item.id,
        "site_code": work_item.site.site_code if work_item.site else None,
        "site_type": work_item.site_type,
        "requested_technology": work_item.requested_technology,
        "current_stage": work_item.current_stage,
        "project_name": work_item.project_name,
        "assignment_date": _as_aware(assignment.assigned_at) if assignment else None,
        "assignment_user": (
            user_names.get(assignment.assigned_by) if assignment else None
        ),
        "contractor_name": (
            assignment.contractor.name
            if assignment is not None and assignment.contractor is not None
            else None
        ),
        "returned_date": _as_aware(assignment.returned_at) if assignment else None,
        "dt_submission_date": dt_submission_date,
        "dt_approval_date": approval_date,
        "dt_approval_user": approval_user,
        "aging_days": _aging_days(assignment, drive_test),
    }


def referenced_user_ids(work_items: list[WorkItem]) -> set[int]:
    """Every user id the rows will need a name for, in one pass."""
    ids: set[int] = set()
    for wi in work_items:
        for a in wi.assignments:
            if a.assigned_by is not None:
                ids.add(a.assigned_by)
        for dt in wi.drive_tests:
            if dt.coordinator_reviewed_by is not None:
                ids.add(dt.coordinator_reviewed_by)
    return ids
