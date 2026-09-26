"""The Drive Test dashboard's work items, read as plain columns.

``DriveTestAnalytics`` walks every in-scope work item with its site, its
drive-test assignments, its health-check tasks and its legacy health checks.
Loading those as ORM objects cost most of each request: every work item with
all of its columns, then four eager loads issued in batches of five hundred
ids -- over a hundred queries -- plus, through ``HcTask``'s own eager
relationships, every task's technologies and remediations, which nothing on
the dashboard reads. Three requests on the page did all of it once each.

This reads the fields the dashboard's predicates use, in five queries, into
small objects shaped like the ORM ones where it matters, so ``is_onair``,
``effective_contractor_id``, ``problematic_since`` and the rest take them
unchanged. The classes are slotted on purpose: a field some future predicate
reads and this module does not load fails loudly with ``AttributeError``
instead of quietly reading as empty.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.health_check import HcTask
from app.models.reference import ProblemCategory, User
from app.models.workitem import Assignment, HealthCheck, Site, WorkItem
from app.services.visibility import apply_work_item_scope


class SiteRow:
    __slots__ = ("id", "site_code", "province_id")

    def __init__(self, id: int, site_code: str | None, province_id: int | None) -> None:
        self.id = id
        self.site_code = site_code
        self.province_id = province_id


class NamedRow:
    """Stands in for a related row read only for its ``name``."""

    __slots__ = ("name",)

    def __init__(self, name: str) -> None:
        self.name = name


class HealthCheckRow:
    __slots__ = ("id", "status", "checked_at", "problem_category")

    def __init__(self, id, status, checked_at, problem_category_name) -> None:
        self.id = id
        self.status = status
        self.checked_at = checked_at
        self.problem_category = (
            NamedRow(problem_category_name) if problem_category_name is not None else None
        )


class WorkItemRow:
    __slots__ = (
        "id",
        "site",
        "last_stage",
        "current_stage",
        "dt_status",
        "dt_sc_contractor_id",
        "dt_problem_category",
        "dt_date_gregorian",
        "launch_date_gregorian",
        "launch_date_shamsi",
        "assignments",
        "hc_tasks",
        "health_checks",
    )

    def __init__(self, r, site: SiteRow | None) -> None:
        self.id: int = r.id
        self.site = site
        self.last_stage: str | None = r.last_stage
        self.current_stage: str = r.current_stage
        self.dt_status: str | None = r.dt_status
        self.dt_sc_contractor_id: int | None = r.dt_sc_contractor_id
        self.dt_problem_category: str | None = r.dt_problem_category
        self.dt_date_gregorian: date | None = r.dt_date_gregorian
        self.launch_date_gregorian: date | None = r.launch_date_gregorian
        self.launch_date_shamsi: str | None = r.launch_date_shamsi
        # Result rows, read by attribute exactly as the ORM objects were.
        self.assignments: list = []
        self.hc_tasks: list = []
        self.health_checks: list[HealthCheckRow] = []


def load(db: Session, user: User, province_id: int | None = None) -> list[WorkItemRow]:
    """The live work items in this user's scope, optionally one province.

    Exactly the rows ``DriveTestAnalytics._load`` selected as ORM objects:
    ``apply_work_item_scope`` first, and the province narrowing after it, so
    the filter can only remove what the scope allowed. Related rows come in
    id order, which is what the ORM collections returned in practice and what
    the predicates' "first active assignment" relies on.
    """
    scoped = apply_work_item_scope(
        select(WorkItem.id).where(WorkItem.deleted_at.is_(None)), user, db
    )
    if province_id is not None:
        scoped = scoped.where(
            WorkItem.site_id.in_(select(Site.id).where(Site.province_id == province_id))
        )
    # Straight to the connection: column reads gain nothing from the session's
    # ORM result handling but time.
    conn = db.connection()

    items: dict[int, WorkItemRow] = {}
    for r in conn.execute(
        select(
            WorkItem.id,
            WorkItem.last_stage,
            WorkItem.current_stage,
            WorkItem.dt_status,
            WorkItem.dt_sc_contractor_id,
            WorkItem.dt_problem_category,
            WorkItem.dt_date_gregorian,
            WorkItem.launch_date_gregorian,
            WorkItem.launch_date_shamsi,
            Site.id.label("site_id"),
            Site.site_code,
            Site.province_id,
        )
        .outerjoin(Site, WorkItem.site_id == Site.id)
        .where(WorkItem.id.in_(scoped))
        .order_by(WorkItem.id)
    ):
        site = (
            SiteRow(r.site_id, r.site_code, r.province_id)
            if r.site_id is not None
            else None
        )
        items[r.id] = WorkItemRow(r, site)

    for r in conn.execute(
        select(
            Assignment.id,
            Assignment.work_item_id,
            Assignment.is_active,
            Assignment.contractor_id,
            Assignment.assigned_at,
            Assignment.returned_at,
        )
        .where(Assignment.work_item_id.in_(scoped))
        .order_by(Assignment.id)
    ):
        items[r.work_item_id].assignments.append(r)

    for r in conn.execute(
        select(
            HcTask.id,
            HcTask.work_item_id,
            HcTask.completed_at,
            HcTask.reviewed_at,
            HcTask.overall_result,
            HcTask.problem_category,
        )
        .where(HcTask.work_item_id.in_(scoped))
        .order_by(HcTask.id)
    ):
        items[r.work_item_id].hc_tasks.append(r)

    for r in conn.execute(
        select(
            HealthCheck.id,
            HealthCheck.work_item_id,
            HealthCheck.status,
            HealthCheck.checked_at,
            ProblemCategory.name.label("problem_category_name"),
        )
        .outerjoin(ProblemCategory, HealthCheck.problem_category_id == ProblemCategory.id)
        .where(HealthCheck.work_item_id.in_(scoped))
        .order_by(HealthCheck.id)
    ):
        items[r.work_item_id].health_checks.append(
            HealthCheckRow(r.id, r.status, r.checked_at, r.problem_category_name)
        )

    return list(items.values())
