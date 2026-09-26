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
``dt_in_progress``           assigned sites the contractor still owes a DT for
``dt_review``                drive tests awaiting approval
``contractor_dt_todo``       one contractor's own slice of ``dt_in_progress``
``contractor_dt_submitted``  one contractor's own drive tests awaiting review
===========================  ==================================================

Every one is province-scoped through ``visible_work_item_ids``, the same as
every other read in the platform.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core import count_cache
from app.models.health_check import HcAssignment, HcRemediation, HcTask
from app.models.reference import Contractor, User
from app.models.workitem import Assignment, DriveTest, Site, WorkItem
from app.services.health_check import build_assignment_stats, scoped_work_items
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
def dt_assignment(
    db: Session, user: User, work_items: list[WorkItem] | None = None
) -> list[dict]:
    """Sites cleared for an official drive test and not yet assigned to one.

    The condition is exactly what ``assert_ready_for_dt`` enforces on the way
    in — latest completed round Ready, and reviewed — so nothing can appear
    here that the assignment endpoint would then refuse. A queue offering rows
    the server rejects is worse than no queue.
    """
    if work_items is None:
        work_items = scoped_work_items(db, user)

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


def dt_in_progress(
    db: Session, user: User, work_items: list[WorkItem] | None = None
) -> list[dict]:
    """Assigned sites the contractor still owes a drive test for.

    The blind spot between Assignment and Review. A site handed to a drive-test
    contractor left the assignment queue and reached the review queue only once
    something was submitted, so for however long that took it appeared on no
    screen: "who is late" was unanswerable, and a drive test sent back to its
    contractor was invisible to the person who sent it.

    The condition is exactly ``derive_stage(wi) == STAGE_ASSIGNED``, written the
    same way ``workflow.derive_stage`` writes it -- latest *active* assignment
    present and not handed back, and the latest *active* drive test neither
    ``Submitted`` (it is with the reviewer) nor ``Approved`` (it is done). Both
    "latest" are by id, as they are there, so the two can never disagree about
    a site. ``assignment_type`` is deliberately not consulted, for the same
    reason: the stage does not consult it either.

    The two states this answers for are the whole point of the queue:

    * **with_contractor** -- assigned, nothing come back yet.
    * **sent_back** -- a reviewer rejected or returned the drive test, so the
      site is stage ``Assigned`` again and the contractor owes a resubmission.
      The reviewer's comment and date travel with the row, because "what did I
      send back, and when" is the other question this queue exists to answer.

    Read-only for the reviewer: every row here is waiting on somebody else.
    """
    if work_items is None:
        work_items = scoped_work_items(db, user)

    latest_dt = _active_drive_test_by_work_item(db, user)
    contractors = _contractor_names(db)

    out = []
    for wi in work_items:
        assignment = _latest_active(wi.assignments)
        if assignment is None or assignment.returned_at is not None:
            continue
        dt = latest_dt.get(wi.id)
        if dt is not None and dt.status in ("Submitted", "Approved"):
            continue

        sent_back = dt is not None and dt.status in ("Rejected", "Returned")
        site_code, province = _site_of(wi)
        out.append(
            {
                "work_item_id": wi.id,
                "site_code": site_code,
                "site_type": wi.site_type,
                "province": province,
                "requested_technologies": parse_technologies(
                    wi.requested_technology
                ),
                "contractor_name": contractors.get(assignment.contractor_id),
                "assigned_at": _aware(assignment.assigned_at),
                "days_since_assigned": _days_since(assignment.assigned_at) or 0,
                "status": "sent_back" if sent_back else "with_contractor",
                "sent_back_comment": (
                    dt.coordinator_comment if sent_back else None
                ),
                "sent_back_at": (
                    _aware(dt.coordinator_reviewed_at) if sent_back else None
                ),
            }
        )
    # Sent back first -- those are the ones a reviewer has already spent a
    # decision on -- then longest assigned first within each group.
    out.sort(key=lambda r: (r["status"] != "sent_back", -r["days_since_assigned"]))
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
# My Drive Tests -- one contractor's own view of dt_in_progress / dt_review
# --------------------------------------------------------------------------
def _own_active_assignment(wi: WorkItem, contractor_id: int) -> Assignment | None:
    """This work item's active assignment, if it is currently this company's.

    ``apply_work_item_scope`` already lets a contractor see every site it has
    *ever* held, which is right for history and too wide for "what do I still
    owe" -- a site reassigned away to a different company must not still show
    up in the original contractor's To Do list. This is the one extra check
    that narrows a scoped work item down to "and it is still mine right now".
    """
    active = _latest_active(wi.assignments)
    if active is None or active.contractor_id != contractor_id:
        return None
    return active


def contractor_dt_todo(db: Session, user: User) -> list[dict]:
    """One contractor's To Do tab: their own rows of ``dt_in_progress``.

    Deliberately built by filtering ``scoped_work_items`` down to this
    company's own active assignments and handing the result to
    ``dt_in_progress`` -- the same "still owes a drive test" predicate PM and
    Coordinator see, reused rather than re-written, so the two can never
    silently disagree about what belongs in a To Do queue.
    """
    if user.contractor_id is None:
        return []

    work_items = [
        wi for wi in scoped_work_items(db, user)
        if _own_active_assignment(wi, user.contractor_id) is not None
    ]
    rows = dt_in_progress(db, user, work_items=work_items)

    latest_dt = _active_drive_test_by_work_item(db, user)
    for row in rows:
        dt = latest_dt.get(row["work_item_id"])
        row["active_drive_test_id"] = dt.id if dt else None
    return rows


def contractor_dt_submitted(db: Session, user: User) -> list[dict]:
    """One contractor's Submitted tab: their own drive tests awaiting review.

    Read-only, like ``dt_review`` -- every row here is waiting on a PM or
    Coordinator, not on the contractor reading it. Scoped to this company's
    own active assignments the same way ``contractor_dt_todo`` is, rather
    than to everything the contractor has ever held.
    """
    if user.contractor_id is None:
        return []

    work_item_ids = [
        wi.id for wi in scoped_work_items(db, user)
        if _own_active_assignment(wi, user.contractor_id) is not None
    ]
    if not work_item_ids:
        return []

    rows = (
        db.execute(
            select(DriveTest, WorkItem, Site)
            .join(WorkItem, DriveTest.work_item_id == WorkItem.id)
            .join(Site, WorkItem.site_id == Site.id)
            .where(
                DriveTest.is_active.is_(True),
                DriveTest.status == "Submitted",
                DriveTest.work_item_id.in_(work_item_ids),
            )
            .options(selectinload(DriveTest.evidence))
            .order_by(DriveTest.submitted_at.asc(), DriveTest.id.asc())
        )
        .all()
    )

    out = []
    for dt, wi, site in rows:
        submitted_at = _aware(dt.submitted_at or dt.created_at)
        out.append(
            {
                "work_item_id": wi.id,
                "drive_test_id": dt.id,
                "site_code": site.site_code,
                "province": site.province.name if site.province else None,
                "execution_date": dt.execution_date,
                "submitted_at": submitted_at,
                "days_waiting": _days_since(submitted_at) or 0,
                "evidence_filenames": [e.original_filename for e in dt.evidence],
            }
        )
    return out


def contractor_dt_counts(db: Session, user: User) -> dict[str, int]:
    """How many rows the two My Drive Tests tabs hold, for the badges.

    Answered from bare columns rather than by building both lists, for the
    reason ``counts`` gives below. The conditions are the lists' own, one for
    one, and ``tests/test_queue_count_parity.py`` holds the two together.
    """
    return _cached(("contractor_dt", user), lambda: _contractor_dt_counts(db, user))


def _contractor_dt_counts(db: Session, user: User) -> dict[str, int]:
    if user.contractor_id is None:
        return {"todo": 0, "submitted": 0}

    scoped = visible_work_item_ids(user, db)
    assignments = _active_assignments(db, scoped)
    latest_dt = _active_drive_test_by_work_item(db, user)

    # ``_own_active_assignment``: the latest active assignment is this
    # company's. Every scoped id is in ``assignments`` or has none at all, so
    # walking the assignments walks exactly the sites that can qualify.
    own = [
        wi_id
        for wi_id, rows in assignments.items()
        if rows[-1].contractor_id == user.contractor_id
    ]
    todo = sum(
        1 for wi_id in own if _owes_drive_test(assignments[wi_id], latest_dt.get(wi_id))
    )
    submitted = 0
    if own:
        submitted = db.execute(
            _submitted_drive_tests_count().where(DriveTest.work_item_id.in_(own))
        ).scalar_one()
    return {"todo": todo, "submitted": submitted}


# --------------------------------------------------------------------------
# Counts, for the tab badges and the Action Center
# --------------------------------------------------------------------------
def counts(db: Session, user: User) -> dict[str, int]:
    """How many items each queue currently holds, for this user.

    These badges are read far more often than the lists behind them: the
    sidebar, the Health Check and Drive Test tabs and the Action Center all
    ask, usually for the same click. Building every list in full to take its
    length loaded each in-scope work item with its sites, tasks, assignments
    and -- through eager relationships -- every task's technologies and
    remediations, several times per click, and that was most of the time a
    page took to open.

    So each count is answered from the few columns its condition reads, by
    the same condition the list applies. A badge disagreeing with the list
    behind it would be worse than no badge -- a queue reading 3 that opens
    empty teaches people to stop trusting the numbers -- which is why the two
    are held together by ``tests/test_queue_count_parity.py`` rather than by
    sharing code: any change to a list's condition has to be made here too,
    and that test is what says so.

    Cached for a few seconds per user (see ``app.core.count_cache``), and the
    cache is emptied by every commit, so an action shows in the next read.
    """
    return _cached(("hc", user), lambda: _counts(db, user))


def _counts(db: Session, user: User) -> dict[str, int]:
    scoped = visible_work_item_ids(user, db)

    # --- HC Pool: every on-air site whose drive test is not Done --------
    from app.services import cpm_columns as C
    from app.services.health_check import work_item_ids_in_open_hc

    busy = work_item_ids_in_open_hc(db)
    pool = pool_assignable = 0
    for wi_id, last_stage, dt_status in db.execute(
        select(WorkItem.id, WorkItem.last_stage, WorkItem.dt_status).where(
            WorkItem.id.in_(scoped)
        )
    ):
        if C.normalize_stage(last_stage) not in C.ONAIR_STAGES:
            continue
        if C.normalize_dt_status(dt_status) in C.DT_STATUS_EXCLUDED_FROM_HC:
            continue
        pool += 1
        # Every pool state but "In health check" is assignable (see
        # HC_ASSIGNABLE_STATES), and that state is exactly "in ``busy``".
        if wi_id not in busy:
            pool_assignable += 1

    # --- HC In Progress: pending sites of every assignment in scope -------
    # ``in_progress`` lists an assignment once any in-scope site of it is
    # pending, then counts *all* of its pending sites -- so this does too.
    visible_assignments = select(HcTask.hc_assignment_id).where(
        HcTask.work_item_id.in_(scoped), HcTask.completed_at.is_(None)
    )
    in_progress_sites = db.execute(
        select(func.count(HcTask.id)).where(
            HcTask.hc_assignment_id.in_(visible_assignments),
            HcTask.completed_at.is_(None),
        )
    ).scalar_one()

    # --- Remediation board and re-route decisions -----------------------
    open_fixes = select(func.count(HcRemediation.id)).where(
        HcRemediation.closed_at.is_(None),
        HcRemediation.work_item_id.in_(scoped),
    )
    remediation = db.execute(open_fixes).scalar_one()
    reroute_count = db.execute(
        open_fixes.where(HcRemediation.reroute_to_category_id.isnot(None))
    ).scalar_one()

    # --- Drive-test assignment and in-progress ---------------------------
    assignments = _active_assignments(db, scoped)
    latest_task = _latest_completed_task_facts(db, scoped)
    latest_dt = _active_drive_test_by_work_item(db, user)

    dt_assignment_count = 0
    for wi_id, task in latest_task.items():
        if task.overall_result != "Ready" or task.reviewed_at is None:
            continue
        # ``dt_assignment`` takes the *first* active assignment, not the
        # latest -- kept as it is, so the badge and the list cannot differ.
        active = assignments.get(wi_id, [None])[0]
        if active is not None and active.returned_at is None:
            continue
        dt_assignment_count += 1

    dt_in_progress_count = sum(
        1
        for wi_id, rows in assignments.items()
        if _owes_drive_test(rows, latest_dt.get(wi_id))
    )

    # --- Drive-test review -------------------------------------------------
    dt_review_count = db.execute(
        _submitted_drive_tests_count().where(DriveTest.work_item_id.in_(scoped))
    ).scalar_one()

    return {
        # The pool quantity: every on-air site whose drive test is not Done.
        "pool": pool,
        # The slice of it a Coordinator can raise a check for right now. The
        # pool figure answers "how much work is there"; the nav's attention
        # badge asks "how much can I do something about", and since the pool
        # started carrying sites that are mid-check those are two numbers.
        "pool_assignable": pool_assignable,
        "in_progress": in_progress_sites,
        "hc_review": _hc_review_count(db, user),
        "remediation": remediation,
        "reroutes": reroute_count,
        "dt_assignment": dt_assignment_count,
        "dt_in_progress": dt_in_progress_count,
        "dt_review": dt_review_count,
    }


def _cached(kind: tuple[str, User], compute) -> dict[str, int]:
    """One user's counts, shared by every read of them for a few seconds.

    Keyed on everything the scope rules read from the user, so a change of
    role, contractor or grant (each a commit, which empties the cache anyway)
    can never be answered from another scope's numbers.
    """
    name, user = kind
    key = (name, user.id, user.role_id, user.contractor_id)
    return count_cache.get_or_compute(key, compute)


def _active_assignments(db: Session, scoped) -> dict[int, list]:
    """Each in-scope site's active drive-test assignments, oldest id first.

    Oldest-first so ``[0]`` is what ``next(a for a in wi.assignments if
    a.is_active)`` finds and ``[-1]`` is what ``_latest_active`` picks.
    """
    out: dict[int, list] = {}
    for row in db.execute(
        select(
            Assignment.id,
            Assignment.work_item_id,
            Assignment.contractor_id,
            Assignment.returned_at,
        )
        .where(Assignment.is_active.is_(True), Assignment.work_item_id.in_(scoped))
        .order_by(Assignment.id.asc())
    ):
        out.setdefault(row.work_item_id, []).append(row)
    return out


def _latest_completed_task_facts(db: Session, scoped) -> dict[int, object]:
    """Each in-scope site's latest completed HC task, as bare columns.

    "Latest" as ``dt_assignment`` picks it: the greatest ``completed_at``,
    the first in id order on a tie.
    """
    latest: dict[int, object] = {}
    for row in db.execute(
        select(
            HcTask.id,
            HcTask.work_item_id,
            HcTask.completed_at,
            HcTask.overall_result,
            HcTask.reviewed_at,
        )
        .where(HcTask.completed_at.isnot(None), HcTask.work_item_id.in_(scoped))
        .order_by(HcTask.id.asc())
    ):
        seen = latest.get(row.work_item_id)
        if seen is None or _aware(row.completed_at) > _aware(seen.completed_at):
            latest[row.work_item_id] = row
    return latest


def _owes_drive_test(assignments: list, dt) -> bool:
    """``dt_in_progress``'s condition, for one site."""
    assignment = assignments[-1] if assignments else None
    if assignment is None or assignment.returned_at is not None:
        return False
    return dt is None or dt.status not in ("Submitted", "Approved")


def _submitted_drive_tests_count():
    """``dt_review``'s rows, counted -- joins kept, since they can drop rows."""
    return (
        select(func.count(DriveTest.id))
        .select_from(DriveTest)
        .join(WorkItem, DriveTest.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(DriveTest.is_active.is_(True), DriveTest.status == "Submitted")
    )


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


def _latest_active(rows):
    """The newest active row, by id.

    ``workflow.derive_stage`` picks both the assignment and the drive test this
    way. Anything that has to agree with the stage has to pick the same one --
    ``next(... if is_active)`` reads the collection in load order, which is not
    the same choice if two rows are ever active at once.
    """
    active = [r for r in rows if r.is_active]
    return max(active, key=lambda r: r.id) if active else None


def _active_drive_test_by_work_item(db: Session, user: User) -> dict[int, object]:
    """The latest active drive test per in-scope site, as bare columns.

    Columns rather than entities on purpose: ``DriveTest.evidence`` is
    ``lazy="selectin"``, so loading these as ORM objects would pull every
    attached report file's metadata for the whole country to answer a question
    that is only about ``status``.
    """
    rows = db.execute(
        select(
            DriveTest.id,
            DriveTest.work_item_id,
            DriveTest.status,
            DriveTest.coordinator_comment,
            DriveTest.coordinator_reviewed_at,
        ).where(
            DriveTest.is_active.is_(True),
            DriveTest.work_item_id.in_(visible_work_item_ids(user, db)),
        )
    ).all()

    latest: dict[int, object] = {}
    for row in rows:
        seen = latest.get(row.work_item_id)
        if seen is None or row.id > seen.id:
            latest[row.work_item_id] = row
    return latest


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
