"""Home's acceptance queues, read from the acceptance cases (UEP-22 §5.7).

Each queue is a predicate in ``acceptance_cases.counts.HOME_QUEUES`` over the
viewer's open cases -- the inbox's own rows -- so a Home row, the rail badge
and the Filing tab it opens show one number. The clock is days in basket.
"""
from __future__ import annotations

from collections.abc import Callable

from app.services.acceptance_cases import counts
from app.services.acceptance_cases.scope import CaseRow, viewer_kind
from app.services.acceptance_cases.sync import at_noon
from app.services.action_queues.context import QueueContext
from app.services.action_queues.types import OwnerRef, PendingItem

FILING_URL = "/filing"


def filing_url(authority: str | None = None, tab: str | None = None) -> str:
    params = [p for p in (f"authority={authority}" if authority else None, f"tab={tab}" if tab else None) if p]
    return f"{FILING_URL}?{'&'.join(params)}" if params else FILING_URL


def _rows(ctx: QueueContext) -> list[CaseRow]:
    """The viewer's open cases, read once per Home build."""
    cached = getattr(ctx, "_acceptance_case_rows", None)
    if cached is None:
        cached = counts.open_cases(ctx.db, ctx.user, counts.clock(ctx.db)) if _has_scope(ctx) else []
        ctx._acceptance_case_rows = cached
    return cached


def _has_scope(ctx: QueueContext) -> bool:
    return viewer_kind(ctx.user) is not None


def _owner(ctx: QueueContext, row: CaseRow) -> OwnerRef | None:
    if row.state == "waiting" or row.basket_role == "Contractor":
        return ctx.contractor(row.contractor_id)
    if row.basket_owner:
        return OwnerRef("category", None, row.basket_owner)
    return None


def queue(key: str) -> Callable[[QueueContext], list[PendingItem]]:
    test = counts.HOME_QUEUES[key]

    def fetch(ctx: QueueContext) -> list[PendingItem]:
        return [
            PendingItem(r.case_id, at_noon(r.state_since), owner=_owner(ctx, r))
            for r in _rows(ctx) if test(r)
        ]

    fetch.__name__ = f"cases_{key}"
    return fetch


def meta(ctx: QueueContext, key: str) -> dict:
    """"{n} over SLA · {n} no comment" for a Home row."""
    test = counts.HOME_QUEUES[key]
    return counts.summary(r for r in _rows(ctx) if test(r))
