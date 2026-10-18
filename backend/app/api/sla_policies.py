"""Admin > SLA policies (UEP-15): every step's SLA in days, edited in one place.

PM and Admin edit; Viewer reads; every other role gets 403. Rules live in
``services/sla_policy``.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.database import get_db
from app.core.deps import ADMIN, PM, VIEWER, require_roles
from app.models.reference import User
from app.services import sla_policy
from app.services.audit import record_audit

router = APIRouter(prefix="/admin/sla-policies", tags=["sla-policies"])

can_read = require_roles(PM, ADMIN, VIEWER)
can_edit = require_roles(PM, ADMIN)


class SlaChangeIn(BaseModel):
    step_key: str
    days: int
    expected_days: int | None = None


class SlaUpdateIn(BaseModel):
    changes: list[SlaChangeIn]


def _audit(db: Session, user: User, change_id: uuid.UUID, old: dict, new: dict) -> None:
    record_audit(
        db, user_id=user.id, action=audit_actions.UPDATED, module="Admin",
        entity_type="SlaPolicy", entity_id=None,
        old_value={"change_id": str(change_id), "days": old},
        new_value={"change_id": str(change_id), "days": new},
    )


def _response(db: Session, change_id: uuid.UUID | None = None) -> dict:
    out = sla_policy.listing(db)
    if change_id is not None:
        out["change_id"] = str(change_id)
    return out


@router.get("")
def get_sla_policies(db: Session = Depends(get_db), _: User = Depends(can_read)) -> dict:
    return _response(db)


@router.put("")
def put_sla_policies(
    body: SlaUpdateIn, db: Session = Depends(get_db), user: User = Depends(can_edit)
) -> dict:
    """Save every changed step in one transaction. 409 if any is stale."""
    before = sla_policy.get_all(db)
    try:
        change_id = sla_policy.update(db, [c.model_dump() for c in body.changes], user)
    except KeyError as exc:
        raise HTTPException(422, f"Unknown step {exc.args[0]}") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except sla_policy.StaleChange as exc:
        db.rollback()
        raise HTTPException(
            409, {"message": "Someone else changed these SLAs. The latest values are loaded.",
                  "stale": exc.stale},
        ) from exc
    after = sla_policy.get_all(db)
    changed = {k: after[k] for k in after if before.get(k) != after[k]}
    if changed:
        _audit(db, user, change_id, {k: before.get(k) for k in changed}, changed)
    db.commit()
    return _response(db, change_id)


@router.get("/history")
def get_sla_history(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), _: User = Depends(can_read),
) -> list[dict]:
    return sla_policy.history(db, limit)


@router.post("/revert/{change_id}")
def revert_sla_change(
    change_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(can_edit)
) -> dict:
    before = sla_policy.get_all(db)
    try:
        new_id = sla_policy.revert(db, change_id, user)
    except LookupError as exc:
        raise HTTPException(404, "No such change") from exc
    after = sla_policy.get_all(db)
    changed = {k: after[k] for k in after if before.get(k) != after[k]}
    if changed:
        _audit(db, user, new_id, {k: before.get(k) for k in changed}, changed)
    db.commit()
    return _response(db, new_id)
