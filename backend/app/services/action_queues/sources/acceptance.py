"""ICT and CRA queues, as pending items -- one My Work tab, one authority each.

Each queue is My Work's own population (``my_work_query.base_select``, scope
"remaining") narrowed by the tab predicate My Work itself applies, so the
ticket and the tab it opens are the same select. The clock is My Work's
waiting clock for that one side, except for "with authority", which runs from
the unanswered request letter.

For staff, an item belongs to the drive-test contractor on the site (the
contractor My Work shows on the row); with none, to the province's
coordinator. On a contractor's own board every item is theirs.

Home's two headline queues, *Pending ICT* and *Pending CRA*
(:func:`not_approved`), are the same population -- My Work's "remaining"
scope: هدف, drive test Done, on air -- narrowed to villages whose side is not
yet approved, and counted once per village (see :func:`one_per_village`).
"""
from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import ColumnElement

from app.models.workitem import Village, WorkItem
from app.services import acceptance_requests as requests
from app.services import my_work_query as query
from app.services import my_work_status as S
from app.services.action_queues.context import QueueContext
from app.services.action_queues.types import PendingItem
from app.services.my_work_scope import SCOPE_REMAINING


def my_work_url(authority: str, tab: str | None = None) -> str:
    """My Work for one authority; without a tab, the viewer's default tab."""
    url = f"/my-work?authority={authority}"
    return f"{url}&tab={tab}" if tab else url


def _owned(
    ctx: QueueContext, rows: list[tuple], *, contractor_owns: bool
) -> list[PendingItem]:
    """``(village id, work item id, contractor id, started_at)`` rows as items."""
    if ctx.is_contractor:
        # Everything My Work shows a contractor is theirs to act on -- the
        # platform's own rule (their CPM sites and any site they were assigned).
        me = ctx.contractor(ctx.user.contractor_id)
        return [PendingItem(village_id, started_at, owner=me) for village_id, *_, started_at in rows]
    coordinators = ctx.coordinators_for([r[1] for r in rows])
    return [
        PendingItem(
            village_id, started_at,
            owner=(ctx.contractor(contractor_id) if contractor_owns else None)
            or coordinators.get(work_item_id),
        )
        for village_id, work_item_id, contractor_id, started_at in rows
    ]


def _items(
    ctx: QueueContext, authority: str, tab: str, since: ColumnElement, *, contractor_owns: bool
) -> list[PendingItem]:
    stmt = (
        query.base_select(ctx.db, ctx.user, scope=SCOPE_REMAINING)
        .where(query.tab_predicate(tab, authority))
        .with_only_columns(Village.id, Village.work_item_id, WorkItem.dt_sc_contractor_id, since)
    )
    return _owned(ctx, ctx.db.execute(stmt).all(), contractor_owns=contractor_owns)


def one_per_village(rows: list[tuple]) -> list[tuple]:
    """One row per village: a site, its site type and the village code.

    A work item is one site and site type (``uq_site_type``), so the key is the
    work item and the village code. CPM can list a village once per technology
    (3G and 4G) on the same site; those rows are one village to accept. The
    lowest village id stands for the rest, so the pick never changes between
    reads. Rows are ``(village id, work item id, village code, ...)``.
    """
    seen: set[tuple] = set()
    kept = []
    for row in sorted(rows, key=lambda r: r[0]):
        village_id, work_item_id, code = row[0], row[1], row[2]
        key = (work_item_id, code.strip().upper()) if code and code.strip() else ("id", village_id)
        if key not in seen:
            seen.add(key)
            kept.append(row)
    return kept


def not_approved(authority: str) -> Callable[[QueueContext], list[PendingItem]]:
    """Villages in the acceptance universe whose ``authority`` side is not
    approved, once per village, timed by that side's own waiting clock."""
    side = query.side_columns(authority)[0]

    def fetch(ctx: QueueContext) -> list[PendingItem]:
        stmt = (
            query.base_select(ctx.db, ctx.user, scope=SCOPE_REMAINING)
            .where(side != S.stored_status(S.APPROVED))
            .with_only_columns(
                Village.id, Village.work_item_id, Village.village_code,
                WorkItem.dt_sc_contractor_id, query.waiting_since(authority),
            )
        )
        rows = [(vid, wid, cid, since) for vid, wid, _code, cid, since
                in one_per_village(ctx.db.execute(stmt).all())]
        return _owned(ctx, rows, contractor_owns=True)

    fetch.__name__ = f"{authority.lower()}_not_approved"
    return fetch


def queue(authority: str, tab: str, *, contractor_owns: bool) -> Callable[[QueueContext], list[PendingItem]]:
    """The fetch for one authority's view of one My Work tab."""
    def fetch(ctx: QueueContext) -> list[PendingItem]:
        since = (
            requests.open_since(Village.id, (authority,))
            if tab == S.TAB_WITH_AUTHORITY
            else query.waiting_since(authority)
        )
        return _items(ctx, authority, tab, since, contractor_owns=contractor_owns)

    fetch.__name__ = f"{authority.lower()}_{tab}"
    return fetch
