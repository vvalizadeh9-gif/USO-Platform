"""add last_login_at to users

Revision ID: 97e73674816a
Revises:
Create Date: 2026-07-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "97e73674816a"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "last_login_at")
