"""Monthly plan: the PM may approve a different number (UEP-18).

**Purely additive.** Two nullable columns on ``contractor_monthly_plans``, no
backfill. ``asked_count`` keeps the number the contractor submitted when the
PM approves another one; ``decision_comment`` is the PM's reason. Both stay
null on every existing row and on every plan approved as asked, so nothing
that reads the table changes behaviour. Rollback leaves the columns in place
and the previous release ignores them.

Revision ID: b8d4f2a6c913
Revises: a3c9e6f1d274
Create Date: 2026-10-23
"""
import sqlalchemy as sa
from alembic import op

revision = "b8d4f2a6c913"
down_revision = "a3c9e6f1d274"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Guarded: a database built by create_all already has the columns.
    present = _columns("contractor_monthly_plans")
    if "asked_count" not in present:
        op.add_column(
            "contractor_monthly_plans", sa.Column("asked_count", sa.Integer(), nullable=True)
        )
    if "decision_comment" not in present:
        op.add_column(
            "contractor_monthly_plans", sa.Column("decision_comment", sa.Text(), nullable=True)
        )


def downgrade() -> None:
    op.drop_column("contractor_monthly_plans", "decision_comment")
    op.drop_column("contractor_monthly_plans", "asked_count")
