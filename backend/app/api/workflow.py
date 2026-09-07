"""Workflow action endpoints: health check, assignment, DT, reviews, acceptance."""
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.database import get_db
from app.core.deps import (
    COORDINATOR,
    CONTRACTOR,
    PM,
    get_current_user,
    require_review_authority,
    require_roles,
)
from app.models.reference import User
from app.models.workitem import (
    Assignment,
    DriveTest,
    DriveTestEvidence,
    Village,
    WorkItem,
)
from app.models.acceptance import Acceptance
from app.schemas import (
    AcceptanceUpdate,
    EvidenceOut,
    AssignmentCreate,
    BulkAssignmentCreate,
    DriveTestCreate,
    ReturnToCoordinatorRequest,
    ReviewRequest,
)
from app.services import acceptance_workflow as acceptance_flow
from app.services import evidence_store
from app.services import health_check as hc
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


def _require_active_assignment(wi: WorkItem, user: User) -> None:
    """A contractor may only record work on a site currently assigned to them.

    ``apply_work_item_scope`` deliberately includes every assignment a
    contractor has *ever* held, so a site moved to someone else does not vanish
    from their history. That is right for reads and too wide for writes: it let
    a contractor removed from a site keep submitting health checks and drive
    tests against it, indefinitely.

    Staff roles are unaffected -- a PM submitting on a contractor's behalf is a
    normal part of the workflow. This narrows the contractor case only, the
    same way ``return_to_coordinator`` on this router already did.
    """
    if user.role.name != CONTRACTOR:
        return
    active = next((a for a in wi.assignments if a.is_active), None)
    if active is None or active.contractor_id != user.contractor_id:
        raise HTTPException(
            403, "This site is not currently assigned to your company."
        )


def _assert_assignable(
    db: Session, wi: WorkItem, assignment_type: str
) -> None:
    """An official drive test may only be assigned to a site that passed HC.

    This is the lifecycle's central rule, and until now it was enforced by
    which checkbox the interface chose to draw -- so the Work Items bulk bar
    and this router's own single-site form would both accept a Problematic or
    never-checked site. Enforced here, both endpoints get it, and so does
    whatever calls them next.

    Only ``official`` assignments are gated. ``first`` is the vestigial type
    that predates ``hc_assignments`` and no longer means a drive test.
    """
    if assignment_type != "official":
        return
    label = wi.site.site_code if wi.site else f"Work item {wi.id}"
    try:
        hc.assert_ready_for_dt(db, wi.id, site_label=label)
    except hc.NotReadyForDriveTest as exc:
        raise HTTPException(400, str(exc)) from None


def _now() -> datetime:
    return datetime.now(timezone.utc)


# The single-flag health check endpoint that used to live here is gone.
#
# It wrote a ``health_checks`` row: a Ready/Problematic verdict with no round,
# no per-technology detail, no remediation and no history -- which is every
# part of the health check the lifecycle is made of. It survived the move to
# ``hc_tasks`` as a second way to declare a site ready, reachable by PM and
# Contractor, and ``derive_stage`` still honoured it. A site could therefore
# reach an official drive test on a verdict that no subcontractor measured and
# no coordinator reviewed.
#
# The table and the read-side fallback stay, so pre-migration rows still
# resolve. Only the ability to write new ones is withdrawn. Health checks are
# created through ``/hc/assignments`` and submitted through
# ``/hc/tasks/{id}/result``.


@router.post("/work-items/{work_item_id}/assignment")
def create_assignment(
    work_item_id: int,
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_review_authority),
):
    """PM or Coordinator assigns the work item. Deactivates prior assignment."""
    wi = _load_work_item(work_item_id, db, user)
    _assert_assignable(db, wi, payload.assignment_type)
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
        db, user_id=user.id, action=audit_actions.ASSIGNED,
        module="Assignment", entity_type="WorkItem",
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
        db, user_id=user.id, action=audit_actions.RETURNED,
        module="Assignment", entity_type="WorkItem",
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
    user: User = Depends(require_review_authority),
):
    """PM or Coordinator assigns many work items to one contractor at once.

    Backs both the "Ready for Assignment" queue and the HC Result screen.
    Per item: deactivate any prior active assignment (one active per item),
    create the new one, then refresh the stage to "Assigned".
    """
    if payload.assignment_type not in ("first", "official"):
        raise HTTPException(400, "assignment_type must be 'first' or 'official'")

    assigned = 0
    for wid in dict.fromkeys(payload.work_item_ids):  # de-dupe, preserve order
        wi = _load_work_item(wid, db, user)
        _assert_assignable(db, wi, payload.assignment_type)
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
        db, user_id=user.id, action=audit_actions.ASSIGNED,
        module="Assignment", entity_type="WorkItemBulk",
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
    _require_active_assignment(wi, user)
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
        submitted_at=_now(),
        is_active=True,
    )
    wi.drive_tests.append(dt)
    db.flush()
    refresh_stage(wi)
    record_audit(
        db, user_id=user.id, action=audit_actions.SUBMITTED,
        module="DriveTest", entity_type="WorkItem",
        entity_id=wi.id, new_value={"drive_test_id": dt.id},
    )
    notify_roles(db, role_names=[COORDINATOR], type="DTSubmitted",
                 message=f"Drive test submitted for work item {wi.id}",
                 entity_type="WorkItem", entity_id=wi.id)
    db.commit()
    return {"status": "ok", "drive_test_id": dt.id, "stage": wi.current_stage}


@router.post("/drive-tests/{drive_test_id}/coordinator-review")
def review_drive_test(
    drive_test_id: int,
    payload: ReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_review_authority),
):
    """PM or Coordinator validates a submitted drive test. Approval is terminal.

    The path keeps the ``coordinator-review`` spelling because it is in
    people's clients and bookmarks, but the Coordinator is no longer the only
    role that may reach it: a PM could not approve a drive test at all, which
    left the busiest role in the platform unable to finish the work it had
    assigned.

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
        db, user_id=user.id,
        action=(
            audit_actions.APPROVED if payload.decision == "Approved"
            else audit_actions.REJECTED
        ),
        module="DriveTest", entity_type="DriveTest",
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


# ---------------- Drive-test evidence ----------------
#
# The same store as acceptance evidence, and deliberately so: capped read,
# magic-byte validation, SHA-256, safe filename, files on disk with only their
# metadata in the database, and a download that derives its media type from
# what the bytes actually are rather than from what the uploader claimed.
#
# A drive test previously carried a date and an optional ``report_link`` that
# no screen ever set, so a reviewer approving one had nothing to approve
# against -- and approval is what writes ``dt_status = "Done"`` and moves the
# national KPI.
@router.post(
    "/drive-tests/{drive_test_id}/evidence",
    response_model=EvidenceOut,
    status_code=201,
)
def upload_drive_test_evidence(
    drive_test_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, COORDINATOR, CONTRACTOR)),
):
    """Attach a report or measurement file to a submitted drive test."""
    dt = _load_drive_test(drive_test_id, db, user)
    if dt.status != "Submitted":
        raise HTTPException(
            400, "Evidence can only be added while the drive test is awaiting review"
        )
    wi = _load_work_item(dt.work_item_id, db, user)
    _require_active_assignment(wi, user)

    if len(dt.evidence) >= evidence_store.MAX_FILES_PER_SUBMISSION:
        raise HTTPException(
            400,
            f"At most {evidence_store.MAX_FILES_PER_SUBMISSION} files per "
            "drive test",
        )

    try:
        content = evidence_store.read_capped(file.file)
        stored = evidence_store.store(file.filename or "", content)
    except evidence_store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from None

    record = DriveTestEvidence(
        drive_test_id=dt.id,
        sha256=stored["sha256"],
        stored_path=stored["stored_path"],
        original_filename=(file.filename or "")[:255],
        content_type=file.content_type,
        size_bytes=stored["size_bytes"],
        uploaded_by=user.id,
        uploaded_at=_now(),
    )
    db.add(record)
    record_audit(
        db, user_id=user.id, action=audit_actions.SUBMITTED,
        module="DriveTest", entity_type="DriveTestEvidence",
        entity_id=dt.id, new_value={"filename": record.original_filename},
    )
    db.commit()
    db.refresh(record)
    return EvidenceOut.model_validate(record)


@router.get("/drive-tests/evidence/{evidence_id}/download")
def download_drive_test_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download one drive-test evidence file, if the caller may see its site."""
    record = db.get(DriveTestEvidence, evidence_id)
    if record is None:
        raise HTTPException(404, "Evidence not found")
    dt = db.get(DriveTest, record.drive_test_id)
    # Same answer for absent and out-of-scope, as everywhere else: the
    # difference between "no" and "not yours" is a way to enumerate ids.
    if dt is None or dt.work_item_id not in set(
        db.execute(visible_work_item_ids(user, db)).scalars()
    ):
        raise HTTPException(404, "Evidence not found")

    path = evidence_store.absolute_path(record.stored_path)
    if not path.exists():
        raise HTTPException(404, "The stored file is missing")

    return Response(
        content=path.read_bytes(),
        # From the extension the magic bytes were checked against, never the
        # Content-Type the uploader sent -- echoing that back is how a
        # document becomes a script.
        media_type=evidence_store.media_type_for(record.stored_path),
        headers={
            "Content-Disposition":
                'attachment; filename="'
                + record.original_filename.replace('"', "'")
                + '"',
            "X-Content-Type-Options": "nosniff",
        },
    )


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
        db, user_id=user.id, action=audit_actions.UPDATED,
        module="Acceptance", entity_type="Acceptance",
        entity_id=acc.id, old_value=old,
        new_value={"ict": acc.ict_status, "cra": acc.cra_status},
    )
    db.commit()
    return {"status": "ok"}
