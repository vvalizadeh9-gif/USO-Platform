"""Health Check workflow endpoints (Phase A).

Coordinator: basket, create assignment, list assignments, results.
Subcontractor: my assignments, submit per-site result, download/upload template.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import (
    ADMIN,
    COORDINATOR,
    CONTRACTOR,
    PM,
    get_current_user,
    require_category_owner,
    require_roles,
)
from app.models.health_check import HcAssignment, HcRemediation, HcTask
from app.models.reference import Contractor, User
from app.models.workitem import Site, WorkItem
from app.schemas import (
    HcAssignmentCreate,
    HcAssignmentListItem,
    HcAssignmentOut,
    HcBasketItem,
    HcHistoryEvent,
    HcRemediationClose,
    HcRemediationOut,
    HcRerouteDecision,
    HcRerouteRequest,
    HcResultRow,
    HcReviewSubmit,
    HcTaskResultSubmit,
    HcTechnologyOut,
)
from app.services import health_check as hc
from app.services.audit import record_audit
from app.services.hc_template import (
    build_assignment_feedback_export,
    build_results_export,
    build_template,
    parse_template,
)

_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

router = APIRouter(prefix="/hc", tags=["health-check"])


# ---------------- Coordinator ----------------
@router.get("/basket", response_model=list[HcBasketItem])
def hc_basket(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN, PM, COORDINATOR)),
):
    """On-air sites still needing a health check, in the user's provinces."""
    return hc.get_basket(db, user)


@router.post("/assignments", response_model=HcAssignmentOut, status_code=201)
def create_hc_assignment(
    payload: HcAssignmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, COORDINATOR)),
):
    """Assign one or many sites to a subcontractor for health check."""
    assignment = hc.create_assignment(
        db,
        contractor_id=payload.contractor_id,
        work_item_ids=payload.work_item_ids,
        user=user,
    )
    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="HcAssignment",
        entity_id=assignment.id,
        new_value={"code": assignment.code, "sites": len(payload.work_item_ids)},
    )
    db.commit()
    db.refresh(assignment)
    return hc.build_assignment_out(assignment)


@router.get("/assignments", response_model=list[HcAssignmentListItem])
def list_hc_assignments(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN, PM, COORDINATOR)),
):
    # ``HcAssignment.tasks`` uses lazy="selectin", so reading a.tasks over the
    # 200 assignments issues a single extra IN-query for all their tasks (not
    # an N+1). That gives us each task's result/completed_at needed for the
    # per-assignment feedback breakdown shown in HC History.
    assignments = (
        db.query(HcAssignment).order_by(HcAssignment.id.desc()).limit(200).all()
    )
    items = []
    for a in assignments:
        stats = hc.build_assignment_stats(a)
        items.append(
            HcAssignmentListItem(
                id=a.id,
                code=a.code,
                contractor_id=a.contractor_id,
                status=a.status,
                created_at=a.assigned_at,
                task_count=stats["sites_assigned"],
                sites_ready=stats["sites_ready"],
                sites_not_ready=stats["sites_not_ready"],
                sites_pending=stats["sites_pending"],
                feedback_received_at=stats["feedback_received_at"],
                aging_days=stats["aging_days"],
                aging_ongoing=stats["aging_ongoing"],
            )
        )
    return items


@router.get("/assignments/{assignment_id}", response_model=HcAssignmentOut)
def get_hc_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    assignment = db.get(HcAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(404, "Assignment not found")
    return hc.build_assignment_out(assignment)


@router.get("/results", response_model=list[HcResultRow])
def hc_results(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN, PM, COORDINATOR)),
):
    """Completed health check results (Ready / Not Ready) with site info."""
    stmt = (
        select(HcTask, WorkItem, Site, HcAssignment, Contractor)
        .join(WorkItem, HcTask.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .join(HcAssignment, HcTask.hc_assignment_id == HcAssignment.id)
        .join(Contractor, HcAssignment.contractor_id == Contractor.id)
        .where(HcTask.completed_at.isnot(None))
        .order_by(HcTask.completed_at.desc())
        .options(selectinload(HcTask.technologies))
    )
    rows = db.execute(stmt).all()
    return [
        HcResultRow(
            work_item_id=task.work_item_id,
            site_code=site.site_code,
            site_type=wi.site_type,
            overall_result=task.overall_result,
            problem_category=task.problem_category,
            problem_categories=[
                r.category.name for r in task.remediations if r.category is not None
            ],
            round_no=task.round_no,
            reviewed=task.reviewed_at is not None,
            task_id=task.id,
            assignment_code=assignment.code,
            contractor_name=contractor.name,
            technologies=[
                HcTechnologyOut.model_validate(t) for t in task.technologies
            ],
        )
        for task, wi, site, assignment, contractor in rows
    ]


@router.get("/results/export")
def hc_results_export(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN, PM, COORDINATOR)),
):
    """Download every completed health-check result as an Excel, all details."""
    stmt = (
        select(HcTask, WorkItem, Site, HcAssignment, Contractor)
        .join(WorkItem, HcTask.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .join(HcAssignment, HcTask.hc_assignment_id == HcAssignment.id)
        .join(Contractor, HcAssignment.contractor_id == Contractor.id)
        .where(HcTask.completed_at.isnot(None))
        .order_by(HcTask.completed_at.desc())
        .options(selectinload(HcTask.technologies))
    )
    rows = db.execute(stmt).all()
    export_rows = [
        {
            "site_code": site.site_code,
            "site_type": wi.site_type,
            "province": site.province.name if site.province else None,
            "assignment_code": assignment.code,
            "contractor_name": contractor.name,
            "overall_result": task.overall_result,
            "problem_category": task.problem_category,
            "reviewed": task.reviewed_at is not None,
            "completed_at": task.completed_at,
            "technologies": [
                {
                    "technology": t.technology,
                    "result": t.result,
                    "comment": t.comment,
                }
                for t in task.technologies
            ],
        }
        for task, wi, site, assignment, contractor in rows
    ]
    content = build_results_export(export_rows)
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": 'attachment; filename="hc_results.xlsx"'
        },
    )


# ---------------- Subcontractor ----------------
@router.get("/my/assignments", response_model=list[HcAssignmentOut])
def my_hc_assignments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """HC assignments belonging to the logged-in subcontractor's company."""
    if user.contractor_id is None and user.role.name not in (ADMIN, PM, COORDINATOR):
        return []
    q = db.query(HcAssignment)
    if user.contractor_id is not None:
        q = q.filter(HcAssignment.contractor_id == user.contractor_id)
    assignments = q.order_by(HcAssignment.id.desc()).limit(200).all()
    return [hc.build_assignment_out(a) for a in assignments]


@router.post("/tasks/{task_id}/result")
def submit_hc_result(
    task_id: int,
    payload: HcTaskResultSubmit,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, CONTRACTOR)),
):
    """Subcontractor submits per-technology results for one site (final)."""
    task = db.get(HcTask, task_id)
    if task is None:
        raise HTTPException(404, "Task not found")

    requested = set(hc.requested_techs_for_task(task))
    provided = {t.technology for t in payload.technology_results}
    # Enforce: only requested technologies, and all of them.
    if provided != requested:
        raise HTTPException(
            400,
            f"Must submit exactly the requested technologies {sorted(requested)}; "
            f"got {sorted(provided)}.",
        )
    for tr in payload.technology_results:
        if tr.result not in ("Normal", "NotNormal"):
            raise HTTPException(
                400, f"{tr.technology}: result must be 'Normal' or 'NotNormal'."
            )
        # The subcontractor only marks Normal / Not Normal and, when Not
        # Normal, writes a comment. The problem category is assigned later by
        # a Coordinator/PM, so it is NOT required (or accepted) here.
        if tr.result == "NotNormal" and not (tr.comment and tr.comment.strip()):
            raise HTTPException(
                400, f"{tr.technology}: 'Not Normal' requires a comment."
            )

    hc.submit_task_result(
        db,
        task=task,
        technology_results=[tr.model_dump() for tr in payload.technology_results],
    )
    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="HcTask",
        entity_id=task.id, new_value={"overall_result": task.overall_result},
    )
    db.commit()
    return {"status": "ok", "overall_result": task.overall_result}


@router.post("/tasks/{task_id}/review")
def review_hc_result(
    task_id: int,
    payload: HcReviewSubmit,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, COORDINATOR)),
):
    """Coordinator/PM validates a completed result.

    Ready → acknowledged (no category). Not Ready → assign one of the four
    problem categories. This is the second stage of the health-check flow:
    the subcontractor decides Normal/Not-Normal; the coordinator/PM decides
    which category a Not-Ready site belongs to.
    """
    task = db.get(HcTask, task_id)
    if task is None:
        raise HTTPException(404, "Task not found")
    try:
        hc.review_task(
            db, task=task, problem_categories=payload.selected(), user=user
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="HcTask",
        entity_id=task.id,
        new_value={"reviewed": True, "problem_category": task.problem_category},
    )
    db.commit()
    return {
        "status": "ok",
        "problem_category": task.problem_category,
        "reviewed": True,
    }


# ---------------- Category owners: the fix queue ----------------
@router.get("/my/fixes", response_model=list[HcRemediationOut])
def my_fix_queue(
    db: Session = Depends(get_db),
    user: User = Depends(require_category_owner),
):
    """Every open fix routed to the signed-in owner's role."""
    return hc.owner_queue(db, user)


@router.post("/fixes/{remediation_id}/close")
def close_fix(
    remediation_id: int,
    payload: HcRemediationClose,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Owner marks their fix done.

    Closing the last open fix on a site is what returns it to the basket for
    re-check, so this endpoint is the hinge of the whole loop.
    """
    rem = db.get(HcRemediation, remediation_id)
    if rem is None:
        raise HTTPException(404, "Fix not found")
    _assert_may_work_fix(user, rem)

    try:
        hc.close_remediation(db, remediation=rem, note=payload.note, user=user)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    returned = hc.returns_to_basket(rem.task)
    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="HcRemediation",
        entity_id=rem.id,
        new_value={"status": rem.status, "returned_to_basket": returned},
    )
    db.commit()
    return {"status": "ok", "returned_to_basket": returned}


@router.post("/fixes/{remediation_id}/reroute")
def request_reroute(
    remediation_id: int,
    payload: HcRerouteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Owner proposes that a fix belongs to a different category."""
    rem = db.get(HcRemediation, remediation_id)
    if rem is None:
        raise HTTPException(404, "Fix not found")
    _assert_may_work_fix(user, rem)

    try:
        hc.propose_reroute(
            db,
            remediation=rem,
            to_category_name=payload.to_category,
            reason=payload.reason,
            user=user,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="HcRemediation",
        entity_id=rem.id, new_value={"reroute_to": payload.to_category},
    )
    db.commit()
    return {"status": "ok"}


@router.post("/fixes/{remediation_id}/reroute/decide")
def decide_reroute(
    remediation_id: int,
    payload: HcRerouteDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN, PM)),
):
    """PM approves or rejects a proposed re-route."""
    rem = db.get(HcRemediation, remediation_id)
    if rem is None:
        raise HTTPException(404, "Fix not found")
    try:
        hc.decide_reroute(db, remediation=rem, approve=payload.approve, user=user)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="HcRemediation",
        entity_id=rem.id, new_value={"reroute_approved": payload.approve},
    )
    db.commit()
    return {"status": "ok"}


@router.get("/sites/{work_item_id}/history", response_model=list[HcHistoryEvent])
def site_history(
    work_item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The full health-check timeline for one site, visible to every user."""
    return hc.site_history(db, work_item_id)


def _assert_may_work_fix(user: User, rem: HcRemediation) -> None:
    """Only the owning role (or Admin/PM acting on their behalf) may act."""
    if user.role.name in (ADMIN, PM):
        return
    if user.role.is_category_owner and rem.owner_role_id == user.role_id:
        return
    raise HTTPException(403, "This fix is not assigned to your team")


@router.get("/assignments/{assignment_id}/template")
def download_template(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download a pre-filled Excel template for bulk result entry."""
    assignment = db.get(HcAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(404, "Assignment not found")
    content = build_template(assignment)
    filename = f"{assignment.code}_healthcheck.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/assignments/{assignment_id}/upload")
def upload_template(
    assignment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM, CONTRACTOR)),
):
    """Apply a filled bulk template: computes every site's Ready/NotReady."""
    assignment = db.get(HcAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(404, "Assignment not found")
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files are accepted")

    content = file.file.read()
    try:
        parsed = parse_template(content, assignment)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    applied = 0
    task_by_wi = {t.work_item_id: t for t in assignment.tasks}
    for entry in parsed:
        task = task_by_wi.get(entry["work_item_id"])
        if task is None:
            continue
        hc.submit_task_result(
            db, task=task, technology_results=entry["technology_results"]
        )
        applied += 1

    record_audit(
        db, user_id=user.id, module="HealthCheck", entity_type="HcAssignment",
        entity_id=assignment.id, new_value={"bulk_applied": applied},
    )
    db.commit()
    return {"status": "ok", "sites_applied": applied}


@router.get("/assignments/{assignment_id}/export")
def export_assignment_feedback(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN, PM, COORDINATOR)),
):
    """Download one assignment's feedback (summary + per-site detail) as Excel.

    Lets a PM pick any single assignment from HC History and pull its full
    feedback into a spreadsheet.
    """
    assignment = db.get(HcAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(404, "Assignment not found")

    contractor = db.get(Contractor, assignment.contractor_id)
    stats = hc.build_assignment_stats(assignment)
    content = build_assignment_feedback_export(
        assignment,
        contractor_name=contractor.name if contractor else None,
        stats=stats,
    )
    filename = f"{assignment.code}_feedback.xlsx"
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
