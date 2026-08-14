"""Row-level security: scope Work Item queries by the current user.

Single source of truth for visibility rules so no screen re-implements
its own filtering (DRY). Every list/dashboard/report query passes through
``apply_work_item_scope``.
"""
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.core.deps import CONTRACTOR
from app.models.health_check import HcRemediation
from app.models.reference import ProblemCategory, User
from app.models.workitem import Assignment, Site, WorkItem


def visible_province_ids(user: User) -> list[int] | None:
    """Return the province ids the user may see.

    Returns ``None`` when the user may see *all* provinces (no filtering).
    """
    if user.sees_all_provinces:
        return None
    return [p.id for p in user.provinces]


def apply_work_item_scope(stmt: Select, user: User, db: Session) -> Select:
    """Apply row-level filtering to a WorkItem query.

    Two distinct scoping models, never mixed:

    * **Contractors** are scoped strictly by their own relationship to each
      work item — either they are the drive-test subcontractor (``dt_sc``,
      seeded from CPM col AV) *or* they hold an active in-app assignment.
      Province grants do not apply to contractors (a contractor is defined by
      what's assigned to them, not by geography).
    * **Staff roles** (Admin/PM/Coordinator/…) are scoped by their province
      grants, unless they may see all provinces.
    """
    if user.role.is_category_owner:
        # A category owner sees a site because a fix is routed to their role —
        # not by geography and not by contractor. Same principle as the
        # contractor rule below: you are defined by what is assigned to you.
        owned = (
            select(HcRemediation.work_item_id)
            .join(
                ProblemCategory,
                HcRemediation.problem_category_id == ProblemCategory.id,
            )
            .where(HcRemediation.owner_role_id == user.role_id)
        )
        return stmt.where(WorkItem.id.in_(owned))

    if user.role.name == CONTRACTOR and user.contractor_id is not None:
        # Every work item this contractor has *ever* held, not just the
        # currently-active assignment. A site reassigned away, or one whose
        # drive test is already approved (assignment no longer active),
        # must still appear in the contractor's history rather than
        # silently vanishing from their "All" tab.
        assigned_ids = select(Assignment.work_item_id).where(
            Assignment.contractor_id == user.contractor_id,
        )
        return stmt.where(
            or_(
                WorkItem.dt_sc_contractor_id == user.contractor_id,
                WorkItem.id.in_(assigned_ids),
            )
        )

    # Staff: province scope (unless the user sees everything).
    province_ids = visible_province_ids(user)
    if province_ids is not None:
        stmt = stmt.join(Site, WorkItem.site_id == Site.id).where(
            Site.province_id.in_(province_ids or [-1])
        )
    return stmt
