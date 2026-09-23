"""KPI & Performance: province ownership mapping, and the user link to it.

**Purely additive.** One new table and one new nullable column. Nothing
existing is altered, renamed or dropped, so a rollback costs nothing and the
screens that read ``provinces.coordinator_user_id`` /
``regional_manager_user_id`` are untouched.

``province_mapping`` records who owns a province over a period of time: its CRA
region, PSO coordinator and regional manager, between ``effective_from`` and
``effective_to``. A reassignment closes the open row and inserts a new one, so
a result computed for last quarter still belongs to whoever held the province
then.

The partial unique index is the part that matters. "At most one open row per
province" cannot be enforced by the application alone — two simultaneous
reassignments both pass a read-then-write check, and from then on every KPI
lens counts that province twice, quietly, with no error anywhere.

``users.kpi_person_name`` is how an account says which person in that table it
is. Nullable, because most accounts are neither a regional manager nor a
coordinator, and an unlinked one is refused the KPI page with an explanation
rather than being shown somebody else's provinces.

The 31 seed rows are not inserted here. They are seeded by
``core/bootstrap.py`` on startup, which is where every other piece of reference
data in this platform is seeded, and which skips a province that already has an
open row — so an assignment made in the product is never overwritten by a
restart.

Revision ID: f7a2c5d91b34
Revises: 2dc7644d5198
Create Date: 2026-09-23
"""
import sqlalchemy as sa
from alembic import op

revision = "f7a2c5d91b34"
down_revision = "2dc7644d5198"
branch_labels = None
depends_on = None

TABLE = "province_mapping"
OPEN_ROW_INDEX = "uq_province_mapping_one_open"
LOOKUP_INDEX = "ix_province_mapping_province"
USER_COLUMN = "kpi_person_name"


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _user_columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}


def upgrade() -> None:
    if not _has_table(TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("province_fa", sa.String(length=100), nullable=False),
            sa.Column("province_en", sa.String(length=100), nullable=False),
            sa.Column("cra_region", sa.String(length=60), nullable=False),
            sa.Column("pso_coordinator", sa.String(length=120), nullable=False),
            sa.Column("regional_manager", sa.String(length=120), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), nullable=True),
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
        )
        op.create_index(LOOKUP_INDEX, TABLE, ["province_fa", "effective_to"])
        # Partial, so that closed rows may accumulate freely while only one
        # row per province is ever the current one.
        op.create_index(
            OPEN_ROW_INDEX,
            TABLE,
            ["province_fa"],
            unique=True,
            postgresql_where=sa.text("effective_to IS NULL"),
            sqlite_where=sa.text("effective_to IS NULL"),
        )

    if USER_COLUMN not in _user_columns():
        op.add_column(
            "users", sa.Column(USER_COLUMN, sa.String(length=120), nullable=True)
        )


def downgrade() -> None:
    if USER_COLUMN in _user_columns():
        op.drop_column("users", USER_COLUMN)

    if _has_table(TABLE):
        op.drop_index(OPEN_ROW_INDEX, table_name=TABLE)
        op.drop_index(LOOKUP_INDEX, table_name=TABLE)
        op.drop_table(TABLE)
