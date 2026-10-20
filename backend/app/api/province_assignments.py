"""Admin > Province assignments (UEP-17): one coordinator per CRA region.

PM and Admin edit; Viewer reads; every other role gets 403. Rules live in
``services/province_assignment``.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ADMIN, PM, VIEWER, require_roles
from app.models.reference import User
from app.services import province_assignment

router = APIRouter(prefix="/admin/province-assignments", tags=["province-assignments"])

can_read = require_roles(PM, ADMIN, VIEWER)
can_edit = require_roles(PM, ADMIN)


class RegionChangeIn(BaseModel):
    cra_region: str
    coordinator_user_id: int
    #: Required, and may be null: a region with no owner is still a value the
    #: client must have seen, so every change is checked against it.
    expected_coordinator_user_id: int | None


class AssignmentUpdateIn(BaseModel):
    changes: list[RegionChangeIn]


def _response(db: Session, change_id: uuid.UUID | None = None) -> dict:
    out = province_assignment.get_overview(db)
    if change_id is not None:
        out["change_id"] = str(change_id)
    return out


@router.get("")
def get_province_assignments(
    db: Session = Depends(get_db), _: User = Depends(can_read)
) -> dict:
    return _response(db)


@router.put("")
def put_province_assignments(
    body: AssignmentUpdateIn, db: Session = Depends(get_db), user: User = Depends(can_edit)
) -> dict:
    """Save every changed region in one transaction. 409 if any is stale."""
    try:
        change_id = province_assignment.update(
            db, [c.model_dump() for c in body.changes], user
        )
    except province_assignment.AssignmentError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    except province_assignment.StaleChange as exc:
        db.rollback()
        raise HTTPException(
            409,
            {"message": "Assignments changed since you opened the page.",
             "stale": exc.stale},
        ) from exc
    db.commit()
    return _response(db, change_id)


@router.get("/history")
def get_province_assignment_history(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db), _: User = Depends(can_read),
) -> list[dict]:
    return province_assignment.history(db, limit)


@router.post("/revert/{change_id}")
def revert_province_assignment(
    change_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(can_edit)
) -> dict:
    try:
        new_id = province_assignment.revert(db, change_id, user)
    except LookupError as exc:
        raise HTTPException(404, "No such change") from exc
    except province_assignment.AssignmentError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    db.commit()
    return _response(db, new_id)
