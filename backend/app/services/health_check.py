"""Health Check workflow service (Phase A).

Encapsulates: the HC basket (on-air sites needing a health check), creating
assignments, submitting per-technology results, and the auto-computation of
each site's overall Ready / NotReady outcome.

Site readiness is derived, never entered manually: a site is Ready only when
every requested technology is marked Normal; otherwise NotReady, and the
problem category is taken from the first failing technology.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import Select, false, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import CONTRACTOR
from app.models.health_check import (
    HcAssignment,
    HcRemediation,
    HcTask,
    HcTaskTechnology,
)
from app.models.reference import ProblemCategory, Role, User
from app.models.workitem import Site, WorkItem
from app.services import cpm_columns as C
from app.services.tech_parser import parse_technologies
from app.services.visibility import apply_work_item_scope, visible_work_item_ids
from app.services.workflow import refresh_stage

# A site that has been round-tripped this many times is no longer a routine
# fix — it is surfaced to the PM as an exception rather than quietly looping.
EXCEPTION_ROUND = 3


class ScopeError(ValueError):
    """A request naming records the caller may not reach.

    Carried as an exception rather than a filtered-down list because these are
    all-or-nothing operations: quietly dropping the sites a caller may not
    touch would create an assignment that silently differs from the one they
    asked for.
    """


# --------------------------------------------------------------------------
# Scope
#
# Health check has its own contractor rule, which is why these cannot simply
# call ``apply_work_item_scope`` and stop. A subcontractor doing health checks
# is reached through ``hc_assignments.contractor_id``; the work-item scope
# knows about drive-test assignments, which are a different relationship
# entirely. A contractor with an HC assignment usually has no drive-test
# assignment for the same site, so work-item scope alone would hide their own
# work from them — and, far worse, was never applied at all, which let any
# contractor reach every task in the country by its id.
#
# Staff (Admin/PM/Coordinator/…) are scoped by province, the same as
# everywhere else, through the sites their tasks point at.
# --------------------------------------------------------------------------
def visible_assignments(db: Session, user: User) -> Select:
    """An ``HcAssignment`` select restricted to what this user may reach."""
    stmt = select(HcAssignment)
    if user.role.name == CONTRACTOR:
        if user.contractor_id is None:
            # A contractor account with no company attached has no assignments
            # of its own, and must not fall through to seeing everyone else's.
            return stmt.where(false())
        return stmt.where(HcAssignment.contractor_id == user.contractor_id)
    return stmt.where(HcAssignment.id.in_(_assignment_ids_in_scope(user, db)))


def visible_tasks(db: Session, user: User) -> Select:
    """An ``HcTask`` select restricted to what this user may reach."""
    stmt = select(HcTask)
    if user.role.name == CONTRACTOR:
        if user.contractor_id is None:
            return stmt.where(false())
        return stmt.where(
            HcTask.hc_assignment_id.in_(
                select(HcAssignment.id).where(
                    HcAssignment.contractor_id == user.contractor_id
                )
            )
        )
    return stmt.where(HcTask.work_item_id.in_(visible_work_item_ids(user, db)))


def _assignment_ids_in_scope(user: User, db: Session) -> Select:
    """Assignments holding at least one site this user may see.

    An assignment spanning two provinces is reachable by a coordinator granted
    either of them. That is deliberate: the assignment is the unit people work
    with, and hiding it entirely because one of its sites is out of scope would
    make the visible half unreachable. The per-task queries above still cut the
    rows themselves to what the user may see.
    """
    return (
        select(HcTask.hc_assignment_id)
        .where(HcTask.work_item_id.in_(visible_work_item_ids(user, db)))
        .distinct()
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime | None) -> datetime | None:
    """Coerce a possibly-naive datetime to UTC-aware.

    Postgres stores our timestamps tz-aware, but a naive value can slip in via
    SQLite (tests) or older rows. Normalising here keeps date subtraction from
    raising on a naive/aware mismatch.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def build_assignment_stats(assignment: HcAssignment) -> dict:
    """Aggregate feedback metrics for one assignment (used by history + export).

    Returns per-assignment counts plus timing:
      * sites_assigned / sites_ready / sites_not_ready / sites_pending
      * assigned_at            — when the assignment was created
      * feedback_received_at   — when the LAST site's result arrived; only set
        once every site has feedback (i.e. the assignment is fully complete),
        otherwise None (feedback still outstanding)
      * aging_days             — assignment date → feedback date, in whole days;
        while feedback is still outstanding this counts up to "now" instead and
        ``aging_ongoing`` is True
    """
    tasks = list(assignment.tasks)
    sites_assigned = len(tasks)
    sites_ready = sum(1 for t in tasks if t.overall_result == "Ready")
    sites_not_ready = sum(1 for t in tasks if t.overall_result == "NotReady")
    completed_dates = [
        _as_aware(t.completed_at) for t in tasks if t.completed_at is not None
    ]
    sites_pending = sites_assigned - len(completed_dates)

    assigned_at = _as_aware(assignment.assigned_at)
    # Feedback is "received" only when every site has reported back.
    feedback_received_at = (
        max(completed_dates)
        if completed_dates and len(completed_dates) == sites_assigned
        else None
    )

    aging_days: int | None = None
    aging_ongoing = False
    if assigned_at is not None:
        end = feedback_received_at or _now()
        aging_ongoing = feedback_received_at is None
        aging_days = max((end - assigned_at).days, 0)

    return {
        "sites_assigned": sites_assigned,
        "sites_ready": sites_ready,
        "sites_not_ready": sites_not_ready,
        "sites_pending": sites_pending,
        "assigned_at": assigned_at,
        "feedback_received_at": feedback_received_at,
        "aging_days": aging_days,
        "aging_ongoing": aging_ongoing,
    }


def generate_assignment_code(db: Session) -> str:
    """Produce a friendly sequential code like HC-2026-0001.

    Derived from the highest number already issued *this year*, not from the
    row count. Counting rows was wrong twice: deleting any assignment made the
    count go back down and reissue a code that already existed, against a
    unique column -- a 500 that would appear years later under conditions
    nobody tests for -- and the counter never restarted, so 2027 continued from
    2026's number despite the year being right there in the format.

    Still a read-then-write, so two simultaneous creations can collide. The
    unique constraint is what actually guarantees correctness; the caller
    retries. That is the right division of labour -- the database is the only
    thing that can promise uniqueness.
    """
    year = _now().year
    prefix = f"HC-{year}-"
    highest = db.execute(
        select(func.max(HcAssignment.code)).where(
            HcAssignment.code.like(f"{prefix}%")
        )
    ).scalar()
    next_number = 1
    if highest:
        try:
            next_number = int(highest.rsplit("-", 1)[1]) + 1
        except (IndexError, ValueError):
            # A hand-edited code that does not parse must not stop the platform
            # issuing new ones; fall back to counting this year's rows.
            next_number = (
                db.query(HcAssignment)
                .filter(HcAssignment.code.like(f"{prefix}%"))
                .count()
                + 1
            )
    return f"{prefix}{next_number:04d}"


def work_item_ids_in_open_hc(db: Session) -> set[int]:
    """IDs of work items that already have a not-yet-completed HC task.

    Used to keep the basket clean — a site being health-checked shouldn't
    reappear in the 'needs assignment' basket.
    """
    rows = (
        db.query(HcTask.work_item_id)
        .filter(HcTask.completed_at.is_(None))
        .all()
    )
    return {r[0] for r in rows}


def completed_hc_work_item_ids(db: Session) -> set[int]:
    """IDs of work items with a completed HC task (Ready or NotReady)."""
    rows = db.query(HcTask.work_item_id).filter(HcTask.completed_at.isnot(None)).all()
    return {r[0] for r in rows}


def latest_completed_tasks(db: Session) -> dict[int, HcTask]:
    """The most recent completed HC task per work item."""
    tasks = (
        db.query(HcTask)
        .filter(HcTask.completed_at.isnot(None))
        .order_by(HcTask.completed_at.asc())
        .all()
    )
    # Ascending order means the last write per work item wins — the latest.
    return {t.work_item_id: t for t in tasks}


def _returning_summary(task: HcTask) -> str | None:
    """Short "why is this site back" line for a re-checked site."""
    names = [
        r.category.name
        for r in task.remediations
        if r.closed_at is not None and r.category is not None
    ]
    if not names:
        return None
    if len(names) == 1:
        return f"{names[0]} fixed"
    return f"{len(names)} fixes closed"


def get_basket(db: Session, user) -> list[dict]:
    """On-air sites that still need a health check, scoped to the user.

    A site is eligible when it is on-air, is not already inside an open HC
    task, and is not currently *being worked on*. Concretely it appears when:

    * it has never been health-checked (round 1), or
    * its last check failed, a PM triaged it, and **every** resulting fix has
      since been closed — so it is genuinely ready to be re-checked.

    It is deliberately withheld while it is still Not Ready and untriaged (the
    PM owes a decision, visible in HC Results) or while any fix is still open
    (an owner owes the work, visible in their Fix Queue). That is what makes
    the loop close by itself: nobody re-adds a site by hand.
    """
    stmt = select(WorkItem).where(WorkItem.deleted_at.is_(None))
    stmt = apply_work_item_scope(stmt, user, db)
    stmt = stmt.options(selectinload(WorkItem.site).selectinload(Site.province))
    work_items = db.execute(stmt).scalars().all()

    busy = work_item_ids_in_open_hc(db)
    latest = latest_completed_tasks(db)

    basket = []
    for wi in work_items:
        if C.normalize_stage(wi.last_stage) not in C.ONAIR_STAGES:
            continue
        # Exclude sites whose drive test is already Done or Ongoing — they do
        # not belong in the health-check basket (only sites still awaiting DT,
        # i.e. blank or Problematic DT status, are eligible).
        if C.normalize_dt_status(wi.dt_status) in C.DT_STATUS_EXCLUDED_FROM_HC:
            continue
        if wi.id in busy:
            continue

        task = latest.get(wi.id)
        round_no = 1
        returning = None
        if task is not None:
            if task.overall_result != "NotReady":
                continue  # passed — it has left the loop for good
            if not task.remediations:
                continue  # failed but not triaged yet: the PM owes a decision
            if any(r.is_open for r in task.remediations):
                continue  # an owner is still working on it
            round_no = task.round_no + 1
            returning = _returning_summary(task)

        basket.append(
            {
                "work_item_id": wi.id,
                "site_code": wi.site.site_code if wi.site else None,
                "site_type": wi.site_type,
                "province": wi.site.province.name if wi.site and wi.site.province else None,
                "requested_technologies": parse_technologies(wi.requested_technology),
                "round_no": round_no,
                "returning_reason": returning,
            }
        )
    return basket


def create_assignment(
    db: Session, *, contractor_id: int, work_item_ids: list[int], user
) -> HcAssignment:
    """Create an HC assignment containing one task per given site.

    Every site is checked against the caller's scope first. Without this a
    coordinator granted one province could assign health checks for sites
    anywhere in the country simply by putting their ids in the list — and the
    resulting tasks would then be real work for a real subcontractor.
    """
    reachable = set(
        db.execute(
            select(WorkItem.id).where(
                WorkItem.id.in_(work_item_ids),
                WorkItem.id.in_(visible_work_item_ids(user, db)),
            )
        ).scalars()
    )
    if set(work_item_ids) - reachable:
        # Deliberately does not say which ids failed, or whether they exist:
        # the response must not become a way to probe for site ids.
        raise ScopeError("One or more of those sites could not be found")

    assignment = HcAssignment(
        code=generate_assignment_code(db),
        contractor_id=contractor_id,
        assigned_by=user.id,
        assigned_at=_now(),
        status="Open",
    )
    db.add(assignment)
    db.flush()

    # Stamp each task with its round: one more than however many completed
    # checks the site already has. Round 1 is a first-ever check.
    prior_counts = dict(
        db.query(HcTask.work_item_id, func.count(HcTask.id))
        .filter(
            HcTask.work_item_id.in_(work_item_ids),
            HcTask.completed_at.isnot(None),
        )
        .group_by(HcTask.work_item_id)
        .all()
    )

    for wi_id in work_item_ids:
        task = HcTask(
            hc_assignment_id=assignment.id,
            work_item_id=wi_id,
            round_no=prior_counts.get(wi_id, 0) + 1,
        )
        db.add(task)

    db.flush()
    return assignment


def submit_task_result(
    db: Session, *, task: HcTask, technology_results: list[dict]
) -> HcTask:
    """Apply the subcontractor's per-technology results and compute readiness.

    ``technology_results`` is a list of dicts:
        {technology, result ('Normal'|'NotNormal'), comment?}

    Business rules enforced:
      * a comment is required when result == 'NotNormal'
      * overall Ready only if every technology is Normal; any NotNormal ⇒
        NotReady
      * the subcontractor does NOT choose a problem category — that is done
        later by a Coordinator/PM during validation. Submitting (or
        re-submitting) a result therefore clears any prior category and
        resets the review state.
    """
    # Replace any existing technology rows for idempotent re-submission.
    task.technologies.clear()
    db.flush()

    any_not_normal = False

    for entry in technology_results:
        tech = entry["technology"]
        result = entry["result"]
        comment = entry.get("comment")

        if result == "NotNormal":
            any_not_normal = True

        task.technologies.append(
            HcTaskTechnology(
                technology=tech,
                result=result,
                reason_category=None,  # category is coordinator-owned now
                comment=comment if result == "NotNormal" else None,
            )
        )

    task.overall_result = "NotReady" if any_not_normal else "Ready"
    # Category & review are coordinator-owned; a fresh submission resets them,
    # including any fix that was routed off the superseded result. Fixes an
    # owner already closed are left alone — that work really happened.
    task.problem_category = None
    task.reviewed_by = None
    task.reviewed_at = None
    task.completed_at = _now()
    _clear_open_remediations(db, task)

    db.flush()
    # Bridge into the lifecycle: a completed HC advances the work item to
    # "Ready for Assignment" (or "Problematic"), which surfaces it in the
    # PM's assignment queue and Action Center. Assignment/DT states already
    # take precedence inside derive_stage, so this never regresses a site.
    if task.work_item is not None:
        refresh_stage(task.work_item)
    _maybe_complete_assignment(db, task.hc_assignment_id)
    return task


def review_task(
    db: Session, *, task: HcTask, problem_categories: list[str] | None, user
) -> HcTask:
    """Coordinator/PM triage of a completed HC task.

    * A **Ready** site needs no category (validation just acknowledges it).
    * A **Not Ready** site is tagged with one *or more* problem categories.
      Each one opens an :class:`HcRemediation` against the role that owns that
      category, with its own SLA clock. Owners then work in parallel and the
      site returns to the basket only once all of them are closed.

    Re-triaging a site that has not been worked yet is allowed: untouched
    fixes are replaced. A fix an owner has already closed is never withdrawn —
    that would erase completed work and its audit trail.

    Raises ``ValueError`` on invalid input so the API can return 400.
    """
    if task.completed_at is None or task.overall_result is None:
        raise ValueError("This site has no submitted result to validate yet.")

    names = [n.strip() for n in (problem_categories or []) if n and n.strip()]

    if task.overall_result != "NotReady":
        if names:
            raise ValueError("A Ready site cannot be given a problem category.")
        task.problem_category = None
        _clear_open_remediations(db, task)
    else:
        if not names:
            raise ValueError(
                "A Not-Ready site must be given at least one problem category."
            )
        categories = _resolve_categories(db, names)
        _sync_remediations(db, task=task, categories=categories)
        # Kept in sync as a readable summary for the screens and exports that
        # still show a single category (Work Items, Drive Test dashboard).
        task.problem_category = ", ".join(c.name for c in categories)

    task.reviewed_by = user.id
    task.reviewed_at = _now()
    db.flush()
    return task


def _resolve_categories(db: Session, names: list[str]) -> list[ProblemCategory]:
    """Look up category rows by name, preserving the caller's order."""
    found = {
        c.name: c
        for c in db.query(ProblemCategory).filter(ProblemCategory.name.in_(names)).all()
    }
    missing = [n for n in names if n not in found]
    if missing:
        raise ValueError(f"Unknown problem category: {', '.join(missing)}")
    ordered, seen = [], set()
    for n in names:
        if n not in seen:
            seen.add(n)
            ordered.append(found[n])
    return ordered


def _clear_open_remediations(db: Session, task: HcTask) -> None:
    for rem in list(task.remediations):
        if rem.is_open:
            task.remediations.remove(rem)
            db.delete(rem)
    db.flush()


def _sync_remediations(
    db: Session, *, task: HcTask, categories: list[ProblemCategory]
) -> None:
    """Make the task's open fixes match the chosen categories exactly."""
    wanted = {c.id: c for c in categories}
    now = _now()

    for rem in list(task.remediations):
        if rem.is_open and rem.problem_category_id not in wanted:
            task.remediations.remove(rem)
            db.delete(rem)

    existing = {r.problem_category_id for r in task.remediations}
    for cat_id, cat in wanted.items():
        if cat_id in existing:
            continue
        sla = cat.sla_days or 7
        task.remediations.append(
            HcRemediation(
                work_item_id=task.work_item_id,
                problem_category_id=cat_id,
                owner_role_id=cat.owner_role_id,
                status=HcRemediation.STATUS_OPEN,
                opened_at=now,
                due_at=now + timedelta(days=sla),
            )
        )
    db.flush()


def close_remediation(
    db: Session, *, remediation: HcRemediation, note: str | None, user
) -> HcRemediation:
    """An owner marks their fix done. May put the site back in the basket.

    Closing the *last* open fix on a task is what returns the site for
    re-check — there is no separate PM step, because the next health check is
    itself the verification.
    """
    if remediation.closed_at is not None:
        raise ValueError("This fix is already closed.")

    remediation.status = HcRemediation.STATUS_FIXED
    remediation.closed_at = _now()
    remediation.closed_by = user.id
    remediation.resolution_note = (note or "").strip() or None
    # A closed fix supersedes any pending "not my area" proposal on it.
    remediation.reroute_to_category_id = None
    db.flush()
    return remediation


def returns_to_basket(task: HcTask) -> bool:
    """True when every fix on a failed task is closed, so it can be re-checked.

    There is no flag to set and no queue to push to: the basket query asks
    this same question, so closing the last fix is what makes the site
    reappear. Kept as a named function so the API can report it back to the
    owner ("this went back for re-check") without duplicating the rule.
    """
    if task.overall_result != "NotReady" or not task.remediations:
        return False
    return all(r.closed_at is not None for r in task.remediations)


def propose_reroute(
    db: Session,
    *,
    remediation: HcRemediation,
    to_category_name: str,
    reason: str,
    user,
) -> HcRemediation:
    """Owner says a fix belongs to a different category; a PM decides.

    The owner keeps the fix (and its clock) until a PM approves, so a disputed
    site can never fall between two owners while the argument is settled.
    """
    if remediation.closed_at is not None:
        raise ValueError("This fix is already closed.")
    if not (reason and reason.strip()):
        raise ValueError("Say why this is not your area so a PM can decide.")

    target = _resolve_categories(db, [to_category_name])[0]
    if target.id == remediation.problem_category_id:
        raise ValueError("Pick a different category than the current one.")

    remediation.reroute_to_category_id = target.id
    remediation.reroute_reason = reason.strip()
    remediation.reroute_by = user.id
    remediation.reroute_at = _now()
    db.flush()
    return remediation


def decide_reroute(
    db: Session, *, remediation: HcRemediation, approve: bool, user
) -> HcRemediation:
    """PM approves or rejects a proposed re-route.

    On approval the fix moves to the new category and owner and its clock
    restarts, because the new owner has not had the site until now.
    """
    if remediation.reroute_to_category_id is None:
        raise ValueError("There is no re-route request on this fix.")

    if approve:
        target = db.get(ProblemCategory, remediation.reroute_to_category_id)
        if target is None:
            raise ValueError("The requested category no longer exists.")
        # A fix already open against the target category would collide with
        # the (task, category) uniqueness rule — merge into it instead.
        clash = next(
            (
                r
                for r in remediation.task.remediations
                if r.id != remediation.id
                and r.problem_category_id == target.id
                and r.is_open
            ),
            None,
        )
        if clash is not None:
            raise ValueError(
                f"This site already has an open {target.name} fix. "
                "Close or reject that one first."
            )
        now = _now()
        remediation.problem_category_id = target.id
        remediation.owner_role_id = target.owner_role_id
        remediation.opened_at = now
        remediation.due_at = now + timedelta(days=target.sla_days or 7)

    remediation.reroute_to_category_id = None
    remediation.reroute_reason = None
    remediation.reroute_by = None
    remediation.reroute_at = None
    db.flush()
    return remediation


def owner_queue(db: Session, user: User) -> list[dict]:
    """Every open fix routed to this user's role, worst-overdue first."""
    rows = (
        db.query(HcRemediation)
        .join(HcTask, HcRemediation.hc_task_id == HcTask.id)
        .filter(
            HcRemediation.owner_role_id == user.role_id,
            HcRemediation.closed_at.is_(None),
        )
        .options(
            selectinload(HcRemediation.task).selectinload(HcTask.technologies),
            selectinload(HcRemediation.task).selectinload(HcTask.remediations),
            selectinload(HcRemediation.category),
        )
        .all()
    )

    now = _now()
    out = []
    for rem in rows:
        task = rem.task
        wi = db.get(WorkItem, rem.work_item_id)
        site = wi.site if wi else None
        due = _as_aware(rem.due_at)
        days_open = max((now - _as_aware(rem.opened_at)).days, 0) if rem.opened_at else 0
        days_late = max((now - due).days, 0) if due else 0

        failed = [
            t for t in task.technologies if t.result == "NotNormal" and t.comment
        ]
        # Other owners still holding this same site — the owner needs to know
        # that finishing their part alone will not send it back for re-check.
        blocking = [
            r.category.name
            for r in task.remediations
            if r.id != rem.id and r.is_open and r.category is not None
        ]

        out.append(
            {
                "id": rem.id,
                "work_item_id": rem.work_item_id,
                "site_code": site.site_code if site else None,
                "province": site.province.name if site and site.province else None,
                "category": rem.category.name if rem.category else None,
                "round_no": task.round_no,
                "technologies": [t.technology for t in failed],
                "issue": failed[0].comment if failed else None,
                "days_open": days_open,
                "days_late": days_late,
                "due_at": due,
                "also_waiting_on": blocking,
                "reroute_pending": rem.reroute_to_category_id is not None,
            }
        )

    out.sort(key=lambda r: (-r["days_late"], -r["days_open"]))
    return out


def site_history(db: Session, work_item_id: int) -> list[dict]:
    """One flat timeline for a site: every round, owner and comment.

    Deliberately assembled from the records themselves rather than a separate
    event log, so the history cannot drift out of step with the data it
    describes.
    """
    tasks = (
        db.query(HcTask)
        .filter(HcTask.work_item_id == work_item_id)
        .order_by(HcTask.id.asc())
        .options(
            selectinload(HcTask.technologies),
            selectinload(HcTask.remediations).selectinload(HcRemediation.category),
            selectinload(HcTask.assignment),
        )
        .all()
    )

    users = {u.id: u.full_name for u in db.query(User).all()}
    events: list[dict] = []

    for task in tasks:
        rnd = task.round_no
        assignment = task.assignment
        events.append(
            {
                "at": _as_aware(assignment.assigned_at) if assignment else None,
                "round_no": rnd,
                "kind": "assigned",
                "title": f"Assigned for health check — round {rnd}",
                "detail": assignment.code if assignment else None,
                "actor": users.get(assignment.assigned_by) if assignment else None,
            }
        )

        if task.completed_at is not None:
            failed = [t for t in task.technologies if t.result == "NotNormal"]
            ok = task.overall_result == "Ready"
            events.append(
                {
                    "at": _as_aware(task.completed_at),
                    "round_no": rnd,
                    "kind": "passed" if ok else "failed",
                    "title": "Health check passed"
                    if ok
                    else f"Health check failed — {', '.join(t.technology for t in failed)}",
                    "detail": None if ok else "; ".join(
                        f"{t.technology}: {t.comment}" for t in failed if t.comment
                    ),
                    "actor": assignment.contractor.name
                    if assignment and assignment.contractor
                    else None,
                }
            )

        if task.reviewed_at is not None and task.remediations:
            names = ", ".join(
                r.category.name for r in task.remediations if r.category is not None
            )
            events.append(
                {
                    "at": _as_aware(task.reviewed_at),
                    "round_no": rnd,
                    "kind": "routed",
                    "title": f"Routed to {names}",
                    "detail": None,
                    "actor": users.get(task.reviewed_by),
                }
            )

        for rem in task.remediations:
            if rem.closed_at is None:
                continue
            due = _as_aware(rem.due_at)
            closed = _as_aware(rem.closed_at)
            late = max((closed - due).days, 0) if due else 0
            opened = _as_aware(rem.opened_at)
            held = max((closed - opened).days, 0) if opened else 0
            events.append(
                {
                    "at": closed,
                    "round_no": rnd,
                    "kind": "fixed",
                    "title": f"{rem.category.name if rem.category else 'Fix'} closed",
                    "detail": rem.resolution_note,
                    "actor": users.get(rem.closed_by),
                    "aging": f"{held} days"
                    + (f" · {late} days late" if late else " · on time"),
                }
            )

    events.sort(key=lambda e: (e["at"] is None, e["at"] or _now()), reverse=True)
    return events


def _maybe_complete_assignment(db: Session, assignment_id: int) -> None:
    """Mark an assignment Completed once all its tasks have a result."""
    assignment = db.get(HcAssignment, assignment_id)
    if assignment is None:
        return
    pending = [t for t in assignment.tasks if t.completed_at is None]
    assignment.status = "Completed" if not pending else "Open"


def requested_techs_for_task(task: HcTask) -> list[str]:
    """The technologies to ask about for a task's site (requested only)."""
    wi = task.work_item
    return parse_technologies(wi.requested_technology) if wi else []


def build_assignment_out(assignment: HcAssignment) -> dict:
    """Build an enriched assignment payload with site info per task.

    Enriches each task with site_code / site_type / province / requested
    technologies so the subcontractor form needs no extra work-item lookup
    (which contractors aren't scoped to see anyway). Also builds the
    "HC-0001 || July-2026" style title from the assignment date.
    """
    month_label = ""
    if assignment.assigned_at:
        month_label = assignment.assigned_at.strftime("%B-%Y")
    title = f"{assignment.code} || {month_label}" if month_label else assignment.code

    tasks_out = []
    for task in assignment.tasks:
        wi = task.work_item
        site = wi.site if wi else None
        tasks_out.append(
            {
                "id": task.id,
                "work_item_id": task.work_item_id,
                "site_code": site.site_code if site else None,
                "site_type": wi.site_type if wi else None,
                "province": site.province.name if site and site.province else None,
                "requested_technologies": requested_techs_for_task(task),
                "overall_result": task.overall_result,
                "problem_category": task.problem_category,
                "problem_categories": [
                    r.category.name for r in task.remediations if r.category is not None
                ],
                "round_no": task.round_no,
                "reviewed": task.reviewed_at is not None,
                "technologies": [
                    {
                        "technology": t.technology,
                        "result": t.result,
                        "reason_category": t.reason_category,
                        "comment": t.comment,
                    }
                    for t in task.technologies
                ],
            }
        )

    return {
        "id": assignment.id,
        "code": assignment.code,
        "title": title,
        "contractor_id": assignment.contractor_id,
        "status": assignment.status,
        "remarks": assignment.remarks,
        "created_at": assignment.assigned_at,
        "tasks": tasks_out,
    }
