"""The pending-work settings: each queue's SLA days (Admin) and each user's
digest opt-out.

Thin by design: every rule is in ``services/action_queues``, which also feeds
Home, the app rail counts and the daily digest. Home is each user's view of
their pending work; there is no separate board screen.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.database import get_db
from app.core.deps import ADMIN, get_current_user, require_roles
from app.models.action_center import ActionQueueSla
from app.models.reference import User
from app.schemas.action_center import (
    NotificationsIn,
    NotificationsOut,
    QueueSlaIn,
    QueueSlaOut,
)
from app.services.action_queues import sla
from app.services.action_queues.registry import QUEUES, QUEUES_BY_KEY
from app.services.action_queues.types import STAGE_LABELS, SlaKind
from app.services.audit import record_audit

router = APIRouter(tags=["work-queues"])


# --------------------------------------------------------------------------
# SLA settings (Admin)
# --------------------------------------------------------------------------
def _sla_rows(db: Session) -> list[QueueSlaOut]:
    days = sla.sla_days_by_queue(db, [q.key for q in QUEUES])
    return [
        QueueSlaOut(
            queue_key=q.key, label=q.label, stage=STAGE_LABELS[q.stage],
            sla_days=days[q.key], configurable=q.sla is SlaKind.CONFIGURED,
        )
        for q in QUEUES
    ]


@router.get("/admin/action-sla", response_model=list[QueueSlaOut])
def get_action_sla(
    db: Session = Depends(get_db), _: User = Depends(require_roles(ADMIN))
) -> list[QueueSlaOut]:
    return _sla_rows(db)


@router.put("/admin/action-sla", response_model=list[QueueSlaOut])
def put_action_sla(
    body: list[QueueSlaIn],
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
) -> list[QueueSlaOut]:
    """Set the SLA days of one or more queues. Takes effect on the next read."""
    for item in body:
        queue = QUEUES_BY_KEY.get(item.queue_key)
        if queue is None:
            raise HTTPException(422, f"Unknown queue {item.queue_key!r}")
        if queue.sla is not SlaKind.CONFIGURED:
            raise HTTPException(
                422, f"{queue.label} is measured against its own due date, not SLA days"
            )
    for item in body:
        row = db.get(ActionQueueSla, item.queue_key)
        old = row.sla_days if row else None
        if row is None:
            row = ActionQueueSla(queue_key=item.queue_key)
            db.add(row)
        row.sla_days = item.sla_days
        row.updated_by = admin.id
        record_audit(
            db, user_id=admin.id, action=audit_actions.UPDATED, module="action_center",
            entity_type="ActionQueueSla", entity_id=None,
            old_value={"queue_key": item.queue_key, "sla_days": old},
            new_value={"queue_key": item.queue_key, "sla_days": item.sla_days},
        )
    db.commit()
    return _sla_rows(db)


# --------------------------------------------------------------------------
# My notifications
# --------------------------------------------------------------------------
@router.get("/me/notifications", response_model=NotificationsOut)
def get_my_notifications(user: User = Depends(get_current_user)) -> NotificationsOut:
    return NotificationsOut(email_digest=user.email_digest_enabled)


@router.put("/me/notifications", response_model=NotificationsOut)
def put_my_notifications(
    body: NotificationsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationsOut:
    """Turn the daily email digest on or off for yourself.

    ``user`` is bound to this request's session (``get_db`` is shared within a
    request), so the change commits with it.
    """
    user.email_digest_enabled = body.email_digest
    db.commit()
    return NotificationsOut(email_digest=user.email_digest_enabled)
