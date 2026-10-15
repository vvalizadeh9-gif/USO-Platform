"""Explorer: the list of all sites and the site record page.

Deliberately not ``GET /work-items``: that list carries every stage tab's
columns and keeps villages out on purpose (the assignment screens rely on it).
Scope is the work-item scope every list uses, so a site the caller may not see
is never listed and is a 404 when asked for by id, as everywhere else.

The fixed paths (``filters``, ``export``) are declared before
``/sites/{work_item_id}``: FastAPI matches routes in order and would otherwise
read them as an id.
"""
from dataclasses import replace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas.explorer import (
    FilterOptionsOut,
    SiteListOut,
    SiteRecordOut,
    VillageRefOut,
)
from app.services import explorer_list as L
from app.services.explorer import SiteNotFound, site_record
from app.services.work_item_export import build_sheet

router = APIRouter(prefix="/explorer", tags=["explorer"])

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

#: As GET /work-items/export: beyond this the answer is a query, not a download.
MAX_EXPORT_ROWS = 20000

_EXPORT_COLUMNS = [
    ("Site ID", "site_code"),
    ("Province", "province"),
    ("Type", "type"),
    ("Technology", "technology"),
    ("Hadaf villages", "hadaf_villages"),
    ("DT contractor", "dt_contractor"),
]
_EXPORT_WIDTHS = [14, 18, 14, 14, 14, 28]


def list_query(
    q: str | None = Query(default=None, max_length=100),
    province: list[int] = Query(default=[]),
    type: list[str] = Query(default=[]),  # noqa: A002 -- the wire name
    tech: list[str] = Query(default=[]),
    dt_contractor: list[int] = Query(default=[]),
    sort: Literal[L.SORT_KEYS] = Query(default=L.SORT_SITE),  # type: ignore[valid-type]
    dir: Literal["asc", "desc"] = Query(default="asc"),  # noqa: A002
) -> L.ListQuery:
    """The list's search, filters and sort, shared by the list and its export."""
    return L.ListQuery(
        q=q or "", provinces=tuple(province), types=tuple(type), techs=tuple(tech),
        dt_contractors=tuple(dt_contractor), sort=sort, direction=dir,
    )


@router.get("/sites", response_model=SiteListOut)
def list_sites(
    query: L.ListQuery = Depends(list_query),
    cursor: str | None = Query(default=None, max_length=2000),
    limit: int = Query(default=L.DEFAULT_LIMIT, ge=1, le=L.MAX_LIMIT),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """One page of the sites the caller may see, with the total and next cursor."""
    try:
        return L.list_sites(db, user, query, cursor=cursor, limit=limit)
    except L.BadCursor:
        raise HTTPException(status_code=400, detail="Invalid cursor") from None


@router.get("/sites/filters", response_model=FilterOptionsOut)
def get_filter_options(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """The values the caller can filter by: only what their own sites carry."""
    return L.filter_options(db, user)


@router.get("/sites/export")
def export_sites(
    query: L.ListQuery = Depends(list_query),
    ids: list[int] = Query(default=[]),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The list as a spreadsheet: the same rows, scope, search, filters and sort.

    ``ids`` narrows it to a selection; it can only narrow, never widen.
    """
    rows = L.export_rows(db, user, replace(query, ids=tuple(ids)),
                         limit=MAX_EXPORT_ROWS)
    flat = [
        {
            **r,
            "technology": " ".join(r["requested_technology"]),
            "dt_contractor": r["dt_contractor"]["name"] if r["dt_contractor"] else None,
        }
        for r in rows
    ]
    content = build_sheet("Sites", _EXPORT_COLUMNS, _EXPORT_WIDTHS, flat)
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="explorer_sites.xlsx"'},
    )


@router.get("/sites/{work_item_id}/villages", response_model=list[VillageRefOut])
def get_site_villages(
    work_item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """The site's هدف villages, for the list's inline strip."""
    try:
        return L.site_villages(db, user, work_item_id)
    except SiteNotFound:
        raise HTTPException(status_code=404, detail="Site not found") from None


@router.get("/sites/{work_item_id}", response_model=SiteRecordOut)
def get_site_record(
    work_item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """One site's record: general information, journey and acceptance."""
    try:
        return site_record(db, user, work_item_id)
    except SiteNotFound:
        raise HTTPException(status_code=404, detail="Site not found") from None
