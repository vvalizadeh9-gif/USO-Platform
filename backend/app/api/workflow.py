"""Workflow action endpoints: health check, assignment, DT, reviews, acceptance."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import (
    COORDINATOR,
    CONTRACTOR,
    PM,
    require_roles,
)
from app.models.reference import User
from app.models.workitem import Assignment, DriveTest, HealthCheck, Village, WorkItem
from app.models.acceptance import Acceptance
from app.schemas import (
    AcceptanceUpdate,
    AssignmentCreate,
    BulkAssignmentCreate,
    DriveTestCreate,
    HealthCheckCreate,
    ReturnToCoordinatorRequest,
    ReviewRequest,
)
from app.services import acceptance_workflow as acceptance_flow
from app.services.audit import notify_roles, record_audit
from app.services.visibility import apply_work_item_scope, visible_work_item_ids
from app.services.workflow import refresh_stage

router = APIRouter(tags=["workflow"])


def _load_work_item(work_item_id: int, db: Session, user: User) -> WorkItem:
    stmt = select(WorkItem).where(
        WorkItem.id == work_item_id, WorkItem.deleted_at.is_(None)
    )
    stmt = apply_work_item_scope(stmt, user, db)
    wi = db.execute(stmt).scalars().one_or_none()
    if wi is None:
        raise HTTPException(status_code=404, detail="Work item not found")
    return wi


def _load_drive_test(drive_test_id: int, db: Session, user: User) -> DriveTest:
    """Load an active drive test whose site this user may see, or 404.

    Resolving by primary key alone let any coordinator approve any drive test
    in the country — and approving is what writes ``dt_status = "Done"`` onto
    the work item, so it moved a national KPI for a site the reviewer had no
    authority over.
    """
    stmt = (
        select(DriveTest)
        .where(DriveTest.id == drive_test_id, DriveTest.is_active.is_(True))
        .where(DriveTest.work_item_id.in_(visible_work_item_ids(user, db)))
    )
    dt = db.execute(stmt).scalars().one_or_none()
    if dt is None:
        raise HTTPException(404, "Active drive test not found")
    return dt


def _load_village(village_id: int, db: Session, user: User) -> Village:
    """Load a village this user may see, or 404.

    Same rule as the acceptance module's loader of the same name, and for the
    same reason: a missing village and someone else's village must give the
    same answer, or the endpoint becomes a way to enumerate them.
    """
    village = db.execute(
        acceptance_flow.visible_villages(user, db).where(Village.id == village_id)
    ).scalars().one_or_none()
    if village is None:
        raise HTTPException(404, "Village not found")
    return village


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/work-items/{work_item_id}/health-check")
def submit_health_check(
    work_item_id: int,
    payload: HealthCheckCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, CONTRACTOR)),
):
    """Contractor records the health check result."""
    wi = _load_work_item(work_item_id, db, user)
    if payload.status == "Problematic" and payload.problem_category_id is None:
        raise HTTPException(400, "Problematic health check requires a category")

    hc = HealthCheck(
        work_item_id=wi.id,
        status=payload.status,
        problem_category_id=payload.problem_category_id,
        comment=payload.comment,
        checked_by=user.id,
        checked_at=_now(),
    )
    db.add(hc)
    db.flush()
    refresh_stage(wi)
    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="WorkItem",
        entity_id=wi.id, new_value={"status": payload.status},
    )
    notify_roles(db, role_names=[PM], type="HealthCheckCompleted",
                 message=f"Health check completed for work item {wi.id}",
                 entity_type="WorkItem", entity_id=wi.id)
    db.commit()
    return {"status": "ok", "stage": wi.current_stage}


@router.post("/work-items/{work_item_id}/assignment")
def create_assignment(
    work_item_id: int,
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM)),
):
    """PM assigns the work item to a contractor. Deactivates prior assignment."""
    wi = _load_work_item(work_item_id, db, user)
    for prev in wi.assignments:
        if prev.is_active:
            prev.is_active = False

    # Associate through the relationship so the loaded collection stays
    # consistent and refresh_stage below sees the new active assignment.
    wi.assignments.append(
        Assignment(
            assignment_type=payload.assignment_type,
            contractor_id=payload.contractor_id,
            assigned_by=user.id,
            assigned_at=_now(),
            remarks=payload.remarks,
            is_active=True,
        )
    )
    db.flush()
    refresh_stage(wi)
    record_audit(
        db, user_id=user.id, module="Assignment", entity_type="WorkItem",
        entity_id=wi.id, new_value={"contractor_id": payload.contractor_id},
    )
    db.commit()
    return {"status": "ok", "stage": wi.current_stage}


@router.post("/work-items/{work_item_id}/return-to-coordinator")
def return_to_coordinator(
    work_item_id: int,
    payload: ReturnToCoordinatorRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(CONTRACTOR)),
):
    """Contractor hands the site back before a drive test can be attempted.

    Covers the small fraction of assignments a contractor genuinely cannot
    proceed with (blocked road, site down, access denied, ...). The active
    assignment is flagged rather than deactivated, so the PM/Coordinator
    queue can see exactly which sites bounced back and why; creating a new
    assignment (single or bulk) naturally supersedes the flag.
    """
    wi = _load_work_item(work_item_id, db, user)
    active = next((a for a in wi.assignments if a.is_active), None)
    if active is None:
        raise HTTPException(400, "This site has no active assignment to return.")
    if active.contractor_id != user.contractor_id:
        raise HTTPException(403, "This site is not assigned to your company.")

    active.returned_at = _now()
    active.return_reason = payload.reason
    db.flush()
    refresh_stage(wi)
    record_audit(
        db, user_id=user.id, module="Assignment", entity_type="WorkItem",
        entity_id=wi.id, new_value={"returned": True, "reason": payload.reason},
    )
    notify_roles(
        db, role_names=[PM, COORDINATOR], type="AssignmentReturned",
        message=f"Contractor returned work item {wi.id}: {payload.reason}",
        entity_type="WorkItem", entity_id=wi.id,
    )
    db.commit()
    return {"status": "ok", "stage": wi.current_stage}


@router.post("/work-items/assign")
def bulk_assign(
    payload: BulkAssignmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM)),
):
    """PM assigns many work items to one contractor in one action.

    Backs both the "Ready for Assignment" queue and the HC Result screen.
    Per item: deactivate any prior active assignment (one active per item),
    create the new one, then refresh the stage to "Assigned".
    """
    if payload.assignment_type not in ("first", "official"):
        raise HTTPException(400, "assignment_type must be 'first' or 'official'")

    assigned = 0
    for wid in dict.fromkeys(payload.work_item_ids):  # de-dupe, preserve order
        wi = _load_work_item(wid, db, user)
        for prev in wi.assignments:
            if prev.is_active:
                prev.is_active = False
        # Associate through the relationship (not a raw db.add) so the loaded
        # collection stays consistent and refresh_stage sees the new row.
        wi.assignments.append(
            Assignment(
                assignment_type=payload.assignment_type,
                contractor_id=payload.contractor_id,
                assigned_by=user.id,
                assigned_at=_now(),
                remarks=payload.remarks,
                is_active=True,
            )
        )
        db.flush()
        refresh_stage(wi)
        assigned += 1

    record_audit(
        db, user_id=user.id, module="Assignment", entity_type="WorkItemBulk",
        entity_id=payload.contractor_id,
        new_value={"contractor_id": payload.contractor_id, "count": assigned},
    )
    db.commit()
    return {"status": "ok", "assigned": assigned}


@router.post("/work-items/{work_item_id}/drive-test")
def submit_drive_test(
    work_item_id: int,
    payload: DriveTestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, CONTRACTOR)),
):
    """Contractor submits a drive test. Previous active DT is archived."""
    wi = _load_work_item(work_item_id, db, user)
    for prev in wi.drive_tests:
        if prev.is_active:
            prev.is_active = False

    # Associate through the relationship (not a raw db.add) so the loaded
    # collection stays consistent and refresh_stage below actually sees the
    # new drive test. With db.add() the stage silently stayed "Assigned".
    dt = DriveTest(
        execution_date=payload.execution_date,
        report_link=payload.report_link,
        status="Submitted",
        is_active=True,
    )
    wi.drive_tests.append(dt)
    db.flush()
    refresh_stage(wi)
    record_audit(
        db, user_id=user.id, module="DriveTest", entity_type="WorkItem",
        entity_id=wi.id, new_value={"drive_test_id": dt.id},
    )
    notify_roles(db, role_names=[COORDINATOR], type="DTSubmitted",
                 message=f"Drive test submitted for work item {wi.id}",
                 entity_type="WorkItem", entity_id=wi.id)
    db.commit()
    return {"status": "ok", "drive_test_id": dt.id, "stage": wi.current_stage}


@router.post("/drive-tests/{drive_test_id}/coordinator-review")
def coordinator_review(
    drive_test_id: int,
    payload: ReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(COORDINATOR)),
):
    """Coordinator validates a submitted drive test. Approval is terminal.

    Approving is what makes a drive test *count*: besides moving the work
    item to its final stage, it writes the outcome through to the work
    item's ``dt_status`` / ``dt_date_gregorian``. Those two columns are what
    the Drive Test dashboard's "DT Done" KPI reads. Without this write-back
    the CPM import remains the only thing that can ever mark a site Done,
    and in-app drive tests stay invisible to the dashboard that exists to
    report on them.
    """
    if payload.decision not in ("Approved", "Rejected", "Returned"):
        raise HTTPException(400, "decision must be Approved, Rejected or Returned")
    dt = _load_drive_test(drive_test_id, db, user)
    wi = _load_work_item(dt.work_item_id, db, user)

    dt.status = payload.decision
    dt.coordinator_reviewed_by = user.id
    dt.coordinator_reviewed_at = _now()
    dt.coordinator_comment = payload.comment
    db.flush()

    if payload.decision == "Approved":
        # Write-back: the in-app workflow becomes the source of truth for
        # this site's drive-test outcome until the next CPM import.
        wi.dt_status = "Done"
        wi.dt_date_gregorian = dt.execution_date
        wi.dt_problem_category = None
    refresh_stage(wi)
    record_audit(
        db, user_id=user.id, module="DriveTest", entity_type="DriveTest",
        entity_id=dt.id, new_value={"coordinator_decision": payload.decision},
    )
    if payload.decision != "Approved":
        notify_roles(
            db, role_names=[CONTRACTOR], type="DTRejected",
            message=f"Drive test for work item {wi.id} was {payload.decision.lower()}",
            entity_type="WorkItem", entity_id=wi.id,
        )
    db.commit()
    return {"status": "ok", "stage": wi.current_stage}


@router.patch("/villages/{village_id}/acceptance/{technology}")
def update_acceptance(
    village_id: int,
    technology: str,
    payload: AcceptanceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, COORDINATOR)),
):
    """Coordinator updates ICT/CRA status for one technology of a village."""
    village = _load_village(village_id, db, user)
    acc = (
        db.query(Acceptance)
        .filter(Acceptance.village_id == village.id, Acceptance.technology == technology)
        .one_or_none()
    )
    if acc is None:
        acc = Acceptance(village_id=village.id, technology=technology)
        db.add(acc)

    old = {"ict": acc.ict_status, "cra": acc.cra_status}
    if payload.ict_status is not None:
        acc.ict_status = payload.ict_status
        acc.ict_date = payload.ict_date
    if payload.cra_status is not None:
        acc.cra_status = payload.cra_status
        acc.cra_date = payload.cra_date
    db.flush()
    # This edits an acceptance without a submission behind it, so the queue's
    # cached per-authority status has to be rebuilt from what the row now says
    # — otherwise My Work would keep showing the village where it used to be.
    acceptance_flow.recompute_authority_statuses(db, [village])
    record_audit(
        db, user_id=user.id, module="Acceptance", entity_type="Acceptance",
        entity_id=acc.id, old_value=old,
        new_value={"ict": acc.ict_status, "cra": acc.cra_status},
    )
    db.commit()
    return {"status": "ok"}
