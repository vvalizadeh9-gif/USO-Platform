"""Explorer's list of all sites (GET /explorer/sites) and what hangs off it.

One row per live work item in the caller's scope: site, province, type,
requested technology, how many هدف villages it has, and its DT contractor.
Search, filters and sort run in the database, and the list pages with a
keyset cursor rather than an offset, so a page costs the same at row 4,000 as
at row 1 and a site added mid-scroll never shifts a page.

The query count is fixed whatever the page size: the هدف values, the page,
the total, and (only when searching) which villages matched. The هدف count is
one grouped subquery and the DT contractor one join -- no per-row reads.

Nothing is redefined. Scope is ``visible_work_item_ids`` (the rule every list
uses); "هدف" is ``kpi.target_values``, the values ``cpm_columns.is_pure_target``
accepts, so the list's count is the record page's count; Persian text is folded
the way ``cpm_columns.normalize_persian`` folds it.
"""
from __future__ import annotations

import base64
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import (
    ColumnElement,
    Select,
    and_,
    case,
    func,
    literal,
    or_,
    select,
)
from sqlalchemy.orm import Session

from app.core.digits import to_latin
from app.models.reference import Contractor, Province, User
from app.models.workitem import Site, Village, WorkItem
from app.services import kpi
from app.services.cpm_columns import normalize_persian
from app.services.explorer import SiteNotFound
from app.services.tech_parser import KNOWN_TECHNOLOGIES, parse_technologies
from app.services.visibility import visible_work_item_ids

DEFAULT_LIMIT = 50
MAX_LIMIT = 100

SORT_SITE = "site"
SORT_KEYS = (SORT_SITE, "province", "type", "tech", "villages", "dt_contractor")
DIRECTIONS = ("asc", "desc")

# Arabic letter forms and zero-width marks, as ``normalize_persian`` folds them.
_FOLDS = (("\u064a", "\u06cc"), ("\u0643", "\u06a9"),
          ("\u200c", " "), ("\u200d", " "), ("\u200b", " "), ("\ufeff", " "))


class BadCursor(ValueError):
    """A cursor this endpoint did not issue for this sort."""


@dataclass(frozen=True)
class ListQuery:
    """What the list was asked for: search, filters and sort."""

    q: str = ""
    provinces: tuple[int, ...] = ()
    types: tuple[str, ...] = ()
    techs: tuple[str, ...] = ()
    dt_contractors: tuple[int, ...] = ()
    sort: str = SORT_SITE
    direction: str = "asc"
    ids: tuple[int, ...] = ()  # an export of a selection

    @property
    def term(self) -> str:
        """The search text as it is compared: Latin digits, Persian folded."""
        return normalize_persian(to_latin(self.q or "").strip()) or ""


# --------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------
def _fold(column: ColumnElement) -> ColumnElement:
    """``column`` with Arabic letter forms and zero-width marks folded."""
    for old, new in _FOLDS:
        column = func.replace(column, old, new)
    return column


def _like(term: str) -> str:
    # A typed % or _ means itself, as in the header search.
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _hadaf(db: Session) -> ColumnElement[bool]:
    """A live هدف village: the record page's rule (``explorer._hadaf_villages``)."""
    return and_(
        Village.deleted_at.is_(None),
        Village.target_classification.in_(kpi.target_values(db) or [""]),
    )


def _village_matches(term: str) -> ColumnElement[bool]:
    like = _like(term)
    return or_(
        _fold(Village.village_name).ilike(like, escape="\\"),
        Village.village_code.ilike(like, escape="\\"),
    )


@dataclass(frozen=True)
class _Columns:
    """The page query's columns, so sort keys and the row share one source."""

    hadaf_count: ColumnElement[int]

    def sort_value(self, key: str) -> ColumnElement:
        return {
            "site": Site.site_code,
            "province": Province.name,
            "type": WorkItem.site_type,
            "tech": WorkItem.requested_technology,
            "villages": self.hadaf_count,
            "dt_contractor": Contractor.name,
        }[key]


def _base(db: Session, user: User, hadaf: ColumnElement[bool]) -> tuple[Select, _Columns]:
    """Every in-scope site with its row columns, before search and filters."""
    counts = (
        select(Village.work_item_id, func.count().label("n"))
        .where(hadaf)
        .group_by(Village.work_item_id)
        .subquery()
    )
    cols = _Columns(hadaf_count=func.coalesce(counts.c.n, 0))
    stmt = (
        select(
            WorkItem.id,
            Site.site_code,
            Province.name.label("province"),
            WorkItem.site_type,
            WorkItem.requested_technology,
            cols.hadaf_count.label("hadaf_villages"),
            Contractor.id.label("dt_contractor_id"),
            Contractor.name.label("dt_contractor_name"),
        )
        .select_from(WorkItem)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .outerjoin(Contractor, WorkItem.dt_sc_contractor_id == Contractor.id)
        .outerjoin(counts, counts.c.work_item_id == WorkItem.id)
        .where(WorkItem.deleted_at.is_(None))
        .where(WorkItem.id.in_(visible_work_item_ids(user, db)))
    )
    return stmt, cols


def _narrow(stmt: Select, query: ListQuery, hadaf: ColumnElement[bool]) -> Select:
    """Search and filters. Applied inside the scope, so they only narrow it."""
    term = query.term
    if term:
        like = _like(term)
        by_village = select(Village.work_item_id).where(hadaf, _village_matches(term))
        stmt = stmt.where(or_(
            Site.site_code.ilike(like, escape="\\"),
            _fold(Province.name).ilike(like, escape="\\"),
            WorkItem.id.in_(by_village),
        ))
    if query.provinces:
        stmt = stmt.where(Site.province_id.in_(query.provinces))
    if query.types:
        stmt = stmt.where(WorkItem.site_type.in_(query.types))
    if query.techs:
        stmt = stmt.where(or_(*(
            WorkItem.requested_technology.ilike(f"%{t}%") for t in query.techs
        )))
    if query.dt_contractors:
        stmt = stmt.where(WorkItem.dt_sc_contractor_id.in_(query.dt_contractors))
    if query.ids:
        stmt = stmt.where(WorkItem.id.in_(query.ids))
    return stmt


# --------------------------------------------------------------------------
# Sort and keyset
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class _Key:
    expr: ColumnElement
    descending: bool


def _keys(cols: _Columns, query: ListQuery) -> list[_Key]:
    """The full ordering: the chosen column (empty values last in either
    direction), then site code and id ascending, so ties are stable."""
    desc = query.direction == "desc"
    keys: list[_Key] = []
    if query.sort != SORT_SITE:
        value = cols.sort_value(query.sort)
        keys += [
            _Key(case((value.is_(None), 1), else_=0), False),
            _Key(func.coalesce(value, literal(0 if query.sort == "villages" else "")), desc),
        ]
        desc = False
    keys += [_Key(Site.site_code, desc), _Key(WorkItem.id, desc)]
    return keys


def _after(keys: Sequence[_Key], values: Sequence) -> ColumnElement[bool]:
    """Rows strictly after ``values`` in the order ``keys`` define."""
    clauses = []
    for i, key in enumerate(keys):
        equal = [k.expr == v for k, v in zip(keys[:i], values[:i], strict=True)]
        step = key.expr < values[i] if key.descending else key.expr > values[i]
        clauses.append(and_(*equal, step))
    return or_(*clauses)


def encode_cursor(query: ListQuery, values: Sequence) -> str:
    raw = json.dumps({"s": query.sort, "d": query.direction, "v": list(values)})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(query: ListQuery, cursor: str, n: int) -> list:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        values = data["v"]
        same = data["s"] == query.sort and data["d"] == query.direction
    except (ValueError, KeyError, TypeError):
        raise BadCursor(cursor) from None
    if not same or not isinstance(values, list) or len(values) != n:
        raise BadCursor(cursor)
    return values


# --------------------------------------------------------------------------
# Rows
# --------------------------------------------------------------------------
def _row(r) -> dict:
    return {
        "id": r.id,
        "site_code": r.site_code,
        "province": r.province,
        "type": r.site_type,
        "requested_technology": parse_technologies(r.requested_technology),
        "hadaf_villages": r.hadaf_villages,
        "dt_contractor": (
            {"id": r.dt_contractor_id, "name": r.dt_contractor_name}
            if r.dt_contractor_id is not None else None
        ),
        "village_match": None,
    }


def _village_hits(db: Session, ids: list[int], term: str,
                  hadaf: ColumnElement[bool]) -> dict[int, dict]:
    """For each listed site, the first of its هدف villages the search matched."""
    if not term or not ids:
        return {}
    hits: dict[int, dict] = {}
    for wi_id, code, name in db.execute(
        select(Village.work_item_id, Village.village_code, Village.village_name)
        .where(Village.work_item_id.in_(ids), hadaf, _village_matches(term))
        .order_by(Village.village_code, Village.id)
    ):
        hits.setdefault(wi_id, {"code": code, "name": name})
    return hits


def list_sites(db: Session, user: User, query: ListQuery, *,
               cursor: str | None = None, limit: int = DEFAULT_LIMIT) -> dict:
    """One page of the list, its total, and the cursor for the next page."""
    hadaf = _hadaf(db)
    stmt, cols = _base(db, user, hadaf)
    stmt = _narrow(stmt, query, hadaf)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()

    keys = _keys(cols, query)
    paged = stmt.add_columns(*(k.expr.label(f"k{i}") for i, k in enumerate(keys)))
    if cursor:
        paged = paged.where(_after(keys, decode_cursor(query, cursor, len(keys))))
    paged = paged.order_by(*(k.expr.desc() if k.descending else k.expr.asc() for k in keys))
    rows = db.execute(paged.limit(limit + 1)).all()

    more = len(rows) > limit
    rows = rows[:limit]
    items = [_row(r) for r in rows]
    hits = _village_hits(db, [i["id"] for i in items], query.term, hadaf)
    for item in items:
        item["village_match"] = hits.get(item["id"])
    last = rows[-1] if rows else None
    next_cursor = (
        encode_cursor(query, [getattr(last, f"k{i}") for i in range(len(keys))])
        if more and last is not None else None
    )
    return {"items": items, "total": total, "next_cursor": next_cursor}


def export_rows(db: Session, user: User, query: ListQuery, limit: int) -> list[dict]:
    """The rows the list shows for ``query``, in its order, for a spreadsheet."""
    return list_sites(db, user, query, limit=limit)["items"]


# --------------------------------------------------------------------------
# One site's villages, and the filter menu
# --------------------------------------------------------------------------
def site_villages(db: Session, user: User, work_item_id: int) -> list[dict]:
    """The site's هدف villages in code order. Raises :class:`SiteNotFound`."""
    visible = db.execute(
        select(WorkItem.id)
        .where(WorkItem.id == work_item_id)
        .where(WorkItem.id.in_(visible_work_item_ids(user, db)))
    ).first()
    if visible is None:
        raise SiteNotFound(work_item_id)
    return [
        {"code": code, "name": name}
        for code, name in db.execute(
            select(Village.village_code, Village.village_name)
            .where(Village.work_item_id == work_item_id, _hadaf(db))
            .order_by(Village.village_code, Village.id)
        )
    ]


def _techs(raw_values: Iterable[str | None]) -> list[str]:
    found = {t for raw in raw_values for t in parse_technologies(raw)}
    return [t for t in KNOWN_TECHNOLOGIES if t in found]


def filter_options(db: Session, user: User) -> dict:
    """The distinct values the caller can see for each filter field."""
    visible = (
        select(WorkItem.id, WorkItem.site_id, WorkItem.site_type,
               WorkItem.requested_technology, WorkItem.dt_sc_contractor_id)
        .where(WorkItem.deleted_at.is_(None))
        .where(WorkItem.id.in_(visible_work_item_ids(user, db)))
        .subquery()
    )
    provinces = db.execute(
        select(Province.id, Province.name).distinct()
        .join(Site, Site.province_id == Province.id)
        .join(visible, visible.c.site_id == Site.id)
        .order_by(Province.name)
    ).all()
    types = db.execute(
        select(visible.c.site_type).distinct().order_by(visible.c.site_type)
    ).scalars().all()
    techs = db.execute(select(visible.c.requested_technology).distinct()).scalars().all()
    contractors = db.execute(
        select(Contractor.id, Contractor.name).distinct()
        .join(visible, visible.c.dt_sc_contractor_id == Contractor.id)
        .order_by(Contractor.name)
    ).all()
    return {
        "provinces": [{"id": i, "name": n} for i, n in provinces],
        "types": [t for t in types if t],
        "technologies": _techs(techs),
        "dt_contractors": [{"id": i, "name": n} for i, n in contractors],
    }
