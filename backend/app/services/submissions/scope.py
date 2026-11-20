"""Who sees what in Submissions, and the village universe everything reads.

* **Universe:** live, pure هدف villages whose work item is drive-test done --
  ``acceptance_universe.dt_done_universe``, the same definition Lifecycle Gaps
  and the Acceptance dashboard count over. Both ways a site becomes DT done
  (seeded by the first CPM import, or a drive test approved in the app) write
  ``work_items.dt_status = 'Done'``, so one condition covers both.
* **Acting:** the PM, always, and the one coordinator the PM made the owner.
* **Reading:** PM, the owner and Viewer see every region. Every other
  coordinator sees only the villages of their own provinces (their CRA
  region), read-only. Everyone else is refused by the permission map
  (``Area.SUBMISSIONS``).
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, Select, and_, select
from sqlalchemy.orm import Session

from app.core.access import FORBIDDEN, Area, check
from app.core.deps import COORDINATOR, PM, VIEWER
from app.models.kpi import ProvinceMapping
from app.models.reference import Province, Region, User
from app.models.submission import SubmissionSettings
from app.models.workitem import Site, Village, WorkItem
from app.services.acceptance_universe import dt_done_universe
from app.services.visibility import visible_province_ids

SETTINGS_ID = 1


def settings(db: Session) -> SubmissionSettings | None:
    return db.get(SubmissionSettings, SETTINGS_ID)


def owner_id(db: Session) -> int | None:
    row = settings(db)
    return row.owner_user_id if row else None


def owner(db: Session) -> User | None:
    uid = owner_id(db)
    return db.get(User, uid) if uid else None


def is_pm(user: User) -> bool:
    return user.role.name == PM


def is_owner(db: Session, user: User) -> bool:
    return user.role.name == COORDINATOR and owner_id(db) == user.id


def can_act(db: Session, user: User) -> bool:
    """PM always; otherwise only the owner coordinator."""
    return is_pm(user) or is_owner(db, user)


def require_read(user: User) -> None:
    check(user, Area.SUBMISSIONS)


def require_act(db: Session, user: User) -> None:
    require_read(user)
    if not can_act(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)


def require_pm(user: User) -> None:
    if not is_pm(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)


def sees_all(db: Session, user: User) -> bool:
    return user.role.name in (PM, VIEWER) or is_owner(db, user)


def province_ids(db: Session, user: User) -> list[int] | None:
    """The provinces a read-only coordinator is limited to; None for all."""
    if sees_all(db, user):
        return None
    return visible_province_ids(user) or [-1]


def universe(db: Session) -> ColumnElement[bool]:
    """Live, pure هدف, drive test done. Expects Village joined to WorkItem."""
    return dt_done_universe(db)


def located(stmt: Select) -> Select:
    """Join a Village select to its work item, site, province, CPM region and
    CRA region. The CRA region is the province's (``province_mapping``), the
    same mapping coordinators are scoped by; the CPM منطقه (R1-R10) is not one
    to one with it."""
    return (
        stmt.join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .outerjoin(Region, Site.region_id == Region.id)
        .outerjoin(
            ProvinceMapping,
            and_(
                ProvinceMapping.province_fa == Province.name,
                ProvinceMapping.effective_to.is_(None),
            ),
        )
    )


def in_scope(stmt: Select, db: Session, user: User) -> Select:
    """Narrow a ``located`` select to the user's provinces."""
    ids = province_ids(db, user)
    return stmt if ids is None else stmt.where(Site.province_id.in_(ids))


#: The columns every village row carries, in this order.
VILLAGE_COLUMNS = (
    Village.id.label("village_id"),
    Village.village_code,
    Village.village_name,
    WorkItem.id.label("work_item_id"),
    WorkItem.site_type,
    Site.site_code,
    Province.name.label("province"),
    ProvinceMapping.cra_region,
)


def village_select(*extra) -> Select:
    return located(select(*VILLAGE_COLUMNS, *extra))
