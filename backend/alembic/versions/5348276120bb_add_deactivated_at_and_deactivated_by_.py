"""record who deactivated a user account, and when

Revision ID: 5348276120bb
Revises: b7f1c2d9e4a3
Create Date: 2026-08-14

Deleting a user used to remove the row outright. Users are referenced by
``audit_logs.user_id``, ``hc_tasks.reviewed_by``,
``work_items.coordinator_reviewed_by`` and ``work_items.pm_reviewed_by``, so
removing one turned "reviewed by Maryam" into "reviewed by nobody" everywhere it
appeared. Deactivation replaces deletion, and these two columns record who did
it and when so the action itself is accountable.

Both are cleared when an account is reactivated.
"""
from alembic import op
import sqlalchemy as sa

revision = "5348276120bb"
down_revision = "b7f1c2d9e4a3"
branch_labels = None
depends_on = None

FK_NAME = "users_deactivated_by_fkey"


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}


def upgrade() -> None:
    existing = _columns()

    if "deactivated_at" not in existing:
        op.add_column(
            "users", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True)
        )
    if "deactivated_by" not in existing:
        op.add_column("users", sa.Column("deactivated_by", sa.Integer(), nullable=True))

    # SQLite cannot add a constraint to an existing table -- doing so means
    # rebuilding the whole table. Only the test suite runs on SQLite, where
    # foreign keys are not enforced by default anyway, so the constraint is
    # added on PostgreSQL only. Production is PostgreSQL.
    if op.get_bind().dialect.name != "postgresql":
        return

    already = {fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys("users")}
    if FK_NAME not in already:
        op.create_foreign_key(FK_NAME, "users", "users", ["deactivated_by"], ["id"])


def downgrade() -> None:
    """Drop the two columns. No user row is removed."""
    if op.get_bind().dialect.name == "postgresql":
        already = {fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys("users")}
        if FK_NAME in already:
            op.drop_constraint(FK_NAME, "users", type_="foreignkey")

    existing = _columns()
    if "deactivated_by" in existing:
        op.drop_column("users", "deactivated_by")
    if "deactivated_at" in existing:
        op.drop_column("users", "deactivated_at")
