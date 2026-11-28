"""Confirm, drive test half (§6.2): once per work item, from the grouped values.

Written through the same records the app writes, so there is one status
truth, then ``workflow.refresh_stage``:

1. **Health check.** "HC before DT" stays a rule: a site with no completed,
   reviewed, Ready HC gets an imported one (one ``HcAssignment`` per batch,
   code ``IMP-{n}``), dated the assignment date. ``assert_ready_for_dt`` is
   then satisfied as it is, with no bypass.
2. **Assignment.** A new official assignment; the previous active one is made
   inactive, never deleted.
3. **Drive test.** A new drive test (Submitted, Approved when Done, Rejected
   when Problematic); the previous active one is made inactive.
4. **Work item.** ``dt_status``, ``dt_date_gregorian``, ``dt_sc_contractor_id``,
   ``dt_problem_category``.

Every record created or changed is noted in the context as an effect.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.data_import import SOURCE_IMPORT
from app.models.health_check import HcAssignment, HcTask, HcTaskTechnology, HcTaskVillage
from app.models.workitem import Assignment, AssignmentVillage, DriveTest, WorkItem
from app.services import workflow
from app.services.dt_workflow import _site_village_ids
from app.services.tech_parser import parse_technologies
from app.services.workflow import _completed_at as _hc_completed_at

from . import columns as C
from .context import Ctx, noon
from .current import Universe, Value

DT_LIFECYCLE = ("dt_date", "ssv_date", "dt_result", "dt_approved_date")
WI_FIELDS = ("dt_status", "dt_problem_category", "dt_date_gregorian", "dt_sc_contractor_id")


def load_work_items(db, ids) -> dict[int, WorkItem]:
    out: dict[int, WorkItem] = {}
    ids = list(ids)
    for start in range(0, len(ids), 1000):
        chunk = ids[start:start + 1000]
        for wi in db.execute(
            select(WorkItem).where(WorkItem.id.in_(chunk)).options(
                selectinload(WorkItem.assignments), selectinload(WorkItem.drive_tests),
                selectinload(WorkItem.hc_tasks), selectinload(WorkItem.health_checks),
            )
        ).scalars():
            out[wi.id] = wi
    return out


def _wi_snapshot(wi: WorkItem) -> dict:
    return {
        "dt_status": wi.dt_status,
        "dt_problem_category": wi.dt_problem_category,
        "dt_date_gregorian": wi.dt_date_gregorian.isoformat() if wi.dt_date_gregorian else None,
        "dt_sc_contractor_id": wi.dt_sc_contractor_id,
    }


def restore_wi(wi: WorkItem, snap: dict) -> None:
    wi.dt_status = snap.get("dt_status")
    wi.dt_problem_category = snap.get("dt_problem_category")
    day = snap.get("dt_date_gregorian")
    wi.dt_date_gregorian = date.fromisoformat(day) if day else None
    wi.dt_sc_contractor_id = snap.get("dt_sc_contractor_id")


def wi_snapshot(wi: WorkItem) -> dict:
    return _wi_snapshot(wi)


def _hc_passed(wi: WorkItem) -> bool:
    done = [t for t in wi.hc_tasks if t.completed_at is not None]
    if not done:
        return False
    latest = max(done, key=_hc_completed_at)
    return latest.overall_result == "Ready" and latest.reviewed_at is not None


def _ensure_hc(ctx: Ctx, wi: WorkItem, day: str, contractor_id: int | None, row_id,
               new_tasks: list[HcTask]) -> None:
    if _hc_passed(wi) or contractor_id is None:
        return
    if ctx.hc_assignment is None:
        ctx.hc_assignment = HcAssignment(
            code=f"IMP-{ctx.batch.number}", contractor_id=contractor_id,
            assigned_by=ctx.user.id, assigned_at=noon(day), status="Completed",
            remarks=ctx.tag, source=SOURCE_IMPORT, import_batch_id=ctx.batch.id,
        )
        ctx.db.add(ctx.hc_assignment)
        ctx.created(None, "hc_assignments", ctx.hc_assignment)
    moment = noon(day)
    task = HcTask(
        assignment=ctx.hc_assignment, work_item_id=wi.id,
        round_no=max((t.round_no for t in wi.hc_tasks), default=0) + 1,
        overall_result="Ready", completed_at=moment, reviewed_at=moment,
        reviewed_by=ctx.user.id, source=SOURCE_IMPORT, import_batch_id=ctx.batch.id,
    )
    task.technologies = [
        HcTaskTechnology(technology=t, result="Normal")
        for t in parse_technologies(wi.requested_technology)
    ]
    wi.hc_tasks.append(task)
    ctx.db.add(task)
    new_tasks.append(task)
    ctx.created(row_id, "hc_tasks", task, {"work_item_id": wi.id})


def apply_sites(ctx: Ctx, plans: dict[int, tuple[int, dict[str, str]]],
                now_by_wi: dict[int, dict[str, Value]], universe: Universe) -> None:
    """``plans``: work item -> (row id, {field: value to write}). Only the
    fields that change are in it (New, or a conflict decided Use file)."""
    if not plans:
        return
    db = ctx.db
    wis = load_work_items(db, plans)
    new_tasks: list[HcTask] = []
    new_assignments: list[Assignment] = []
    for wid, (row_id, new) in plans.items():
        wi = wis.get(wid)
        if wi is None:
            continue
        now = {k: v.value for k, v in now_by_wi.get(wid, {}).items()}
        target = {**now, **new}
        _apply_one(ctx, wi, row_id, new, target, universe, new_tasks, new_assignments)
        workflow.refresh_stage(wi)
        ctx.touched_work_items.add(wid)

    db.flush()
    # The villages each new record covered (UEP-14 §4), in bulk.
    villages = _site_village_ids(db, {t.work_item_id for t in new_tasks}
                                 | {a.work_item_id for a in new_assignments})
    for task in new_tasks:
        for vid in villages.get(task.work_item_id, []):
            db.add(HcTaskVillage(hc_task_id=task.id, village_id=vid))
    for assignment in new_assignments:
        for vid in villages.get(assignment.work_item_id, []):
            db.add(AssignmentVillage(assignment_id=assignment.id, village_id=vid))


def _apply_one(ctx: Ctx, wi: WorkItem, row_id, new: dict, target: dict, universe: Universe,
               new_tasks: list, new_assignments: list) -> None:
    db = ctx.db
    before = _wi_snapshot(wi)
    contractor_id = universe.contractors.get((target.get("dt_contractor") or "").casefold())
    result = target.get("dt_result")
    lifecycle = set(new) & set(DT_LIFECYCLE)

    # 2. Assignment.
    if ("dt_contractor" in new or "assignment_date" in new) and target.get("assignment_date") \
            and contractor_id is not None:
        _ensure_hc(ctx, wi, target["assignment_date"], contractor_id, row_id, new_tasks)
        previous = [a for a in wi.assignments if a.is_active]
        for a in previous:
            a.is_active = False
            ctx.changed(row_id, "assignments", a, "is_active", True, False)
        assignment = Assignment(
            work_item_id=wi.id, assignment_type="official", contractor_id=contractor_id,
            assigned_by=ctx.user.id, assigned_at=noon(target["assignment_date"]),
            remarks=ctx.tag, is_active=True,
            round_no=max((a.round_no for a in previous), default=1),
            source=SOURCE_IMPORT, import_batch_id=ctx.batch.id,
        )
        wi.assignments.append(assignment)
        db.add(assignment)
        new_assignments.append(assignment)
        ctx.created(row_id, "assignments", assignment, {"work_item_id": wi.id})

    # 3. Drive test.
    if lifecycle and (target.get("dt_date") or target.get("ssv_date")):
        if result == C.DT_DONE:
            _ensure_hc(ctx, wi, target.get("assignment_date") or target.get("dt_date"),
                       contractor_id or wi.dt_sc_contractor_id, row_id, new_tasks)
        for t in [t for t in wi.drive_tests if t.is_active]:
            old = {"is_active": True, "status": t.status}
            t.is_active = False
            if t.status == "Submitted":
                t.status = "Superseded"
            ctx.changed(row_id, "drive_tests", t, "is_active", old, {"is_active": False, "status": t.status})
        submitted_on = target.get("ssv_date") or target.get("dt_date")
        test = DriveTest(
            work_item_id=wi.id,
            execution_date=date.fromisoformat(target["dt_date"]) if target.get("dt_date") else None,
            submitted_at=noon(submitted_on), status="Submitted", is_active=True,
            coordinator_comment=ctx.tagged(target.get("dt_comment")),
            source=SOURCE_IMPORT, import_batch_id=ctx.batch.id,
        )
        if result in (C.DT_DONE, C.DT_PROBLEMATIC):
            decided = target.get("dt_approved_date") or submitted_on
            test.status = "Approved" if result == C.DT_DONE else "Rejected"
            test.coordinator_reviewed_at = noon(decided)
            test.coordinator_reviewed_by = ctx.user.id
        wi.drive_tests.append(test)
        db.add(test)
        ctx.created(row_id, "drive_tests", test, {"work_item_id": wi.id, "status": test.status})
    elif "dt_comment" in new:
        active = [t for t in wi.drive_tests if t.is_active]
        if active:
            t = max(active, key=lambda d: d.id or 0)
            old = t.coordinator_comment
            t.coordinator_comment = ctx.tagged(new["dt_comment"])
            ctx.changed(row_id, "drive_tests", t, "coordinator_comment", old, t.coordinator_comment)

    # 4. The work item's own drive test fields.
    if "dt_contractor" in new and contractor_id is not None:
        wi.dt_sc_contractor_id = contractor_id
    if result == C.DT_DONE and ("dt_result" in new or "dt_date" in new):
        wi.dt_status = C.DT_DONE
        wi.dt_problem_category = None
        if target.get("dt_date"):
            wi.dt_date_gregorian = date.fromisoformat(target["dt_date"])
        if contractor_id is not None:
            wi.dt_sc_contractor_id = contractor_id
    elif result == C.DT_PROBLEMATIC and ("dt_result" in new or "problem_category" in new):
        wi.dt_status = C.DT_PROBLEMATIC
        wi.dt_problem_category = target.get("problem_category")
    elif "dt_date" in new and target.get("dt_date") and wi.dt_status == C.DT_DONE:
        wi.dt_date_gregorian = date.fromisoformat(target["dt_date"])

    after = _wi_snapshot(wi)
    if after != before:
        ctx.changed(row_id, "work_items", wi, "fields", before, after)


def group_plans(changes) -> dict[int, tuple[int, dict[str, str]]]:
    """The DT changes to apply, grouped per work item."""
    plans: dict[int, tuple[int, dict]] = {}
    grouped: dict[int, dict] = defaultdict(dict)
    rows: dict[int, int] = {}
    for c in changes:
        grouped[c.entity_id][c.field] = c.new_value
        rows.setdefault(c.entity_id, c.row_id)
    for wid, fields in grouped.items():
        plans[wid] = (rows[wid], fields)
    return plans
