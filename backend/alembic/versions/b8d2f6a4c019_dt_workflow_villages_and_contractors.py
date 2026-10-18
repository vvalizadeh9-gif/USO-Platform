"""Drive test workflow (UEP-14): villages per assignment, DT rounds, and the
contractor clean-up.

* ``hc_task_villages`` and ``assignment_villages``: the villages each HC task
  and DT assignment covered when it was made. Backfilled from each site's
  current villages.
* ``villages.first_seen_at``: when the CPM import first stored the village.
  Backfilled as NULL (unknown), so no existing village reads as new.
* ``assignments.round_no``: a send back opens round N+1 with the same
  contractor. Existing rows are round 1.
* Contractors whose name is a DT status word (Ongoing, Done, Problematic,
  Site SC, blank) were created by the CPM import from status cells. Those with
  no assignments are deactivated; those with assignments are left alone and
  listed in the migration log for manual review.

Revision ID: b8d2f6a4c019
Revises: a7c3e9d2f514
Create Date: 2026-10-18
"""
import logging

import sqlalchemy as sa
from alembic import op

revision = "b8d2f6a4c019"
down_revision = "a7c3e9d2f514"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

#: Lower-cased contractor names that are status words, not companies.
JUNK_NAMES = ("ongoing", "done", "problematic", "problematical", "site sc", "")


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if "hc_task_villages" not in tables:
        op.create_table(
            "hc_task_villages",
            sa.Column("hc_task_id", sa.Integer, sa.ForeignKey("hc_tasks.id"), primary_key=True),
            sa.Column("village_id", sa.Integer, sa.ForeignKey("villages.id"), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if "assignment_villages" not in tables:
        op.create_table(
            "assignment_villages",
            sa.Column("assignment_id", sa.Integer, sa.ForeignKey("assignments.id"), primary_key=True),
            sa.Column("village_id", sa.Integer, sa.ForeignKey("villages.id"), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if "first_seen_at" not in _columns("villages"):
        with op.batch_alter_table("villages") as batch:
            batch.add_column(sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True))
    if "round_no" not in _columns("assignments"):
        with op.batch_alter_table("assignments") as batch:
            batch.add_column(sa.Column("round_no", sa.Integer, nullable=False, server_default="1"))

    bind = op.get_bind()
    # Backfill: each task / assignment covered its site's current villages.
    bind.execute(sa.text(
        "INSERT INTO hc_task_villages (hc_task_id, village_id) "
        "SELECT t.id, v.id FROM hc_tasks t JOIN villages v ON v.work_item_id = t.work_item_id "
        "WHERE v.deleted_at IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM hc_task_villages x WHERE x.hc_task_id = t.id AND x.village_id = v.id)"
    ))
    bind.execute(sa.text(
        "INSERT INTO assignment_villages (assignment_id, village_id) "
        "SELECT a.id, v.id FROM assignments a JOIN villages v ON v.work_item_id = a.work_item_id "
        "WHERE v.deleted_at IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM assignment_villages x WHERE x.assignment_id = a.id AND x.village_id = v.id)"
    ))

    # Contractor clean-up.
    rows = bind.execute(sa.text("SELECT id, name FROM contractors WHERE active = :t"), {"t": True}).all()
    junk = [(cid, name) for cid, name in rows if " ".join((name or "").split()).lower() in JUNK_NAMES]
    for cid, name in junk:
        used = bind.execute(
            sa.text(
                "SELECT (SELECT COUNT(*) FROM assignments WHERE contractor_id = :c)"
                " + (SELECT COUNT(*) FROM hc_assignments WHERE contractor_id = :c)"
            ),
            {"c": cid},
        ).scalar()
        if used:
            log.warning("Contractor %s (%r) looks like a status word but has %s assignments: review by hand", cid, name, used)
            continue
        bind.execute(sa.text("UPDATE contractors SET active = :f WHERE id = :c"), {"f": False, "c": cid})
        log.info("Deactivated contractor %s (%r): a DT status word, not a company", cid, name)


def downgrade() -> None:
    # Deactivated contractors stay deactivated: re-activating junk rows is
    # never wanted.
    with op.batch_alter_table("assignments") as batch:
        batch.drop_column("round_no")
    with op.batch_alter_table("villages") as batch:
        batch.drop_column("first_seen_at")
    op.drop_table("assignment_villages")
    op.drop_table("hc_task_villages")
