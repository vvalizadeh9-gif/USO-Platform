"""Acceptance, Letter, Notification, Audit and CPM import models."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Acceptance(Base):
    """Per village, per technology ICT & CRA approval status."""

    __tablename__ = "acceptances"
    __table_args__ = (
        UniqueConstraint("village_id", "technology", name="uq_village_tech"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), nullable=False, index=True)
    technology: Mapped[str] = mapped_column(String(10), nullable=False)  # 2G|3G|4G

    ict_status: Mapped[str] = mapped_column(
        String(10), default="Pending", nullable=False
    )  # Approved|Rejected|Pending
    ict_date: Mapped[date | None] = mapped_column(Date)

    cra_status: Mapped[str] = mapped_column(
        String(10), default="Pending", nullable=False
    )
    cra_date: Mapped[date | None] = mapped_column(Date)

    # Where each verdict came from: NULL or "CPM" for a value seeded from the
    # workbook, "App" once a coordinator has validated a submission for it.
    #
    # The CPM import already leaves a blank cell alone, and from the next
    # release the workbook carries no acceptance data at all, so in normal
    # operation these are never consulted. They exist for the abnormal case: a
    # stale non-blank cell in some future file must not be able to overwrite a
    # decision a coordinator made in the app, which is now the system of
    # record. Checking a column here rather than querying the submissions
    # keeps that guard O(1) across a fifteen-thousand-row import.
    ict_source: Mapped[str | None] = mapped_column(String(10))
    cra_source: Mapped[str | None] = mapped_column(String(10))

    village = relationship("Village", back_populates="acceptances")


# Many-to-many between letters and villages.
letter_villages = Table(
    "letter_villages",
    Base.metadata,
    Column("letter_id", Integer, ForeignKey("letters.id", ondelete="CASCADE"), primary_key=True),
    Column("village_id", Integer, ForeignKey("villages.id", ondelete="CASCADE"), primary_key=True),
)


class Letter(Base):
    __tablename__ = "letters"

    id: Mapped[int] = mapped_column(primary_key=True)
    letter_number: Mapped[str] = mapped_column(String(120), nullable=False)
    letter_date: Mapped[date | None] = mapped_column(Date)
    # ICT Province | ICT HQ | CRA Region | CRA HQ
    authority: Mapped[str] = mapped_column(String(30), nullable=False)
    province_id: Mapped[int | None] = mapped_column(ForeignKey("provinces.id"))
    attachment_path: Mapped[str | None] = mapped_column(String(500))
    comment: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    villages = relationship("Village", secondary=letter_villages, lazy="selectin")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    related_entity_type: Mapped[str | None] = mapped_column(String(50))
    related_entity_id: Mapped[int | None] = mapped_column(Integer)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AuditLog(Base):
    """One thing that happened, and everything needed to explain it later.

    Append-only. Nothing in the application updates or deletes a row, and no
    endpoint exposes a way to: the whole value of this table is that what it
    says today is what it will say in five years. The API offers reading and
    filtering and no more, and only to an administrator.

    The columns answer the questions an audit is actually made of -- who
    (``user_id``), what (``action``), to which record (``module``,
    ``entity_type``, ``entity_id``), when (``created_at``, from ``Base``), from
    where (``ip_address``), what changed (``old_value`` / ``new_value``) and
    whether it worked (``result``). ``reason`` carries the sentence a person
    would write, for the cases where the structured fields cannot say it.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        # The audit screen's two heaviest reads: a filtered page in reverse
        # time order, and one user's own history. Over a ten-year deployment
        # this is the fastest-growing table in the platform, so both get an
        # index rather than a sequential scan that gets slower every month.
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    # What happened, from the closed vocabulary in ``core/audit_actions.py``.
    # This used to be inferred by the frontend from the shape of ``new_value``
    # and the wording of ``reason``, which meant no event could be counted or
    # filtered, and any event nobody had written a branch for was described
    # wrongly.
    action: Mapped[str] = mapped_column(String(60), nullable=False, index=True)

    module: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    old_value: Mapped[dict | None] = mapped_column(JSONB)
    new_value: Mapped[dict | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))

    # "Success" or "Failure". A log that only records what succeeded cannot
    # show a failed sign-in, an attempt refused by a guard, or anything else
    # someone tried and could not do -- which is the first thing a reviewer
    # looks for.
    result: Mapped[str] = mapped_column(
        String(20), default="Success", nullable=False
    )


class MonthlySnapshot(Base):
    """Per-Shamsi-month snapshot of Drive Test KPIs, used for +/- deltas.

    One row per (year, month, province). ``province_id`` NULL means the
    global (all-provinces) snapshot. The UNIQUE constraint makes snapshot
    creation idempotent — re-running in the same month is a no-op.
    """

    __tablename__ = "monthly_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "shamsi_year", "shamsi_month", "province_id", name="uq_snapshot_period"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shamsi_year: Mapped[int] = mapped_column(Integer, nullable=False)
    shamsi_month: Mapped[int] = mapped_column(Integer, nullable=False)
    province_id: Mapped[int | None] = mapped_column(ForeignKey("provinces.id"))

    total_onair: Mapped[int] = mapped_column(Integer, default=0)
    total_dt_done: Mapped[int] = mapped_column(Integer, default=0)
    total_remaining: Mapped[int] = mapped_column(Integer, default=0)
    total_ongoing: Mapped[int] = mapped_column(Integer, default=0)
    total_problematic: Mapped[int] = mapped_column(Integer, default=0)
    current_month_dt_done: Mapped[int] = mapped_column(Integer, default=0)


class CpmImportBatch(Base):
    __tablename__ = "cpm_import_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    imported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    new_count: Mapped[int] = mapped_column(Integer, default=0)
    new_villages_count: Mapped[int] = mapped_column(Integer, default=0)
    changed_count: Mapped[int] = mapped_column(Integer, default=0)
    # Breakdown of changed_count by the three tracked change types, so the
    # import history can report each dedicated count separately.
    changed_village_qty: Mapped[int] = mapped_column(Integer, default=0)
    changed_site_type: Mapped[int] = mapped_column(Integer, default=0)
    changed_requested_tech: Mapped[int] = mapped_column(Integer, default=0)
    unchanged_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_satellite: Mapped[int] = mapped_column(Integer, default=0)

    change_requests: Mapped[list[CpmChangeRequest]] = relationship(
        back_populates="batch"
    )


class CpmChangeRequest(Base):
    __tablename__ = "cpm_change_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_batch_id: Mapped[int] = mapped_column(
        ForeignKey("cpm_import_batches.id"), nullable=False
    )
    work_item_id: Mapped[int | None] = mapped_column(ForeignKey("work_items.id"))
    site_code: Mapped[str] = mapped_column(String(50), nullable=False)
    # What kind of change this is: 'site_type' | 'village_qty' | 'requested_tech'.
    # Only these three are ever flagged for PM validation; everything else on a
    # monthly re-import is auto-applied silently.
    change_type: Mapped[str] = mapped_column(String(30), default="field", nullable=False)
    field_name: Mapped[str] = mapped_column(String(80), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    # Human-readable explanation (e.g. "2 villages added, 1 removed").
    detail: Mapped[str | None] = mapped_column(Text)
    # Serialized data needed to apply this change on Accept (for site_type and
    # village_qty changes, where the raw CPM row values must be re-applied).
    payload_json: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), default="Pending", nullable=False
    )  # Pending|Accepted|Ignored|Archived
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    batch: Mapped[CpmImportBatch] = relationship(back_populates="change_requests")
