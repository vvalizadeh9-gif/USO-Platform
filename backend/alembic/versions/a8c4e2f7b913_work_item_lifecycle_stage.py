"""UEP-28: each work item's open journey step, cached for Explorer's list.

Adds ``work_items.lifecycle_stage`` (the open step's index in
``explorer_journey.STEP_ORDER``, 6 = acceptance done) and
``work_items.lifecycle_stage_since`` (the date that step's clock started), and
an index over both so the list can sort every site by stage in the database.

Both columns are a cache of ``explorer.step facts`` -> ``build_steps``, kept by
``services.lifecycle_stage`` (refreshed on every commit that touches a fact,
and filled for any row still NULL at start-up). The migration only adds the
columns: the values come from the application's own rule, never a SQL copy.

Idempotent: a column or index that already exists (a database built by
``create_all``) is skipped.

Revision ID: a8c4e2f7b913
Revises: f9d3b7a2c614
Create Date: 2026-11-27
"""
import sqlalchemy as sa
from alembic import op

revision = "a8c4e2f7b913"
down_revision = "f9d3b7a2c614"
branch_labels = None
depends_on = None

INDEX = "ix_work_items_lifecycle_stage"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("work_items")}
    if "lifecycle_stage" not in columns:
        op.add_column("work_items", sa.Column("lifecycle_stage", sa.SmallInteger(), nullable=True))
    if "lifecycle_stage_since" not in columns:
        op.add_column("work_items", sa.Column("lifecycle_stage_since", sa.Date(), nullable=True))
    indexes = {i["name"] for i in inspector.get_indexes("work_items")}
    if INDEX not in indexes:
        op.create_index(INDEX, "work_items", ["lifecycle_stage", "lifecycle_stage_since"])


def downgrade() -> None:
    op.drop_index(INDEX, table_name="work_items")
    op.drop_column("work_items", "lifecycle_stage_since")
    op.drop_column("work_items", "lifecycle_stage")
