"""Contractor monthly plan (PIP): one committed count per stream per month.

A contractor's coordinator submits a single number for a Shamsi month and a
stream — how many drive tests (``DT``) or how many sites accepted
(``ACCEPTANCE``) that contractor commits to. A PM approves it, or returns it
with a comment. Once approved it locks and becomes that contractor's target
for the month. The two streams are separate plans: each has its own versions,
its own status and its own PM decision.

Three shape decisions are worth stating, because each of them is the reason a
more obvious design was not used:

**One number, not a list.** Not a set of site codes, not a split by province or
technology. The commitment being made is a volume, and modelling it as a
selection of sites would make it a plan of *which* sites — a different promise,
and one nobody is in a position to make on day three of the month.

**One plan per contractor per month, not per user.** A contractor company may
hold several accounts. A second account opening the month's plan edits the one
that is already there; it never starts a competing one. The key is
``contractor_id``, deliberately, and ``submitted_by`` records which of that
company's people last handed it in.

**Approved rows are immutable, and revision appends.** A contractor asks to
revise an approved plan by writing a *new row* at ``version = previous + 1``
with status ``RevisionRequested``; the approved figure and who approved it
survive exactly as decided. This is the same append-only principle the
acceptance rounds use, and for the same reason — a target that can be edited
after the fact is not a target anyone can be held to.

**``is_current`` is the latest version; "in force" is the latest approved
one.** They differ while a revision is pending or after one was returned: the
request is the current row, and the number the contractor is measured against
is still the last version a PM approved. ``services/monthly_plan.in_force_plan``
is the one definition of "in force", and every reader of the PIP uses it.

``is_current`` is enforced in the service layer rather than by a partial unique
index. The test suite builds its database on SQLite, whose handling of partial
indexes differs from PostgreSQL's, so an index that reads as a guarantee in
production would be untested where the tests actually run. See
``services/monthly_plan.py``, which is the only thing that writes this table,
and the test that proves one current row survives a revision.
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# ---------------------------------------------------------------------------
# Statuses
# ---------------------------------------------------------------------------
#: Being written by the contractor. Not yet anybody else's business.
STATUS_DRAFT = "Draft"
#: Handed in. The PM owes a decision.
STATUS_SUBMITTED = "Submitted"
#: The PM sent it back with a comment. The contractor owes a resubmission,
#: which reuses the same version — being returned is part of one round, not a
#: new one.
STATUS_RETURNED = "Returned"
#: Locked. The number is the contractor's target for the month.
STATUS_APPROVED = "Approved"
#: The contractor asked to change an approved number. The PM owes a decision;
#: until it is approved, the previous approved version stays in force.
STATUS_REVISION_REQUESTED = "RevisionRequested"
#: The PM turned the revision down, with a comment. Final for this version:
#: the previous approved version stays in force, and the contractor may ask
#: again (as a new version) while the revision window is open.
STATUS_REVISION_RETURNED = "RevisionReturned"

PLAN_STATUSES: tuple[str, ...] = (
    STATUS_DRAFT,
    STATUS_SUBMITTED,
    STATUS_RETURNED,
    STATUS_APPROVED,
    STATUS_REVISION_REQUESTED,
    STATUS_REVISION_RETURNED,
)

# ---------------------------------------------------------------------------
# Streams
# ---------------------------------------------------------------------------
#: Counted in drive tests. Every plan filed before streams existed is this one.
STREAM_DT = "DT"
#: Counted in sites accepted.
STREAM_ACCEPTANCE = "ACCEPTANCE"

PLAN_STREAMS: tuple[str, ...] = (STREAM_DT, STREAM_ACCEPTANCE)

# ---------------------------------------------------------------------------
# Revision reasons
# ---------------------------------------------------------------------------
REASON_SITES_BLOCKED = "SITES_BLOCKED"
REASON_SCOPE_CHANGE = "SCOPE_CHANGE"
REASON_PERMITS = "PERMITS"
#: Requires a comment saying what the reason is.
REASON_OTHER = "OTHER"

REVISION_REASONS: tuple[str, ...] = (
    REASON_SITES_BLOCKED,
    REASON_SCOPE_CHANGE,
    REASON_PERMITS,
    REASON_OTHER,
)


class ContractorMonthlyPlan(Base):
    """One contractor's committed count for one stream and one Shamsi month."""

    __tablename__ = "contractor_monthly_plans"
    __table_args__ = (
        # A version number is only meaningful within one contractor's stream
        # and month, and two rows claiming the same one would make "which is
        # version 2" unanswerable. This is the constraint the
        # append-on-revision rule rests on.
        UniqueConstraint(
            "contractor_id",
            "stream",
            "shamsi_year",
            "shamsi_month",
            "version",
            name="uq_plan_contractor_stream_period_version",
        ),
        # How every read of this table starts: one contractor's month in one
        # stream, or the PM's queue for a month across all contractors.
        Index(
            "ix_plan_contractor_stream_period",
            "contractor_id",
            "stream",
            "shamsi_year",
            "shamsi_month",
        ),
        Index("ix_plan_period", "shamsi_year", "shamsi_month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id"), nullable=False, index=True
    )

    #: ``DT`` or ``ACCEPTANCE``. One plan per contractor, per stream, per
    #: month; the two streams never share a version sequence.
    stream: Mapped[str] = mapped_column(
        String(20), default=STREAM_DT, server_default=STREAM_DT, nullable=False
    )

    shamsi_year: Mapped[int] = mapped_column(Integer, nullable=False)
    shamsi_month: Mapped[int] = mapped_column(Integer, nullable=False)

    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    #: The latest version for this contractor, stream and month. Exactly one
    #: row per (contractor, stream, month) carries it;
    #: ``services/monthly_plan.py`` is what keeps that true. Not the same as
    #: "in force" -- see the module docstring.
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    #: Nullable while the plan is a draft — an SC may open the month's plan
    #: before they know the number. Required, and non-negative, on submit.
    committed_count: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[str] = mapped_column(
        String(20), default=STATUS_DRAFT, nullable=False, index=True
    )

    #: Reserved for the automatic figure applied when nobody submits by the
    #: deadline. There is no scheduler in this system, so nothing sets this
    #: today and it is always false; the column exists now so that building
    #: that automation later is not a second migration of this table.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    #: Which of the contractor's accounts last handed this version in. The
    #: plan belongs to the company; this says who acted for it.
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: The PM who approved or returned this version, and when. Cleared on a
    #: resubmission, because a row awaiting a decision has not had one; who
    #: returned it and when stays in the audit log.
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: Why the PM sent it back. Required when returning, and kept across the
    #: resubmission — it is what the contractor is answering, and what the PM
    #: reads next to the new number.
    return_comment: Mapped[str | None] = mapped_column(Text)

    #: Set only on a ``RevisionRequested`` row: why the contractor wants the
    #: approved number changed. One of :data:`REVISION_REASONS`.
    revision_reason: Mapped[str | None] = mapped_column(String(20))
    #: The contractor's own words on the request. Required when the reason is
    #: ``OTHER``, optional otherwise.
    revision_comment: Mapped[str | None] = mapped_column(Text)

    contractor = relationship("Contractor")
