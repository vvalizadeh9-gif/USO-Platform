"""UEP-24 lab fixes: one open drive test per site, and DT Done stages.

* **F2.** Duplicate ``Submitted`` drive tests are marked ``Superseded`` (kept,
  shown in history, counted nowhere): every ``Submitted`` row that is no longer
  the site's active drive test, and every active one but the newest. Then a
  partial unique index allows one ``Submitted`` row per work item.
* **F8.** A work item whose CPM drive-test status is Done but whose stage still
  reads ``New`` gets the stage ``DT Done``.

Both data steps only touch rows still in the old state, so a second run
changes nothing; each logs how many rows it changed. Migrations run at every
start-up through ``app.scripts.migrate_with_lock``.

Revision ID: d2a7f4c9e815
Revises: c4e8a2f6b310
Create Date: 2026-11-25
"""
import logging

import sqlalchemy as sa
from alembic import op

revision = "d2a7f4c9e815"
down_revision = "c4e8a2f6b310"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

INDEX = "uq_drive_tests_one_submitted"


def supersede_duplicate_drive_tests(bind) -> int:
    """Mark extra Submitted rows Superseded. Returns the rows changed."""
    result = bind.execute(sa.text(
        """
        UPDATE drive_tests SET status = 'Superseded'
        WHERE status = 'Submitted'
          AND (
            is_active = :false
            OR id NOT IN (
              SELECT keep_id FROM (
                SELECT MAX(id) AS keep_id FROM drive_tests
                WHERE status = 'Submitted' AND is_active = :true
                GROUP BY work_item_id
              ) AS newest
            )
          )
        """
    ), {"true": True, "false": False})
    return result.rowcount or 0


def fix_dt_done_stages(bind) -> int:
    """Stage ``New`` -> ``DT Done`` where CPM says the drive test is Done."""
    result = bind.execute(sa.text(
        "UPDATE work_items SET current_stage = 'DT Done' "
        "WHERE current_stage = 'New' AND LOWER(TRIM(dt_status)) = 'done'"
    ))
    return result.rowcount or 0


def _indexes() -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("drive_tests")}


def upgrade() -> None:
    bind = op.get_bind()
    changed = supersede_duplicate_drive_tests(bind)
    log.info("UEP-24 F2: %d duplicate drive test(s) marked Superseded", changed)
    if INDEX not in _indexes():
        op.create_index(
            INDEX, "drive_tests", ["work_item_id"], unique=True,
            postgresql_where=sa.text("status = 'Submitted'"),
            sqlite_where=sa.text("status = 'Submitted'"),
        )
    fixed = fix_dt_done_stages(bind)
    log.info("UEP-24 F8: %d work item(s) moved from New to DT Done", fixed)


def downgrade() -> None:
    # The data steps are corrections and are not reversed.
    if INDEX in _indexes():
        op.drop_index(INDEX, table_name="drive_tests")
