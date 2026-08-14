"""Workflow service: derives Work Item lifecycle stage from database state.

Per the design, status is *derived* rather than manually set wherever the
system can compute it. This keeps a single source of truth for stage logic.
"""
from datetime import datetime, timezone

from app.models.workitem import WorkItem

STAGE_NEW = "New"
STAGE_HEALTH_PROBLEM = "Problematic"
STAGE_READY = "Ready for Assignment"
STAGE_ASSIGNED = "Assigned"
STAGE_RETURNED = "Returned by Contractor"
STAGE_DT_SUBMITTED = "DT Submitted"
# Coordinator approval is terminal: an approved drive test *is* a completed
# drive test. There is no separate PM sign-off step and no "DT Completed"
# stage — approving writes the outcome straight through to the work item's
# dt_status/dt_date_gregorian, which is what the Drive Test dashboard reads.
STAGE_COORD_APPROVED = "Coordinator Approved"


def _completed_at(task) -> datetime:
    """A task's completion time, always tz-aware.

    Once a site can be health-checked more than once, these values get
    compared against each other — and a row read back from SQLite (or written
    by an older build) can be naive while a freshly-set one is aware, which
    makes the comparison raise. Normalising here keeps "which check was last"
    answerable regardless of how each row was stored.
    """
    dt = task.completed_at
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def derive_stage(work_item: WorkItem) -> str:
    """Compute the current lifecycle stage from related records.

    The function is intentionally small and pure: it reads the aggregate's
    children and returns a stage string. No database writes here.
    """
    active_dt = _latest_active_dt(work_item)
    if active_dt is not None:
        if active_dt.status == "Approved":
            return STAGE_COORD_APPROVED
        if active_dt.status in ("Submitted", "Returned"):
            return STAGE_DT_SUBMITTED

    active_assignment = _latest_active_assignment(work_item)
    if active_assignment is not None:
        if active_assignment.returned_at is not None:
            return STAGE_RETURNED
        return STAGE_ASSIGNED

    hc_status = _latest_hc_status(work_item)
    if hc_status is not None:
        if hc_status == "Problematic":
            return STAGE_HEALTH_PROBLEM
        return STAGE_READY

    return STAGE_NEW


def refresh_stage(work_item: WorkItem) -> None:
    """Recompute and persist the derived stage on the work item."""
    work_item.current_stage = derive_stage(work_item)


def _latest_active_dt(work_item: WorkItem):
    active = [dt for dt in work_item.drive_tests if dt.is_active]
    return max(active, key=lambda d: d.id) if active else None


def _latest_active_assignment(work_item: WorkItem):
    active = [a for a in work_item.assignments if a.is_active]
    return max(active, key=lambda a: a.id) if active else None


def _has_active_assignment(work_item: WorkItem) -> bool:
    return _latest_active_assignment(work_item) is not None


def _latest_hc_status(work_item: WorkItem) -> str | None:
    """Latest health-check outcome as ``Ready`` | ``Problematic`` | ``None``.

    Prefers the current HC workflow (``hc_tasks`` with a computed
    ``overall_result``); falls back to the legacy ``health_checks`` table so
    any pre-migration data still resolves. Returns ``None`` when no health
    check has been completed for this site yet.
    """
    completed = [t for t in work_item.hc_tasks if t.completed_at is not None]
    if completed:
        latest = max(completed, key=_completed_at)
        # New model: overall_result is 'Ready' | 'NotReady'.
        return "Problematic" if latest.overall_result == "NotReady" else "Ready"

    last_legacy = max(work_item.health_checks, key=lambda h: h.id, default=None)
    if last_legacy is not None:
        return "Problematic" if last_legacy.status == "Problematic" else "Ready"
    return None


def latest_problem_category_name(work_item: WorkItem) -> str | None:
    """The human-readable problem category for a NotReady/Problematic site.

    Single source of truth for "why is this site problematic", used by both
    the Work Item screens and the Drive Test dashboard so they never disagree.
    Preference order:
      1. The current HC workflow's reviewed category (``hc_tasks``) — the
         Admin/PM/Coordinator dropdown selection is the authoritative source
         going forward.
      2. The legacy ``health_checks`` category, for pre-migration data.
      3. ``None`` — callers that also have a CPM-imported free-text category
         (``WorkItem.dt_problem_category``) should fall back to that
         themselves; this function never reads it, since CPM text isn't a
         validated category.
    """
    completed = [t for t in work_item.hc_tasks if t.completed_at is not None]
    if completed:
        latest = max(completed, key=_completed_at)
        return latest.problem_category

    last_legacy = max(work_item.health_checks, key=lambda h: h.id, default=None)
    if last_legacy is not None and last_legacy.problem_category is not None:
        return last_legacy.problem_category.name
    return None


def is_fully_accepted(work_item: WorkItem) -> bool:
    """A Work Item is fully accepted only when every village's every
    technology is ICT- and CRA-approved."""
    if not work_item.villages:
        return False
    for village in work_item.villages:
        if not village.acceptances:
            return False
        for acc in village.acceptances:
            if acc.ict_status != "Approved" or acc.cra_status != "Approved":
                return False
    return True
