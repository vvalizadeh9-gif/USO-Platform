"""Feature access: what the signed-in user may use, and Admin > Access (UEP-25).

``GET /me/access`` is the only thing the frontend reads to build navigation,
route guards and buttons. Everything under ``/admin/access`` is the Access
screen: Admin edits; PM and Viewer read (the ``access`` feature at View).
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.access import Feature as F, require_access
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.acceptance import AuditLog
from app.models.reference import Role, User
from app.services import access_admin
from app.services.access_admin import AccessRuleError

router = APIRouter(tags=["access"])

reader = require_access(F.ACCESS, "view")
editor = require_access(F.ACCESS, "edit")


def _refuse(exc: AccessRuleError) -> HTTPException:
    return HTTPException(422, str(exc))


# --------------------------------------------------------------------------
# What I may use
# --------------------------------------------------------------------------
@router.get("/me/access")
def my_access(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """``{features: {key: level}, hidden_in_menus, landing, ...}``. The
    frontend re-reads it on page load and every 5 minutes."""
    return access.access_map(user, db)


# --------------------------------------------------------------------------
# Catalogue and roles
# --------------------------------------------------------------------------
@router.get("/admin/access/features")
def list_features(db: Session = Depends(get_db), _: User = Depends(reader)) -> list[dict]:
    return [
        {"key": f.key, "app": f.app, "label": f.label, "description": f.description,
         "levels": list(f.levels), "sort_order": f.sort_order}
        for f in access_admin.catalogue(db)
    ]


def _role_out(db: Session, role: Role, counts: dict[int, int]) -> dict:
    grants = access_admin.role_grants(db, role.id)
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "landing": role.landing,
        "data_scope_type": role.data_scope_type,
        "is_system": role.is_system,
        "is_category_owner": role.is_category_owner,
        "user_count": counts.get(role.id, 0),
        "grants": {k: g.level for k, g in grants.items()},
        "hidden_in_menus": sorted(k for k, g in grants.items() if g.hidden_in_menus),
    }


@router.get("/admin/access/roles")
def list_roles(db: Session = Depends(get_db), _: User = Depends(reader)) -> list[dict]:
    counts = access_admin.user_counts(db)
    roles = db.scalars(select(Role).order_by(Role.is_system.desc(), Role.id))
    return [_role_out(db, r, counts) for r in roles]


class RoleUpdate(BaseModel):
    grants: dict[str, str] = Field(default_factory=dict)
    description: str | None = Field(default=None, max_length=255)
    landing: str | None = Field(default=None, max_length=80)
    data_scope_type: str | None = None
    reason: str | None = Field(default=None, max_length=500)


def _role(db: Session, role_id: int) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise HTTPException(404, "Role not found")
    return role


@router.put("/admin/access/roles/{role_id}")
def update_role(role_id: int, body: RoleUpdate, db: Session = Depends(get_db),
                admin: User = Depends(editor)) -> dict:
    role = _role(db, role_id)
    try:
        summary = access_admin.save_role(
            db, role, actor=admin, grants=body.grants, description=body.description,
            landing=body.landing, data_scope_type=body.data_scope_type, reason=body.reason,
        )
    except AccessRuleError as exc:
        db.rollback()
        raise _refuse(exc) from None
    db.commit()
    access.invalidate()
    return {"role": _role_out(db, role, access_admin.user_counts(db)), "summary": summary}


class RoleCreate(BaseModel):
    source_role_id: int
    name: str = Field(max_length=50)
    description: str | None = Field(default=None, max_length=255)


@router.post("/admin/access/roles", status_code=201)
def create_role(body: RoleCreate, db: Session = Depends(get_db),
                admin: User = Depends(editor)) -> dict:
    """Duplicate a role: how CPO is made from Viewer."""
    source = _role(db, body.source_role_id)
    try:
        role = access_admin.duplicate_role(db, source, name=body.name, actor=admin,
                                           description=body.description)
    except AccessRuleError as exc:
        db.rollback()
        raise _refuse(exc) from None
    db.commit()
    access.invalidate()
    return _role_out(db, role, access_admin.user_counts(db))


@router.delete("/admin/access/roles/{role_id}", status_code=204)
def remove_role(role_id: int, db: Session = Depends(get_db),
                admin: User = Depends(editor)) -> None:
    role = _role(db, role_id)
    try:
        access_admin.delete_role(db, role, actor=admin)
    except AccessRuleError as exc:
        db.rollback()
        raise _refuse(exc) from None
    db.commit()
    access.invalidate()


# --------------------------------------------------------------------------
# People
# --------------------------------------------------------------------------
def _person(u: User) -> dict:
    return {"id": u.id, "username": u.username, "full_name": u.full_name,
            "role": u.role.name if u.role else None, "role_id": u.role_id, "status": u.status}


@router.get("/admin/access/users")
def search_users(q: str = Query("", max_length=80), limit: int = Query(20, ge=1, le=50),
                 db: Session = Depends(get_db), _: User = Depends(reader)) -> list[dict]:
    query = select(User).order_by(User.first_name, User.family_name)
    term = q.strip()
    if term:
        like = f"%{term}%"
        query = query.where(or_(User.username.ilike(like), User.first_name.ilike(like),
                                User.family_name.ilike(like)))
    return [_person(u) for u in db.scalars(query.limit(limit))]


def _user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    return user


def _data_area(user: User) -> dict:
    return {
        "type": user.role.data_scope_type if user.role else "none",
        "sees_all_provinces": user.sees_all_provinces,
        "provinces": [p.name for p in user.provinces],
        "contractor": user.contractor.name if user.contractor else None,
    }


@router.get("/admin/access/users/{user_id}")
def user_access(user_id: int, db: Session = Depends(get_db), _: User = Depends(reader)) -> dict:
    user = _user(db, user_id)
    return {
        "user": _person(user),
        "data_area": _data_area(user),
        "features": access_admin.user_view(db, user),
    }


class OverrideIn(BaseModel):
    level: str
    reason: str = Field(min_length=1, max_length=500)
    expires_on: date | None = None


@router.put("/admin/access/users/{user_id}/overrides/{feature}")
def put_override(user_id: int, feature: str, body: OverrideIn,
                 db: Session = Depends(get_db), admin: User = Depends(editor)) -> dict:
    user = _user(db, user_id)
    # An expiry date means "through that day": it stops at the end of it, UTC.
    expires = (datetime.combine(body.expires_on, time.max, tzinfo=timezone.utc)
               if body.expires_on else None)
    try:
        access_admin.set_override(db, user, feature, level=body.level, reason=body.reason,
                                  actor=admin, expires_at=expires)
    except AccessRuleError as exc:
        db.rollback()
        raise _refuse(exc) from None
    db.commit()
    access.invalidate()
    return user_access(user_id, db)


@router.delete("/admin/access/users/{user_id}/overrides/{feature}")
def delete_override(user_id: int, feature: str, reason: str | None = Query(None, max_length=500),
                    db: Session = Depends(get_db), admin: User = Depends(editor)) -> dict:
    user = _user(db, user_id)
    try:
        removed = access_admin.remove_override(db, user, feature, actor=admin, reason=reason)
    except AccessRuleError as exc:
        db.rollback()
        raise _refuse(exc) from None
    if not removed:
        raise HTTPException(404, "No exception on that feature")
    db.commit()
    access.invalidate()
    return user_access(user_id, db)


@router.get("/admin/access/users/{user_id}/preview")
def preview_user(user_id: int, db: Session = Depends(get_db),
                 _: User = Depends(editor)) -> dict:
    """"View as this user": their /me/access and Home summary, read only.
    No impersonation, no session, no writes."""
    from app.services import home
    from app.services.action_queues.board import NotOnBoard

    user = _user(db, user_id)
    try:
        summary = home.summary_for(db, user)
    except NotOnBoard:
        summary = None
    return {"user": _person(user), "access": access.access_map(user, db), "home": summary}


# --------------------------------------------------------------------------
# History
# --------------------------------------------------------------------------
@router.get("/admin/access/history")
def history(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
            db: Session = Depends(get_db), _: User = Depends(reader)) -> dict:
    query = select(AuditLog).where(AuditLog.action.like("access.%"))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(AuditLog.id.desc()).offset(offset).limit(limit)).all()
    names = {}
    ids = {r.user_id for r in rows if r.user_id}
    if ids:
        names = {u.id: u.full_name for u in db.scalars(select(User).where(User.id.in_(ids)))}
    return {
        "total_count": total or 0,
        "items": [
            {"id": r.id, "action": r.action, "who": names.get(r.user_id, "System"),
             "created_at": r.created_at, "entity_type": r.entity_type, "entity_id": r.entity_id,
             "before": r.old_value, "after": r.new_value, "reason": r.reason}
            for r in rows
        ],
    }
