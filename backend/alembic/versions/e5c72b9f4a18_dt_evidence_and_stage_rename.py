"""Drive-test evidence, and the stage rename to "DT Done".

Two changes, both on the drive-test half of the lifecycle.

**drive_tests.submitted_at** records when a drive test was handed in, which is
not the same fact as ``execution_date`` -- one driven three weeks ago can be
submitted today, and the review queue ages on the submission. The code read
``created_at`` for this, whose server default both databases truncate to the
second, so two events a fraction of a second apart could order backwards in a
site's timeline. Backfilled from ``created_at``.

**drive_test_evidence** is a new child table of ``drive_tests``, modelled on
``acceptance_evidence`` and sharing its store: capped read, SHA-256, safe
filename, files on disk with only their metadata in the database. A drive test
previously carried nothing but a date and an optional free-text ``report_link``
that no screen ever set, so an approver had nothing to approve against.

**work_items.current_stage** is a derived column, recomputed from the records
by ``services/workflow.derive_stage``. Two of the values it can hold changed:

* ``Coordinator Approved`` becomes ``DT Done``. The stage says what is true of
  the site rather than who last touched it -- and since a PM may now approve a
  drive test as well, the old name had stopped being accurate.
* Sites in an open or unreviewed health check gain ``HC In Progress`` and
  ``HC Review``. Those are new states, not renames, so nothing needs
  rewriting: the next ``refresh_stage`` computes them.

Rewriting the stored ``Coordinator Approved`` rows is not strictly required --
the column is derived, and any write to those sites would fix itself -- but a
site whose drive test is finished may never be written again, so leaving them
would mean a permanent split between two spellings of one state, and a stage
filter that silently misses half its rows.

Revision ID: e5c72b9f4a18
Revises: d8f4a13c6e07
Create Date: 2026-09-07
"""
from alembic import op
import sqlalchemy as sa

revision = "e5c72b9f4a18"
down_revision = "d8f4a13c6e07"
branch_labels = None
depends_on = None

OLD_STAGE = "Coordinator Approved"
NEW_STAGE = "DT Done"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded, like the baseline revision and for the same reason: the live
    # database was never built by Alembic. It was built by
    # ``Base.metadata.create_all()`` running on every application start, so it
    # already carries every table and column the models declare -- including
    # the two this revision adds. An unguarded CREATE TABLE would fail the
    # deploy on exactly the database this migration exists to serve.
    if not _has_table("drive_test_evidence"):
        op.create_table(
            "drive_test_evidence",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "drive_test_id",
                sa.Integer(),
                sa.ForeignKey("drive_tests.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            # The content hash, so the same report uploaded twice is recognisable
            # and a stored file can be checked against what was received.
            sa.Column("sha256", sa.String(length=64), nullable=False),
            sa.Column("stored_path", sa.String(length=500), nullable=False),
            sa.Column("original_filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=100)),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column(
                "uploaded_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
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
        )

    # When a drive test was handed in, as distinct from when it was driven.
    # Backfilled from created_at, which is what the code read before and is
    # the best answer available for rows already in the database.
    if not _has_column("drive_tests", "submitted_at"):
        op.add_column(
            "drive_tests",
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        )
    # Backfilled unconditionally but only where it is still empty, so a
    # database that already had the column (built by create_all) is filled in
    # too, and a re-run cannot overwrite a real submission time with a
    # created_at that no longer matches it.
    op.execute(
        sa.text(
            "UPDATE drive_tests SET submitted_at = created_at "
            "WHERE submitted_at IS NULL"
        )
    )

    op.execute(
        sa.text(
            "UPDATE work_items SET current_stage = :new WHERE current_stage = :old"
        ).bindparams(new=NEW_STAGE, old=OLD_STAGE)
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE work_items SET current_stage = :old WHERE current_stage = :new"
        ).bindparams(new=NEW_STAGE, old=OLD_STAGE)
    )
    # The two new stages are derived, so a downgrade only has to stop them
    # being read as final states; the next refresh recomputes whatever the old
    # code would have produced.
    op.execute(
        sa.text(
            "UPDATE work_items SET current_stage = 'New' "
            "WHERE current_stage IN ('HC In Progress', 'HC Review')"
        )
    )
    if _has_column("drive_tests", "submitted_at"):
        op.drop_column("drive_tests", "submitted_at")
    if _has_table("drive_test_evidence"):
        op.drop_table("drive_test_evidence")
