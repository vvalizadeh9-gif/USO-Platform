"""Action Center tables: per-queue SLA, the daily snapshot, the digest log.

The queues themselves are never stored -- they are reads over live state (see
``services/action_queues``). These three tables hold only what live state
cannot answer:

* ``action_queue_sla``      how many days each queue's items may wait, so an
                            SLA changes without a deploy;
* ``action_daily_snapshot`` what each user's board read on a given day, for
                            day-over-day history and the email;
* ``digest_log``            one row per user per day, which is what makes the
                            digest send at most once even if the job runs twice.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

#: The SLA a queue has until an administrator sets another.
DEFAULT_SLA_DAYS = 14

# Digest outcomes. ``sending`` is the claim a run takes before it talks to the
# mail server; a row left in it means the run died mid-send.
DIGEST_SENDING = "sending"
DIGEST_SENT = "sent"
DIGEST_FAILED = "failed"
DIGEST_SKIPPED_OPTED_OUT = "skipped_opted_out"
DIGEST_SKIPPED_NO_EMAIL = "skipped_no_email"
DIGEST_SKIPPED_EMPTY = "skipped_empty"


class ActionQueueSla(Base):
    """How long one queue's items may wait before they read as overdue.

    A missing row means :data:`DEFAULT_SLA_DAYS`; rows are written only when an
    administrator changes a value, so a new queue needs no migration.
    """

    __tablename__ = "action_queue_sla"

    queue_key: Mapped[str] = mapped_column(String(50), primary_key=True)
    sla_days: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_SLA_DAYS, nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class ActionDailySnapshot(Base):
    """One queue on one user's board, as it read on one day."""

    __tablename__ = "action_daily_snapshot"
    __table_args__ = (
        UniqueConstraint(
            "snapshot_date", "user_id", "queue_key", name="uq_action_snapshot_day"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    queue_key: Mapped[str] = mapped_column(String(50), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    overdue: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Items turning late within Home's due-soon window. NULL on rows from
    #: before the column existed: not known, rather than none.
    due_soon: Mapped[int | None] = mapped_column(Integer)


class DigestLog(Base):
    """The one digest a user gets on one day, and how sending it went."""

    __tablename__ = "digest_log"
    __table_args__ = (
        UniqueConstraint("user_id", "digest_date", name="uq_digest_user_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    digest_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
