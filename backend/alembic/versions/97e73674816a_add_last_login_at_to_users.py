"""add last_login_at to users

Revision ID: 97e73674816a
Revises: 9309f88c62ca
Create Date: 2026-07-11 00:00:00.000000

This is the original migration, kept in the chain so that any database already
stamped with it continues to upgrade cleanly.

Two things changed about it during the schema-consolidation work:

* It now follows the baseline revision instead of being the first migration.
  On a brand-new database the baseline creates ``users`` with ``last_login_at``
  already on it, so by the time this revision runs there is nothing left to do.
* The column add is therefore guarded. Adding a column that is already there is
  an error in PostgreSQL, so the guard is what lets the same chain serve both a
  fresh database and one that was stamped at this revision long ago.
"""
from alembic import op
import sqlalchemy as sa

revision = "97e73674816a"
down_revision = "9309f88c62ca"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("users", "last_login_at"):
        op.add_column(
            "users",
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _has_column("users", "last_login_at"):
        op.drop_column("users", "last_login_at")
