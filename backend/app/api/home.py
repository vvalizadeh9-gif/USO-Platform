"""UEP Home's one read. Every rule is in ``services/home.py``."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas.home import HomeSummaryOut, MeHomeOut
from app.services import home, system_status
from app.services.action_queues.board import NotOnBoard

router = APIRouter(tags=["home"])


@router.get("/home/summary", response_model=HomeSummaryOut)
def home_summary(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> HomeSummaryOut:
    """Everything the Home page shows, in one response.

    The Action Center board's roles and Regional Managers; a Viewer or Admin
    gets 403, not an empty page.
    """
    try:
        return HomeSummaryOut(**home.summary_for(db, user))
    except NotOnBoard as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from None


@router.get("/me/home", response_model=MeHomeOut)
def me_home(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MeHomeOut:
    """Home in one round-trip: the summary (cached per user, emptied by every
    commit), plus system status and the version for the footer. The shell's
    rail counts and notification badge read this same response."""
    try:
        summary = home.summary_for(db, user)
    except NotOnBoard as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from None
    return MeHomeOut(
        **summary, system=system_status.status(db), version=system_status.APP_VERSION
    )
