"""What one board build shares between its queues.

Several queues walk the same scoped work items (the HC pool and the DT
assignment queue both do), and most need the same owner lookups. Loading
those once per build, instead of once per queue, is the difference between one
scan of the country's sites and several.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import cached_property

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.reference import Contractor, Province, User
from app.models.workitem import Site, WorkItem
from app.services.action_queues.types import (
    CONTRACTOR,
    COORDINATOR,
    PM,
    PROBLEM_OWNER,
    REGIONAL_MANAGER,
    OwnerRef,
)
from app.services.health_check import scoped_work_items


def board_role(user: User) -> str | None:
    """Which board this user gets, or None if the Action Center is not theirs.

    A problem owner is recognised by ``Role.is_category_owner`` rather than by
    name, so a new category-owner role needs no change here.
    """
    if user.role.is_category_owner:
        return PROBLEM_OWNER
    if user.role.name in (PM, COORDINATOR):
        return user.role.name
    if user.role.name == CONTRACTOR and user.contractor_id is not None:
        return CONTRACTOR
    return None


def home_role(user: User) -> str | None:
    """Which Home this user gets: their board's, or a Regional Manager's
    (Home's headline queues, with no board behind them). None for the rest."""
    role = board_role(user)
    if role is None and user.role.name == REGIONAL_MANAGER:
        return REGIONAL_MANAGER
    return role


@dataclass
class QueueContext:
    db: Session
    user: User
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_contractor(self) -> bool:
        return self.user.contractor_id is not None

    @property
    def is_problem_owner(self) -> bool:
        return bool(self.user.role.is_category_owner)

    @cached_property
    def work_items(self) -> list[WorkItem]:
        """This user's scoped work items, with the graph the HC/DT queues read."""
        return scoped_work_items(self.db, self.user)

    @cached_property
    def _contractor_names(self) -> dict[int, str]:
        return dict(self.db.execute(select(Contractor.id, Contractor.name)).all())

    @cached_property
    def _coordinators_by_province(self) -> dict[int, OwnerRef]:
        rows = self.db.execute(
            select(Province.id, User.id, User.first_name, User.family_name)
            .join(User, Province.coordinator_user_id == User.id)
        ).all()
        return {
            pid: OwnerRef("coordinator", uid, f"{first} {family}".strip())
            for pid, uid, first, family in rows
        }

    def contractor(self, contractor_id: int | None) -> OwnerRef | None:
        if contractor_id is None:
            return None
        return OwnerRef(
            "contractor", contractor_id,
            self._contractor_names.get(contractor_id, f"Contractor {contractor_id}"),
        )

    def coordinators_for(self, work_item_ids: list[int]) -> dict[int, OwnerRef]:
        """The coordinator of each work item's province, where one is assigned.

        A province with no coordinator yields no owner rather than a guess; the
        per-owner breakdown then shows that work as unassigned.
        """
        if not work_item_ids:
            return {}
        rows = self.db.execute(
            select(WorkItem.id, Site.province_id)
            .join(Site, WorkItem.site_id == Site.id)
            .where(WorkItem.id.in_(set(work_item_ids)))
        ).all()
        by_province = self._coordinators_by_province
        return {
            wi_id: by_province[pid]
            for wi_id, pid in rows
            if pid is not None and pid in by_province
        }
