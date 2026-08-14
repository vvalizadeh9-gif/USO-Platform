"""Work Item endpoints (list & detail) with row-level security."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.models.workitem import Assignment, WorkItem
from app.schemas import VillageAcceptanceRow, WorkItemDetail, WorkItemListItem
from app.services.eager_loading import with_villages_and_acceptances
from app.services.visibility import apply_work_item_scope
from app.services.work_item_rows import (
    active_drive_test,
    build_list_row,
    referenced_user_ids,
)

router = APIRouter(prefix="/work-items", tags=["work-items"])


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
    stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
    stmt = apply_work_item_scope(stmt, user, db)
    if stage:
        stmt = stmt.where(WorkItem.current_stage == stage)
    stmt = stmt.order_by(WorkItem.id.desc()).limit(limit).offset(offset)
    stmt = stmt.options(
        selectinload(WorkItem.site),
        selectinload(WorkItem.assignments).selectinload(Assignment.contractor),
        selectinload(WorkItem.drive_tests),
    )
    work_items = list(db.execute(stmt).scalars().all())

    user_ids = referenced_user_ids(work_items)
    user_names: dict[int, str] = {}
    if user_ids:
        rows = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
        user_names = {u.id: u.full_name for u in rows}

    return [build_list_row(wi, user_names) for wi in work_items]


@router.get("/acceptance/overview", response_model=list[VillageAcceptanceRow])
def acceptance_overview(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[dict]:
    """Flattened village+acceptance rows for every visible work item, in ONE query.

    Replaces the previous frontend pattern of fetching the work item list and
    then one detail request per item (N+1 HTTP calls) — the single biggest
    contributor to a slow Acceptance page as data grows.
    """
    stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
    stmt = apply_work_item_scope(stmt, user, db)
    stmt = with_villages_and_acceptances(stmt)
    work_items = db.execute(stmt).scalars().all()

    rows = []
    for wi in work_items:
        for village in wi.villages:
            rows.append(
                {"work_item_id": wi.id, "site_type": wi.site_type, "village": village}
            )
    return rows


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
    stmt = with_villages_and_acceptances(stmt)  # detail view needs the full graph
    wi = db.execute(stmt).scalars().one_or_none()
    if wi is None:
        raise HTTPException(status_code=404, detail="Work item not found")

    active_dt = active_drive_test(wi)
    return {
        "id": wi.id,
        "site_type": wi.site_type,
        "requested_technology": wi.requested_technology,
        "deployed_technology": wi.deployed_technology,
        "project_name": wi.project_name,
        "pm_name": wi.pm_name,
        "power_status": wi.power_status,
        "current_stage": wi.current_stage,
        "villages": wi.villages,
        "active_drive_test_id": active_dt.id if active_dt else None,
        "dt_submission_date": active_dt.execution_date if active_dt else None,
    }
