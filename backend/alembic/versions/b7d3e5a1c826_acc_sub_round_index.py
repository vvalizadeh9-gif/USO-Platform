"""Index acceptance submissions on (village_id, authority, round_no).

My Work reads a village's rounds per authority newest first -- the history in
each authority card, the carry-over from the last decided round, and the next
round number when a letter is filed. Every one of those is
``WHERE village_id = ? AND authority = ? ORDER BY round_no DESC``, and the only
index was on ``(village_id, authority)``, which finds the rows but sorts them.

The new index answers the filter and the order together. Its leading columns
are exactly the old index, so the old one is dropped rather than kept as a
second copy of the same prefix: every query it served, this one serves.

Deliberately **not unique**. ``f3c8a1d0b729`` resolved duplicate pending
submissions by withdrawing all but the newest, and the withdrawn rows kept
their round number, so (village, authority, round) already repeats in real
data. Making it unique would mean renumbering history, which this table never
does. Concurrent filings are serialised in the service instead.

Revision ID: b7d3e5a1c826
Revises: e9a4c7b2d153
Create Date: 2026-10-01

"""
import sqlalchemy as sa
from alembic import op

revision = "b7d3e5a1c826"
down_revision = "e9a4c7b2d153"
branch_labels = None
depends_on = None

TABLE = "acceptance_submissions"
NEW_INDEX = "ix_acc_sub_village_authority_round"
OLD_INDEX = "ix_acc_sub_village_authority"


def _indexes() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {i["name"] for i in inspector.get_indexes(TABLE)}


def upgrade() -> None:
    # Guarded as f3c8a1d0b729 is: a database built from the ORM models and
    # stamped at an older revision may already have the new index.
    existing = _indexes()
    if NEW_INDEX not in existing:
        op.create_index(NEW_INDEX, TABLE, ["village_id", "authority", "round_no"])
    if OLD_INDEX in existing:
        op.drop_index(OLD_INDEX, table_name=TABLE)


def downgrade() -> None:
    existing = _indexes()
    if OLD_INDEX not in existing:
        op.create_index(OLD_INDEX, TABLE, ["village_id", "authority"])
    if NEW_INDEX in existing:
        op.drop_index(NEW_INDEX, table_name=TABLE)
