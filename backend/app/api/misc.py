"""Action Center and reference data endpoints."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.acceptance import Notification
from app.models.reference import (
    Contractor,
    ProblemCategory,
    Province,
    Role,
    User,
)
from app.schemas import (
    ActionCenterOut,
    ActionItem,
    ContractorOut,
    ProblemCategoryOut,
    ProvinceOut,
    RoleOut,
    UserOptionOut,
)
from app.services import action_center as action_center_service

router = APIRouter(tags=["misc"])


@router.get("/action-center", response_model=list[ActionItem])
def action_center(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[ActionItem]:
    """The flat item feed. Superseded by ``/action-center/summary``.

    Kept because it is what an older client asks for, and because several
    screens still deep-link from an individual item. New callers should use
    the summary, which leads with the counts.
    """
    return action_center_service.build(db, user)


@router.get("/action-center/summary", response_model=ActionCenterOut)
def action_center_summary(
    items: bool = Query(
        True,
        description="Also build the item feed. Pass false for the counters alone.",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ActionCenterOut:
    """Counts first, then the items behind them.

    Both halves are derived from live state and clear themselves: an item
    exists exactly as long as its condition does, and is never written to a
    table or dismissed. The counters come from the same reads the queue
    screens use, so a badge cannot disagree with the list behind it.

    ``items=false`` skips the feed. The sidebar badge and the Action Center
    page read the counters and nothing else, and building the feed walks
    every work item in scope -- on a timer, for every signed-in user. It stays
    on by default because an older client may still read it.
    """
    return ActionCenterOut(
        counters=action_center_service.counters(db, user),
        items=action_center_service.build(db, user) if items else [],
    )


@router.post("/notifications/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notif = db.get(Notification, notification_id)
    if notif and notif.user_id == user.id:
        notif.is_read = True
        db.commit()
    return {"status": "ok"}


# ---------------- Reference data (for dropdowns) ----------------
@router.get("/reference/provinces", response_model=list[ProvinceOut])
def list_provinces(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Return only the 31 canonical Iranian provinces.

    Older databases may still contain stray province rows created before
    canonical mapping existed (site codes / work-item strings that leaked into
    the استان column). We filter to the canonical set here so "Grant province
    access" always shows exactly the 31 real provinces, never junk.
    """
    from app.services.cpm_columns import CANONICAL_PROVINCE_BY_NORM, normalize_persian

    provinces = db.query(Province).order_by(Province.name).all()
    return [
        p for p in provinces
        if normalize_persian(p.name) in CANONICAL_PROVINCE_BY_NORM
    ]


@router.get("/reference/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Role).order_by(Role.id).all()


@router.get("/reference/contractors", response_model=list[ContractorOut])
def list_contractors(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Contractor).filter(Contractor.active.is_(True)).all()


@router.get("/reference/problem-categories", response_model=list[ProblemCategoryOut])
def list_problem_categories(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    return db.query(ProblemCategory).filter(ProblemCategory.active.is_(True)).all()


@router.get("/reference/coordinators", response_model=list[UserOptionOut])
def list_coordinators(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Coordinators currently assigned to at least one province in Admin's
    Province Assignments screen — the options for a Coordinator filter."""
    assigned = select(Province.coordinator_user_id).where(
        Province.coordinator_user_id.is_not(None)
    )
    return db.query(User).filter(User.id.in_(assigned)).order_by(User.full_name).all()


@router.get("/reference/regional-managers", response_model=list[UserOptionOut])
def list_regional_managers(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    """Regional Managers currently assigned to at least one province."""
    assigned = select(Province.regional_manager_user_id).where(
        Province.regional_manager_user_id.is_not(None)
    )
    return db.query(User).filter(User.id.in_(assigned)).order_by(User.full_name).all()
