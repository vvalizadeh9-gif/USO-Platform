"""Mojri tracker reconciliation: is a village in ICT HQ's own tracker yet?

This sits **after** our acceptance decision and changes nothing about it. ICT
and CRA approval are recorded in ``acceptances`` and derived by
``acceptance_workflow``; this table is a parallel record of whether a third
party has caught up to a verdict we already made. Nothing in the acceptance
arithmetic reads it, and nothing here writes acceptance.

That is why Mojri is **not** a third authority beside ICT and CRA. Adding it to
``AUTHORITIES`` would put it into the submit/review pipeline, into the My Work
buckets and into every figure that counts approvals — and "ICT HQ has typed
this village into their spreadsheet" is not an approval. It is a separate
table, read independently.

Two tables, for the same reason the CPM import has two: the status per village,
and the run that wrote it. Without the run, "who loaded this, from which file,
when" is unanswerable three months later, and a monthly reconciliation nobody
can audit is a rumour.

The three statuses, per authority, are the whole vocabulary:

``not_in_tracker``  we have no record of it in Mojri's tracker (the default,
                    and what a blank cell means)
``in_tracker``      every technology the village requested reads registered
``needs_look``      something in the file could not be read as either — an
                    unrecognised token, a cell carrying a note, a comment. A
                    person decides; the importer never guesses.
"""
from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

NOT_IN_TRACKER = "not_in_tracker"
IN_TRACKER = "in_tracker"
NEEDS_LOOK = "needs_look"

#: The three values either status column may hold. Held as a string with a
#: CHECK constraint rather than as a PostgreSQL ENUM type, which is this
#: platform's convention for exactly this shape of column (see
#: ``villages.ict_status`` and the note on ``authority`` in ARCHITECTURE.md):
#: adding a fourth value later is then a data decision, not a migration against
#: a live type.
TRACKER_STATUSES = (NOT_IN_TRACKER, IN_TRACKER, NEEDS_LOOK)

_STATUS_CHECK = ", ".join(f"'{value}'" for value in TRACKER_STATUSES)


class MojriImportRun(Base):
    """One import of Mojri's tracker, kept so every status can name its source.

    Same pattern as ``cpm_import_batches``: the counts the preview showed are
    stored with the run, so the history says what the person was looking at
    when they pressed Confirm.
    """

    __tablename__ = "mojri_import_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    imported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # created_at / updated_at come from Base, which gives them to every table.

    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    matched_rows: Mapped[int] = mapped_column(Integer, default=0)
    unmatched_rows: Mapped[int] = mapped_column(Integer, default=0)

    ict_in_tracker: Mapped[int] = mapped_column(Integer, default=0)
    ict_needs_look: Mapped[int] = mapped_column(Integer, default=0)
    cra_in_tracker: Mapped[int] = mapped_column(Integer, default=0)
    cra_needs_look: Mapped[int] = mapped_column(Integer, default=0)
    #: Villages that were in the tracker last time and are absent from this
    #: file. Recorded, never acted on — see services/mojri_tracker.py.
    disappeared: Mapped[int] = mapped_column(Integer, default=0)


class MojriTrackerStatus(Base):
    """Where one village stands with each authority's Mojri tracker.

    One row per village, written whole by each import: the file is a snapshot
    of the tracker as of that month, not a list of changes.
    """

    __tablename__ = "mojri_tracker_status"
    __table_args__ = (
        CheckConstraint(
            f"ict_status IN ({_STATUS_CHECK})", name="ck_mojri_ict_status"
        ),
        CheckConstraint(
            f"cra_status IN ({_STATUS_CHECK})", name="ck_mojri_cra_status"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Unique: a village has one standing, and two rows would make every count
    # over this table double somewhere.
    village_id: Mapped[int] = mapped_column(
        ForeignKey("villages.id"), nullable=False, unique=True, index=True
    )

    # The two authorities are independent. ICT HQ registering a village says
    # nothing about whether CRA's tracker has it, so neither column is derived
    # from the other.
    ict_status: Mapped[str] = mapped_column(
        String(20), default=NOT_IN_TRACKER, server_default=NOT_IN_TRACKER,
        nullable=False, index=True,
    )
    cra_status: Mapped[str] = mapped_column(
        String(20), default=NOT_IN_TRACKER, server_default=NOT_IN_TRACKER,
        nullable=False, index=True,
    )

    # ``updated_at`` is Base's, and carries onupdate=now(). The importer also
    # sets it explicitly, because a village confirmed by this month's file with
    # no change of status has still been re-confirmed, and "when did we last
    # see this" is the question a reconciliation is for.
    source_import_id: Mapped[int | None] = mapped_column(
        ForeignKey("mojri_import_runs.id")
    )

    village = relationship("Village")
    source_import = relationship("MojriImportRun")
