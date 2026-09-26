"""A ``stream`` on the MTN internal target, so the PM can set one for DT.

What this does to ``acceptance_monthly_targets``, and to the rows already in it:

* **``stream``** -- a new ``VARCHAR(20) NOT NULL`` column, server default
  ``'ACCEPTANCE'``. Every existing row gets ``'ACCEPTANCE'``, because every
  target set before this revision was the acceptance target. No other value
  in any existing row changes, and none of them changes meaning: an
  ACCEPTANCE target is still cumulative.
* The version uniqueness moves from (year, month, version) to
  (**stream**, year, month, version), and the lookup index gains the stream
  the same way. Every existing row is ACCEPTANCE, so the rows that were
  unique before are still unique.

No row is inserted, updated (beyond the new column's default) or deleted.

**Downgrade** drops the column and puts the old constraint and index back. It
refuses to run while any ``DT`` target exists: under the old constraint a DT
and an Acceptance target for the same month would collide, and the older code
would read a DT row as an acceptance target. Targets are append-only, so the
only way through would be deleting them, which this migration never does.

Revision ID: c4f9a2e7d318
Revises: b3e8d1f5a927
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op

revision = "c4f9a2e7d318"
down_revision = "b3e8d1f5a927"
branch_labels = None
depends_on = None

TABLE = "acceptance_monthly_targets"

OLD_UNIQUE = "uq_acceptance_target_period_version"
NEW_UNIQUE = "uq_internal_target_stream_period_version"
OLD_INDEX = "ix_acceptance_target_period"
NEW_INDEX = "ix_internal_target_stream_period"


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}


def _uniques() -> set[str]:
    return {
        u["name"] for u in sa.inspect(op.get_bind()).get_unique_constraints(TABLE)
    }


def _indexes() -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(TABLE)}


def upgrade() -> None:
    # Guarded step by step, like the revisions before it: the live database
    # was originally built by ``Base.metadata.create_all()``, so the model's
    # shape can already be there.
    if "stream" not in _columns():
        with op.batch_alter_table(TABLE) as batch:
            batch.add_column(
                sa.Column(
                    "stream",
                    sa.String(length=20),
                    nullable=False,
                    server_default="ACCEPTANCE",
                )
            )

    uniques = _uniques()
    indexes = _indexes()
    with op.batch_alter_table(TABLE) as batch:
        if OLD_UNIQUE in uniques:
            batch.drop_constraint(OLD_UNIQUE, type_="unique")
        if NEW_UNIQUE not in uniques:
            batch.create_unique_constraint(
                NEW_UNIQUE, ["stream", "shamsi_year", "shamsi_month", "version"]
            )
        if OLD_INDEX in indexes:
            batch.drop_index(OLD_INDEX)
        if NEW_INDEX not in indexes:
            batch.create_index(NEW_INDEX, ["stream", "shamsi_year", "shamsi_month"])


def downgrade() -> None:
    bind = op.get_bind()
    columns = _columns()
    if "stream" in columns:
        dt = bind.execute(
            sa.text(f"SELECT COUNT(*) FROM {TABLE} WHERE stream <> 'ACCEPTANCE'")
        ).scalar_one()
        if dt:
            raise RuntimeError(
                f"{dt} non-ACCEPTANCE target row(s) exist in {TABLE}. "
                "Downgrading would make them collide with acceptance targets "
                "under the old uniqueness rule, and the older code would read "
                "them as acceptance targets. Targets are never deleted. "
                "Refusing to downgrade."
            )

    uniques = _uniques()
    indexes = _indexes()
    with op.batch_alter_table(TABLE) as batch:
        if NEW_INDEX in indexes:
            batch.drop_index(NEW_INDEX)
        if OLD_INDEX not in indexes:
            batch.create_index(OLD_INDEX, ["shamsi_year", "shamsi_month"])
        if NEW_UNIQUE in uniques:
            batch.drop_constraint(NEW_UNIQUE, type_="unique")
        if OLD_UNIQUE not in uniques:
            batch.create_unique_constraint(
                OLD_UNIQUE, ["shamsi_year", "shamsi_month", "version"]
            )

    if "stream" in columns:
        with op.batch_alter_table(TABLE) as batch:
            batch.drop_column("stream")
