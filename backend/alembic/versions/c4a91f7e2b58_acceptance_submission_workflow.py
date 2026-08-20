"""acceptance submission workflow: submissions, per-technology claims, evidence

Revision ID: c4a91f7e2b58
Revises: 5348276120bb
Create Date: 2026-08-20

Until now the ``acceptances`` table was the whole acceptance record: a status
per village and technology, seeded from the CPM workbook. It said where a
village stood but not how it got there, and nothing in the application could
write to it.

This revision adds the workflow underneath it. A contractor or a coordinator
records a claimed ICT or CRA verdict backed by a letter and its scan; a
coordinator or PM validates it, and only then does anything reach
``acceptances``. Every attempt is kept, so a village rejected three times has
three rounds on the record rather than one overwritten status.

Two columns are added to ``acceptances`` itself to mark a verdict as decided in
the app, so a stale cell in some future workbook cannot silently undo it.

Nothing existing is dropped or altered, so the dashboard that reads
``acceptances`` today keeps working unchanged.
"""
from alembic import op
import sqlalchemy as sa

revision = "c4a91f7e2b58"
down_revision = "5348276120bb"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _tables() -> set[str]:
    return set(_inspector().get_table_names())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _timestamps() -> list:
    """The ``created_at`` / ``updated_at`` pair every table inherits from Base."""
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    existing = _tables()

    # ---- acceptances: where each verdict came from -----------------------
    if "acceptances" in existing:
        present = _columns("acceptances")
        for column in ("ict_source", "cra_source"):
            if column not in present:
                op.add_column(
                    "acceptances", sa.Column(column, sa.String(length=10), nullable=True)
                )

    # ---- acceptance_submissions -----------------------------------------
    if "acceptance_submissions" not in existing:
        op.create_table(
            "acceptance_submissions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("village_id", sa.Integer(), nullable=False),
            sa.Column("authority", sa.String(length=10), nullable=False),
            sa.Column(
                "round_no", sa.Integer(), nullable=False, server_default="1"
            ),
            sa.Column("letter_number", sa.String(length=120), nullable=False),
            sa.Column("letter_date", sa.Date(), nullable=True),
            sa.Column("source", sa.String(length=20), nullable=False),
            sa.Column(
                "review_status",
                sa.String(length=20),
                nullable=False,
                server_default="Pending",
            ),
            sa.Column("submitted_by", sa.Integer(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reviewed_by", sa.Integer(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_comment", sa.Text(), nullable=True),
            *_timestamps(),
            sa.ForeignKeyConstraint(["village_id"], ["villages.id"]),
            sa.ForeignKeyConstraint(["submitted_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_acceptance_submissions_village_id",
            "acceptance_submissions",
            ["village_id"],
        )
        op.create_index(
            "ix_acc_sub_village_authority",
            "acceptance_submissions",
            ["village_id", "authority"],
        )
        op.create_index(
            "ix_acc_sub_review_status", "acceptance_submissions", ["review_status"]
        )

    # ---- acceptance_submission_techs ------------------------------------
    if "acceptance_submission_techs" not in existing:
        op.create_table(
            "acceptance_submission_techs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("submission_id", sa.Integer(), nullable=False),
            sa.Column("technology", sa.String(length=10), nullable=False),
            sa.Column("claimed_status", sa.String(length=10), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            *_timestamps(),
            sa.ForeignKeyConstraint(
                ["submission_id"], ["acceptance_submissions.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("submission_id", "technology", name="uq_acc_sub_tech"),
        )
        op.create_index(
            "ix_acceptance_submission_techs_submission_id",
            "acceptance_submission_techs",
            ["submission_id"],
        )

    # ---- acceptance_evidence --------------------------------------------
    if "acceptance_evidence" not in existing:
        op.create_table(
            "acceptance_evidence",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("submission_id", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(length=64), nullable=False),
            sa.Column("stored_path", sa.String(length=500), nullable=False),
            sa.Column("original_filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=100), nullable=True),
            sa.Column(
                "size_bytes", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column("uploaded_by", sa.Integer(), nullable=True),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            *_timestamps(),
            sa.ForeignKeyConstraint(
                ["submission_id"], ["acceptance_submissions.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_acceptance_evidence_submission_id",
            "acceptance_evidence",
            ["submission_id"],
        )
        op.create_index("ix_acc_evidence_sha256", "acceptance_evidence", ["sha256"])


def downgrade() -> None:
    """Drop the workflow tables and the two marker columns.

    The submissions and their evidence rows go with them: that is the whole
    history of who claimed what and who accepted it, which is why this is not
    something to run casually. The scanned files themselves are left on disk.
    """
    existing = _tables()
    for table in (
        "acceptance_evidence",
        "acceptance_submission_techs",
        "acceptance_submissions",
    ):
        if table in existing:
            op.drop_table(table)

    if "acceptances" in existing:
        present = _columns("acceptances")
        for column in ("cra_source", "ict_source"):
            if column in present:
                op.drop_column("acceptances", column)
