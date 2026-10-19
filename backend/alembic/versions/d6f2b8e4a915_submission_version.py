"""Acceptance validation (UEP-16): a version on every submission.

``acceptance_submissions.version`` counts state changes. A review names the
version it was looking at; a stale one is answered with 409, so two
coordinators on the same letter cannot both decide a village.

The return reason is already one per submission (``review_comment``), so no
reason column is added. Nothing is backfilled: every existing row starts at 0.

Revision ID: d6f2b8e4a915
Revises: c5e1a9d7f342
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op

revision = "d6f2b8e4a915"
down_revision = "c5e1a9d7f342"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Guarded: a database built by create_all already has the column.
    if "version" not in _columns("acceptance_submissions"):
        with op.batch_alter_table("acceptance_submissions") as batch:
            batch.add_column(
                sa.Column("version", sa.Integer, nullable=False, server_default="0")
            )


def downgrade() -> None:
    with op.batch_alter_table("acceptance_submissions") as batch:
        batch.drop_column("version")
