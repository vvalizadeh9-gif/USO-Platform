"""MTN internal target: a ``stream`` (DT or ACCEPTANCE), and monthly amounts.

What this does to ``acceptance_monthly_targets``, and to the rows already in it:

* **``stream``** -- a new ``VARCHAR(20) NOT NULL`` column, server default
  ``'ACCEPTANCE'``. Every existing row gets ``'ACCEPTANCE'``, because every
  target set before this revision was the acceptance target.
* **``target_count`` becomes a monthly amount.** Before this revision it was
  cumulative (villages fully accepted by the end of the month, all-time).
  Every existing row is converted: its number minus the *current* target of
  the month before it. Two cases cannot be converted cleanly and are kept
  visible in the row's note rather than hidden:

  - no target for the month before -> the number is kept as it was, and the
    note says to check it (it is probably far too high for one month);
  - the month before was higher -> the number becomes 0, and the note says so.

  Every converted row's note ends with ``[Converted from cumulative target N
  ...]``, holding the original number. Nothing else in the row changes:
  versions, ``is_current``, who set it and when are all kept.
* The version uniqueness moves from (year, month, version) to
  (**stream**, year, month, version), and the lookup index gains the stream
  the same way. Every existing row is ACCEPTANCE, so the rows that were
  unique before are still unique.

No row is inserted or deleted.

**Downgrade** turns every ACCEPTANCE row back into a cumulative number -- the
original from its note where there is one, otherwise the previous month's
cumulative plus this month's amount -- strips the note marker, drops the
column and puts the old constraint and index back. It refuses to run while any ``DT`` target exists: under the old constraint a DT
and an Acceptance target for the same month would collide, and the older code
would read a DT row as an acceptance target. Targets are append-only, so the
only way through would be deleting them, which this migration never does.

Revision ID: c4f9a2e7d318
Revises: b3e8d1f5a927
Create Date: 2026-09-26
"""
import re

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


MARKER = re.compile(r"\s*\[Converted from cumulative target (\d+)[^\]]*\]$")


def _previous(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _rows(bind):
    return bind.execute(
        sa.text(
            f"SELECT id, shamsi_year, shamsi_month, is_current, target_count, note "
            f"FROM {TABLE} ORDER BY shamsi_year, shamsi_month, version"
        )
    ).fetchall()


def _set(bind, row_id: int, count: int, note: str | None) -> None:
    bind.execute(
        sa.text(f"UPDATE {TABLE} SET target_count = :n, note = :note WHERE id = :id"),
        {"n": count, "note": note, "id": row_id},
    )


def _to_monthly(bind) -> None:
    rows = _rows(bind)
    # The cumulative figures as stored, before anything is rewritten.
    current = {(r.shamsi_year, r.shamsi_month): r.target_count for r in rows if r.is_current}
    for r in rows:
        before = current.get(_previous(r.shamsi_year, r.shamsi_month))
        if before is None:
            count, flag = r.target_count, "; no earlier month to subtract, check this number"
        elif r.target_count < before:
            count, flag = 0, f"; the month before was higher ({before}), set to 0"
        else:
            count, flag = r.target_count - before, ""
        marker = f"[Converted from cumulative target {r.target_count}{flag}]"
        _set(bind, r.id, count, f"{r.note} {marker}" if r.note else marker)


def _to_cumulative(bind) -> None:
    rows = _rows(bind)
    cumulative: dict[tuple[int, int], int] = {}
    # Rows come oldest month first, so the month before is always settled
    # before the month that needs it.
    for r in rows:
        period = (r.shamsi_year, r.shamsi_month)
        match = MARKER.search(r.note or "")
        if match:
            count = int(match.group(1))
            note = MARKER.sub("", r.note) or None
        else:
            count = cumulative.get(_previous(*period), 0) + r.target_count
            note = r.note
        if r.is_current:
            cumulative[period] = count
        _set(bind, r.id, count, note)


def upgrade() -> None:
    # Guarded step by step, like the revisions before it: the live database
    # was originally built by ``Base.metadata.create_all()``, so the model's
    # shape can already be there -- and then its rows were written by code
    # that already stores monthly amounts, so they are not converted.
    if "stream" not in _columns():
        _to_monthly(op.get_bind())
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

        _to_cumulative(bind)

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
