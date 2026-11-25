"""Acceptance cases (UEP-22): the Filing inbox and Insights > Acceptance baskets.

Resolves the caller, maps errors, holds no rules: those are in
``services/acceptance_cases``. Every endpoint is scoped by role (§4.4) inside
the services; the area check here only keeps out roles with no Filing.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.access import Area, require_access
from app.core.database import get_db
from app.models.acceptance_case import STATE_APPROVED, STATE_REJECTED, AcceptanceRejectionCategory
from app.models.reference import User
from app.services.acceptance_cases import baskets, counts, history, inbox, scope, update
from app.services.acceptance_cases.scope import CaseRow

router = APIRouter(tags=["acceptance-cases"])

require_filing = require_access(Area.ACCEPTANCE_CASES)
require_baskets = require_access(Area.ACCEPTANCE_BASKETS)


def _error(status: int, code: str, message: str, errors: list | None = None) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "errors": errors or []})


def _authority(raw: str) -> str:
    value = (raw or "").upper().strip()
    if value not in ("ICT", "CRA"):
        raise _error(400, "invalid_authority", "authority must be ICT or CRA")
    return value


def _kind(user: User) -> str:
    try:
        return scope.require_kind(user)
    except scope.ScopeError as exc:
        raise _error(403, "forbidden", str(exc)) from None


# --------------------------------------------------------------------------
# Filing
# --------------------------------------------------------------------------
@router.get("/acceptance/inbox")
def get_inbox(
    authority: str = Query(..., description="ICT|CRA"),
    tab: str = counts.TAB_ALL,
    q: str | None = Query(None, max_length=4000),
    basket: str | None = Query(None, max_length=80),
    bucket: str | None = Query(None, max_length=20),
    db: Session = Depends(get_db),
    user: User = Depends(require_filing),
) -> dict:
    """One authority's open cases: two groups, oldest in basket first."""
    _kind(user)
    counts.ensure_synced(db)
    try:
        out = inbox.build(db, user, _authority(authority), tab, inbox.Filters(q, basket, bucket))
    except inbox.InboxError as exc:
        raise _error(400, "invalid_tab", str(exc)) from None
    out["can"] = _abilities(user)
    return out


def _abilities(user: User) -> dict:
    kind = scope.viewer_kind(user)
    deciding = user.role.name in scope.DECIDING_ROLES
    return {
        "record_letters": deciding or kind == scope.KIND_CONTRACTOR,
        "comment": deciding or kind == scope.KIND_CONTRACTOR,
        "fix": deciding or kind in (scope.KIND_CONTRACTOR, scope.KIND_TEAM),
        "change_basket": deciding,
        # UEP-24 F10: a basket owner marks its own cases fixed (one button).
        "owner_fix": kind == scope.KIND_TEAM,
        "lands_directly": deciding,
        "read_only": not (deciding or kind in (scope.KIND_CONTRACTOR, scope.KIND_TEAM)),
    }


def _comment_line(row: CaseRow, latest: dict | None) -> dict:
    return {
        "stale": row.stale,
        "age_days": row.comment_age,
        "text": latest["text"] if latest and not row.stale else None,
        "author": latest["author"] if latest and not row.stale else None,
    }


def _status_label(row: CaseRow) -> str:
    if row.state == STATE_APPROVED:
        return "Approved"
    if row.state == STATE_REJECTED:
        return "Rejected"
    return f"Waiting for {row.authority}"


def _box(row: CaseRow, latest: dict | None, approved_on) -> dict:
    if row.state == STATE_APPROVED:
        sub = f"Approved on {approved_on:%d %b %Y}" if approved_on else "Approved"
    elif row.state == STATE_REJECTED:
        sub = f"{row.category_label or 'Needs category'} · {row.basket_owner} basket"
    else:
        sub = f"Contractor basket · {row.basket_owner}"
    return {
        "case_id": row.case_id, "authority": row.authority, "state": row.state,
        "label": _status_label(row), "days_in_basket": row.days_in_basket,
        "over_sla": row.over_sla, "sub": sub, "category": row.category_code,
        "basket_key": row.basket_key, "basket_owner": row.basket_owner,
        "in_validation": row.in_validation,
        "comment": None if row.state == STATE_APPROVED else _comment_line(row, latest),
    }


@router.get("/acceptance/cases/{village_id}")
def get_case(
    village_id: int,
    authority: str = Query(..., description="ICT|CRA"),
    db: Session = Depends(get_db),
    user: User = Depends(require_filing),
) -> dict:
    """A village's two status boxes, the current authority's first."""
    _kind(user)
    current = _authority(authority)
    c = counts.clock(db)
    rows = scope.all_cases_of_village(db, user, c, village_id)
    if not rows:
        raise _error(404, "not_found", "Village not found")
    latest = history.latest_comment(db, [r.case_id for r in rows])
    rows.sort(key=lambda r: r.authority != current)
    head = rows[0]
    return {
        "village": {
            "id": head.village_id, "code": head.village_code, "name": head.village_name,
            "site_code": head.site_code, "work_item_id": head.work_item_id,
            "province": head.province, "tech": head.tech,
            "contractor": head.contractor_name,
        },
        "boxes": [_box(r, latest.get(r.case_id), r.state_since if r.state == STATE_APPROVED else None)
                  for r in rows],
        "sla_days": c.sla_days,
        "fresh_days": c.fresh_days,
    }


@router.get("/acceptance/cases/{village_id}/history")
def get_history(
    village_id: int,
    authority: str = Query(..., description="ICT|CRA"),
    db: Session = Depends(get_db),
    user: User = Depends(require_filing),
) -> dict:
    _kind(user)
    wanted = _authority(authority)
    c = counts.clock(db)
    row = next((r for r in scope.all_cases_of_village(db, user, c, village_id) if r.authority == wanted), None)
    if row is None:
        raise _error(404, "not_found", "Village not found")
    return history.build(db, row, c.today)


class UpdateIn(BaseModel):
    village_ids: list[int] = Field(..., min_length=1, max_length=update.MAX_VILLAGES)
    authority: str
    choice: str
    comment: str | None = Field(None, max_length=4000)
    category: str | None = None
    letter_no: str | None = Field(None, max_length=120)
    letter_date: str | None = Field(None, max_length=20)
    scan_ids: list[str] = Field(default_factory=list, max_length=10)
    request_id: str | None = Field(None, max_length=64)


@router.post("/acceptance/cases/update")
def post_update(payload: UpdateIn, db: Session = Depends(get_db), user: User = Depends(require_filing)) -> dict:
    """Save one choice for one or many villages, all or nothing."""
    _kind(user)
    req = update.UpdateRequest(
        village_ids=tuple(payload.village_ids), authority=payload.authority,
        choice=payload.choice, comment=payload.comment, category=payload.category,
        letter_no=payload.letter_no, letter_date=payload.letter_date,
        scan_ids=tuple(payload.scan_ids), request_id=payload.request_id,
    )
    try:
        outcome = update.save(db, user, req)
    except update.UpdateError as exc:
        db.rollback()
        raise _error(exc.status, "invalid" if exc.status == 400 else "refused", exc.message, exc.errors) from None
    db.commit()
    return {
        "authority": outcome.authority, "choice": outcome.choice, "replayed": outcome.replayed,
        "applied": outcome.applied, "in_validation": outcome.in_validation,
    }


class BasketIn(BaseModel):
    category_id: int
    reason: str = Field(..., max_length=2000)


@router.post("/acceptance/cases/{case_id}/basket")
def post_basket(case_id: int, payload: BasketIn, db: Session = Depends(get_db),
                user: User = Depends(require_filing)) -> dict:
    try:
        update.change_basket(db, user, case_id, payload.category_id, payload.reason)
    except update.UpdateError as exc:
        db.rollback()
        raise _error(exc.status, "refused", exc.message, exc.errors) from None
    db.commit()
    return {"case_id": case_id, "category_id": payload.category_id}


class OwnerActionIn(BaseModel):
    action: str = Field(..., max_length=20)
    comment: str | None = Field(None, max_length=4000)
    scan_ids: list[str] = Field(default_factory=list, max_length=10)
    request_id: str | None = Field(None, max_length=64)


@router.post("/acceptance/cases/{case_id}/owner")
def post_owner_action(case_id: int, payload: OwnerActionIn, db: Session = Depends(get_db),
                      user: User = Depends(require_filing)) -> dict:
    """UEP-24 F10: the team that owns a basket comments on, or marks fixed, a
    case in it. Fixed moves the case to the Contractor basket."""
    try:
        update.owner_action(db, user, case_id, payload.action, payload.comment,
                            tuple(payload.scan_ids), payload.request_id)
    except update.UpdateError as exc:
        db.rollback()
        raise _error(exc.status, "invalid" if exc.status == 400 else "refused", exc.message, exc.errors) from None
    db.commit()
    return {"case_id": case_id, "action": payload.action}


@router.get("/acceptance/categories")
def get_categories(db: Session = Depends(get_db), user: User = Depends(require_filing)) -> list[dict]:
    cats = db.execute(
        select(AcceptanceRejectionCategory).where(AcceptanceRejectionCategory.active.is_(True))
        .order_by(AcceptanceRejectionCategory.sort)
    ).scalars()
    return [{"id": c.id, "code": c.code, "label": c.label, "basket_role": c.basket_role} for c in cats]


# --------------------------------------------------------------------------
# Insights > Acceptance baskets
# --------------------------------------------------------------------------
def _baskets_call(fn, *args):
    try:
        return fn(*args)
    except baskets.BasketsError as exc:
        raise _error(exc.status, "invalid" if exc.status == 400 else "forbidden", str(exc)) from None


@router.get("/insights/acceptance-baskets")
def get_baskets(authority: str = "both", db: Session = Depends(get_db),
                user: User = Depends(require_baskets)) -> dict:
    counts.ensure_synced(db)
    return _baskets_call(lambda: baskets.grid(db, user, baskets.authority_filter(authority)))


@router.get("/insights/acceptance-baskets/cell")
def get_basket_cell(
    basket: str = Query(..., max_length=80),
    bucket: str = Query(..., max_length=20),
    authority: str = "both",
    db: Session = Depends(get_db),
    user: User = Depends(require_baskets),
) -> dict:
    return _baskets_call(lambda: baskets.cell(db, user, basket, bucket, baskets.authority_filter(authority)))

