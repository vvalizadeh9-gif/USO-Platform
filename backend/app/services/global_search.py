"""The header's search: one query, answered from every place a person can look.

What a person finds is what they could already open. Sites and villages come
through the same row-level rules as every list (``visible_work_item_ids``), so a
contractor never sees a site that is not theirs and a coordinator never sees
another province's. Contractors are offered to staff only, and people to
administrators only -- the user directory is not something every role may read.

Each group answers with its best few matches and the true number of matches,
so the page can say "5 of 212" and link to the full list instead of pretending
the first five are everything.

Pages and apps are not here: they are the interface's own routes, filtered by
role in the browser (``shell/appRegistry.js``), and the server has nothing to
add to them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import quote

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import ADMIN, CONTRACTOR
from app.core.digits import to_latin
from app.models.reference import Contractor, Province, User
from app.models.workitem import Site, Village, WorkItem
from app.services.visibility import visible_work_item_ids

#: Shorter than this matches half the database and tells the person nothing.
MIN_QUERY_LENGTH = 2
#: Longest query read; the endpoint caps it too.
MAX_QUERY_LENGTH = 100
#: Matches returned per group. The group's ``total`` says how many there are.
PER_GROUP = 5


@dataclass
class Hit:
    """One result: what to call it, what to say under it, and where it opens."""

    id: int
    title: str
    subtitle: str
    route: str


@dataclass
class Group:
    key: str
    label: str
    total: int
    items: list[Hit] = field(default_factory=list)
    #: Where "see all N" goes, when the full list lives on a page of its own.
    all_route: str | None = None


def normalise(q: str | None) -> str:
    """The query as it is compared: trimmed, with Persian digits made Latin."""
    return to_latin((q or "").strip())[:MAX_QUERY_LENGTH]


def like_pattern(q: str) -> str:
    """``q`` as a contains-pattern, with LIKE's own wildcards taken literally.

    Without this a search for ``%`` or ``_`` matches everything, and a site code
    with an underscore in it matches its neighbours.
    """
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _count(db: Session, stmt: Select) -> int:
    return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0


def _sites(db: Session, user: User, pattern: str) -> Group:
    """Sites by ID, temporary ID, province, county or district."""
    matches = (
        select(WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(
            WorkItem.id.in_(visible_work_item_ids(user, db)),
            or_(
                Site.site_code.ilike(pattern, escape="\\"),
                Site.temp_site_code.ilike(pattern, escape="\\"),
                Province.name.ilike(pattern, escape="\\"),
                Site.county.ilike(pattern, escape="\\"),
                Site.district.ilike(pattern, escape="\\"),
            ),
        )
    )
    rows = db.execute(
        select(WorkItem.id, Site.site_code, WorkItem.site_type, WorkItem.current_stage, Province.name)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(WorkItem.id.in_(matches))
        .order_by(Site.site_code, WorkItem.id)
        .limit(PER_GROUP)
    ).all()
    return Group(
        key="sites",
        label="Sites",
        total=_count(db, matches),
        items=[
            Hit(
                id=wid,
                title=code,
                subtitle=" · ".join(p for p in (site_type, province, stage) if p),
                route=f"/work-items/{wid}",
            )
            for wid, code, site_type, stage, province in rows
        ],
    )


def _villages(db: Session, user: User, pattern: str) -> Group:
    """Villages by name or code, opening the site they belong to."""
    matches = (
        select(Village.id)
        .where(
            Village.deleted_at.is_(None),
            Village.work_item_id.in_(visible_work_item_ids(user, db)),
            or_(
                Village.village_name.ilike(pattern, escape="\\"),
                Village.village_code.ilike(pattern, escape="\\"),
            ),
        )
    )
    rows = db.execute(
        select(Village.id, Village.village_name, Village.village_code, Village.work_item_id, Site.site_code)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(Village.id.in_(matches))
        .order_by(Village.village_name, Village.id)
        .limit(PER_GROUP)
    ).all()
    return Group(
        key="villages",
        label="Villages",
        total=_count(db, matches),
        items=[
            Hit(
                id=vid,
                title=name or code or f"Village {vid}",
                subtitle=" · ".join(p for p in (code, f"Site {site_code}") if p),
                route=f"/work-items/{wid}",
            )
            for vid, name, code, wid, site_code in rows
        ],
    )


def _contractors(db: Session, pattern: str) -> Group:
    """Contractors by name, opening the sites that are theirs."""
    matches = select(Contractor.id).where(
        Contractor.active.is_(True), Contractor.name.ilike(pattern, escape="\\")
    )
    rows = db.execute(
        select(Contractor.id, Contractor.name)
        .where(Contractor.id.in_(matches))
        .order_by(Contractor.name)
        .limit(PER_GROUP)
    ).all()
    return Group(
        key="contractors",
        label="Contractors",
        total=_count(db, matches),
        items=[
            Hit(id=cid, title=name, subtitle="Their sites", route=f"/work-items?contractor_id={cid}&contractor={quote(name, safe='')}")
            for cid, name in rows
        ],
    )


def _people(db: Session, pattern: str) -> Group:
    """People by name, username or email, opening the user list on them."""
    clause = or_(
        User.first_name.ilike(pattern, escape="\\"),
        User.family_name.ilike(pattern, escape="\\"),
        User.username.ilike(pattern, escape="\\"),
        User.email.ilike(pattern, escape="\\"),
    )
    matches = select(User.id).where(clause)
    rows = db.execute(
        select(User)
        .where(User.id.in_(matches))
        .order_by(User.family_name, User.first_name)
        .limit(PER_GROUP)
    ).scalars().all()
    return Group(
        key="people",
        label="People",
        total=_count(db, matches),
        items=[
            Hit(
                id=u.id,
                title=u.full_name,
                subtitle=" · ".join(p for p in (u.role.name if u.role else None, u.username) if p),
                route=f"/admin?tab=users&q={quote(u.username, safe='')}",
            )
            for u in rows
        ],
    )


def search(db: Session, user: User, raw_query: str | None) -> list[Group]:
    """Everything ``user`` may see that matches ``raw_query``, in groups.

    Empty groups are left out, and a query under ``MIN_QUERY_LENGTH``
    characters answers nothing rather than everything.
    """
    q = normalise(raw_query)
    if len(q) < MIN_QUERY_LENGTH:
        return []
    pattern = like_pattern(q)

    groups = [_sites(db, user, pattern), _villages(db, user, pattern)]
    role = user.role.name if user.role else None
    # A contractor is defined by what is assigned to them, and a category owner
    # by the fixes routed to them; neither has any business browsing the
    # contractor list.
    if role != CONTRACTOR and not (user.role and user.role.is_category_owner):
        groups.append(_contractors(db, pattern))
    if role == ADMIN:
        groups.append(_people(db, pattern))
    return [g for g in groups if g.total > 0]
