"""The active queues, as reads over records that already exist.

One rule holds throughout: **an item is in a queue exactly while its condition
holds.** Nothing is pushed to a queue, nothing is dismissed from one, and there
is no queue table to reconcile — which is why the health-check pool has never
gone wrong, and why the rest of the lifecycle is modelled the same way here.

Each function answers one question about live state:

===========================  ==================================================
``in_progress``              health checks out with a subcontractor
``remediations``             open fixes, across every category
``reroutes``                 fixes whose owner disputes the category
``dt_assignment``            confirmed-Ready sites awaiting an official DT
``dt_review``                drive tests awaiting approval
===========================  ==================================================

Every one is province-scoped through ``visible_work_item_ids``, the same as
every other read in the platform.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.health_check import HcAssignment, HcRemediation, HcTask
from app.models.reference import Contractor, User
from app.models.workitem import Assignment, DriveTest, Site, WorkItem
from app.services.health_check import build_assignment_stats
from app.services.tech_parser import parse_technologies
from app.services.visibility import visible_work_item_ids


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _days_since(dt: datetime | None) -> int | None:
    dt = _aware(dt)
    return max((_now() - dt).days, 0) if dt else None


def _site_of(wi: WorkItem | None) -> tuple[str | None, str | None]:
    if wi is None or wi.site is None:
        return None, None
    return wi.site.site_code, (
        wi.site.province.name if wi.site.province else None
    )


# --------------------------------------------------------------------------
# HC In Progress
# --------------------------------------------------------------------------
def in_progress(db: Session, user: User) -> list[dict]:
    """Assignments with at least one site still awaiting a result.

    A site between assignment and submission was visible on no screen: it had
    left the pool and reached no results table, and the only place it appeared
    was the assignment-level history tab, which the Coordinator could not open.
    "Who is late" was unanswerable without opening each assignment.
    """
    visible = select(HcTask.hc_assignment_id).where(
        HcTask.work_item_id.in_(visible_work_item_ids(user, db)),
        HcTask.completed_at.is_(None),
    )
    assignments = (
        db.execute(
            select(HcAssignment)
            .where(HcAssignment.id.in_(visible))
            .order_by(HcAssignment.assigned_at.asc())
            .options(selectinload(HcAssignment.contractor))
        )
        .scalars()
        .all()
    )

    rows = []
    for assignment in assignments:
        stats = build_assignment_stats(assignment)
        pending = [t for t in assignment.tasks if t.completed_at is None]
        rows.append(
            {
                "assignment_id": assignment.id,
                "code": assignment.code,
                "contractor_name": (
                    assignment.contractor.name if assignment.contractor else None
                ),
                "assigned_at": stats["assigned_at"],
                "days_outstanding": _days_since(assignment.assigned_at) or 0,
                "sites_total": stats["sites_assigned"],
                "sites_submitted": (
                    stats["sites_assigned"] - stats["sites_pending"]
                ),
                "sites_pending": stats["sites_pending"],
                "pending_sites": [
                    (t.work_item.site.site_code if t.work_item and t.work_item.site else None)
                    for t in pending
                ],
            }
        )
    # Longest outstanding first: the assignment nobody has answered for three
    # weeks is the one worth chasing.
    rows.sort(key=lambda r: -r["days_outstanding"])
    return rows


# --------------------------------------------------------------------------
# Remediation board
# --------------------------------------------------------------------------
def remediations(db: Session, user: User) -> list[dict]:
    """Every open fix in scope, worst-overdue first.

    The owner's own queue already exists; this is the view the people who
    routed the work never had. A PM or Coordinator saw remediation only as
    individual overdue nudges in the Action Center, so the shape of what was
    outstanding across categories was not visible anywhere.
    """
    rows = (
        db.query(HcRemediation)
        .filter(
            HcRemediation.closed_at.is_(None),
            HcRemediation.work_item_id.in_(visible_work_item_ids(user, db)),
        )
        .options(
            selectinload(HcRemediation.category),
            selectinload(HcRemediation.owner_role),
            selectinload(HcRemediation.task).selectinload(HcTask.technologies),
        )
        .all()
    )

    work_items = _work_items_by_id(db, [r.work_item_id for r in rows])

    out = []
    for rem in rows:
        wi = work_items.get(rem.work_item_id)
        site_code, province = _site_of(wi)
        due = _aware(rem.due_at)
        failed = [
            t for t in rem.task.technologies if t.result == "NotNormal"
        ] if rem.task else []
        out.append(
            {
                "id": rem.id,
                "work_item_id": rem.work_item_id,
                "site_code": site_code,
                "province": province,
                "category": rem.category.name if rem.category else None,
                "owner_role": rem.owner_role.name if rem.owner_role else None,
                "round_no": rem.task.round_no if rem.task else 1,
                "technologies": [t.technology for t in failed],
                "issue": failed[0].comment if failed else None,
                "days_open": _days_since(rem.opened_at) or 0,
                "days_late": max((_now() - due).days, 0) if due else 0,
                "due_at": due,
                "reroute_pending": rem.reroute_to_category_id is not None,
            }
        )
    out.sort(key=lambda r: (-r["days_late"], -r["days_open"]))
    return out


def reroutes(db: Session, user: User) -> list[dict]:
    """Fixes whose owner says the category is wrong, awaiting a decision.

    The endpoint that decides these has always existed, and the Action Center
    has always deep-linked to ``?tab=reroutes``. The destination was never
    built, so the link resolved to nothing.
    """
    rows = (
        db.query(HcRemediation)
        .filter(
            HcRemediation.reroute_to_category_id.isnot(None),
            HcRemediation.closed_at.is_(None),
            HcRemediation.work_item_id.in_(visible_work_item_ids(user, db)),
        )
        .options(
            selectinload(HcRemediation.category),
            selectinload(HcRemediation.reroute_to_category),
            selectinload(HcRemediation.owner_role),
        )
        .order_by(HcRemediation.reroute_at.asc())
        .all()
    )

    work_items = _work_items_by_id(db, [r.work_item_id for r in rows])
    users = _user_names(db, [r.reroute_by for r in rows])

    out = []
    for rem in rows:
        site_code, province = _site_of(work_items.get(rem.work_item_id))
        out.append(
            {
                "id": rem.id,
                "work_item_id": rem.work_item_id,
                "site_code": site_code,
                "province": province,
                "from_category": rem.category.name if rem.category else None,
                "to_category": (
                    rem.reroute_to_category.name
                    if rem.reroute_to_category
                    else None
                ),
                "reason": rem.reroute_reason,
                "proposed_by": users.get(rem.reroute_by),
                "proposed_at": _aware(rem.reroute_at),
                "days_open": _days_since(rem.opened_at) or 0,
            }
        )
    return out


# --------------------------------------------------------------------------
# Drive test
# --------------------------------------------------------------------------
def dt_assignment(db: Session, user: User) -> list[dict]:
    """Sites cleared for an official drive test and not yet assigned to one.

    The condition is exactly what ``assert_ready_for_dt`` enforces on the way
    in — latest completed round Ready, and reviewed — so nothing can appear
    here that the assignment endpoint would then refuse. A queue offering rows
    the server rejects is worse than no queue.
    """
    work_items = (
        db.execute(
            select(WorkItem)
            .where(
                WorkItem.id.in_(visible_work_item_ids(user, db)),
                WorkItem.deleted_at.is_(None),
            )
            .options(
                selectinload(WorkItem.site).selectinload(Site.province),
                selectinload(WorkItem.hc_tasks).selectinload(HcTask.assignment),
                selectinload(WorkItem.assignments),
            )
        )
        .scalars()
        .all()
    )

    contractors = _contractor_names(db)
    out = []
    for wi in work_items:
        completed = [t for t in wi.hc_tasks if t.completed_at is not None]
        if not completed:
            continue
        latest = max(completed, key=lambda t: _aware(t.completed_at))
        if latest.overall_result != "Ready" or latest.reviewed_at is None:
            continue
        # An active assignment means the drive test is already in someone's
        # hands; a returned one means it is back and needs re-assigning, which
        # is the same action, so those stay.
        active = next((a for a in wi.assignments if a.is_active), None)
        if active is not None and active.returned_at is None:
            continue

        site_code, province = _site_of(wi)
        hc_contractor = (
            contractors.get(latest.assignment.contractor_id)
            if latest.assignment
            else None
        )
        out.append(
            {
                "work_item_id": wi.id,
                "site_code": site_code,
                "site_type": wi.site_type,
                "province": province,
                "requested_technologies": parse_technologies(
                    wi.requested_technology
                ),
                "rounds_taken": latest.round_no,
                "hc_contractor": hc_contractor,
                "ready_since": _aware(latest.reviewed_at),
                "days_waiting": _days_since(latest.reviewed_at) or 0,
                "returned_reason": active.return_reason if active else None,
            }
        )
    out.sort(key=lambda r: -r["days_waiting"])
    return out


def dt_review(db: Session, user: User) -> list[dict]:
    """Drive tests submitted and awaiting approval.

    A reviewer previously reached each of these one site at a time through the
    work-item detail page, which meant knowing which sites to open.
    """
    rows = (
        db.execute(
            select(DriveTest, WorkItem, Site)
            .join(WorkItem, DriveTest.work_item_id == WorkItem.id)
            .join(Site, WorkItem.site_id == Site.id)
            .where(
                DriveTest.is_active.is_(True),
                DriveTest.status == "Submitted",
                DriveTest.work_item_id.in_(visible_work_item_ids(user, db)),
            )
            .options(selectinload(DriveTest.evidence))
            .order_by(DriveTest.submitted_at.asc(), DriveTest.id.asc())
        )
        .all()
    )

    contractors = _contractor_names(db)
    assignment_contractor = _dt_contractor_by_work_item(
        db, [dt.work_item_id for dt, _wi, _site in rows]
    )

    out = []
    for dt, wi, site in rows:
        submitted_at = _aware(dt.submitted_at or dt.created_at)
        out.append(
            {
                "drive_test_id": dt.id,
                "work_item_id": wi.id,
                "site_code": site.site_code,
                "site_type": wi.site_type,
                "province": site.province.name if site.province else None,
                "contractor_name": contractors.get(
                    assignment_contractor.get(wi.id)
                ),
                "execution_date": dt.execution_date,
                "submitted_at": submitted_at,
                "days_waiting": _days_since(submitted_at) or 0,
                "report_link": dt.report_link,
                "evidence": [
                    {
                        "id": e.id,
                        "original_filename": e.original_filename,
                        "content_type": e.content_type,
                        "size_bytes": e.size_bytes,
                        "uploaded_at": _aware(e.uploaded_at),
                    }
                    for e in dt.evidence
                ],
            }
        )
    return out


# --------------------------------------------------------------------------
# Counts, for the tab badges and the Action Center
# --------------------------------------------------------------------------
def counts(db: Session, user: User) -> dict[str, int]:
    """How many items each queue currently holds, for this user.

    Counted by running the same reads the screens use rather than by separate
    ``COUNT(*)`` queries, so a badge can never disagree with the list behind
    it — which would be worse than no badge, because a queue reading 3 that
    opens empty teaches people to stop trusting the numbers.
    """
    from app.services.health_check import get_basket

    return {
        "pool": len(get_basket(db, user)),
        "in_progress": sum(r["sites_pending"] for r in in_progress(db, user)),
        "hc_review": _hc_review_count(db, user),
        "remediation": len(remediations(db, user)),
        "reroutes": len(reroutes(db, user)),
        "dt_assignment": len(dt_assignment(db, user)),
        "dt_review": len(dt_review(db, user)),
    }


def _hc_review_count(db: Session, user: User) -> int:
    return (
        db.query(HcTask)
        .filter(
            HcTask.completed_at.isnot(None),
            HcTask.reviewed_at.is_(None),
            HcTask.work_item_id.in_(visible_work_item_ids(user, db)),
        )
        .count()
    )


# --------------------------------------------------------------------------
# Shared lookups
# --------------------------------------------------------------------------
def _work_items_by_id(db: Session, ids: list[int]) -> dict[int, WorkItem]:
    """Work items with their site and province, in one query rather than N."""
    if not ids:
        return {}
    items = (
        db.execute(
            select(WorkItem)
            .where(WorkItem.id.in_(set(ids)))
            .options(selectinload(WorkItem.site).selectinload(Site.province))
        )
        .scalars()
        .all()
    )
    return {wi.id: wi for wi in items}


def _user_names(db: Session, ids: list[int | None]) -> dict[int, str]:
    real = {i for i in ids if i is not None}
    if not real:
        return {}
    rows = db.execute(select(User).where(User.id.in_(real))).scalars().all()
    return {u.id: u.full_name for u in rows}


def _contractor_names(db: Session) -> dict[int, str]:
    return {
        c.id: c.name
        for c in db.execute(select(Contractor)).scalars().all()
    }


def _dt_contractor_by_work_item(
    db: Session, work_item_ids: list[int]
) -> dict[int, int]:
    """The contractor currently holding each site's official assignment."""
    if not work_item_ids:
        return {}
    rows = (
        db.execute(
            select(Assignment)
            .where(
                Assignment.work_item_id.in_(set(work_item_ids)),
                Assignment.is_active.is_(True),
            )
        )
        .scalars()
        .all()
    )
    return {a.work_item_id: a.contractor_id for a in rows}
