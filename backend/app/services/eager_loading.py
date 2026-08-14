"""Shared eager-loading option for WorkItem -> Village -> Acceptance.

Villages/acceptances are NOT eager-loaded by default (see models/workitem.py)
because most endpoints never touch them. The handful of services that DO
need the full graph (dashboards, Drive Test analytics, work item detail,
Acceptance overview) import this one helper instead of repeating the
selectinload chain in four different places.
"""
from sqlalchemy.orm import selectinload

from app.models.workitem import Village, WorkItem


def with_villages_and_acceptances(stmt):
    """Attach the standard villages+acceptances eager-load to a WorkItem select."""
    return stmt.options(
        selectinload(WorkItem.villages).selectinload(Village.acceptances)
    )
