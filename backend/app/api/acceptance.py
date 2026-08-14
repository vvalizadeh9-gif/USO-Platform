"""Acceptance dashboard endpoint.

One combined endpoint returns the KPIs, ICT-vs-CRA analysis and per-province
status for the current user's province scope, computed over the ICT/CRA
approval data seeded from the CPM execution block (columns AV..BQ).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas import (
    AcceptanceAnalysis,
    AcceptanceKpis,
    AcceptanceOverview,
    ProvinceAcceptanceRow,
)
from app.services.acceptance_analytics import AcceptanceAnalytics

router = APIRouter(prefix="/acceptance", tags=["acceptance"])


@router.get("/overview", response_model=AcceptanceOverview)
def acceptance_overview(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> AcceptanceOverview:
    """Return the full Acceptance dashboard payload for this user's scope."""
    data = AcceptanceAnalytics(db, user).build()
    return AcceptanceOverview(
        kpis=AcceptanceKpis(**data["kpis"]),
        analysis=AcceptanceAnalysis(**data["analysis"]),
        provinces=[ProvinceAcceptanceRow(**row) for row in data["provinces"]],
    )
