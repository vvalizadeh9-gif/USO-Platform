"""SLA policies (UEP-15): one SLA in days per workflow step, and their history.

Every page, count, report and the digest reads SLAs from ``sla_policy`` through
``services/sla_policy``; the PM changes a value on Admin > SLA policies and it
applies on the next read. ``sla_policy_history`` holds one row per step per
change, grouped by ``change_id``, so a change can be shown and reverted whole.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SlaPolicy(Base):
    __tablename__ = "sla_policy"
    __table_args__ = (
        CheckConstraint("days >= 1 AND days <= 365", name="ck_sla_policy_days"),
    )

    step_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # ``updated_at`` (when the value last changed) comes from Base.


class SlaPolicyHistory(Base):
    __tablename__ = "sla_policy_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    change_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    step_key: Mapped[str] = mapped_column(String(80), nullable=False)
    old_days: Mapped[int | None] = mapped_column(Integer)
    new_days: Mapped[int] = mapped_column(Integer, nullable=False)
    #: NULL for the System entry the migration writes.
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
