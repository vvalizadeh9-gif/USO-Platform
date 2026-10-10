"""UEP Home's one read. Every rule is in ``services/home.py``."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas.home import HomeSummaryOut
from app.services import home
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
