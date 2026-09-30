"""Clear every Mojri tracker status: each was matched on the wrong key.

Until this revision the Mojri importer looked each row up by ``villages.id``,
the internal primary key. Nobody filling the template can know that number, so
the team filled the column with CPM village codes. Every row either matched
nothing or -- worse -- matched the unrelated village whose primary key happened
to equal the code, and wrote a status onto that village. There is no way to
tell the second kind from a correct row after the fact, so **no existing row in
``mojri_tracker_status`` can be trusted**, and every one is deleted.

The importer now matches on ``(site_code, site_type, village_code)``
(``services/mojri_tracker.py``). After deploy the PM re-uploads the current
file once, and the table is rebuilt from it.

**Kept:** ``mojri_import_runs``. It is the audit history of who imported which
file and when; its counts described what the preview showed at the time, and
that record stays true even though the statuses it wrote do not.

**Downgrade is a no-op.** The deleted rows were wrong, and there is nothing to
put back. The older code runs against an empty table exactly as it would before
its first import.

Data only: no table, column, constraint or index changes.

Revision ID: e9a4c7b2d153
Revises: c4f9a2e7d318
Create Date: 2026-09-30
"""
import sqlalchemy as sa
from alembic import op

revision = "e9a4c7b2d153"
down_revision = "c4f9a2e7d318"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM mojri_tracker_status"))


def downgrade() -> None:
    """Nothing to restore: the rows deleted by the upgrade were wrong."""
