"""Uploaded files in the database (UEP-20): ``stored_files``.

* ``stored_files``: one row per distinct file, keyed by SHA-256, holding the
  bytes (BYTEA) and a ``retain`` flag for files that are never deleted (CPM
  workbooks).
* ``cpm_import_batches.source_sha256``: the workbook each import read, kept
  forever. Null for imports made before this release.

Structure only. Files already on an old uploads volume are copied by the
one-time script ``python -m app.scripts.migrate_uploads_to_db``, not here, so
this migration is fast and safe to run at every start-up.

No column of the evidence tables is dropped or renamed, so the downgrade only
removes what this adds. Downgrading discards the stored bytes: copy them back
out first if an older release has to serve them.

Revision ID: c4e8a2f6b310
Revises: a3c7e9b1d522
Create Date: 2026-11-22
"""
import sqlalchemy as sa
from alembic import op

revision = "c4e8a2f6b310"
down_revision = "a3c7e9b1d522"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Guarded like the other migrations: a legacy database built by
    # create_all() from current models already has both.
    if "stored_files" in _tables():
        _add_source_sha256()
        return
    op.create_table(
        "stored_files",
        sa.Column("sha256", sa.String(64), primary_key=True),
        sa.Column("extension", sa.String(8), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("retain", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    _add_source_sha256()


def _add_source_sha256() -> None:
    if "source_sha256" in _columns("cpm_import_batches"):
        return
    with op.batch_alter_table("cpm_import_batches") as batch:
        batch.add_column(sa.Column("source_sha256", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cpm_import_batches") as batch:
        batch.drop_column("source_sha256")
    op.drop_table("stored_files")
