"""Capture month-over-month movement on the drive-test snapshot.

**Purely additive. No existing column is altered, retyped, renamed or dropped,
and no existing row is read, rewritten or deleted by this revision.**

The snapshot table has always stored balances: where the project stood at the
end of a Shamsi month. Those answer "remaining is down 144" and nothing else,
and the single net number hides the two facts a reader actually needs -- how
many drive tests were completed, and how many new sites arrived. It is worse
for problematic, where "+47" is either forty-seven sites newly flagged with
none resolved or sixty flagged against thirteen resolved, which are opposite
situations. None of it can be reconstructed afterwards: a site that went
ongoing -> problematic -> resolved -> done reads today exactly like one that
went straight through.

Two shapes, chosen for two different reasons:

* **Nullable columns on ``monthly_snapshots``** for the opening and closing
  balances and the flows between them. These are one-per-period figures, so
  they are one-to-one with the row that already exists; a companion table
  would have meant a join on every read and would have allowed a period to
  exist with no movement figures at all, which is a state nothing would know
  how to interpret. Nullable is what keeps every row written before today
  valid: those months were never captured this way, the columns say so by
  being NULL, and the dashboard -- which reads only the ``total_*`` columns --
  cannot tell the difference.

* **A new table, ``snapshot_contractor_completions``**, for drive tests
  completed per contractor per month, which is what makes "completed by
  contractor, this month against last" answerable. This one cannot be columns:
  it is one row per contractor per month, and the set of contractors changes,
  so columns would mean a migration every time a company is added.

``contractor_id`` is nullable there on purpose. A completed drive test that no
contractor can be attributed to still happened, and dropping it would break
the one property that makes these rows checkable -- that they sum to the
month's total.

Nothing here backfills. Past months stay NULL, and deciding whether an
approximate history is better than none is not this revision's call to make.

Revision ID: 2048d4a336ff
Revises: d41bba0eaa52
Create Date: 2026-09-10
"""
from alembic import op
import sqlalchemy as sa

revision = "2048d4a336ff"
down_revision = "d41bba0eaa52"
branch_labels = None
depends_on = None

SNAPSHOTS = "monthly_snapshots"
COMPLETIONS = "snapshot_contractor_completions"

#: The integer columns added to ``monthly_snapshots``, in reading order:
#: the balance at each end of the month, then the flows between them.
MOVEMENT_COLUMNS = (
    "opening_onair",
    "opening_dt_done",
    "opening_remaining",
    "opening_ongoing",
    "opening_problematic",
    "closing_onair",
    "closing_dt_done",
    "closing_remaining",
    "closing_ongoing",
    "closing_problematic",
    "flow_new_onair",
    "flow_dt_completed",
    "flow_newly_problematic",
    "flow_problematic_resolved",
    "flow_ongoing_adjustment",
)

#: The rest: where the opening balance came from, and when each end was read.
#: The two timestamps exist because nothing in this platform runs on a clock --
#: a snapshot is written when somebody signs in -- so "closing" means the last
#: reading taken before the month ended, and a reader has to be able to see how
#: close to the boundary that was.
OTHER_COLUMNS = (
    ("opening_source", sa.String(length=20)),
    ("opening_captured_at", sa.DateTime(timezone=True)),
    ("closing_captured_at", sa.DateTime(timezone=True)),
)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded, like the revisions before it and for the same reason: the live
    # database was originally built by ``Base.metadata.create_all()`` rather
    # than by Alembic, so a table or column the models declare can already
    # exist. An unguarded ADD COLUMN is an error in PostgreSQL and would fail
    # the deploy on exactly the database this migration exists to serve.
    for name in MOVEMENT_COLUMNS:
        if not _has_column(SNAPSHOTS, name):
            op.add_column(SNAPSHOTS, sa.Column(name, sa.Integer(), nullable=True))

    for name, type_ in OTHER_COLUMNS:
        if not _has_column(SNAPSHOTS, name):
            op.add_column(SNAPSHOTS, sa.Column(name, type_, nullable=True))

    if not _has_table(COMPLETIONS):
        op.create_table(
            COMPLETIONS,
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("snapshot_id", sa.Integer(), nullable=False),
            # Nullable: unattributable completions are counted, not dropped.
            sa.Column("contractor_id", sa.Integer(), nullable=True),
            sa.Column(
                "dt_completed",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            # ``sa.func.now()`` rather than a literal ``now()``, like the
            # revisions before it: the test suite builds this schema on
            # SQLite, which has no such function, and the dialect renders
            # this one correctly on both.
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
            sa.ForeignKeyConstraint(["contractor_id"], ["contractors.id"]),
            # CASCADE: these rows are part of the snapshot, not a record in
            # their own right. Deleting a snapshot without them would leave
            # orphans that no code path can reach.
            sa.ForeignKeyConstraint(
                ["snapshot_id"], [f"{SNAPSHOTS}.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "snapshot_id", "contractor_id", name="uq_snapshot_contractor"
            ),
        )
        op.create_index(
            op.f(f"ix_{COMPLETIONS}_snapshot_id"),
            COMPLETIONS,
            ["snapshot_id"],
            unique=False,
        )


def downgrade() -> None:
    # Drops only what this revision created. The six original ``total_*``
    # balances, and every row holding them, are untouched in both directions.
    if _has_table(COMPLETIONS):
        op.drop_index(op.f(f"ix_{COMPLETIONS}_snapshot_id"), table_name=COMPLETIONS)
        op.drop_table(COMPLETIONS)

    for name, _ in reversed(OTHER_COLUMNS):
        if _has_column(SNAPSHOTS, name):
            op.drop_column(SNAPSHOTS, name)

    for name in reversed(MOVEMENT_COLUMNS):
        if _has_column(SNAPSHOTS, name):
            op.drop_column(SNAPSHOTS, name)
