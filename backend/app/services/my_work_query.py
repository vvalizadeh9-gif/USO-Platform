"""The My Work list, its tab counts and its totals -- from one select.

:func:`base_select` is the only place the list's population is defined:
role visibility, scope, the optional authority narrowing and the search. The
rows are that select with one tab's predicate, ordered and cut; the counts are
``count(*) FILTER`` of every tab predicate over the very same select. So the
number on a tab is, by construction, the number of rows it opens -- the
sidebar badge reads the same counts with ``limit=0``.

Pagination is an opaque cursor over an offset, bound to the filters it was
issued for. Waiting time mixes a timestamp (last activity) with a date (the
drive test) and keyset comparison over that mix is not portable between
SQLite and PostgreSQL; the list is a few thousand rows at most, where offset
is cheap.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.digits import to_latin
from app.models.acceptance_workflow import (
    AUTHORITIES,
    REVIEW_PENDING,
    AcceptanceSubmission,
)
from app.models.reference import Contractor, Province, User
from app.models.workitem import Site, Village, WorkItem
from app.services import acceptance_workflow as flow
from app.services import my_work_status as S
from app.services.my_work_scope import SCOPE_UNIVERSE, scope_clause
from app.services.tech_parser import parse_technologies
from app.services.visibility import visible_work_item_ids

SORT_LONGEST = "waiting_longest"
SORT_SHORTEST = "waiting_shortest"
SORT_NAME = "name"
SORTS = (SORT_LONGEST, SORT_SHORTEST, SORT_NAME)

MAX_LIMIT = 500


class QueryError(ValueError):
    """A request the list cannot answer, with a machine-readable code."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ListRequest:
    scope: str
    tab: str
    authority: str | None = None
    q: str | None = None
    sort: str = SORT_LONGEST
    cursor: str | None = None
    limit: int = 100

    def fingerprint(self) -> str:
        key = json.dumps([self.scope, self.tab, self.authority, self.q, self.sort])
        return hashlib.sha256(key.encode()).hexdigest()[:16]


@dataclass
class SideFacts:
    status: str
    round_no: int | None
    next_round_no: int | None
    editable: bool
    reviewable: bool


@dataclass
class RowFacts:
    village_id: int
    village_code: str | None
    village_name: str | None
    site_id: int
    site_code: str | None
    work_item_id: int
    province_name: str | None
    contractor_name: str | None
    requested_technologies: list[str]
    dt_date: date | None
    days_waiting: int | None
    long_wait: bool
    refiling_round: int | None
    sides: dict[str, SideFacts] = field(default_factory=dict)


@dataclass
class ListResult:
    view: str
    read_only: bool
    tabs: list[tuple[str, int]]
    totals_kind: str
    totals: dict[str, int]
    total: int
    rows: list[RowFacts]
    next_cursor: str | None


# --------------------------------------------------------------------------
# The population
# --------------------------------------------------------------------------
def side_columns(authority: str | None) -> tuple[ColumnElement, ...]:
    if authority == "ICT":
        return (Village.ict_status,)
    if authority == "CRA":
        return (Village.cra_status,)
    return (Village.ict_status, Village.cra_status)


def _search_clause(q: str) -> ColumnElement[bool]:
    pattern = f"%{to_latin(q).strip()}%"
    return or_(
        Village.village_name.ilike(pattern),
        Village.village_code.ilike(pattern),
        Site.site_code.ilike(pattern),
    )


def base_select(db: Session, user: User, *, scope: str, q: str | None = None) -> Select:
    """Every village this user may see in ``scope``, matching ``q``."""
    stmt = (
        select(Village.id)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(
            Village.work_item_id.in_(visible_work_item_ids(user, db)),
            scope_clause(db, scope),
        )
    )
    if q and q.strip():
        stmt = stmt.where(_search_clause(q))
    return stmt


def _waiting_since() -> ColumnElement:
    """When a village's acceptance last moved, else its drive-test date.

    The same clock as ``acceptance_workflow.last_activity`` / ``dt_age_days``:
    an untouched village is measured from its drive test, so it never sorts
    as fresh.
    """
    activity = (
        select(
            func.max(
                func.coalesce(
                    AcceptanceSubmission.reviewed_at, AcceptanceSubmission.submitted_at
                )
            )
        )
        .where(AcceptanceSubmission.village_id == Village.id)
        .correlate(Village)
        .scalar_subquery()
    )
    return func.coalesce(activity, WorkItem.dt_date_gregorian)


def _ordering(sort: str) -> tuple:
    if sort == SORT_NAME:
        return (Village.village_name.asc(), Village.id.asc())
    since = _waiting_since()
    if sort == SORT_SHORTEST:
        return (since.desc().nulls_last(), Village.id.desc())
    return (since.asc().nulls_last(), Village.id.asc())


# --------------------------------------------------------------------------
# Cursor
# --------------------------------------------------------------------------
def encode_cursor(request: ListRequest, offset: int) -> str:
    raw = json.dumps({"o": offset, "f": request.fingerprint()}).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(request: ListRequest) -> int:
    if not request.cursor:
        return 0
    try:
        padded = request.cursor + "=" * (-len(request.cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        offset = int(data["o"])
        if data["f"] != request.fingerprint() or offset < 0:
            raise ValueError
    except (ValueError, KeyError, TypeError, binascii.Error, json.JSONDecodeError):
        raise QueryError("This page link no longer matches the list", "invalid_cursor") from None
    return offset


# --------------------------------------------------------------------------
# Counts
# --------------------------------------------------------------------------
def _counts(
    db: Session, base: Select, view: str, tabs: tuple[str, ...], authority: str | None
) -> tuple[dict[str, int], dict[str, int]]:
    """Every tab's count and both authority totals, in one aggregate over
    exactly the rows :func:`base_select` lists."""
    population = base.with_only_columns(
        Village.id, Village.ict_status, Village.cra_status
    ).subquery()
    tab_counts = [
        func.count()
        .filter(S.tab_clause(tab, _subquery_sides(population, authority)))
        .label(tab)
        for tab in tabs
    ]
    totals = [
        func.count()
        .filter(S.totals_clause(view, _subquery_sides(population, a)[0]))
        .label(a)
        for a in AUTHORITIES
    ]
    row = db.execute(select(*tab_counts, *totals).select_from(population)).one()._mapping
    return {t: int(row[t]) for t in tabs}, {a: int(row[a]) for a in AUTHORITIES}


def _subquery_sides(population, authority: str | None) -> tuple[ColumnElement, ...]:
    if authority == "ICT":
        return (population.c.ict_status,)
    if authority == "CRA":
        return (population.c.cra_status,)
    return (population.c.ict_status, population.c.cra_status)


# --------------------------------------------------------------------------
# Rows
# --------------------------------------------------------------------------
def _round_facts(db: Session, village_ids: list[int]) -> tuple[dict, dict]:
    """Per (village, authority): the latest round number, and who filed the
    pending round when there is one."""
    latest: dict[tuple[int, str], int] = {}
    pending_by: dict[tuple[int, str], int | None] = {}
    if not village_ids:
        return latest, pending_by
    rows = db.execute(
        select(
            AcceptanceSubmission.village_id,
            AcceptanceSubmission.authority,
            AcceptanceSubmission.round_no,
            AcceptanceSubmission.review_status,
            AcceptanceSubmission.submitted_by,
        ).where(AcceptanceSubmission.village_id.in_(village_ids))
    ).all()
    for village_id, authority, round_no, status, submitted_by in rows:
        key = (village_id, authority)
        latest[key] = max(latest.get(key, 0), round_no)
        if status == REVIEW_PENDING:
            pending_by[key] = submitted_by
    return latest, pending_by


def side_facts(
    status: str,
    latest_round: int | None,
    pending_by: int | None,
    *,
    viewer: User,
) -> SideFacts:
    """What one side lets this viewer do. Shared by the list and the detail."""
    read_only = S.is_read_only(viewer.role.name)
    editable = not read_only and status in S.EDITABLE
    reviewable = (
        status == S.FILLED
        and S.decides_directly(viewer.role.name)
        and pending_by != viewer.id
    )
    return SideFacts(
        status=status,
        round_no=latest_round,
        next_round_no=((latest_round or 0) + 1) if status in S.EDITABLE else None,
        editable=editable,
        reviewable=reviewable,
    )


def refiling_round(sides: dict[str, SideFacts]) -> int | None:
    """The "Round N" tag: the highest round a side is being filed again as."""
    rounds = [
        s.next_round_no
        for s in sides.values()
        if s.status in S.REFILING and s.next_round_no
    ]
    return max(rounds) if rounds else None


def _days(since) -> int | None:
    if since is None:
        return None
    if isinstance(since, datetime):
        return flow.days_since(since)
    return max((datetime.now(timezone.utc).date() - since).days, 0)


def _rows(db: Session, village_ids: list[int], viewer: User) -> list[RowFacts]:
    if not village_ids:
        return []
    records = db.execute(
        select(
            Village.id, Village.village_code, Village.village_name,
            Village.ict_status, Village.cra_status,
            Site.id, Site.site_code, WorkItem.id, Province.name,
            Contractor.name, WorkItem.requested_technology, WorkItem.dt_date_gregorian,
        )
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .outerjoin(Contractor, WorkItem.dt_sc_contractor_id == Contractor.id)
        .where(Village.id.in_(village_ids))
    ).all()
    by_id = {r[0]: r for r in records}
    latest, pending_by = _round_facts(db, village_ids)
    activity = flow.last_activity(db, village_ids)

    rows = []
    for village_id in village_ids:
        (vid, code, name, ict, cra, site_id, site_code, wi_id, province,
         contractor, requested, dt_date) = by_id[village_id]
        sides = {
            authority: side_facts(
                S.display_status(stored),
                latest.get((vid, authority)),
                pending_by.get((vid, authority)),
                viewer=viewer,
            )
            for authority, stored in (("ICT", ict), ("CRA", cra))
        }
        days = _days(activity.get(vid) or dt_date)
        rows.append(RowFacts(
            village_id=vid, village_code=code, village_name=name,
            site_id=site_id, site_code=site_code, work_item_id=wi_id,
            province_name=province, contractor_name=contractor,
            requested_technologies=parse_technologies(requested),
            dt_date=dt_date, days_waiting=days,
            long_wait=days is not None and days >= S.LONG_WAIT_DAYS,
            refiling_round=refiling_round(sides), sides=sides,
        ))
    return rows


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
def list_my_work(db: Session, user: User, request: ListRequest) -> ListResult:
    view = S.view_for(user.role.name)
    tabs = S.tabs_for(view, universe=request.scope == SCOPE_UNIVERSE)
    if request.tab not in tabs:
        raise QueryError(f"tab must be one of {', '.join(tabs)}", "invalid_tab")
    if request.sort not in SORTS:
        raise QueryError(f"sort must be one of {', '.join(SORTS)}", "invalid_sort")
    if request.authority not in (None, *AUTHORITIES):
        raise QueryError("authority must be ICT or CRA", "invalid_authority")
    if not 0 <= request.limit <= MAX_LIMIT:
        raise QueryError(f"limit must be 0 to {MAX_LIMIT}", "invalid_limit")
    offset = decode_cursor(request)

    base = base_select(db, user, scope=request.scope, q=request.q)
    counts, totals = _counts(db, base, view, tabs, request.authority)

    rows: list[RowFacts] = []
    next_cursor = None
    if request.limit:
        stmt = (
            base.where(S.tab_clause(request.tab, side_columns(request.authority)))
            .order_by(*_ordering(request.sort))
            .offset(offset)
            .limit(request.limit + 1)
        )
        ids = list(db.execute(stmt).scalars())
        if len(ids) > request.limit:
            ids = ids[: request.limit]
            next_cursor = encode_cursor(request, offset + request.limit)
        rows = _rows(db, ids, user)

    return ListResult(
        view=view,
        read_only=S.is_read_only(user.role.name),
        tabs=[(t, counts[t]) for t in tabs],
        totals_kind=S.totals_kind(view),
        totals=totals,
        total=counts[request.tab],
        rows=rows,
        next_cursor=next_cursor,
    )
