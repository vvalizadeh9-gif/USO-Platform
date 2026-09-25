"""Acceptance monthly target: the PM's programme-wide village-acceptance plan.

A PM sets, once per Shamsi month, how many villages the programme should have
fully accepted -- ICT **and** CRA, cumulatively, by the end of that month.
Coordinators across every province work toward that single number; it is not
attributed to a contractor, a province or a technology, because full
acceptance is the one thing every one of them shares responsibility for.

This is deliberately a different shape from ``ContractorMonthlyPlan`` in
``monthly_plan.py``, even though the two tables sit side by side and share a
name pattern. That one is a per-contractor *drive-test volume commitment*,
submitted by a contractor and approved by a PM every month. This one is a
programme-wide *acceptance target*, set unilaterally by a PM with nobody to
submit it and nobody to approve it -- there is no workflow here, only a
number and who set it.

Two shape decisions are worth stating, because each is the reason a more
obvious design was not used:

**Cumulative, not a monthly delta.** ``target_count`` means "by the end of
this month, this many villages total should be fully accepted" rather than
"this many new villages this month". A programme target is almost always
phrased that way -- "1,200 villages accepted by the end of مهر" -- and a
cumulative figure is also the one that can be plotted directly against the
cumulative acceptance trend this feature computes, with no further
arithmetic on either side.

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
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AcceptanceMonthlyTarget(Base):
    """One version of the programme's cumulative acceptance target for one
    Shamsi month."""

    __tablename__ = "acceptance_monthly_targets"
    __table_args__ = (
        # A version number is only meaningful within one month, and two rows
        # claiming the same one would make "which is version 2" unanswerable
        # -- the constraint the append-on-revision rule rests on.
        UniqueConstraint(
            "shamsi_year", "shamsi_month", "version",
            name="uq_acceptance_target_period_version",
        ),
        # How every read of this table starts: one month's current target, or
        # the trend's month-by-month lookup.
        Index("ix_acceptance_target_period", "shamsi_year", "shamsi_month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    shamsi_year: Mapped[int] = mapped_column(Integer, nullable=False)
    shamsi_month: Mapped[int] = mapped_column(Integer, nullable=False)

    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    #: The live version for this month. Exactly one row per month carries it;
    #: ``services/acceptance_plan.py`` is what keeps that true.
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    #: Cumulative: how many villages should be fully accepted by the end of
    #: this month, counting everything accepted before it too. Validated
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
