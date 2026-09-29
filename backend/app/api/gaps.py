"""Lifecycle Gaps endpoints.

Three routes, all read-only. Permission and scope are the KPI page's, called rather
than copied: Admin is refused, a non-PM is confined to their own lens and their
own key, and asking for somebody else's is a 403 rather than an empty list.
See ``services/gaps.py`` and ``services/kpi.py``.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.services import gap_export, gaps

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/gaps", tags=["gaps"])


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


@router.get("/villages.xlsx")
def gap_villages_export(
    gap: str = Query(
        ...,
        description="pending_ict | pending_cra | ict_remained | cra_remained | "
        "ict_missing_in_mojri | cra_missing_in_mojri | ict_approved | cra_approved",
    ),
    lens: str | None = Query(
        None, description="With key: only the villages that roll up to this owner."
    ),
    key: str | None = Query(None, description="The owner's name, as the row shows it."),
    scope: str | None = Query(
        None, description="province:<Persian name> or region:<CRA region>, from the map."
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The villages behind one figure, as an Excel file.

    The same eligible villages the overview counts, the same gap condition and
    the same owner attribution, so the file has exactly the clicked figure's
    row count. Access is the overview's: Admin is a 403, and a non-PM naming
    somebody else's villages is a 403, never an empty file.

    Small files are sent whole; above ``gap_export.STREAM_THRESHOLD_ROWS``
    villages the file is streamed in chunks.
    """
    export = gaps.export_villages(db, user, gap=gap, lens=lens, key=key, scope=scope)
    built = gap_export.build(
        export.rows,
        gap_export.ExportMeta(
            title=export.title,
            filter_text=export.filter_text,
            exported_by=f"{user.full_name} ({user.username})",
            exported_at=datetime.now(timezone.utc),
        ),
    )
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{gap_export.filename(export.gap, export.file_key)}"'
        ),
        "X-Village-Count": str(built.rows),
    }
    if built.rows > gap_export.STREAM_THRESHOLD_ROWS:
        return StreamingResponse(built.chunks(), media_type=_XLSX_MEDIA_TYPE, headers=headers)
    try:
        return Response(content=built.read(), media_type=_XLSX_MEDIA_TYPE, headers=headers)
    finally:
        built.file.close()
