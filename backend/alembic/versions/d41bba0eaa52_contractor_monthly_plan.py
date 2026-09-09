"""Contractor monthly plan (PIP): one committed drive-test count per month.

One new table, ``contractor_monthly_plans``. Nothing existing is altered: no
column is added, dropped or retyped anywhere else, and no row in any other
table is read or written by this revision.

The shape is one number per contractor per Shamsi month, versioned. A plan is
drafted and submitted by the contractor's coordinator, and approved or returned
by a PM. Approving locks it, and revising an approved plan appends a new row at
``version + 1`` rather than editing the one that was decided -- the same
append-only principle the acceptance rounds use, and for the same reason: a
target that can be edited afterwards is not a target anyone can be held to.

**There is deliberately no partial unique index on ``is_current``.** It is the
obvious way to say "one live version per contractor per month" to PostgreSQL,
and it is the wrong tool here: the test suite builds its database on SQLite,
whose handling of partial indexes differs, so the guarantee would hold in
production and go unexercised everywhere it is actually checked. The rule lives
in ``services/monthly_plan.py``, which is the only thing that writes this
table, and a test covers it.

``is_default`` is created now and is always false. It is reserved for the
automatic figure applied when nobody submits by the deadline; this system has
no scheduler, so nothing sets it yet. It exists here so that building that
later is not a second migration of this table.

Revision ID: d41bba0eaa52
Revises: e5c72b9f4a18
Create Date: 2026-09-09
"""
from alembic import op
import sqlalchemy as sa

revision = "d41bba0eaa52"
down_revision = "e5c72b9f4a18"
branch_labels = None
depends_on = None

TABLE = "contractor_monthly_plans"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Guarded, like the revisions before it and for the same reason: the live
    # database was originally built by ``Base.metadata.create_all()`` rather
    # than by Alembic, so a table the models declare can already exist. An
    # unguarded CREATE TABLE would fail the deploy on exactly the database
    # this migration exists to serve.
    if _has_table(TABLE):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        # The plan belongs to the contractor company, not to the account that
        # filed it. A second account at the same company edits this row; it
        # never starts a competing one for the same month.
        sa.Column(
            "contractor_id",
            sa.Integer(),
            sa.ForeignKey("contractors.id"),
            nullable=False,
        ),
        # Reporting periods are Shamsi months throughout the platform, so the
        # period is stored as the two numbers rather than as a date range that
        # would have to be converted back on every read.
        sa.Column("shamsi_year", sa.Integer(), nullable=False),
        sa.Column("shamsi_month", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "is_current", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        # Nullable, because a draft may legitimately be opened before the
        # number is known. Required, and non-negative, on submit -- a rule the
        # service enforces, since "required only in some states" is not
        # something a column constraint can say.
        sa.Column("committed_count", sa.Integer(), nullable=True),
        # Draft | Submitted | Returned | Approved.
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="Draft"
        ),
        sa.Column(
            "is_default", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "submitted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("return_comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        # A version number only means anything inside one contractor's month,
        # and two rows claiming the same one would make "which is version 2"
        # unanswerable. This is what the append-on-revision rule rests on.
        sa.UniqueConstraint(
            "contractor_id",
            "shamsi_year",
            "shamsi_month",
            "version",
            name="uq_plan_contractor_period_version",
        ),
    )

    # How every read of this table starts: one contractor's month, the PM's
    # queue for a month across all contractors, or a sweep by status.
    op.create_index(
        op.f("ix_contractor_monthly_plans_contractor_id"),
        TABLE,
        ["contractor_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_contractor_monthly_plans_status"), TABLE, ["status"], unique=False
    )
    op.create_index(
        "ix_plan_contractor_period",
        TABLE,
        ["contractor_id", "shamsi_year", "shamsi_month"],
        unique=False,
    )
    op.create_index(
        "ix_plan_period", TABLE, ["shamsi_year", "shamsi_month"], unique=False
    )


def downgrade() -> None:
    # The table is new and nothing outside it refers to it, so dropping it
    # undoes this revision exactly. Every other table is left untouched, which
    # is the same thing the upgrade can say.
    if not _has_table(TABLE):
        return
    op.drop_index("ix_plan_period", table_name=TABLE)
    op.drop_index("ix_plan_contractor_period", table_name=TABLE)
    op.drop_index(op.f("ix_contractor_monthly_plans_status"), table_name=TABLE)
    op.drop_index(op.f("ix_contractor_monthly_plans_contractor_id"), table_name=TABLE)
    op.drop_table(TABLE)
