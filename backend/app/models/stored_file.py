"""Uploaded file bytes, kept in the database (UEP-20).

One row per distinct file, keyed by the SHA-256 of its bytes. The rows that
*use* a file -- acceptance evidence, drive-test evidence, MTN submission
letters, CPM import batches -- keep only metadata and point here by digest.
``evidence_store.FILE_REFERENCES`` lists every such column.

Kept in its own table, not as a column on the evidence tables, so that lists
and dashboards that read evidence rows constantly never drag file bytes along;
the bytes are fetched only when someone opens a file.

There is deliberately no foreign key from the referencing tables: a scan is
stored the moment it is uploaded, before anything references it, and rows
older than this table exist.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Integer, LargeBinary, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StoredFile(Base):
    __tablename__ = "stored_files"

    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    # The validated extension (pdf, jpg, ..., xlsx for CPM workbooks).
    extension: Mapped[str] = mapped_column(String(8), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # BYTEA on PostgreSQL, which moves large values out of line (TOAST) on its
    # own. Never loaded except by evidence_store.read().
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # True: never deleted by the cleanup job (CPM workbooks are kept forever).
    retain: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
