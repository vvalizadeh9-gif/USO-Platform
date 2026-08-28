"""Acceptance submission workflow models.

The ``acceptances`` table (models/acceptance.py) records *where a village
stands*: one row per village and technology, holding the ICT and CRA verdicts
that the dashboard counts. It is a projection, and these three tables are what
write to it.

Nothing here is ever updated in place once it has been reviewed. A village that
is rejected, fixed and submitted again produces a second submission with
``round_no = 2``; the first one stays exactly as it was decided. That is the
whole point — the acceptance record carries contractual consequences, so "who
claimed what, backed by which letter, and who accepted it" has to survive for a
decade. Deriving the current status from these rows means the history can never
disagree with the status.

    AcceptanceSubmission          one village + one authority + one round
      └── AcceptanceSubmissionTech    the per-technology claim (+ reason)
      └── AcceptanceEvidence          the scanned letter(s) backing it

Only ICT and CRA are recorded today, as province-level and region-level
approvals respectively. ``authority`` is a value rather than a column so the
upstream stages (ICT HQ, CRA Setad) can be added later without a schema change.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
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

# The two approval authorities tracked today.
AUTHORITY_ICT = "ICT"
AUTHORITY_CRA = "CRA"
AUTHORITIES = (AUTHORITY_ICT, AUTHORITY_CRA)

# What the submitter claims the authority decided, per technology.
CLAIM_APPROVED = "Approved"
CLAIM_REJECTED = "Rejected"
CLAIMS = (CLAIM_APPROVED, CLAIM_REJECTED)

# Where the submission sits in the coordinator's review.
REVIEW_PENDING = "Pending"
REVIEW_VALIDATED = "Validated"
REVIEW_RETURNED = "Returned"
REVIEW_WITHDRAWN = "Withdrawn"

# Who entered it. Both paths are supported on purpose: a contractor submits
# what they obtained, and a coordinator records what came in through their own
# follow-up with the province or region.
SOURCE_CONTRACTOR = "Contractor"
SOURCE_COORDINATOR = "Coordinator"


class AcceptanceSubmission(Base):
    """One village's claimed ICT *or* CRA verdict, awaiting or past review."""

    __tablename__ = "acceptance_submissions"
    __table_args__ = (
        # The queue, the basket and the history all filter on these.
        Index("ix_acc_sub_village_authority", "village_id", "authority"),
        Index("ix_acc_sub_review_status", "review_status"),
        # At most one submission awaiting review per village and authority.
        # services/acceptance_workflow.py checks this before inserting, but
        # that is a read-then-write: two simultaneous submits both passed it,
        # and from then on every query using scalar_one_or_none() on this pair
        # raised MultipleResultsFound -- a permanent 500 for that village. The
        # application check stays for its readable message; this is the
        # guarantee underneath it. Partial, because validated, returned and
        # withdrawn rounds legitimately accumulate.
        Index(
            "uq_acc_sub_one_pending_per_authority",
            "village_id",
            "authority",
            unique=True,
            postgresql_where=text("review_status = 'Pending'"),
            sqlite_where=text("review_status = 'Pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(
        ForeignKey("villages.id"), nullable=False, index=True
    )
    authority: Mapped[str] = mapped_column(String(10), nullable=False)  # ICT|CRA

    # 1 = first attempt. A village rejected by ICT, fixed and submitted again
    # gets 2, 3, ... Every round is kept.
    round_no: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # The letter is the objective artefact behind the claim. One letter often
    # covers a hundred villages, so the number is repeated across submissions
    # rather than being an entity of its own.
    letter_number: Mapped[str] = mapped_column(String(120), nullable=False)
    # Stored Gregorian, entered and displayed Shamsi (see core/jalali.py).
    letter_date: Mapped[date | None] = mapped_column(Date)

    source: Mapped[str] = mapped_column(String(20), nullable=False)
    review_status: Mapped[str] = mapped_column(
        String(20), default=REVIEW_PENDING, nullable=False
    )

    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # Distinct from the inherited ``created_at``: this is the domain fact
    # (when the submitter said it was sent), set deliberately by the service.
    # ``updated_at`` comes from Base and maintains itself.
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Required when a submission is returned: the contractor has to be told
    # what was wrong with it, and the reason belongs in the record.
    review_comment: Mapped[str | None] = mapped_column(Text)

    village = relationship("Village")
    technologies: Mapped[list[AcceptanceSubmissionTech]] = relationship(
        back_populates="submission",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    evidence: Mapped[list[AcceptanceEvidence]] = relationship(
        back_populates="submission",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class AcceptanceSubmissionTech(Base):
    """The claimed verdict for one technology inside one submission.

    Rows exist only for technologies the CPM file actually requested for the
    site. The frontend hides the others; this table is what makes that a rule
    rather than a presentation choice.
    """

    __tablename__ = "acceptance_submission_techs"
    __table_args__ = (
        UniqueConstraint("submission_id", "technology", name="uq_acc_sub_tech"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("acceptance_submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    technology: Mapped[str] = mapped_column(String(10), nullable=False)  # 2G|3G|4G
    claimed_status: Mapped[str] = mapped_column(String(10), nullable=False)
    # Mandatory when the claim is Rejected — a rejection without a stated
    # reason is not actionable by the team that has to fix it.
    comment: Mapped[str | None] = mapped_column(Text)

    submission: Mapped[AcceptanceSubmission] = relationship(
        back_populates="technologies"
    )


class AcceptanceEvidence(Base):
    """A scanned letter or supporting document attached to a submission.

    Files are content-addressed: ``sha256`` names the file on disk, so the one
    letter covering a hundred villages is stored once however many submissions
    reference it. Deleting a row therefore must not delete the file — another
    submission may still point at the same hash.
    """

    __tablename__ = "acceptance_evidence"
    __table_args__ = (Index("ix_acc_evidence_sha256", "sha256"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("acceptance_submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Relative to settings.upload_dir, so moving the volume does not invalidate
    # every row.
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    submission: Mapped[AcceptanceSubmission] = relationship(back_populates="evidence")
