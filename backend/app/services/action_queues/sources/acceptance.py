"""ICT and CRA queues, as pending items -- one My Work tab, one authority each.

Each queue is My Work's own population (``my_work_query.base_select``, scope
"remaining") narrowed by the tab predicate My Work itself applies, so the
ticket and the tab it opens are the same select. The clock is My Work's
waiting clock for that one side, except for "with authority", which runs from
the unanswered request letter.

For staff, an item belongs to the drive-test contractor on the site (the
contractor My Work shows on the row); with none, to the province's
coordinator. On a contractor's own board every item is theirs.
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


def my_work_url(authority: str, tab: str) -> str:
    return f"/my-work?authority={authority}&tab={tab}"


def _items(
    ctx: QueueContext, authority: str, tab: str, since: ColumnElement, *, contractor_owns: bool
) -> list[PendingItem]:
    stmt = (
        query.base_select(ctx.db, ctx.user, scope=SCOPE_REMAINING)
        .where(query.tab_predicate(tab, authority))
        .with_only_columns(Village.id, Village.work_item_id, WorkItem.dt_sc_contractor_id, since)
    )
    rows = ctx.db.execute(stmt).all()
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
