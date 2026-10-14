"""The header's global search: one query, every kind of thing it can find.

Each group is bounded and scoped exactly as the screen it links to would be,
so a result is never something the person could not have opened anyway:

* **Sites** and **villages** go through ``visible_work_item_ids`` -- the same
  row-level scope as every list in the platform.
* **Provinces** are the ones a staff member is granted; contractors and
  category owners are scoped by assignment, not geography, so get none.
* **Contractors** are offered to staff who can open the All sites list.
* **People** are the Admin's alone: nobody else has a user directory.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import ADMIN, CONTRACTOR, COORDINATOR, PM, REGIONAL, VIEWER, get_current_user
from app.models.reference import Contractor, Province, Role, User
from app.models.workitem import Site, Village, WorkItem
from app.services.cpm_columns import CANONICAL_PROVINCE_BY_NORM, normalize_persian
from app.services.visibility import visible_province_ids, visible_work_item_ids

router = APIRouter(prefix="/search", tags=["search"])

#: Results per group. A search box offers a handful; the list it links to has the rest.
PER_GROUP = 6

# Staff who can open the All sites list a province or contractor result opens.
_SITE_LIST_ROLES = {PM, COORDINATOR, REGIONAL, VIEWER}


class SiteHit(BaseModel):
    id: int
    site_code: str
    province: str | None = None
    stage: str | None = None


class VillageHit(BaseModel):
    work_item_id: int
    village_name: str | None = None
    village_code: str | None = None
    site_code: str


class NamedHit(BaseModel):
    id: int
    name: str


class PersonHit(BaseModel):
    id: int
    full_name: str
    username: str
    role: str


class SearchResults(BaseModel):
    sites: list[SiteHit] = []
    villages: list[VillageHit] = []
    provinces: list[NamedHit] = []
    contractors: list[NamedHit] = []
    people: list[PersonHit] = []


def _like(term: str) -> str:
    # The term is a substring, not a pattern: % and _ typed by a person mean
    # themselves.
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("", response_model=SearchResults)
def search(
    q: str = Query(min_length=2, max_length=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SearchResults:
    """Sites, villages, provinces, contractors and people matching ``q``."""
    term = q.strip()
    if len(term) < 2:
        return SearchResults()
    like = _like(term)
    visible = visible_work_item_ids(user, db)
    role = user.role.name

    sites = db.execute(
        select(WorkItem.id, Site.site_code, Province.name, WorkItem.current_stage)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(WorkItem.id.in_(visible))
        .where(or_(Site.site_code.ilike(like, escape="\\"), Site.temp_site_code.ilike(like, escape="\\")))
        .order_by(func.length(Site.site_code), Site.site_code)
        .limit(PER_GROUP)
    ).all()

    villages = db.execute(
        select(Village.work_item_id, Village.village_name, Village.village_code, Site.site_code)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(Village.deleted_at.is_(None))
        .where(Village.work_item_id.in_(visible))
        .where(or_(Village.village_name.ilike(like, escape="\\"), Village.village_code.ilike(like, escape="\\")))
        .order_by(Village.village_name)
        .limit(PER_GROUP)
    ).all()

    provinces: list[NamedHit] = []
    if role != CONTRACTOR and not user.role.is_category_owner:
        stmt = select(Province.id, Province.name).where(Province.name.ilike(like, escape="\\"))
        granted = visible_province_ids(user)
        if granted is not None:
            stmt = stmt.where(Province.id.in_(granted or [-1]))
        provinces = [
            NamedHit(id=pid, name=name)
            for pid, name in db.execute(stmt.order_by(Province.name)).all()
            # Stray rows from before canonical mapping are not provinces.
            if normalize_persian(name) in CANONICAL_PROVINCE_BY_NORM
        ][:PER_GROUP]

    contractors: list[NamedHit] = []
    if role in _SITE_LIST_ROLES:
        contractors = [
            NamedHit(id=cid, name=name)
            for cid, name in db.execute(
                select(Contractor.id, Contractor.name)
                .where(Contractor.active.is_(True))
                .where(Contractor.name.ilike(like, escape="\\"))
                .order_by(Contractor.name)
                .limit(PER_GROUP)
            ).all()
        ]

    people: list[PersonHit] = []
    if role == ADMIN:
        people = [
            PersonHit(id=u.id, full_name=u.full_name, username=u.username, role=role_name)
            for u, role_name in db.execute(
                select(User, Role.name)
                .join(Role, User.role_id == Role.id)
                .where(
                    or_(
                        User.first_name.ilike(like, escape="\\"),
                        User.family_name.ilike(like, escape="\\"),
                        User.username.ilike(like, escape="\\"),
                        User.email.ilike(like, escape="\\"),
                        User.full_name.ilike(like, escape="\\"),
                    )
                )
                .order_by(User.family_name, User.first_name)
                .limit(PER_GROUP)
            ).all()
        ]

    return SearchResults(
        sites=[SiteHit(id=i, site_code=c, province=p, stage=s) for i, c, p, s in sites],
        villages=[
            VillageHit(work_item_id=w, village_name=n, village_code=vc, site_code=sc)
            for w, n, vc, sc in villages
        ],
        provinces=provinces,
        contractors=contractors,
        people=people,
    )
