"""The Drive test app's work pages (UEP-14): Checks batches, Tests sites,
villages per assignment, rounds and reassignment.

Reads over the existing HC and DT tables plus ``hc_task_villages`` and
``assignment_villages``. SLA values come from the SLA service
(``action_queues.sla``); nothing here hard-codes a day count.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.health_check import HcAssignment, HcTask, HcTaskVillage
from app.models.reference import Contractor, User
from app.models.workitem import Assignment, AssignmentVillage, DriveTest, Site, Village, WorkItem
from app.services import pipeline
from app.services.action_queues import sla
from app.services.visibility import visible_work_item_ids
from app.services.workflow import refresh_stage

#: The configured queues whose SLA each clock reads.
HC_CHECK_QUEUE = "hc_in_check"
DT_TEST_QUEUE = "dt_in_test"

BATCH_STATUSES = ("open", "to_decide", "overdue", "completed")
TEST_TABS = ("review", "with", "reviewed")
TEST_SORTS = ("aging", "site", "province", "contractor")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hours(start, end) -> float | None:
    a, b = sla.as_datetime(start), sla.as_datetime(end)
    if a is None or b is None:
        return None
    return round((b - a).total_seconds() / 3600, 1)


def _names(db: Session, model, ids) -> dict[int, str]:
    real = {i for i in ids if i is not None}
    if not real:
        return {}
    col = model.full_name if model is User else model.name
    return dict(db.execute(select(model.id, col).where(model.id.in_(real))).all())


# --------------------------------------------------------------------------
# Villages per assignment
# --------------------------------------------------------------------------
def _site_village_ids(db: Session, work_item_ids) -> dict[int, list[int]]:
    out: dict[int, list[int]] = defaultdict(list)
    ids = set(work_item_ids)
    if not ids:
        return out
    for wi_id, vid in db.execute(
        select(Village.work_item_id, Village.id).where(
            Village.work_item_id.in_(ids), Village.deleted_at.is_(None)
        )
    ):
        out[wi_id].append(vid)
    return out


def record_hc_villages(db: Session, tasks: list[HcTask]) -> int:
    """Store the villages each new HC task covers. Returns how many."""
    by_site = _site_village_ids(db, [t.work_item_id for t in tasks])
    n = 0
    for t in tasks:
        for vid in by_site.get(t.work_item_id, []):
            db.add(HcTaskVillage(hc_task_id=t.id, village_id=vid))
            n += 1
    db.flush()
    return n


def record_assignment_villages(db: Session, assignment: Assignment, only: list[int] | None = None) -> int:
    """Store the villages a DT assignment covers: ``only`` when it is for a
    site's new villages, else every current village of the site."""
    ids = only if only is not None else _site_village_ids(db, [assignment.work_item_id]).get(assignment.work_item_id, [])
    for vid in ids:
        db.add(AssignmentVillage(assignment_id=assignment.id, village_id=vid))
    db.flush()
    return len(ids)


def new_village_ids(db: Session, work_item_ids) -> dict[int, list[int]]:
    """Per site: villages no DT assignment has covered yet that CPM added
    after the site's first DT assignment (UEP-14 §4)."""
    ids = set(work_item_ids)
    if not ids:
        return {}
    first_assigned: dict[int, datetime] = {}
    for wi_id, at in db.execute(
        select(Assignment.work_item_id, Assignment.assigned_at).where(
            Assignment.work_item_id.in_(ids), Assignment.assignment_type == "official"
        )
    ):
        at = sla.as_datetime(at)
        if at is not None and (wi_id not in first_assigned or at < first_assigned[wi_id]):
            first_assigned[wi_id] = at
    if not first_assigned:
        return {}
    covered = set(
        db.execute(
            select(AssignmentVillage.village_id)
            .join(Assignment, Assignment.id == AssignmentVillage.assignment_id)
            .where(Assignment.work_item_id.in_(first_assigned))
        ).scalars()
    )
    out: dict[int, list[int]] = defaultdict(list)
    for wi_id, vid, seen in db.execute(
        select(Village.work_item_id, Village.id, Village.first_seen_at).where(
            Village.work_item_id.in_(first_assigned), Village.deleted_at.is_(None)
        )
    ):
        seen = sla.as_datetime(seen)
        if vid not in covered and seen is not None and seen > first_assigned[wi_id]:
            out[wi_id].append(vid)
    return dict(out)


def villages_of(db: Session, work_item_ids, since_by_site: dict[int, datetime] | None = None) -> dict[int, list[dict]]:
    """Each site's villages: id, code, name and whether CPM added it after
    ``since_by_site[site]``."""
    out: dict[int, list[dict]] = defaultdict(list)
    ids = set(work_item_ids)
    if not ids:
        return out
    for v in db.execute(
        select(Village)
        .where(Village.work_item_id.in_(ids), Village.deleted_at.is_(None))
        .order_by(Village.village_name.asc(), Village.id.asc())
    ).scalars():
        since = (since_by_site or {}).get(v.work_item_id)
        seen = sla.as_datetime(v.first_seen_at)
        out[v.work_item_id].append(
            {
                "id": v.id,
                "code": v.village_code,
                "name": v.village_name,
                "is_new": bool(since and seen and seen > since),
            }
        )
    return out


# --------------------------------------------------------------------------
# Health check · Checks
# --------------------------------------------------------------------------
def _batch_row(a: HcAssignment, tasks: list[HcTask], days: int, now: datetime, names: dict) -> dict:
    ready = sum(1 for t in tasks if t.overall_result == "Ready")
    not_ready = sum(1 for t in tasks if t.overall_result == "NotReady")
    pending = sum(1 for t in tasks if t.completed_at is None)
    to_decide = sum(1 for t in tasks if t.completed_at is not None and t.reviewed_at is None)
    assigned = sla.as_datetime(a.assigned_at)
    due = assigned + timedelta(days=days) if assigned else None
    done_times = [sla.as_datetime(t.completed_at) for t in tasks if t.completed_at is not None]
    completed_at = max(done_times) if done_times and pending == 0 else None
    overdue = pending > 0 and due is not None and now > due
    if pending == 0 and to_decide == 0:
        status = "completed"
    elif overdue:
        status = "overdue"
    elif to_decide:
        status = "to_decide"
    else:
        status = "open"
    return {
        "id": a.id,
        "code": a.code,
        "contractor_id": a.contractor_id,
        "contractor": names["contractors"].get(a.contractor_id),
        "assigned_at": assigned,
        "assigned_by": names["users"].get(a.assigned_by),
        "due_at": due,
        "completed_at": completed_at,
        "sla_days": days,
        "round": max((t.round_no for t in tasks), default=1),
        "sites": len(tasks),
        "counts": {"ready": ready, "not_ready": not_ready, "pending": pending, "to_decide": to_decide},
        "status": status,
    }


def _matches_status(row: dict, status: str | None) -> bool:
    if not status:
        return True
    if status == "open":
        return row["status"] != "completed"
    if status == "to_decide":
        return row["counts"]["to_decide"] > 0
    if status == "overdue":
        return row["status"] == "overdue"
    return row["status"] == "completed"


def batches(db: Session, user: User, *, status: str | None = None, contractor_id: int | None = None, q: str | None = None) -> dict:
    """Every visible HC assignment batch with its counts, and the count per
    status filter (computed before the status filter, after the others)."""
    scoped = visible_work_item_ids(user, db)
    stmt = (
        select(HcAssignment)
        .where(HcAssignment.id.in_(select(HcTask.hc_assignment_id).where(HcTask.work_item_id.in_(scoped))))
        .options(selectinload(HcAssignment.tasks))
        .order_by(HcAssignment.assigned_at.desc(), HcAssignment.id.desc())
    )
    if contractor_id:
        stmt = stmt.where(HcAssignment.contractor_id == contractor_id)
    found = db.execute(stmt).scalars().all()
    days = pipeline.sla_days_for(db, [HC_CHECK_QUEUE])[HC_CHECK_QUEUE]
    now = _now()
    names = {
        "contractors": _names(db, Contractor, [a.contractor_id for a in found]),
        "users": _names(db, User, [a.assigned_by for a in found]),
    }
    needle = (q or "").strip().lower()
    codes: dict[int, str] = {}
    if needle:
        wi_ids = {t.work_item_id for a in found for t in a.tasks}
        codes = dict(
            db.execute(select(WorkItem.id, Site.site_code).join(Site, WorkItem.site_id == Site.id).where(WorkItem.id.in_(wi_ids))).all()
        )
    rows = []
    for a in found:
        if needle and needle not in (a.code or "").lower() and not any(
            needle in (codes.get(t.work_item_id) or "").lower() for t in a.tasks
        ):
            continue
        rows.append(_batch_row(a, list(a.tasks), days, now, names))
    counts = {s: sum(1 for r in rows if _matches_status(r, s)) for s in BATCH_STATUSES}
    return {"rows": [r for r in rows if _matches_status(r, status)], "counts": counts}


def batch_detail(db: Session, user: User, assignment: HcAssignment) -> dict:
    """One batch's sites, to decide first, then pending, then decided."""
    scoped = set(db.execute(visible_work_item_ids(user, db)).scalars())
    tasks = [t for t in assignment.tasks if t.work_item_id in scoped]
    days = pipeline.sla_days_for(db, [HC_CHECK_QUEUE])[HC_CHECK_QUEUE]
    names = {
        "contractors": _names(db, Contractor, [assignment.contractor_id]),
        "users": _names(db, User, [assignment.assigned_by] + [t.reviewed_by for t in tasks]),
    }
    head = _batch_row(assignment, tasks, days, _now(), names)
    items = {
        wi.id: wi
        for wi in db.execute(
            select(WorkItem).where(WorkItem.id.in_({t.work_item_id for t in tasks})).options(
                selectinload(WorkItem.site).selectinload(Site.province)
            )
        ).scalars()
    }
    recorded: dict[int, set[int]] = defaultdict(set)
    for tid, vid in db.execute(
        select(HcTaskVillage.hc_task_id, HcTaskVillage.village_id).where(
            HcTaskVillage.hc_task_id.in_([t.id for t in tasks])
        )
    ):
        recorded[tid].add(vid)
    villages = villages_of(db, items)
    sla_hours = days * 24
    sites = []
    for t in tasks:
        wi = items.get(t.work_item_id)
        site = wi.site if wi else None
        hours = _hours(assignment.assigned_at, t.completed_at)
        if t.completed_at is None:
            state, decision = "pending", None
        elif t.reviewed_at is None:
            state, decision = "to_decide", None
        else:
            state = "decided"
            decision = (
                "Confirmed ready → Drive test"
                if t.overall_result == "Ready"
                else f"Problematic → Remediation ({t.problem_category or 'owning teams'})"
            )
        mine = recorded.get(t.id)
        sites.append(
            {
                "task_id": t.id,
                "work_item_id": t.work_item_id,
                "site_code": site.site_code if site else None,
                "province": site.province.name if site and site.province else None,
                "round": t.round_no,
                "villages": [v for v in villages.get(t.work_item_id, []) if not mine or v["id"] in mine],
                "result": t.overall_result,
                "submitted_at": sla.as_datetime(t.completed_at),
                "hours_taken": hours,
                "late": hours is not None and hours > sla_hours,
                "state": state,
                "decision": decision,
                "decided_by": names["users"].get(t.reviewed_by),
                "decided_at": sla.as_datetime(t.reviewed_at),
            }
        )
    order = {"to_decide": 0, "pending": 1, "decided": 2}
    sites.sort(key=lambda s: (order[s["state"]], s["site_code"] or ""))
    return {**head, "site_rows": sites}


# --------------------------------------------------------------------------
# Drive test · Tests
# --------------------------------------------------------------------------
def tests_list(
    db: Session,
    user: User,
    *,
    tab: str = "review",
    contractor_id: int | None = None,
    q: str | None = None,
    sort: str = "aging",
    direction: str = "desc",
) -> dict:
    """Site-based Tests list. One row per site with an official DT assignment:

    * ``review`` -- its active drive test is Submitted;
    * ``with`` -- assigned and nothing submitted for this round yet;
    * ``reviewed`` -- its latest drive test was Approved or sent back.

    Aging is assignment → submission for a submitted site, assignment → now
    for an open one, in days.
    """
    scoped = visible_work_item_ids(user, db)
    items = db.execute(
        select(WorkItem)
        .where(WorkItem.id.in_(scoped), WorkItem.id.in_(select(Assignment.work_item_id)))
        .options(
            selectinload(WorkItem.site).selectinload(Site.province),
            selectinload(WorkItem.assignments),
            selectinload(WorkItem.drive_tests).selectinload(DriveTest.evidence),
        )
    ).scalars().all()
    days = pipeline.sla_days_for(db, [DT_TEST_QUEUE])[DT_TEST_QUEUE]
    now = _now()
    contractors = _names(db, Contractor, [a.contractor_id for wi in items for a in wi.assignments])
    users = _names(db, User, [a.assigned_by for wi in items for a in wi.assignments])

    buckets: dict[str, list[dict]] = {t: [] for t in TEST_TABS}
    for wi in items:
        active = [a for a in wi.assignments if a.is_active]
        assignment = max(active, key=lambda a: a.id) if active else None
        if assignment is None:
            continue
        dts = [d for d in wi.drive_tests if d.is_active]
        dt = max(dts, key=lambda d: d.id) if dts else None
        assigned = sla.as_datetime(assignment.assigned_at)
        submitted = sla.as_datetime(dt.submitted_at) if dt and dt.status == "Submitted" else None
        if dt is not None and dt.status == "Submitted":
            tab_key, end = "review", submitted or now
        elif dt is not None and dt.status == "Approved":
            tab_key, end = "reviewed", sla.as_datetime(dt.submitted_at) or now
        elif assignment.returned_at is not None:
            continue
        else:
            # Includes a sent-back site: a new round with the same contractor.
            tab_key, end = "with", now
        aging = (end - assigned).total_seconds() / 86400 if assigned else None
        site = wi.site
        row = {
            "work_item_id": wi.id,
            "assignment_id": assignment.id,
            "drive_test_id": dt.id if dt and tab_key == "review" else None,
            "site_code": site.site_code if site else None,
            "province": site.province.name if site and site.province else None,
            "contractor_id": assignment.contractor_id,
            "contractor": contractors.get(assignment.contractor_id),
            "batch": f"DT-{assignment.id}",
            "round": assignment.round_no or 1,
            "aging_days": round(aging, 2) if aging is not None else None,
            "sla_days": days,
            "late": aging is not None and aging > days,
            "assigned_at": assigned,
            "assigned_by": users.get(assignment.assigned_by),
            "submitted_at": sla.as_datetime(dt.submitted_at) if dt else None,
            "evidence_count": len(dt.evidence) if dt else 0,
            "outcome": "DT done" if tab_key == "reviewed" else None,
            "technologies": [t for t in (wi.requested_technology or "").replace(",", " ").split() if t],
        }
        buckets[tab_key].append(row)
        # A sent-back round also appears in Reviewed, as what was decided.
        prev = [d for d in wi.drive_tests if d.status in ("Rejected", "Returned")]
        if tab_key == "with" and prev:
            last = max(prev, key=lambda d: d.id)
            buckets["reviewed"].append({**row, "outcome": "Sent back", "drive_test_id": last.id,
                                        "submitted_at": sla.as_datetime(last.submitted_at)})

    villages = villages_of(db, [wi.id for wi in items])
    needle = (q or "").strip().lower()
    counts = {}
    result = {}
    for key, rows in buckets.items():
        kept = []
        for r in rows:
            if contractor_id and r["contractor_id"] != contractor_id:
                continue
            r["villages"] = villages.get(r["work_item_id"], [])
            if needle and not (
                needle in (r["site_code"] or "").lower()
                or needle in r["batch"].lower()
                or any(needle in (v["name"] or "").lower() or needle in (v["code"] or "").lower() or needle == str(v["id"]) for v in r["villages"])
            ):
                continue
            kept.append(r)
        counts[key] = len(kept)
        result[key] = kept

    rows = result.get(tab if tab in TEST_TABS else "review", [])
    keyfn = {
        "aging": lambda r: r["aging_days"] if r["aging_days"] is not None else -1,
        "site": lambda r: r["site_code"] or "",
        "province": lambda r: r["province"] or "",
        "contractor": lambda r: r["contractor"] or "",
    }[sort if sort in TEST_SORTS else "aging"]
    rows.sort(key=keyfn, reverse=direction == "desc")
    return {"rows": rows, "counts": counts}


def open_next_round(db: Session, wi: WorkItem, user: User) -> Assignment | None:
    """After a send back: a new active assignment with the same contractor,
    the next round number and a new clock. History keeps the old one."""
    active = [a for a in wi.assignments if a.is_active]
    current = max(active, key=lambda a: a.id) if active else None
    if current is None:
        return None
    current.is_active = False
    nxt = Assignment(
        assignment_type=current.assignment_type,
        contractor_id=current.contractor_id,
        assigned_by=user.id,
        assigned_at=_now(),
        remarks=current.remarks,
        is_active=True,
        round_no=(current.round_no or 1) + 1,
    )
    wi.assignments.append(nxt)
    db.flush()
    covered = list(
        db.execute(select(AssignmentVillage.village_id).where(AssignmentVillage.assignment_id == current.id)).scalars()
    )
    record_assignment_villages(db, nxt, only=covered or None)
    return nxt


# --------------------------------------------------------------------------
# Reassign (PM only)
# --------------------------------------------------------------------------
def reassign_hc_task(db: Session, task: HcTask, contractor_id: int, user: User) -> HcAssignment:
    """Move one pending site out of its batch into a one-site batch for
    another contractor. Its result must still be pending."""
    from app.services.health_check import generate_assignment_code

    if task.completed_at is not None:
        raise ValueError("Only a site still pending in its batch can be reassigned.")
    old_villages = list(
        db.execute(select(HcTaskVillage.village_id).where(HcTaskVillage.hc_task_id == task.id)).scalars()
    )
    target = HcAssignment(
        code=generate_assignment_code(db),
        contractor_id=contractor_id,
        assigned_by=user.id,
        assigned_at=_now(),
        status="Open",
    )
    db.add(target)
    db.flush()
    for vid in old_villages:
        db.execute(HcTaskVillage.__table__.delete().where(HcTaskVillage.hc_task_id == task.id, HcTaskVillage.village_id == vid))
    task.hc_assignment_id = target.id
    db.flush()
    for vid in old_villages:
        db.add(HcTaskVillage(hc_task_id=task.id, village_id=vid))
    db.flush()
    return target


def reassign_dt_assignment(db: Session, assignment: Assignment, contractor_id: int, user: User) -> Assignment:
    """Hand an open DT assignment to another contractor, same round."""
    if not assignment.is_active:
        raise ValueError("Only an active assignment can be reassigned.")
    wi = assignment.work_item
    dts = [d for d in wi.drive_tests if d.is_active]
    if dts and max(dts, key=lambda d: d.id).status in ("Submitted", "Approved"):
        raise ValueError("This site's drive test is already submitted.")
    assignment.is_active = False
    nxt = Assignment(
        assignment_type=assignment.assignment_type,
        contractor_id=contractor_id,
        assigned_by=user.id,
        assigned_at=_now(),
        remarks=assignment.remarks,
        is_active=True,
        round_no=assignment.round_no or 1,
    )
    wi.assignments.append(nxt)
    db.flush()
    covered = list(
        db.execute(select(AssignmentVillage.village_id).where(AssignmentVillage.assignment_id == assignment.id)).scalars()
    )
    record_assignment_villages(db, nxt, only=covered or None)
    refresh_stage(wi)
    return nxt
