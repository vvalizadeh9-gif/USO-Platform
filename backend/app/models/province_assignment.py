"""Province assignments (UEP-17): who coordinates each CRA region, over time.

The current owner is not stored here. It lives where every screen already reads
it -- ``provinces.coordinator_user_id``, the open ``province_mapping`` rows and
the coordinators' province grants -- and ``services/province_assignment`` keeps
the three in step. This table is the record of who held what: one row per
region per change, grouped by ``change_id`` so a change can be shown and
reverted whole.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ProvinceAssignmentHistory(Base):
    __tablename__ = "province_assignment_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    change_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    cra_region: Mapped[str] = mapped_column(String(60), nullable=False)
    old_coordinator_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    new_coordinator_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    #: NULL for the System entry the migration writes.
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
