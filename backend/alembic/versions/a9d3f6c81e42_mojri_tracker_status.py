"""Mojri tracker reconciliation: the status table and its import runs.

**Purely additive.** Two new tables, no column on any existing table, nothing
altered, renamed or dropped. A rollback drops the two tables and leaves the
platform exactly as it was, because nothing else reads them: acceptance is
recorded in ``acceptances`` and derived by ``acceptance_workflow``, and this is
a parallel record of whether a third party has caught up to a verdict we
already made.

In particular this migration deliberately does **not** touch the ``authority``
value set. Mojri is not a third authority beside ICT and CRA — adding it there
would drag "ICT HQ has typed this village into their spreadsheet" into the
submit/review pipeline and into every figure that counts approvals.

Two decisions worth stating, because both look like omissions:

**The status columns are ``VARCHAR`` with a CHECK, not a PostgreSQL ENUM.**
That is this platform's convention for exactly this shape of column
(``villages.ict_status``, ``acceptances`` authority) and the reason is in
ARCHITECTURE.md: a fourth value should be a data decision, not a migration
against a live type while the application is running.

**``village_id`` is unique.** A village has one standing per authority. Two
rows would make every count over this table double somewhere, quietly, with no
error anywhere -- the same failure the partial unique index on
``province_mapping`` exists to prevent.

Revision ID: a9d3f6c81e42
Revises: f7a2c5d91b34
Create Date: 2026-09-24
"""
import sqlalchemy as sa
from alembic import op

revision = "a9d3f6c81e42"
down_revision = "f7a2c5d91b34"
branch_labels = None
depends_on = None

RUNS = "mojri_import_runs"
STATUS = "mojri_tracker_status"

STATUSES = ("not_in_tracker", "in_tracker", "needs_look")
_IN = ", ".join(f"'{value}'" for value in STATUSES)


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _has_table(RUNS):
        op.create_table(
            RUNS,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column(
                "imported_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True
            ),
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
            sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("matched_rows", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "unmatched_rows", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "ict_in_tracker", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "ict_needs_look", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "cra_in_tracker", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "cra_needs_look", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column("disappeared", sa.Integer(), nullable=False, server_default="0"),
        )

    if not _has_table(STATUS):
        op.create_table(
            STATUS,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "village_id",
                sa.Integer(),
                sa.ForeignKey("villages.id"),
                nullable=False,
            ),
            sa.Column(
                "ict_status",
                sa.String(length=20),
                nullable=False,
                server_default="not_in_tracker",
            ),
            sa.Column(
                "cra_status",
                sa.String(length=20),
                nullable=False,
                server_default="not_in_tracker",
            ),
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
            sa.Column(
                "source_import_id",
                sa.Integer(),
                sa.ForeignKey(f"{RUNS}.id"),
                nullable=True,
            ),
            sa.CheckConstraint(f"ict_status IN ({_IN})", name="ck_mojri_ict_status"),
            sa.CheckConstraint(f"cra_status IN ({_IN})", name="ck_mojri_cra_status"),
        )
        op.create_index(
            "ix_mojri_tracker_status_village_id",
            STATUS,
            ["village_id"],
            unique=True,
        )
        # Both statuses are filtered on directly ("how many need a look?"),
        # which is the whole reason the reconciliation screen exists.
        op.create_index("ix_mojri_tracker_status_ict_status", STATUS, ["ict_status"])
        op.create_index("ix_mojri_tracker_status_cra_status", STATUS, ["cra_status"])


def downgrade() -> None:
    if _has_table(STATUS):
        op.drop_index("ix_mojri_tracker_status_cra_status", table_name=STATUS)
        op.drop_index("ix_mojri_tracker_status_ict_status", table_name=STATUS)
        op.drop_index("ix_mojri_tracker_status_village_id", table_name=STATUS)
        op.drop_table(STATUS)
    if _has_table(RUNS):
        op.drop_table(RUNS)
