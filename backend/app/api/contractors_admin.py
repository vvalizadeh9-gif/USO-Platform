"""Admin > Contractors (UEP-31): which drive-test contractors appear in Drive
test, and contractors added by hand.

PM and Admin edit; Viewer reads; every other role gets 403. Hiding a
contractor only takes them out of the Assign columns: open sites, history and
login stay. Every change is audit-logged.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.access import Feature as F, require_access
from app.core.database import get_db
from app.models.reference import Contractor, User
from app.services import contractor_load
from app.services.action_queues.context import QueueContext
from app.services.audit import record_audit

router = APIRouter(prefix="/admin/contractors", tags=["contractors-admin"])

can_read = require_access(F.CONTRACTORS, "view")
can_edit = require_access(F.CONTRACTORS, "edit")


class ContractorIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class VisibilityIn(BaseModel):
    show_in_drive_test: bool


def _key(name: str) -> str:
    """The CPM import's rule: case- and space-insensitive."""
    return " ".join(name.split()).lower()


def _row(c: Contractor, hc: dict, dt: dict) -> dict:
    load_hc, load_dt = hc.get(c.id, {}), dt.get(c.id, {})
    provinces = []
    for share in load_dt.get("provinces", []) + load_hc.get("provinces", []):
        if share["province"] not in provinces:
            provinces.append(share["province"])
    return {
        "id": c.id,
        "name": c.name,
        "source": c.source,
        "show_in_drive_test": c.show_in_drive_test,
        "created_at": c.created_at,
        "open_hc": load_hc.get("open", 0),
        "open_dt": load_dt.get("open", 0),
        "provinces": provinces,
    }


def _loads(db: Session, user: User) -> tuple[dict, dict]:
    ctx = QueueContext(db, user)
    return tuple(
        {r["contractor_id"]: r for r in contractor_load.contractor_load(ctx, p, shown_only=False)}
        for p in ("hc", "dt")
    )


@router.get("")
def list_contractors(db: Session = Depends(get_db), user: User = Depends(can_read)) -> list[dict]:
    """Every drive-test contractor, A to Z, with open work and learned provinces."""
    hc, dt = _loads(db, user)
    found = db.execute(
        select(Contractor).where(Contractor.type == "drive_test").order_by(Contractor.name)
    ).scalars()
    return [_row(c, hc, dt) for c in found]


@router.post("", status_code=201)
def add_contractor(body: ContractorIn, db: Session = Depends(get_db), user: User = Depends(can_edit)) -> dict:
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(422, "Enter a name.")
    if any(_key(n) == _key(name) for n in db.execute(select(Contractor.name)).scalars()):
        raise HTTPException(409, "A contractor with this name already exists.")
    c = Contractor(name=name, type="drive_test", active=True, show_in_drive_test=True, source="manual")
    db.add(c)
    db.flush()
    db.refresh(c)
    record_audit(
        db, user_id=user.id, action=audit_actions.CONTRACTOR_CREATED, module="admin",
        entity_type="contractor", entity_id=c.id, new_value={"name": name, "show_in_drive_test": True},
    )
    db.commit()
    return _row(c, {}, {})


@router.patch("/{contractor_id}")
def set_visibility(
    contractor_id: int, body: VisibilityIn, db: Session = Depends(get_db), user: User = Depends(can_edit)
) -> dict:
    c = db.get(Contractor, contractor_id)
    if c is None or c.type != "drive_test":
        raise HTTPException(404, "Contractor not found.")
    before = c.show_in_drive_test
    c.show_in_drive_test = body.show_in_drive_test
    if before != body.show_in_drive_test:
        record_audit(
            db, user_id=user.id, action=audit_actions.CONTRACTOR_VISIBILITY_CHANGED, module="admin",
            entity_type="contractor", entity_id=c.id,
            old_value={"show_in_drive_test": before}, new_value={"show_in_drive_test": body.show_in_drive_test},
        )
    db.commit()
    hc, dt = _loads(db, user)
    return _row(c, hc, dt)
