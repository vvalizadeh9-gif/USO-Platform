"""PIP streams and revision requests on ``contractor_monthly_plans``.

What this does to the table, and to the rows already in it:

* **``stream``** -- a new ``VARCHAR(20) NOT NULL`` column, server default
  ``'DT'``. Every existing row gets ``'DT'``, because every plan filed before
  this revision was a drive-test plan. No other value in any existing row
  changes.
* **``revision_reason``** / **``revision_comment``** -- two new nullable
  columns. NULL on every existing row: none of them is a revision request.
* The version uniqueness moves from (contractor, year, month, version) to
  (contractor, **stream**, year, month, version), and the lookup index gains
  the stream the same way. Every existing row is DT, so the rows that were
  unique before are still unique.

No row is inserted, updated (beyond the new columns' defaults) or deleted.

**Downgrade** drops the three columns and puts the old constraint and index
back. It refuses to run while any ``ACCEPTANCE`` plan exists: under the old
constraint a contractor's DT and Acceptance plans for the same month would
collide, and the only way through would be deleting plans, which this table
never does. ``RevisionRequested`` / ``RevisionReturned`` rows are left as
they are; the older code does not know those statuses and ignores them.

Revision ID: b3e8d1f5a927
Revises: ac8b37514fc3
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op

revision = "b3e8d1f5a927"
down_revision = "ac8b37514fc3"
branch_labels = None
depends_on = None

TABLE = "contractor_monthly_plans"

OLD_UNIQUE = "uq_plan_contractor_period_version"
NEW_UNIQUE = "uq_plan_contractor_stream_period_version"
OLD_INDEX = "ix_plan_contractor_period"
NEW_INDEX = "ix_plan_contractor_stream_period"


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}


def _uniques() -> set[str]:
    return {
        u["name"] for u in sa.inspect(op.get_bind()).get_unique_constraints(TABLE)
    }


def _indexes() -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(TABLE)}


def upgrade() -> None:
    # Guarded column by column, like the revisions before it: the live
    # database was originally built by ``Base.metadata.create_all()``, so the
    # model's shape can already be there.
    columns = _columns()
    with op.batch_alter_table(TABLE) as batch:
        if "stream" not in columns:
            batch.add_column(
                sa.Column(
                    "stream",
                    sa.String(length=20),
                    nullable=False,
                    server_default="DT",
                )
            )
        if "revision_reason" not in columns:
            batch.add_column(
                sa.Column("revision_reason", sa.String(length=20), nullable=True)
            )
        if "revision_comment" not in columns:
            batch.add_column(sa.Column("revision_comment", sa.Text(), nullable=True))

    uniques = _uniques()
    indexes = _indexes()
    with op.batch_alter_table(TABLE) as batch:
        if OLD_UNIQUE in uniques:
            batch.drop_constraint(OLD_UNIQUE, type_="unique")
        if NEW_UNIQUE not in uniques:
            batch.create_unique_constraint(
                NEW_UNIQUE,
                ["contractor_id", "stream", "shamsi_year", "shamsi_month", "version"],
            )
        if OLD_INDEX in indexes:
            batch.drop_index(OLD_INDEX)
        if NEW_INDEX not in indexes:
            batch.create_index(
                NEW_INDEX, ["contractor_id", "stream", "shamsi_year", "shamsi_month"]
            )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _columns()
    if "stream" in columns:
        acceptance = bind.execute(
            sa.text(f"SELECT COUNT(*) FROM {TABLE} WHERE stream <> 'DT'")
        ).scalar_one()
        if acceptance:
            raise RuntimeError(
                f"{acceptance} non-DT plan row(s) exist in {TABLE}. Downgrading "
                "would make them collide with DT plans under the old uniqueness "
                "rule, and plans are never deleted. Refusing to downgrade."
            )

    uniques = _uniques()
    indexes = _indexes()
    with op.batch_alter_table(TABLE) as batch:
        if NEW_INDEX in indexes:
            batch.drop_index(NEW_INDEX)
        if OLD_INDEX not in indexes:
            batch.create_index(
                OLD_INDEX, ["contractor_id", "shamsi_year", "shamsi_month"]
            )
        if NEW_UNIQUE in uniques:
            batch.drop_constraint(NEW_UNIQUE, type_="unique")
        if OLD_UNIQUE not in uniques:
            batch.create_unique_constraint(
                OLD_UNIQUE, ["contractor_id", "shamsi_year", "shamsi_month", "version"]
            )

    with op.batch_alter_table(TABLE) as batch:
        for name in ("revision_comment", "revision_reason", "stream"):
            if name in columns:
                batch.drop_column(name)
