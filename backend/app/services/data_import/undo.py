"""Undo a whole batch (§7), where nothing changed since.

Every effect the batch recorded is reversed, newest first, **only if the
record still holds what the batch wrote**. Records changed afterwards -- in
UEP or by a later batch -- are left alone and their rows listed as kept.

Records the batch created are deactivated, not deleted: drive tests and
assignments ``is_active = false``, submissions ``Withdrawn``. The one
exception is the imported health check: it is a placeholder the import made
up to satisfy "HC before DT", not a check anyone did, so it is removed from
the site (its trace stays in the audit log and the change log). Stages and
authority statuses are recomputed at the end.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.models.acceptance_case import STATE_WAITING, AcceptanceCase
from app.models.acceptance_workflow import (
    REVIEW_VALIDATED,
    REVIEW_WITHDRAWN,
    AcceptanceSubmission,
)
from app.models.data_import import KIND_EFFECT, STATUS_APPLIED, STATUS_UNDONE, ImportChange, ImportRow
from app.models.health_check import HcAssignment, HcTask, HcTaskVillage
from app.models.reference import User
from app.models.workitem import Assignment, DriveTest, Village, WorkItem
from app.services import acceptance_workflow as flow
from app.services import workflow
from app.services.acceptance_cases import transitions
from app.services.acceptance_cases.sync import state_for_status
from app.services.audit import record_audit

from . import apply_acceptance, apply_dt
from .batches import MODULE, ImportError_


def undo(db: Session, batch, user: User) -> dict:
    if batch.status != STATUS_APPLIED:
        raise ImportError_(f"Batch #{batch.number} is {batch.status}; only an applied batch can be undone.", 409)
    effects = list(db.execute(
        select(ImportChange).where(ImportChange.batch_id == batch.id, ImportChange.kind == KIND_EFFECT)
        .order_by(ImportChange.id.desc())
    ).scalars())

    kept_rows: set[int] = set()
    reverted = 0
    touched_wis: set[int] = set()
    touched_villages: set[int] = set()
    undone_created: set[tuple[str, int]] = set()
    undone_subs: set[tuple[int, str]] = set()
    tag = f"Imported · batch #{batch.number}"

    def kept(e: ImportChange) -> None:
        if e.row_id:
            kept_rows.add(e.row_id)

    for e in effects:
        etype, eid = e.entity_type, e.entity_id
        ok = False
        if etype == "assignments" and e.field == "created":
            a = db.get(Assignment, eid)
            if a and a.is_active and not _newer(db, Assignment, a):
                a.is_active = False
                ok = True
                touched_wis.add(a.work_item_id)
        elif etype == "assignments" and e.field == "is_active":
            a = db.get(Assignment, eid)
            if a and not a.is_active and _created_undone(effects, undone_created, "assignments", a.work_item_id, db):
                if not _any_active(db, Assignment, a.work_item_id):
                    a.is_active = True
                ok = True
                touched_wis.add(a.work_item_id)
        elif etype == "drive_tests" and e.field == "created":
            t = db.get(DriveTest, eid)
            if t and t.is_active and not _newer(db, DriveTest, t) \
                    and t.status == (e.new_value or {}).get("status", t.status) \
                    and (t.coordinator_comment or "").startswith(tag):
                t.is_active = False
                if t.status == "Submitted":
                    t.status = "Superseded"
                ok = True
                touched_wis.add(t.work_item_id)
        elif etype == "drive_tests" and e.field == "is_active":
            t = db.get(DriveTest, eid)
            if t and not t.is_active and _created_undone(effects, undone_created, "drive_tests", t.work_item_id, db):
                old = e.old_value or {}
                if not _any_active(db, DriveTest, t.work_item_id):
                    if old.get("status") == "Submitted" and _has_submitted(db, t.work_item_id):
                        old = {**old, "status": "Superseded"}
                    t.is_active = True
                    t.status = old.get("status", t.status)
                ok = True
                touched_wis.add(t.work_item_id)
        elif etype == "drive_tests" and e.field == "coordinator_comment":
            t = db.get(DriveTest, eid)
            if t and t.coordinator_comment == e.new_value:
                t.coordinator_comment = e.old_value
                ok = True
        elif etype == "work_items" and e.field == "fields":
            wi = db.get(WorkItem, eid)
            if wi and apply_dt.wi_snapshot(wi) == e.new_value:
                apply_dt.restore_wi(wi, e.old_value or {})
                ok = True
                touched_wis.add(wi.id)
        elif etype == "hc_tasks" and e.field == "created":
            task = db.get(HcTask, eid)
            if task is not None:
                db.flush()
                if not _any_active(db, Assignment, task.work_item_id) and not _any_active(db, DriveTest, task.work_item_id):
                    db.execute(delete(HcTaskVillage).where(HcTaskVillage.hc_task_id == task.id))
                    touched_wis.add(task.work_item_id)
                    db.delete(task)
                    ok = True
            else:
                ok = True
        elif etype == "hc_assignments" and e.field == "created":
            db.flush()
            left = db.scalar(select(func.count()).select_from(HcTask).where(HcTask.hc_assignment_id == eid))
            hc = db.get(HcAssignment, eid)
            if hc is not None and not left:
                db.delete(hc)
            ok = True
        elif etype == "acceptance_submissions" and e.field == "created":
            s = db.get(AcceptanceSubmission, eid)
            if s and s.review_status == REVIEW_VALIDATED and _latest_round(db, s):
                s.review_status = REVIEW_WITHDRAWN
                flow.bump_version(s)
                ok = True
                undone_subs.add((s.village_id, s.authority))
                touched_villages.add(s.village_id)
        elif etype == "acceptances" and e.field.startswith("projection:"):
            authority = e.field.split(":", 1)[1]
            village = db.get(Village, eid)
            if village and (eid, authority) in undone_subs and \
                    apply_acceptance._projection(village, authority) == e.new_value:
                _restore_projection(db, village, authority, e.old_value or {})
                ok = True
                touched_villages.add(village.id)
        elif etype == "acceptance_cases" and e.field == "state":
            case = db.get(AcceptanceCase, eid)
            if case and apply_acceptance.case_snapshot(case) == e.new_value and (
                (case.village_id, case.authority) in undone_subs or e.new_value is None
            ):
                touched_villages.add(case.village_id)
                if e.old_value:
                    apply_acceptance.restore_case(case, e.old_value)
                else:
                    db.flush()
                    village = db.get(Village, case.village_id)
                    flow.recompute_authority_statuses(db, [village])
                    case.state = state_for_status(getattr(village, f"{case.authority.lower()}_status"))
                    if case.state == STATE_WAITING:
                        case.basket_role, case.category_id = "Contractor", None
                transitions.comment(db, case, user, f"Import batch #{batch.number} undone",
                                    meta={"import_batch": batch.number, "undo": True})
                ok = True
        else:
            ok = True
        if ok:
            reverted += 1
            if e.field == "created":
                undone_created.add((etype, eid))
        else:
            kept(e)

    db.flush()
    if touched_villages:
        villages = list(db.execute(select(Village).where(Village.id.in_(touched_villages))).scalars())
        flow.recompute_authority_statuses(db, villages)
    if touched_wis:
        for wi in apply_dt.load_work_items(db, touched_wis).values():
            workflow.refresh_stage(wi)

    kept_list = []
    if kept_rows:
        for r in db.execute(select(ImportRow).where(ImportRow.id.in_(kept_rows)).order_by(ImportRow.row_no)).scalars():
            kept_list.append({"row": r.row_no, "key": r.key_text})

    batch.status = STATUS_UNDONE
    batch.undone_by = user.id
    batch.undone_at = datetime.now(timezone.utc)
    batch.counts = {**(batch.counts or {}), "undo": {"reverted": reverted, "kept_rows": len(kept_list),
                                                     "kept": kept_list[:200]}}
    record_audit(
        db, user_id=user.id, action=audit_actions.DATA_IMPORT_UNDONE, module=MODULE,
        entity_type="ImportBatch", entity_id=batch.id,
        new_value={"number": batch.number, "reverted": reverted, "kept_rows": len(kept_list)},
    )
    db.flush()
    return {"reverted": reverted, "kept_rows": len(kept_list), "kept": kept_list[:200]}


def _newer(db: Session, model, record) -> bool:
    return bool(db.scalar(select(func.count()).select_from(model).where(
        model.work_item_id == record.work_item_id, model.id > record.id
    )))


def _any_active(db: Session, model, work_item_id: int) -> bool:
    db.flush()
    return bool(db.scalar(select(func.count()).select_from(model).where(
        model.work_item_id == work_item_id, model.is_active
    )))


def _has_submitted(db: Session, work_item_id: int) -> bool:
    return bool(db.scalar(select(func.count()).select_from(DriveTest).where(
        DriveTest.work_item_id == work_item_id, DriveTest.status == "Submitted"
    )))


def _created_undone(effects, undone_created, etype: str, work_item_id: int, db: Session) -> bool:
    """Whether the record this batch created in place of this one was undone."""
    model = Assignment if etype == "assignments" else DriveTest
    for e in effects:
        if e.entity_type == etype and e.field == "created" and (etype, e.entity_id) in undone_created:
            rec = db.get(model, e.entity_id)
            if rec is not None and rec.work_item_id == work_item_id:
                return True
    return False


def _latest_round(db: Session, s: AcceptanceSubmission) -> bool:
    top = db.scalar(select(func.max(AcceptanceSubmission.id)).where(
        AcceptanceSubmission.village_id == s.village_id,
        AcceptanceSubmission.authority == s.authority,
        AcceptanceSubmission.review_status.in_([REVIEW_VALIDATED, "Pending"]),
    ))
    return top == s.id


def _restore_projection(db: Session, village: Village, authority: str, old: dict) -> None:
    a = authority.lower()
    for row in list(village.acceptances):
        snap = old.get(row.technology)
        if snap is None:
            other = "cra" if a == "ict" else "ict"
            if getattr(row, f"{other}_source") is None and getattr(row, f"{other}_status") in ("Pending", None):
                village.acceptances.remove(row)
                db.delete(row)
            else:
                setattr(row, f"{a}_status", "Pending")
                setattr(row, f"{a}_date", None)
                setattr(row, f"{a}_source", None)
            continue
        status, day, source = snap
        setattr(row, f"{a}_status", status)
        setattr(row, f"{a}_date", date.fromisoformat(day) if day else None)
        setattr(row, f"{a}_source", source)

