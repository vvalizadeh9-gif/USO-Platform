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

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import ADMIN, COORDINATOR, CONTRACTOR, PM
from app.models.acceptance import CpmChangeRequest, Notification
from app.models.health_check import HcAssignment, HcRemediation, HcTask
from app.models.reference import User
from app.models.workitem import WorkItem
from app.schemas import ActionItem
from app.services.visibility import apply_work_item_scope
from app.services.workflow import STAGE_READY


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
            if wi.current_stage == "Assigned":
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
        .filter(CpmChangeRequest.status == "Pending")
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


def _health_check_items(db: Session, user: User) -> list[ActionItem]:
    """HC results awaiting Coordinator/PM review, and, for a subcontractor,
    the sites in their own open assignments still awaiting submission."""
    items: list[ActionItem] = []
    role = user.role.name

    if role in (PM, COORDINATOR):
        review_q = (
            db.query(HcTask)
            .join(HcAssignment)
            .filter(HcTask.completed_at.isnot(None), HcTask.reviewed_at.is_(None))
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
        q = q.filter(HcRemediation.owner_role_id == user.role_id)

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
