"""Acceptance monthly target: the PM's programme-wide village-acceptance plan.

**Purely additive.** One new table, no column on any existing table, nothing
altered, renamed or dropped. A rollback drops the table and leaves the
platform exactly as it was, because nothing else reads it.

This is a different table from ``contractor_monthly_plans``: that one is a
per-contractor drive-test volume commitment with a submit/approve workflow,
this one is a programme-wide, PM-set cumulative acceptance target with no
workflow at all. See ``app/models/acceptance_plan.py`` for the full reasoning.

Revision ID: ac8b37514fc3
Revises: a9d3f6c81e42
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op

revision = "ac8b37514fc3"
down_revision = "a9d3f6c81e42"
branch_labels = None
depends_on = None

TABLE = "acceptance_monthly_targets"


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if _has_table(TABLE):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shamsi_year", sa.Integer(), nullable=False),
        sa.Column("shamsi_month", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "is_current", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("target_count", sa.Integer(), nullable=False),
        sa.Column(
            "set_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("set_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.UniqueConstraint(
            "shamsi_year", "shamsi_month", "version",
            name="uq_acceptance_target_period_version",
        ),
    )
    op.create_index(
        "ix_acceptance_target_period",
        TABLE,
        ["shamsi_year", "shamsi_month"],
    )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    op.drop_index("ix_acceptance_target_period", table_name=TABLE)
    op.drop_table(TABLE)
