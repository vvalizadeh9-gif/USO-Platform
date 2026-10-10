"""Action Center snapshot: how many items were due soon each day.

**Purely additive.** One column on ``action_daily_snapshot``.

Home's Due soon figure gets a 14-day trend like Waiting on you and Overdue,
and the trend is read from the snapshot. The column is **nullable, with no
default**: rows written before it existed never counted due soon, and NULL
says "not known" where a 0 would claim "none were due soon". Home draws a gap
for those days (see ``services/home_trends.py``). Every row the snapshot job
writes from now on carries a number.

Revision ID: d4b6f8a1c357
Revises: c2e8f4a6b913
Create Date: 2026-10-10
"""
import sqlalchemy as sa
from alembic import op

revision = "d4b6f8a1c357"
down_revision = "c2e8f4a6b913"
branch_labels = None
depends_on = None

TABLE = "action_daily_snapshot"
COLUMN = "due_soon"


def _has_column() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns(TABLE)
    return any(c["name"] == COLUMN for c in columns)


def upgrade() -> None:
    if _has_column():
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    if not _has_column():
        return
    with op.batch_alter_table(TABLE) as batch:
        batch.drop_column(COLUMN)
