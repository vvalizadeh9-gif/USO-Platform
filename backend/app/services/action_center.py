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

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import ADMIN, COORDINATOR, CONTRACTOR, PM
from app.models.acceptance import Notification
from app.models.health_check import HcAssignment, HcRemediation, HcTask
from app.models.monthly_plan import STREAM_LABELS
from app.models.reference import User
from app.models.workitem import Assignment, Village, WorkItem
from app.schemas import ActionCounter, ActionItem
from app.services import acceptance_workflow as flow
from app.services.action_queues.sources import plans as plan_sources
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
    return [
        ActionItem(
            id=f"cpm:{cr.id}", category="cpm",
            label=f"{cr.site_code} — {cr.field_name}",
            subtitle=cr.detail or "CPM change awaiting validation",
            url=f"/admin?tab=validate&highlight={cr.id}",
            created_at=cr.created_at,
        )
        for cr in plan_sources.pending_change_requests(db, user)
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


# ---------------------------------------------------------------------------
# Monthly plans (PIP)
# ---------------------------------------------------------------------------
#: How each PIP stream is named in a chip.
_STREAM_NAME = STREAM_LABELS


def _plan_url(plan, *, drawer: bool) -> str:
    url = f"/monthly-plan?year={plan.shamsi_year}&month={plan.shamsi_month}"
    if drawer:
        url += f"&stream={plan.stream}&contractor={plan.contractor_id}"
    return url


def _pm_plan_items(db: Session, user: User) -> list[ActionItem]:
    """Plans and revisions waiting on the PM. PM only -- Admin does not decide
    plans (the Admin/PM separation), and a Coordinator reads but cannot."""
    from app.models.monthly_plan import STATUS_REVISION_REQUESTED
    from app.core import jalali

    if user.role.name != PM:
        return []
    items = []
    for plan, name in plan_sources.plans_awaiting_pm(db):
        month = f"{jalali.month_name(plan.shamsi_month)} {plan.shamsi_year}"
        stream = _STREAM_NAME.get(plan.stream, plan.stream)
        revision = plan.status == STATUS_REVISION_REQUESTED
        items.append(ActionItem(
            id=f"pip-{'revision' if revision else 'approve'}:{plan.id}",
            category="plan",
            label=f"{name}, {stream}, {month}",
            subtitle=(
                f"Revision awaiting approval: {plan.committed_count}"
                if revision else f"Plan awaiting approval: {plan.committed_count}"
            ),
            url=_plan_url(plan, drawer=True),
            created_at=plan_sources.plan_clock(plan),
        ))
    return items


def _contractor_plan_items(db: Session, user: User) -> list[ActionItem]:
    """A contractor's own plans that need them: returned, or not filed.

    * **Returned** (a plan, or a revision request) with the PM's comment --
      until they resubmit, or the window for it closes.
    * **Not submitted** -- the running month, per stream, once its deadline
      (day 3) has passed with no plan filed. Clears when one is.

    Built on ``contractor_plan_gaps``, the same read the board's "Monthly plan
    to submit" ticket uses; this legacy feed only adds the deadline filter.
    """
    from app.core import jalali
    from app.models.monthly_plan import STATUS_REVISION_RETURNED
    from app.services import monthly_plan as plans

    if user.role.name != CONTRACTOR or user.contractor_id is None:
        return []
    today = jalali.tehran_today()
    gaps = plan_sources.contractor_plan_gaps(db, user.contractor_id, today)
    running = gaps.period
    items = []
    for plan in gaps.returned:
        month = f"{jalali.month_name(plan.shamsi_month)} {plan.shamsi_year}"
        stream = _STREAM_NAME.get(plan.stream, plan.stream)
        what = "Revision returned" if plan.status == STATUS_REVISION_RETURNED else "Plan returned"
        items.append(ActionItem(
            id=f"pip-returned:{plan.id}",
            category="plan",
            label=f"{stream} PIP, {month}",
            subtitle=f"{what}: {plan.return_comment}" if plan.return_comment else what,
            url=_plan_url(plan, drawer=False),
            created_at=plan_sources.plan_clock(plan),
        ))

    if plans.deadline_has_passed(*running, today=today):
        month = f"{jalali.month_name(running[1])} {running[0]}"
        for stream in gaps.missing:
            items.append(ActionItem(
                id=f"pip-missing:{stream}:{running[0]}-{running[1]}",
                category="plan",
                label=f"{_STREAM_NAME[stream]} PIP, {month}",
                subtitle="Plan not submitted; the deadline has passed",
                url=f"/monthly-plan?year={running[0]}&month={running[1]}",
                created_at=None,
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
        *_pm_plan_items(db, user),
        *_contractor_plan_items(db, user),
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

        queue_counts = hc_queues.counts(db, user)
        # The HC Pool counter is the slice that can be assigned right now,
        # not the pool quantity. The pool holds every on-air site whose drive
        # test is not Done -- including sites out with a subcontractor and
        # sites waiting on somebody's fix -- and this page says "you owe
        # this", so it must not count work that is already with someone else.
        queue_counts["pool"] = queue_counts.pop("pool_assignable", queue_counts["pool"])

        for key, count in queue_counts.items():
            if not count:
                continue
            # Not every queue earns a counter. ``dt_in_progress`` deliberately
            # has no entry above: those sites are waiting on the contractor,
            # not on the person reading this page, and a number here means
            # "you owe this". A queue with no label is skipped rather than
            # made up, so adding one later is a line in _QUEUE_LABELS.
            if key not in _QUEUE_LABELS:
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

    if role in (PM, COORDINATOR):
        # Filed and waiting on the authority. Everything else on this page is
        # work this user does; these two are work this user *chases* — and
        # without them a coordinator whose whole province is sitting with ICT
        # sees an empty Action Center and concludes there is nothing to do.
        for authority, key, label, column in (
            ("ICT", "awaiting_ict", "Awaiting ICT", Village.ict_status),
            ("CRA", "awaiting_cra", "Awaiting CRA", Village.cra_status),
        ):
            village_ids = (
                db.execute(
                    select(Village.id).where(
                        Village.deleted_at.is_(None),
                        column == flow.STATUS_PENDING,
                        Village.work_item_id.in_(visible_work_item_ids(user, db)),
                    )
                )
                .scalars()
                .all()
            )
            if village_ids:
                out.append(ActionCounter(
                    key=key, label=label, count=len(village_ids),
                    url=f"/my-work?tab=filled&authority={quote(authority)}",
                    oldest_days=flow.oldest_waiting_days(db, village_ids),
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

    # Monthly plans: the same items, counted. PM decides; a contractor answers.
    plan_items = _pm_plan_items(db, user) + _contractor_plan_items(db, user)
    for key, label, prefix in (
        ("plans_to_approve", "Plans To Approve", "pip-approve:"),
        ("revisions_to_approve", "Revisions To Approve", "pip-revision:"),
        ("plans_returned", "Plans Returned", "pip-returned:"),
        ("plans_missing", "Plans Not Submitted", "pip-missing:"),
    ):
        count = sum(1 for i in plan_items if i.id.startswith(prefix))
        if count:
            out.append(ActionCounter(key=key, label=label, count=count, url="/monthly-plan"))

    if role in (ADMIN, PM):
        pending_cpm = len(_cpm_change_request_items(db, user))
        if pending_cpm:
            out.append(ActionCounter(
                key="cpm", label="CPM Changes", count=pending_cpm,
                url="/admin?tab=validate",
            ))

    return out
