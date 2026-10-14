"""Work items: the site (execution) contractor from CPM column 31.

**Purely additive.** One nullable column, ``work_items.site_contractor_id``,
a foreign key to ``contractors`` with an index.

CPM column 31 (پیمانکار اجرایی سایت) was mapped in ``cpm_columns`` but never
stored, so the Explorer record page had nothing to show for it. The column is
filled by the CPM import, with the same contractor-name matching the DT
contractor (column AV) uses. Earlier batches' raw rows are not kept, so there
is no backfill: existing work items pick the value up on the next import.

Revision ID: a7c3e9d2f514
Revises: d4b6f8a1c357
Create Date: 2026-10-14
"""
import sqlalchemy as sa
from alembic import op

revision = "a7c3e9d2f514"
down_revision = "d4b6f8a1c357"
branch_labels = None
depends_on = None

TABLE = "work_items"
COLUMN = "site_contractor_id"
INDEX = "ix_work_items_site_contractor_id"
FK = "fk_work_items_site_contractor_id_contractors"


def _has_column() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns(TABLE)
    return any(c["name"] == COLUMN for c in columns)


def upgrade() -> None:
    if _has_column():
        return
    with op.batch_alter_table(TABLE) as batch:
        batch.add_column(sa.Column(COLUMN, sa.Integer(), nullable=True))
        batch.create_foreign_key(FK, "contractors", [COLUMN], ["id"])
        batch.create_index(INDEX, [COLUMN])


def downgrade() -> None:
    if not _has_column():
        return
    with op.batch_alter_table(TABLE) as batch:
        batch.drop_index(INDEX)
        batch.drop_constraint(FK, type_="foreignkey")
        batch.drop_column(COLUMN)
