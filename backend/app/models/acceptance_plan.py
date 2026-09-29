"""MTN internal target: the PM's own monthly number, per stream.

A PM sets, once per Shamsi month and per stream, what MTN commits to
management for that month:

* ``ACCEPTANCE`` -- villages to become fully accepted (ICT **and** CRA) in
  that month;
* ``ICT`` / ``CRA`` -- villages to be approved by that one authority in that
  month;
* ``DT`` -- drive tests to be delivered in that month.

The UI calls this number the **Internal PIP**.

Both are **monthly amounts**, the same unit as a contractor's PIP and as
Delivered, so "internal target vs actual" and "internal target vs the
contractors' PIPs" are direct comparisons. A cumulative view (the plan's
running total) is derived when read, never stored.

This is deliberately a different table from ``ContractorMonthlyPlan`` in
``monthly_plan.py``. That one is a contractor's own commitment, submitted by
the contractor and approved by a PM. This one is MTN's internal number, set
unilaterally by a PM with nobody to submit it and nobody to approve it --
there is no workflow here, only a number and who set it. **It is staff-only:
no contractor ever reads it.** A contractor measures itself against its own
approved PIP instead.

Until revision ``c4f9a2e7d318`` the Acceptance target was cumulative
("1,200 villages accepted by the end of مهر"); that migration converted the
stored rows to monthly amounts and records the original in each row's note.

**Append-only, exactly like ``ContractorMonthlyPlan``.** Setting a new target
for a month that already has one does not edit the row: it inserts a new row
at ``version = previous + 1`` and flips the previous row's ``is_current`` to
False. A target that could be rewritten in place would let "what did we
commit to in مهر" change retroactively, which defeats the entire point of
having a target to measure against. ``is_current`` is enforced in the
service layer (``services/acceptance_plan.py``) rather than by a partial
unique index, for the same reason ``monthly_plan.py`` gives: the test suite
builds its database on SQLite, whose handling of partial indexes differs
from PostgreSQL's, so a guarantee expressed only as an index would be
untested where the tests actually run.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.monthly_plan import (
    PLAN_STREAMS,
    STREAM_ACCEPTANCE,
    STREAM_CRA,
    STREAM_DT,
    STREAM_ICT,
)

#: Which target a row is. The same names the contractors' PIPs use
#: (``models/monthly_plan.py``), re-exported so callers of this module need
#: not reach into that one.
TARGET_STREAMS: tuple[str, ...] = PLAN_STREAMS
__all__ = [
    "AcceptanceMonthlyTarget",
    "STREAM_ACCEPTANCE",
    "STREAM_CRA",
    "STREAM_DT",
    "STREAM_ICT",
    "TARGET_STREAMS",
]


class AcceptanceMonthlyTarget(Base):
    """One version of one stream's MTN internal target for one Shamsi month."""

    __tablename__ = "acceptance_monthly_targets"
    __table_args__ = (
        # A version number is only meaningful within one month, and two rows
        # claiming the same one would make "which is version 2" unanswerable
        # -- the constraint the append-on-revision rule rests on.
        # Versions count per stream: a DT target and an Acceptance target
        # for the same month are independent histories.
        UniqueConstraint(
            "stream", "shamsi_year", "shamsi_month", "version",
            name="uq_internal_target_stream_period_version",
        ),
        # How every read of this table starts: one stream's current target
        # for a month, or the trend's month-by-month lookup.
        Index(
            "ix_internal_target_stream_period",
            "stream", "shamsi_year", "shamsi_month",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    #: One of :data:`TARGET_STREAMS`. Every row that predates streams is
    #: ``ACCEPTANCE``, the only target there was.
    stream: Mapped[str] = mapped_column(
        String(20),
        default=STREAM_ACCEPTANCE,
        server_default=STREAM_ACCEPTANCE,
        nullable=False,
    )

    shamsi_year: Mapped[int] = mapped_column(Integer, nullable=False)
    shamsi_month: Mapped[int] = mapped_column(Integer, nullable=False)

    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    #: The live version for this month. Exactly one row per month carries it;
    #: ``services/acceptance_plan.py`` is what keeps that true.
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    #: This month alone: villages fully accepted (ACCEPTANCE), approved by one
    #: authority (ICT, CRA) or drive tests delivered (DT). Validated
    #: non-negative at the service/schema layer, matching how
    #: ``committed_count`` is handled on ``ContractorMonthlyPlan``.
    target_count: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Who set this version. Always a PM in practice; nullable only for
    #: symmetry with the rest of this codebase's ORM pattern (see
    #: ``ContractorMonthlyPlan.submitted_by``), never actually null.
    set_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: Optional context for why the target changed -- most useful on a
    #: revision, where the number moved from what it was before.
    note: Mapped[str | None] = mapped_column(Text)
