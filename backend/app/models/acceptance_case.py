"""Acceptance cases (UEP-22): one ICT case and one CRA case per village.

A case is the Filing page's unit of work. It is always in exactly one of
three states, and an open case always sits in exactly one basket:

    waiting   the village's site contractor chases the authority
    rejected  the team named by the rejection category fixes it
    approved  done

``acceptance_case_events`` is the case's history, written by every save --
who, when, letter, file, comment -- so nobody has to keep a history by hand.

The verdict itself still lives where it always has: ``acceptances`` and the
submission rounds (``acceptance_workflow``). A case adds what those never
held -- whose basket it is in, since when, and the latest word on it.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

STATE_WAITING = "waiting"
STATE_REJECTED = "rejected"
STATE_APPROVED = "approved"
STATES = (STATE_WAITING, STATE_REJECTED, STATE_APPROVED)
OPEN_STATES = (STATE_WAITING, STATE_REJECTED)

#: The basket of a waiting case, and of a rejection in the Contractor
#: category: the village's site contractor (resolved from the work item).
BASKET_CONTRACTOR = "Contractor"
#: The Parked category's basket.
BASKET_PM = "PM"

EVENT_CREATED = "created"
EVENT_SUBMITTED = "submitted"
EVENT_APPROVED = "approved"
EVENT_REJECTED = "rejected"
EVENT_FIXED = "fixed"
EVENT_COMMENT = "comment"
EVENT_BASKET_CHANGED = "basket_changed"
EVENT_KINDS = (
    EVENT_CREATED, EVENT_SUBMITTED, EVENT_APPROVED, EVENT_REJECTED,
    EVENT_FIXED, EVENT_COMMENT, EVENT_BASKET_CHANGED,
)
#: The events that move a case; a comment never resets its clock.
STATUS_EVENTS = (EVENT_CREATED, EVENT_APPROVED, EVENT_REJECTED, EVENT_FIXED, EVENT_BASKET_CHANGED)


class AcceptanceRejectionCategory(Base):
    """Why an authority rejected, and so whose basket the case goes to.

    Master data: seeded by the migration, never hard-coded. ``basket_role``
    is a role name, or ``Contractor`` for the village's own site contractor.
    """

    __tablename__ = "acceptance_rejection_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(60), nullable=False)
    basket_role: Mapped[str] = mapped_column(String(50), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class AcceptanceCase(Base):
    """One village's ICT or CRA case."""

    __tablename__ = "acceptance_cases"
    __table_args__ = (
        UniqueConstraint("village_id", "authority", name="uq_acceptance_case_village_authority"),
        Index("ix_acceptance_cases_state_basket", "authority", "state", "basket_role"),
        CheckConstraint("authority IN ('ICT', 'CRA')", name="ck_acceptance_case_authority"),
        CheckConstraint("state IN ('waiting', 'rejected', 'approved')", name="ck_acceptance_case_state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), nullable=False, index=True)
    authority: Mapped[str] = mapped_column(String(10), nullable=False)  # ICT|CRA
    state: Mapped[str] = mapped_column(String(10), nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("acceptance_rejection_categories.id")
    )
    #: Who holds an open case: ``Contractor`` (the site contractor), ``PM``,
    #: or a team role. NULL for an approved case, and for a rejection that
    #: still needs its category (backfilled from before categories existed).
    basket_role: Mapped[str | None] = mapped_column(String(50))
    #: When the case entered its current state and basket.
    state_since: Mapped[date] = mapped_column(Date, nullable=False)
    #: The drive test's approval in the app; NULL for a legacy case.
    dt_approved_on: Mapped[date | None] = mapped_column(Date)
    #: No dates of its own: aged from the first CPM import.
    legacy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_comment_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    category: Mapped[AcceptanceRejectionCategory | None] = relationship()
    village = relationship("Village")


class AcceptanceCaseEvent(Base):
    """One thing that happened to a case. Append-only."""

    __tablename__ = "acceptance_case_events"
    __table_args__ = (
        Index("ix_acceptance_case_events_case", "case_id", "created_at"),
        Index("ix_acceptance_case_events_request", "request_id"),
        CheckConstraint(
            "kind IN ('created', 'submitted', 'approved', 'rejected', 'fixed', 'comment', 'basket_changed')",
            name="ck_acceptance_case_event_kind",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("acceptance_cases.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("acceptance_rejection_categories.id")
    )
    letter_no: Mapped[str | None] = mapped_column(String(120))
    letter_date: Mapped[date | None] = mapped_column(Date)
    evidence_id: Mapped[int | None] = mapped_column(ForeignKey("acceptance_evidence.id"))
    comment: Mapped[str | None] = mapped_column(Text)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    meta: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"))
    #: The client's id for one save, so a retried save is not applied twice.
    request_id: Mapped[str | None] = mapped_column(String(64))

    category: Mapped[AcceptanceRejectionCategory | None] = relationship()
