"""Action Center: a single, per-user, self-clearing queue of everything that
needs this user's action, plus recent events relevant to their role.

Each function below answers one question — "what does this user, in this
role, currently need to do?" — against live state. An item is never written
to a table and never needs to be dismissed: it exists exactly as long as the
underlying condition does, and disappears the moment it's resolved (the site
moves stage, the change request is decided, the HC task is reviewed). The one
exception is unread Notification rows, folded in as dismissible "event"
items so there's exactly one place to look instead of two.

Adding a new actionable source is: write one function here, append its
results in `build()`. Nothing else (schema, endpoint, frontend list
rendering) needs to know about the new category ahead of time.
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote

from sqlalchemy import Select, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import ADMIN, COORDINATOR, CONTRACTOR, PM
from app.models.acceptance import CpmChangeRequest, Notification
from app.models.health_check import HcAssignment, HcRemediation, HcTask
from app.models.reference import User
from app.models.workitem import Assignment, Site, WorkItem
from app.schemas import ActionCounter, ActionItem
from app.services.visibility import apply_work_item_scope, visible_work_item_ids
from app.services.workflow import STAGE_ASSIGNED, STAGE_READY, STAGE_RETURNED


def _site_label(wi: WorkItem | None, fallback: str) -> str:
    if wi is not None and wi.site is not None:
        return wi.site.site_code
    return fallback


def _work_item_items(db: Session, user: User) -> list[ActionItem]:
    """Per-work-item actionable rows, scoped exactly like the work-items list."""
    stmt = apply_work_item_scope(
        select(WorkItem).where(WorkItem.deleted_at.is_(None)), user, db
    )
    stmt = stmt.options(selectinload(WorkItem.site))
    work_items = list(db.execute(stmt).scalars().all())

    role = user.role.name
    items: list[ActionItem] = []

    if role == COORDINATOR:
        for wi in work_items:
            if wi.current_stage == "DT Submitted":
                items.append(ActionItem(
                    id=f"dt:{wi.id}", category="drive_test",
                    label=_site_label(wi, f"Work item {wi.id}"),
                    subtitle="Awaiting drive-test validation",
                    url=f"/work-items/{wi.id}",
                    created_at=wi.updated_at,
                ))

    if role == PM:
        for wi in work_items:
            if wi.current_stage == "Returned by Contractor":
                items.append(ActionItem(
                    id=f"returned:{wi.id}", category="assignment",
                    label=_site_label(wi, f"Work item {wi.id}"),
                    subtitle="Returned by contractor",
                    url=f"/work-items/{wi.id}",
                    created_at=wi.updated_at,
                ))
            if wi.current_stage == STAGE_READY:
                items.append(ActionItem(
                    id=f"ready:{wi.id}", category="assignment",
                    label=_site_label(wi, f"Work item {wi.id}"),
                    subtitle="Ready for assignment",
                    url=f"/work-items/{wi.id}",
                    created_at=wi.updated_at,
                ))

    if role == CONTRACTOR:
        for wi in work_items:
            if wi.current_stage == STAGE_ASSIGNED:
                items.append(ActionItem(
                    id=f"assigned:{wi.id}", category="assignment",
                    label=_site_label(wi, f"Work item {wi.id}"),
                    subtitle="Assigned to you",
                    url=f"/work-items/{wi.id}",
                    created_at=wi.updated_at,
                ))

    return items


def _cpm_change_request_items(db: Session, user: User) -> list[ActionItem]:
    """Pending CPM change requests — only for roles that can decide them."""
    if user.role.name not in (ADMIN, PM):
        return []
    pending = (
        db.query(CpmChangeRequest)
        .filter(
            CpmChangeRequest.status == "Pending",
            CpmChangeRequest.site_code.in_(_visible_site_codes(db, user)),
        )
        .order_by(CpmChangeRequest.id.desc())
        .all()
    )
    return [
        ActionItem(
            id=f"cpm:{cr.id}", category="cpm",
            label=f"{cr.site_code} — {cr.field_name}",
            subtitle=cr.detail or "CPM change awaiting validation",
            url=f"/admin?tab=validate&highlight={cr.id}",
            created_at=cr.created_at,
        )
        for cr in pending
    ]


def _visible_site_codes(db: Session, user: User) -> Select:
    """Site codes inside this user's province scope, as a subquery.

    Change requests are keyed by site code rather than by work item, so they
    cannot reuse ``visible_work_item_ids`` directly. A PM who sees every
    province still sees every request; this only narrows a scoped user.
    """
    return (
        select(Site.site_code)
        .join(WorkItem, WorkItem.site_id == Site.id)
        .where(WorkItem.id.in_(visible_work_item_ids(user, db)))
        .distinct()
    )


def _health_check_items(db: Session, user: User) -> list[ActionItem]:
    """HC results awaiting Coordinator/PM review, and, for a subcontractor,
    the sites in their own open assignments still awaiting submission."""
    items: list[ActionItem] = []
    role = user.role.name

    if role in (PM, COORDINATOR):
        review_q = (
            db.query(HcTask)
            .join(HcAssignment)
            .filter(
                HcTask.completed_at.isnot(None),
                HcTask.reviewed_at.is_(None),
                # Province scope, the same rule every other read in the
                # platform applies. Without it this feed named the site code,
                # the round and the readiness of every health check in the
                # country to a coordinator granted a single province -- the
                # one place row-level security was never wired in.
                HcTask.work_item_id.in_(visible_work_item_ids(user, db)),
            )
            .options(selectinload(HcTask.work_item).selectinload(WorkItem.site))
            .order_by(HcTask.id.desc())
            .all()
        )
        for task in review_q:
            items.append(ActionItem(
                id=f"hc-review:{task.id}", category="health_check",
                label=_site_label(task.work_item, f"HC task {task.id}"),
                subtitle=f"Health check result awaiting review ({task.overall_result})",
                url=f"/health-check?tab=results&task={task.id}",
                created_at=task.completed_at,
            ))

    if user.contractor_id is not None:
        submit_q = (
            db.query(HcTask)
            .join(HcAssignment)
            .filter(
                HcAssignment.contractor_id == user.contractor_id,
                HcTask.completed_at.is_(None),
            )
            .options(selectinload(HcTask.work_item).selectinload(WorkItem.site))
            .order_by(HcTask.id.desc())
            .all()
        )
        for task in submit_q:
            items.append(ActionItem(
                id=f"hc-submit:{task.id}", category="health_check",
                label=_site_label(task.work_item, f"HC task {task.id}"),
                subtitle="Health check submission needed",
                url=f"/my-health-check?assignment={task.hc_assignment_id}&task={task.id}",
                created_at=task.created_at,
            ))

    return items


def _remediation_items(db: Session, user: User) -> list[ActionItem]:
    """Fixes that need attention: proposed re-routes, and breached SLAs.

    A PM sees every pending re-route (they adjudicate) and every overdue fix
    (they chase). An owner sees only their own overdue fixes — their queue is
    the place they work, this is just the nudge.
    """
    role = user.role.name
    is_owner = user.role.is_category_owner
    if role not in (ADMIN, PM) and not is_owner:
        return []

    now = datetime.now(timezone.utc)
    items: list[ActionItem] = []

    q = (
        db.query(HcRemediation)
        .filter(HcRemediation.closed_at.is_(None))
        .options(
            selectinload(HcRemediation.category),
            selectinload(HcRemediation.reroute_to_category),
        )
        .order_by(HcRemediation.id.desc())
    )
    if is_owner:
        # An owner is scoped by what is routed to their role, not by
        # geography -- the same rule ``apply_work_item_scope`` uses for them.
        q = q.filter(HcRemediation.owner_role_id == user.role_id)
    else:
        # Staff are scoped by province, here as everywhere else.
        q = q.filter(
            HcRemediation.work_item_id.in_(visible_work_item_ids(user, db))
        )

    for rem in q.all():
        wi = db.get(WorkItem, rem.work_item_id)
        label = _site_label(wi, f"Site {rem.work_item_id}")
        category = rem.category.name if rem.category else "fix"

        if role in (ADMIN, PM) and rem.reroute_to_category_id is not None:
            target = (
                rem.reroute_to_category.name if rem.reroute_to_category else "another team"
            )
            items.append(ActionItem(
                id=f"hc-reroute:{rem.id}", category="health_check",
                label=label,
                subtitle=f"{category} team says this belongs to {target}",
                url=f"/health-check?tab=reroutes&fix={rem.id}",
                created_at=rem.reroute_at,
            ))

        due = rem.due_at
        if due is not None:
            due = due if due.tzinfo is not None else due.replace(tzinfo=timezone.utc)
            if due < now:
                late = (now - due).days
                items.append(ActionItem(
                    id=f"hc-overdue:{rem.id}", category="health_check",
                    label=label,
                    subtitle=f"{category} fix is {late} day{'s' if late != 1 else ''} late",
                    url="/my-fix-queue" if is_owner
                        else f"/health-check?tab=reroutes&fix={rem.id}",
                    created_at=rem.opened_at,
                ))

    return items


_EVENT_URL_BUILDERS = {
    "WorkItem": lambda entity_id: f"/work-items/{entity_id}",
}


def _event_items(db: Session, user: User) -> list[ActionItem]:
    """Unread notifications, folded into the same feed as dismissible events."""
    notifs = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read.is_(False))
        .order_by(Notification.id.desc())
        .limit(100)
        .all()
    )
    items = []
    for n in notifs:
        url_builder = _EVENT_URL_BUILDERS.get(n.related_entity_type or "")
        url = url_builder(n.related_entity_id) if url_builder and n.related_entity_id else "/work-items"
        items.append(ActionItem(
            id=f"event:{n.id}", category="event",
            label=n.message, subtitle=n.type,
            url=url, created_at=n.created_at, source="event",
        ))
    return items


def _sort_key(item: ActionItem) -> datetime:
    dt = item.created_at
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def build(db: Session, user: User) -> list[ActionItem]:
    """Everything this user needs to see right now, newest first."""
    items = [
        *_work_item_items(db, user),
        *_cpm_change_request_items(db, user),
        *_health_check_items(db, user),
        *_remediation_items(db, user),
        *_event_items(db, user),
    ]
    items.sort(key=_sort_key, reverse=True)
    return items


# What each role is shown as a counter, and where the number leads. The
# counters are the page: "HC Review 37, DT Assignment 21, DT Review 8" answers
# "what needs me now" in one glance, where thirty-seven individual cards did
# not — they filled the screen before the second category appeared.
_QUEUE_LABELS = {
    "pool": ("HC Pool", "/health-check?tab=pool"),
    "in_progress": ("HC In Progress", "/health-check?tab=running"),
    "hc_review": ("HC Review", "/health-check?tab=review"),
    "remediation": ("Active Problems", "/health-check?tab=remediation"),
    "reroutes": ("Re-route Decisions", "/health-check?tab=reroutes"),
    "dt_assignment": ("DT Assignment", "/health-check?tab=dt-assign"),
    "dt_review": ("DT Review", "/health-check?tab=dt-review"),
}


def counters(db: Session, user: User) -> list[ActionCounter]:
    """The count-first summary, role-shaped.

    A counter reading zero is dropped rather than shown as an empty row: the
    point of the page is what needs doing, and a wall of zeroes is the same
    "you are all caught up" said seven times.
    """
    role = user.role.name
    out: list[ActionCounter] = []

    if role in (PM, COORDINATOR):
        from app.services import hc_queues

        for key, count in hc_queues.counts(db, user).items():
            if not count:
                continue
            label, url = _QUEUE_LABELS[key]
            out.append(
                ActionCounter(key=key, label=label, count=count, url=url)
            )

    if role == PM:
        # The two stages a PM, and only a PM, clears by hand. They had no
        # counter while the page also listed one row per site; the page is
        # counters alone now, so without these the work a PM is expected to
        # pick up would not appear on the screen they land on.
        for stage, key, label in (
            (STAGE_READY, "ready_to_assign", "Ready to Assign"),
            (STAGE_RETURNED, "returned", "Returned by Contractor"),
        ):
            count = (
                db.query(WorkItem.id)
                .filter(
                    WorkItem.deleted_at.is_(None),
                    WorkItem.current_stage == stage,
                    WorkItem.id.in_(visible_work_item_ids(user, db)),
                )
                .count()
            )
            if count:
                out.append(ActionCounter(
                    key=key, label=label, count=count,
                    url=f"/work-items?stage={quote(stage)}",
                ))

    if user.contractor_id is not None:
        # The sites this contractor is expected to drive-test right now. A
        # contractor's Action Center listed these one card per site and gave
        # no total, so the first thing they wanted to know -- how many do I
        # owe -- was the one thing the page made them count by hand.
        assigned_sites = (
            db.query(WorkItem.id)
            .join(Assignment, Assignment.work_item_id == WorkItem.id)
            .filter(
                WorkItem.deleted_at.is_(None),
                WorkItem.current_stage == STAGE_ASSIGNED,
                Assignment.contractor_id == user.contractor_id,
                Assignment.is_active.is_(True),
            )
            .distinct()
            .count()
        )
        if assigned_sites:
            out.append(ActionCounter(
                key="assigned_sites", label="Assigned Sites",
                count=assigned_sites, url="/work-items?stage=Assigned",
            ))

        pending = (
            db.query(HcTask)
            .join(HcAssignment)
            .filter(
                HcAssignment.contractor_id == user.contractor_id,
                HcTask.completed_at.is_(None),
            )
            .count()
        )
        if pending:
            out.append(ActionCounter(
                key="hc_submit", label="Health Checks To Submit",
                count=pending, url="/my-health-check",
            ))

    if user.role.is_category_owner:
        open_fixes = (
            db.query(HcRemediation)
            .filter(
                HcRemediation.owner_role_id == user.role_id,
                HcRemediation.closed_at.is_(None),
            )
            .count()
        )
        if open_fixes:
            out.append(ActionCounter(
                key="my_fixes", label="Fixes Assigned To You",
                count=open_fixes, url="/my-fix-queue",
            ))

    if role in (ADMIN, PM):
        pending_cpm = len(_cpm_change_request_items(db, user))
        if pending_cpm:
            out.append(ActionCounter(
                key="cpm", label="CPM Changes", count=pending_cpm,
                url="/admin?tab=validate",
            ))

    return out
