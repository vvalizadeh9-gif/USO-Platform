"""The Action Center ticket board, its per-owner breakdown, the SLA settings
and each user's digest opt-out.

Thin by design: every rule is in ``services/action_queues``. This module
resolves the caller, maps "not your board" onto 403 and shapes the response.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.database import get_db
from app.core.deps import ADMIN, get_current_user, require_roles
from app.models.action_center import ActionQueueSla
from app.models.reference import User
from app.schemas.action_center import (
    BoardOut,
    NotificationsIn,
    NotificationsOut,
    OwnerRowOut,
    QueueSlaIn,
    QueueSlaOut,
    StageOut,
    TicketOut,
    Totals,
)
from app.services.action_queues import board as boards
from app.services.action_queues import sla
from app.services.action_queues.context import QueueContext
from app.services.action_queues.registry import QUEUES, QUEUES_BY_KEY
from app.services.action_queues.types import STAGE_LABELS, SlaKind
from app.services.audit import record_audit

router = APIRouter(tags=["action-center"])


def _forbidden(message: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, message)


def _board_out(board: boards.Board) -> BoardOut:
    return BoardOut(
        role=board.role,
        scope_label=board.scope_label,
        generated_at=board.generated_at,
        totals=Totals(pending=board.pending, overdue=board.overdue),
        stages=[
            StageOut(
                key=stage.key, label=stage.label, total=stage.total,
                tickets=[
                    TicketOut(
                        queue_key=t.queue.key, label=t.queue.label, count=t.count,
                        overdue=t.overdue, oldest_started_at=t.oldest_started_at,
                        earliest_due_at=t.earliest_due_at, date_kind=t.date_kind,
                        url=t.queue.url,
                    )
                    for t in stage.tickets
                ],
            )
            for stage in board.stages
        ],
    )


@router.get("/action-center/board", response_model=BoardOut)
def action_center_board(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> BoardOut:
    """Every queue this user acts on, as tickets grouped by lifecycle stage.

    PM, Coordinator, Contractor and problem owners only. Everyone else is
    refused rather than shown an empty board: an empty board reads as "nothing
    to do", which for a Regional Manager or Viewer would be untrue -- the
    Action Center is simply not their screen.
    """
    try:
        return _board_out(boards.board_for(db, user))
    except boards.NotOnBoard as exc:
        raise _forbidden(str(exc)) from None


@router.get("/action-center/owners", response_model=list[OwnerRowOut])
def action_center_owners(
    queue: str = Query(..., description="A queue key from the board"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[OwnerRowOut]:
    """Who holds this queue's pending items, worst first.

    A PM sees every owner; a coordinator sees the contractors inside their own
    provinces. Everyone else gets 403.
    """
    try:
        rows = boards.owners_breakdown(QueueContext(db, user), queue)
    except boards.NotOnBoard as exc:
        raise _forbidden(str(exc)) from None
    except boards.UnknownQueue:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown queue {queue!r}") from None
    return [OwnerRowOut(**vars(r)) for r in rows]


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
