"""UEP-29: bulk data import (drive test + acceptance) from Admin.

Every upload is a **batch**. Reading the file stages it here and writes nothing
else; Confirm applies the staged changes in one transaction; Undo reverses
them where nobody has changed the value since.

    ImportBatch    one uploaded file: who, when, its counts and its state
      ImportRow    one row of the file as read, with its errors
      ImportChange one field that would change (New / Conflict, with the PM's
                   decision), or -- once applied -- one record the batch
                   created or changed (kind ``effect``), which is what Undo
                   reads.

Batch numbers are their own sequence (``number``), so people talk about
"batch #4" whatever the primary key is.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

_JSON = JSON().with_variant(JSONB(), "postgresql")

STATUS_PREVIEWED = "previewed"
STATUS_APPLIED = "applied"
STATUS_UNDONE = "undone"
STATUS_EXPIRED = "expired"
BATCH_STATUSES = (STATUS_PREVIEWED, STATUS_APPLIED, STATUS_UNDONE, STATUS_EXPIRED)

ROW_OK = "ok"
ROW_ERROR = "error"
#: The row's acceptance cells are fine, but its site's drive test was refused.
ROW_DT_REFUSED = "dt_refused"

KIND_NEW = "new"
KIND_CONFLICT = "conflict"
#: Written on Confirm: one record the batch created or changed, for Undo.
KIND_EFFECT = "effect"

DECISION_KEEP = "keep"
DECISION_FILE = "file"
DECISIONS = (DECISION_KEEP, DECISION_FILE)

#: ``entity_type`` of a staged change: a work item's drive test, or one
#: village's ICT / CRA verdict.
ENTITY_DT = "drive_test"
ENTITY_ICT = "ict"
ENTITY_CRA = "cra"

#: ``source`` on the lifecycle tables that an import can write to.
SOURCE_APP = "app"
SOURCE_IMPORT = "import"


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    #: The original upload, in ``stored_files`` (kept: ``retain``).
    evidence_file_id: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=STATUS_PREVIEWED)

    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applied_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    undone_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: new / same / conflicts / errors / warnings, drive test per site and
    #: ICT / CRA per village, plus the file-level warnings and the undo result.
    counts: Mapped[dict | None] = mapped_column(_JSON)

    rows: Mapped[list[ImportRow]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", passive_deletes=True
    )


class ImportRow(Base):
    __tablename__ = "import_rows"
    __table_args__ = (Index("ix_import_rows_batch", "batch_id", "row_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=False
    )
    row_no: Mapped[int] = mapped_column(Integer, nullable=False)
    key_text: Mapped[str] = mapped_column(String(200), nullable=False)
    work_item_id: Mapped[int | None] = mapped_column(ForeignKey("work_items.id"))
    village_id: Mapped[int | None] = mapped_column(ForeignKey("villages.id"))
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=ROW_OK)
    #: [{"field": ..., "message": ...}]
    errors: Mapped[list | None] = mapped_column(_JSON)
    #: The row as read, by column key (text), for the error file.
    raw: Mapped[dict | None] = mapped_column(_JSON)

    batch: Mapped[ImportBatch] = relationship(back_populates="rows")


class ImportChange(Base):
    __tablename__ = "import_changes"
    __table_args__ = (
        Index("ix_import_changes_batch", "batch_id"),
        Index("ix_import_changes_entity", "entity_type", "entity_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=False
    )
    row_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_rows.id", ondelete="CASCADE")
    )
    #: drive_test (work item) | ict | cra (village) -- or, for an effect, the
    #: table it touched.
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    field: Mapped[str] = mapped_column(String(40), nullable=False)
    old_value: Mapped[object | None] = mapped_column(_JSON)
    new_value: Mapped[object | None] = mapped_column(_JSON)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    decision: Mapped[str | None] = mapped_column(String(10))
    #: Where the UEP value came from, for the conflict table.
    old_source: Mapped[str | None] = mapped_column(Text)
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_record_type: Mapped[str | None] = mapped_column(String(40))
    created_record_id: Mapped[int | None] = mapped_column(Integer)
