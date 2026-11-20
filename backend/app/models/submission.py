"""Submissions (UEP-21): what UEP sent to ICT HQ, batch by batch.

Every two weeks the team sends the villages whose drive test is done to ICT
HQ: an MTN letter with an 18-column Excel list. These tables are **UEP's own
record** of what went, and they are the source of truth for "was this village
sent". ICT HQ's Mojri tracker only ever *confirms* receipt; it runs about a
month late, so reading "not in Mojri" as "not sent" would send the same
village twice.

* ``submission_batches``  one MTN letter (draft, sent or cancelled), with the
  two optional onward letters (ICT HQ -> provinces + CRA, CRA HQ -> regions).
* ``submission_items``    one village in one batch. ``batch_id`` NULL is a
  village found in Mojri that UEP never sent ("sent outside UEP"). An item is
  *active* until it is superseded: a cancelled draft releases its items by
  superseding them, and "Send again" supersedes a sent item so the village is
  Ready once more. At most one active item per village (partial unique index).
* ``submission_letter_files``  the letter PDFs' metadata. The bytes go through
  ``services/evidence_store.py`` like every other upload: one storage path.
* ``submission_settings``  one row: who owns the routine (set by the PM).
* ``cpm_village_sightings``  every non-هدف village key a CPM file listed, the
  first time it was seen. Non-هدف rows never enter ``villages``, so this is the
  only memory that a village was once اقماری -- what tells "became هدف" (Ready,
  no new drive test) apart from "brand new" (a new drive test round).

Dates are Gregorian ``DATE`` columns; Shamsi is for display only.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

BATCH_DRAFT = "draft"
BATCH_SENT = "sent"
BATCH_CANCELLED = "cancelled"
BATCH_STATUSES = (BATCH_DRAFT, BATCH_SENT, BATCH_CANCELLED)

REASON_NEW_DT = "new_dt"
REASON_MISSED = "missed"
REASON_BECAME_TARGET = "became_target"
REASON_RESEND = "resend"
REASON_OUTSIDE = "outside"
REASON_IMPORTED = "imported"
ITEM_REASONS = (
    REASON_NEW_DT, REASON_MISSED, REASON_BECAME_TARGET,
    REASON_RESEND, REASON_OUTSIDE, REASON_IMPORTED,
)

SOURCE_BATCH = "batch"
SOURCE_IMPORT = "import"
SOURCE_MOJRI = "mojri"
ITEM_SOURCES = (SOURCE_BATCH, SOURCE_IMPORT, SOURCE_MOJRI)

#: The three letters a sent batch can carry. MTN is always recorded; the other
#: two are optional and never age or warn.
LETTERS = ("mtn", "ict", "cra")


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


class SubmissionSettings(Base):
    """The single settings row (id = 1)."""

    __tablename__ = "submission_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    owner = relationship("User", foreign_keys=[owner_user_id])


class SubmissionLetterFile(Base):
    """One stored letter file: metadata only, the bytes are in the evidence store."""

    __tablename__ = "submission_letter_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class SubmissionBatch(Base):
    __tablename__ = "submission_batches"
    __table_args__ = (
        CheckConstraint(f"status IN ({_in(BATCH_STATUSES)})", name="ck_submission_batch_status"),
        # A number is reused only by a cancelled draft's successor.
        Index(
            "uq_submission_batch_number_live", "number", unique=True,
            postgresql_where=text("status <> 'cancelled'"),
            sqlite_where=text("status <> 'cancelled'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(12), default=BATCH_DRAFT, nullable=False)
    imported: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    source_filename: Mapped[str | None] = mapped_column(String(255))
    file_digest: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    #: When it was marked as sent in UEP (a timestamp, not the letter's date).
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    mtn_letter_no: Mapped[str | None] = mapped_column(String(120))
    mtn_letter_date: Mapped[date | None] = mapped_column(Date)
    mtn_letter_file_id: Mapped[int | None] = mapped_column(ForeignKey("submission_letter_files.id"))
    ict_letter_no: Mapped[str | None] = mapped_column(String(120))
    ict_letter_date: Mapped[date | None] = mapped_column(Date)
    ict_letter_file_id: Mapped[int | None] = mapped_column(ForeignKey("submission_letter_files.id"))
    cra_letter_no: Mapped[str | None] = mapped_column(String(120))
    cra_letter_date: Mapped[date | None] = mapped_column(Date)
    cra_letter_file_id: Mapped[int | None] = mapped_column(ForeignKey("submission_letter_files.id"))

    items: Mapped[list[SubmissionItem]] = relationship(back_populates="batch")


class SubmissionItem(Base):
    __tablename__ = "submission_items"
    __table_args__ = (
        CheckConstraint(f"reason IN ({_in(ITEM_REASONS)})", name="ck_submission_item_reason"),
        CheckConstraint(f"source IN ({_in(ITEM_SOURCES)})", name="ck_submission_item_source"),
        # One active item per village: never in two drafts, never sent twice
        # without the first being superseded.
        Index(
            "uq_submission_item_active_village", "village_id", unique=True,
            postgresql_where=text("superseded_at IS NULL"),
            sqlite_where=text("superseded_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("submission_batches.id"), index=True
    )
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), nullable=False, index=True)
    # The business key as it was when the item was made, so a later CPM edit
    # cannot rewrite what a letter said.
    site_code: Mapped[str | None] = mapped_column(String(50))
    site_type: Mapped[str | None] = mapped_column(String(50))
    village_code: Mapped[str | None] = mapped_column(String(50))
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    #: The day it left MTN: the MTN letter date (or, for a village found only
    #: in Mojri, that Mojri file's date). Lateness counts from here.
    sent_at: Mapped[date | None] = mapped_column(Date)
    mojri_confirmed_at: Mapped[date | None] = mapped_column(Date)
    raised_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raised_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    raised_note: Mapped[str | None] = mapped_column(Text)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_by_id: Mapped[int | None] = mapped_column(ForeignKey("submission_items.id"))

    batch: Mapped[SubmissionBatch | None] = relationship(back_populates="items")
    village = relationship("Village")


class CpmVillageSighting(Base):
    """A non-هدف village key, the first time a CPM file listed it.

    The key parts are stored normalised (``mojri_tracker.normalize_key_part``),
    so a lookup is an exact match.
    """

    __tablename__ = "cpm_village_sightings"
    __table_args__ = (
        UniqueConstraint("site_code", "site_type", "village_code", name="uq_cpm_village_sighting"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    site_code: Mapped[str] = mapped_column(String(50), nullable=False)
    site_type: Mapped[str] = mapped_column(String(50), nullable=False)
    village_code: Mapped[str] = mapped_column(String(50), nullable=False)
    classification: Mapped[str | None] = mapped_column(String(60))
    #: NULL for a sighting seeded from a stored past file.
    first_seen_batch_id: Mapped[int | None] = mapped_column(ForeignKey("cpm_import_batches.id"))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
