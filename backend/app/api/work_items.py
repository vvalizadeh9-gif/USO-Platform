"""Work Item endpoints (list, detail & export) with row-level security."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.models.workitem import Assignment, Site, WorkItem
from app.schemas import WorkItemDetail, WorkItemListItem
from app.services.visibility import apply_work_item_scope
from app.services.work_item_export import build_assigned_sites_export
from app.services.work_item_rows import (
    active_drive_test,
    aging_since_assignment,
    build_list_row,
    referenced_user_ids,
    relevant_assignment,
)

router = APIRouter(prefix="/work-items", tags=["work-items"])

_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

# A spreadsheet is built whole in memory before it is sent, so this bounds the
# response and the container at once. Beyond it the answer is a query, not a
# download.
MAX_EXPORT_ROWS = 20000


def _scoped_work_items(
    db: Session,
    user: User,
    *,
    stage: str | None,
    limit: int,
    offset: int = 0,
) -> list[WorkItem]:
    """The work items this user may see, eager-loaded for row building.

    Shared by the list and the export so the file can never contain a row the
    screen would not have shown — the province scope, the contractor scope and
    the stage filter are applied in exactly one place.
    """
    stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
    stmt = apply_work_item_scope(stmt, user, db)
    if stage:
        stmt = stmt.where(WorkItem.current_stage == stage)
    stmt = stmt.order_by(WorkItem.id.desc()).limit(limit).offset(offset)
    stmt = stmt.options(
        selectinload(WorkItem.site).selectinload(Site.province),
        selectinload(WorkItem.assignments).selectinload(Assignment.contractor),
        selectinload(WorkItem.drive_tests),
    )
    return list(db.execute(stmt).scalars().all())


def _rows_for(db: Session, user: User, work_items: list[WorkItem]) -> list[dict]:
    """Flatten work items into list rows, resolving user names in one query."""
    user_ids = referenced_user_ids(work_items)
    user_names: dict[int, str] = {}
    if user_ids:
        rows = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
        user_names = {u.id: u.full_name for u in rows}
    return [build_list_row(wi, user_names) for wi in work_items]


@router.get("", response_model=list[WorkItemListItem])
def list_work_items(
    stage: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """Return work items visible to the current user (province/contractor scoped).

    Rows carry the union of columns every stage tab needs. The assignment /
    drive-test graph is eager-loaded and user names resolved in one query, so
    the row count doesn't drive the query count.
    """
    work_items = _scoped_work_items(
        db, user, stage=stage, limit=limit, offset=offset
    )
    return _rows_for(db, user, work_items)


@router.get("/export")
def export_work_items(
    stage: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Download the visible work items as an Excel file.

    Same scope and same stage filter as the list above, so what a contractor
    downloads is exactly the tab they are looking at — their assigned sites,
    never anyone else's. Declared before ``/{work_item_id}`` because FastAPI
    matches routes in order and "export" would otherwise be read as an id.
    """
    work_items = _scoped_work_items(
        db, user, stage=stage, limit=MAX_EXPORT_ROWS
    )
    rows = _rows_for(db, user, work_items)
    content = build_assigned_sites_export(rows)
    slug = (stage or "work-items").lower().replace(" ", "_")
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{slug}_sites.xlsx"'
        },
    )


@router.get("/{work_item_id}", response_model=WorkItemDetail)
def get_work_item(
    work_item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Return a single work item if the user is allowed to see it."""
    stmt = select(WorkItem).where(
        WorkItem.id == work_item_id, WorkItem.deleted_at.is_(None)
    )
    stmt = apply_work_item_scope(stmt, user, db)
    stmt = stmt.options(
        selectinload(WorkItem.site).selectinload(Site.province),
        selectinload(WorkItem.assignments),
        selectinload(WorkItem.drive_tests),
    )
    wi = db.execute(stmt).scalars().one_or_none()
    if wi is None:
        raise HTTPException(status_code=404, detail="Work item not found")

    active_dt = active_drive_test(wi)
    assignment = relevant_assignment(wi)
    return {
        "id": wi.id,
        "site_code": wi.site.site_code if wi.site else None,
        "site_type": wi.site_type,
        "province": (
            wi.site.province.name
            if wi.site is not None and wi.site.province is not None
            else None
        ),
        "requested_technology": wi.requested_technology,
        "deployed_technology": wi.deployed_technology,
        "project_name": wi.project_name,
        "pm_name": wi.pm_name,
        "power_status": wi.power_status,
        "current_stage": wi.current_stage,
        "assignment_date": assignment.assigned_at if assignment else None,
        "assigned_aging_days": aging_since_assignment(assignment, active_dt),
        "active_drive_test_id": active_dt.id if active_dt else None,
        "dt_submission_date": active_dt.execution_date if active_dt else None,
    }
