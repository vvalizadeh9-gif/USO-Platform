"""Gap & Performance endpoints.

Three routes, all read-only. Permission and scope are the KPI page's, called rather
than copied: Admin is refused, a non-PM is confined to their own lens and their
own key, and asking for somebody else's is a 403 rather than an empty list.
See ``services/gaps.py`` and ``services/kpi.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.services import gaps

router = APIRouter(prefix="/gaps", tags=["gaps"])


@router.get("/road")
def gap_road(
    lens: str = Query(
        ...,
        description="rm | coordinator | contractor | region | province. "
        "PM may ask for any; every other role may ask only for their own.",
    ),
    stretch: str | None = Query(
        None, description="ict | cra | tracker | dep. Omit for all four."
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Who is stopped on each stretch of the acceptance road, and the country
    total the owner rows add up to."""
    return gaps.road(db, user, lens, stretch)


@router.get("/overview")
def gap_overview(
    lens: str | None = Query(
        None,
        description="province | rm | coordinator | contractor | region. "
        "PM may ask for any (default province); every other role gets their "
        "own, and asking for another is a 403.",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """The Gaps tab: six gap figures over the eligible (هدف, drive-test-done,
    on-air) villages, and who is behind each one under one lens."""
    return gaps.overview(db, user, lens)


@router.get("/map")
def gap_map(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """ICT and CRA figures for every province (by its CPM province) and every
    CRA region, for the coverage map. PM sees the country; every other role
    sees only the villages that roll up to their own key."""
    return gaps.coverage_map(db, user)
