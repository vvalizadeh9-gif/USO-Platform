"""Roles Performance: the first time an entity was seen in a status.

CPM overwrites ``work_items.last_stage`` on every import and keeps no history,
so "when did this site go on air" can only be answered from the launch-date
columns CPM carries -- and some rows carry neither. This table is the fallback
for those rows: the CPM import writes one row the first time it sees a site
or village on air, dated by that import.

It is not the primary on-air date. ``services/performance/facts.py`` reads the
launch date first and only falls back to this table, because a launch date is
real history and "first seen by an import" can only ever start on the day this
table was created.

``backfilled`` marks the rows written by the very first run, which saw every
already-on-air entity at once. Their ``first_seen_at`` is the day the table
was created, not an on-air date, so they never feed a monthly flow.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

ENTITY_SITE = "site"
ENTITY_VILLAGE = "village"
STATUS_ON_AIR = "on_air"


class LifecycleStatusHistory(Base):
    """One entity's first sighting in one status. Append-only."""

    __tablename__ = "lifecycle_status_history"
    __table_args__ = (
        UniqueConstraint(
            "entity_type", "entity_id", "status", name="uq_lifecycle_status_first"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    #: ``site`` (a work item) or ``village``.
    entity_type: Mapped[str] = mapped_column(String(10), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cpm_import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("cpm_import_batches.id")
    )
    backfilled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
