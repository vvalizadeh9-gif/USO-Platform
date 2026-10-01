"""Which villages My Work lists: the two scopes, each with its SQL twin.

``universe``
    The Acceptance dashboard's universe, unchanged
    (``acceptance_universe.in_dt_done_universe``): هدف, drive test Done, not
    deleted. A dashboard figure links in with this scope, so the list it opens
    holds exactly the villages the figure counted.

``remaining``
    What is still work: the universe, **on air**, and ICT or CRA (or both)
    not yet approved. The sidebar opens this one.

On air is ``cpm_columns.is_onair_stage``. In SQL it is applied the way the KPI
and Gaps pages already apply it (``kpi.onair_values``): the distinct
``last_stage`` values are read, the Python rule picks the on-air ones, and the
query filters on that list -- the same rule over values rather than rows, so
the two readings cannot drift. ``tests/test_my_work_scope.py`` holds the
Python and SQL forms of both scopes to the same village ids.
"""
from __future__ import annotations

from sqlalchemy import ColumnElement, and_, or_
from sqlalchemy.orm import Session

from app.models.workitem import Village, WorkItem
from app.services import acceptance_universe as universe
from app.services import acceptance_workflow as flow
from app.services import cpm_columns as C
from app.services import kpi

SCOPE_REMAINING = "remaining"
SCOPE_UNIVERSE = "universe"
SCOPES = (SCOPE_REMAINING, SCOPE_UNIVERSE)


def is_on_air(work_item) -> bool:
    return C.is_onair_stage(work_item.last_stage)


def onair_clause(db: Session) -> ColumnElement[bool]:
    """:func:`is_on_air` as SQL. Expects ``WorkItem`` in the FROM clause."""
    return WorkItem.last_stage.in_(kpi.onair_values(db) or [""])


def _not_closed(village) -> bool:
    return not (
        village.ict_status == flow.STATUS_APPROVED
        and village.cra_status == flow.STATUS_APPROVED
    )


def _not_closed_clause() -> ColumnElement[bool]:
    return or_(
        Village.ict_status != flow.STATUS_APPROVED,
        Village.cra_status != flow.STATUS_APPROVED,
    )


def in_scope(scope: str, work_item, village) -> bool:
    """Is this village in ``scope``? Takes ORM objects or universe rows."""
    if work_item.deleted_at is not None:
        return False
    if not universe.in_dt_done_universe(work_item, village):
        return False
    if scope == SCOPE_UNIVERSE:
        return True
    return is_on_air(work_item) and _not_closed(village)


def scope_clause(db: Session, scope: str) -> ColumnElement[bool]:
    """:func:`in_scope` as SQL. Expects ``Village`` joined to ``WorkItem``."""
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {', '.join(SCOPES)}")
    base = universe.dt_done_universe(db)
    if scope == SCOPE_UNIVERSE:
        return base
    return and_(base, onair_clause(db), _not_closed_clause())
