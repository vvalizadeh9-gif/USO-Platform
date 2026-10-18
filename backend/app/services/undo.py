"""Undoing an assignment or a confirmation, for two minutes after it was made.

Three actions can be taken back: a health-check assignment, a bulk drive-test
assignment and a batch of Confirm ready decisions. Each may be undone only

* by the user who made it,
* within :data:`UNDO_WINDOW` of making it, and
* while nothing has happened to any of its sites since -- no result
  submitted, no drive test filed, no assignment raised on top of it.

Undo restores the previous state exactly and writes an ``UNDONE`` audit entry
naming what it reversed. Nothing new is stored: the batch is the audit entry
the original action already wrote, which now carries the ids it created and
the ones it replaced. A refusal is :class:`UndoRefused`, which the API answers
with 409.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.models.acceptance import AuditLog
from app.models.health_check import HcAssignment, HcTask, HcTaskVillage
from app.models.reference import User
from app.models.workitem import Assignment, AssignmentVillage, DriveTest
from app.services import health_check as hc
from app.services.action_queues.sla import as_datetime
from app.services.audit import record_audit
from app.services.workflow import refresh_stage

UNDO_WINDOW = timedelta(minutes=2)

#: The audit entry types that name a batch.
DT_ASSIGN_BATCH = "WorkItemBulk"
HC_CONFIRM_BATCH = "HcTaskBatch"

TOO_LATE = "Too late to undo; reassign the sites instead."


class UndoRefused(Exception):
    """The action can no longer be undone. The message is the screen's."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _within_window(at: datetime | None, now: datetime) -> bool:
    at = as_datetime(at)
    return at is not None and now - at <= UNDO_WINDOW


def _batch(db: Session, user: User, batch_id: int, entity_type: str, action: str) -> AuditLog:
    entry = db.get(AuditLog, batch_id)
    if (
        entry is None
        or entry.user_id != user.id
        or entry.entity_type != entity_type
        or entry.action != action
    ):
        # Somebody else's batch reads as missing, never as "not yours".
        raise LookupError("Nothing to undo")
    return entry


def _undone(db: Session, user: User, *, module: str, entity_type: str, entity_id, old_value):
    record_audit(
        db, user_id=user.id, action=audit_actions.UNDONE, module=module,
        entity_type=entity_type, entity_id=entity_id, old_value=old_value,
        reason="Undone within two minutes by the user who made it",
    )


# --------------------------------------------------------------------------
# A health-check assignment
# --------------------------------------------------------------------------
def undo_hc_assignment(db: Session, user: User, assignment: HcAssignment) -> None:
    """Withdraw a health-check assignment nobody has started on.

    Its tasks were created by it and have no results, so removing them and
    the assignment is the exact previous state; the sites' stages are then
    recomputed, which returns them to the pool.
    """
    now = _now()
    if assignment.assigned_by != user.id:
        raise LookupError("Nothing to undo")
    if not _within_window(assignment.assigned_at, now):
        raise UndoRefused(TOO_LATE)
    if any(t.completed_at is not None or t.technologies for t in assignment.tasks):
        raise UndoRefused(TOO_LATE)

    work_item_ids = [t.work_item_id for t in assignment.tasks]
    old = {"code": assignment.code, "work_item_ids": work_item_ids}
    for task in list(assignment.tasks):
        db.execute(HcTaskVillage.__table__.delete().where(HcTaskVillage.hc_task_id == task.id))
        db.delete(task)
    db.flush()
    db.delete(assignment)
    db.flush()
    hc._refresh_stages(db, work_item_ids)
    _undone(db, user, module="HealthCheck", entity_type="HcAssignment",
            entity_id=assignment.id, old_value=old)


# --------------------------------------------------------------------------
# A bulk drive-test assignment
# --------------------------------------------------------------------------
def undo_dt_assignment(db: Session, user: User, batch_id: int, load_work_item) -> None:
    """Remove the assignments a bulk assign created and reactivate the ones
    it replaced. ``load_work_item`` is the router's scoped loader."""
    now = _now()
    entry = _batch(db, user, batch_id, DT_ASSIGN_BATCH, audit_actions.ASSIGNED)
    created: dict = (entry.new_value or {}).get("created") or {}
    replaced: dict = (entry.new_value or {}).get("replaced") or {}
    if not created or not _within_window(entry.created_at, now):
        raise UndoRefused(TOO_LATE)

    rows = {
        a.id: a
        for a in db.execute(
            select(Assignment).where(Assignment.id.in_([int(i) for i in created.values()]))
        ).scalars()
    }
    for wi_id, assignment_id in created.items():
        a = rows.get(int(assignment_id))
        if a is None or not a.is_active or a.returned_at is not None:
            raise UndoRefused(TOO_LATE)
        # Filed since: a drive test submitted (or, for a row with no
        # submission time, created) at or after this assignment.
        filed = db.execute(
            select(DriveTest.id).where(
                DriveTest.work_item_id == int(wi_id),
                func.coalesce(DriveTest.submitted_at, DriveTest.created_at) >= a.assigned_at,
            )
        ).first()
        if filed is not None:
            raise UndoRefused(TOO_LATE)

    for wi_id, assignment_id in created.items():
        wi = load_work_item(int(wi_id))
        a = rows[int(assignment_id)]
        wi.assignments.remove(a)
        db.execute(AssignmentVillage.__table__.delete().where(AssignmentVillage.assignment_id == a.id))
        db.delete(a)
        previous = set(replaced.get(str(wi_id)) or [])
        for prev in wi.assignments:
            if prev.id in previous:
                prev.is_active = True
        db.flush()
        refresh_stage(wi)
    _undone(db, user, module="Assignment", entity_type=DT_ASSIGN_BATCH,
            entity_id=entry.id, old_value={"created": created, "replaced": replaced})


# --------------------------------------------------------------------------
# Confirm ready / Confirm all
# --------------------------------------------------------------------------
def undo_hc_confirm(db: Session, user: User, batch_id: int, load_task) -> None:
    """Put confirmed Ready results back in HC Review.

    Refused once any of the sites has been sent for a drive test since, or
    has a newer health check, because the confirmation is then load-bearing.
    """
    now = _now()
    entry = _batch(db, user, batch_id, HC_CONFIRM_BATCH, audit_actions.REVIEWED)
    task_ids = (entry.new_value or {}).get("task_ids") or []
    if not task_ids or not _within_window(entry.created_at, now):
        raise UndoRefused(TOO_LATE)

    tasks = [load_task(int(i)) for i in task_ids]
    for task in tasks:
        if task.reviewed_at is None or task.reviewed_by != user.id:
            raise UndoRefused(TOO_LATE)
        assigned_since = db.execute(
            select(Assignment.id).where(
                Assignment.work_item_id == task.work_item_id,
                Assignment.assigned_at >= task.reviewed_at,
            )
        ).first()
        newer_check = db.execute(
            select(HcTask.id).where(
                HcTask.work_item_id == task.work_item_id, HcTask.id > task.id
            )
        ).first()
        if assigned_since is not None or newer_check is not None:
            raise UndoRefused(TOO_LATE)

    for task in tasks:
        task.reviewed_by = None
        task.reviewed_at = None
        db.flush()
        if task.work_item is not None:
            refresh_stage(task.work_item)
    db.flush()
    _undone(db, user, module="HealthCheck", entity_type=HC_CONFIRM_BATCH,
            entity_id=entry.id, old_value={"task_ids": task_ids})
