"""Explorer: the list of all sites and the site record page.

Deliberately not ``GET /work-items``: that list carries every stage tab's
columns and keeps villages out on purpose (the assignment screens rely on it).
Scope is ``visibility.explorer_work_item_ids``: the work-item scope every list
uses (all sites for the roles the permission map names). A site the caller
may not see is never listed, and asked for by id it is a 403 (a missing site
is a 404).

The fixed paths (``filters``, ``export``) are declared before
``/sites/{work_item_id}``: FastAPI matches routes in order and would otherwise
read them as an id.
"""
from dataclasses import replace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.access import FORBIDDEN, Area, Feature as F, require_access
from app.models.reference import User
from app.schemas.explorer import (
    FilterOptionsOut,
    SiteListOut,
    SiteRecordOut,
    VillageRefOut,
)
from app.services import explorer_list as L
from app.services.explorer import SiteForbidden, SiteNotFound, site_record
from app.core import audit_actions
from app.services.audit import record_audit
from app.services.explorer_village_history import village_history
from app.services.work_item_export import build_sheet, build_workbook

router = APIRouter(prefix="/explorer", tags=["explorer"])

#: UEP-25: every export also needs the "Export to Excel" feature.
EXPORTER = Depends(require_access(F.EXPORTS))

#: Who may open Explorer: the central permission map's ``Area.EXPLORER``.
#: Which sites they see is ``visibility.explorer_work_item_ids``.
EXPLORER_READER = require_access(Area.EXPLORER)

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
    ("Stage", "stage"),
    ("Days", "stage_days"),
]
_EXPORT_WIDTHS = [14, 18, 14, 14, 14, 28, 16, 8]

#: The list's short stage names (UEP-28), as the Stage column shows them.
STAGE_LABELS = {
    "on_air": "On air", "health_check": "Health check", "assigned": "Assignment",
    "dt_done": "Drive test", "sent_to_ict": "Sent to ICT", "acceptance": "Acceptance",
    "done": "Accepted",
}

_HISTORY_SHEETS = (
    ("Current villages", [("Village ID", "code"), ("Village", "name")], [14, 32]),
    ("History", [("Date", "date"), ("Change", "kind"), ("Village ID", "code"),
                 ("Village", "name"), ("Status", "status"), ("Decided by", "decided_by"),
                 ("Decided on", "decided_at")], [12, 10, 14, 32, 10, 24, 12]),
)


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
    user: User = Depends(EXPLORER_READER),
) -> dict:
    """One page of the sites the caller may see, with the total and next cursor."""
    try:
        return L.list_sites(db, user, query, cursor=cursor, limit=limit)
    except L.BadCursor:
        raise HTTPException(status_code=400, detail="Invalid cursor") from None


@router.get("/sites/filters", response_model=FilterOptionsOut)
def get_filter_options(
    db: Session = Depends(get_db),
    user: User = Depends(EXPLORER_READER),
) -> dict:
    """The values the caller can filter by: only what their own sites carry."""
    return L.filter_options(db, user)


@router.get("/sites/export", dependencies=[EXPORTER])
def export_sites(
    query: L.ListQuery = Depends(list_query),
    ids: list[int] = Query(default=[]),
    db: Session = Depends(get_db),
    user: User = Depends(EXPLORER_READER),
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
            "stage": STAGE_LABELS.get(r["stage"]),
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
    user: User = Depends(EXPLORER_READER),
) -> list[dict]:
    """The site's هدف villages, for the list's inline strip."""
    try:
        return L.site_villages(db, user, work_item_id)
    except SiteNotFound:
        raise HTTPException(status_code=404, detail="Site not found") from None
    except SiteForbidden:
        raise HTTPException(status_code=403, detail=FORBIDDEN) from None


@router.get("/sites/{work_item_id}/villages/export", dependencies=[EXPORTER])
def export_site_villages(
    work_item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(EXPLORER_READER),
) -> Response:
    """The record's History panel as a spreadsheet (UEP-28): current villages
    on one sheet, CPM village changes on the other. Scoped like the record,
    and audited."""
    try:
        current = L.site_villages(db, user, work_item_id)
    except SiteNotFound:
        raise HTTPException(status_code=404, detail="Site not found") from None
    except SiteForbidden:
        raise HTTPException(status_code=403, detail=FORBIDDEN) from None
    history = village_history(db, work_item_id, {v["code"]: v["name"] for v in current})
    flat = [
        {**{k: e[k] for k in ("date", "kind", "status", "decided_by", "decided_at")}, **v}
        for e in history for v in e["villages"]
    ]
    (t1, c1, w1), (t2, c2, w2) = _HISTORY_SHEETS
    content = build_workbook([(t1, c1, w1, current), (t2, c2, w2, flat)])
    record_audit(
        db, user_id=user.id, action=audit_actions.EXPORTED, module="Explorer",
        entity_type="WorkItem", entity_id=work_item_id,
        new_value={"export": "village_history", "villages": len(current), "events": len(history)},
    )
    db.commit()
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="site_{work_item_id}_villages.xlsx"'},
    )


@router.get("/sites/{work_item_id}", response_model=SiteRecordOut)
def get_site_record(
    work_item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(EXPLORER_READER),
) -> dict:
    """One site's record: passport, journey, acceptance and village history."""
    try:
        return site_record(db, user, work_item_id)
    except SiteNotFound:
        raise HTTPException(status_code=404, detail="Site not found") from None
    except SiteForbidden:
        raise HTTPException(status_code=403, detail=FORBIDDEN) from None
