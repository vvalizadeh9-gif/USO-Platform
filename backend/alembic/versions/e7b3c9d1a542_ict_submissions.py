"""Submissions to ICT (UEP-21): batches, items, letters, sightings.

* ``submission_settings``, ``submission_letter_files``, ``submission_batches``,
  ``submission_items``, ``cpm_village_sightings``: new tables, empty. The owner
  stays unset until the PM picks one; past batches arrive through the in-app
  import.
* ``mojri_import_runs.file_date``: nullable, no backfill (an older run reads as
  dated on its import day).
* ``villages.county`` / ``district`` / ``rural_district``: nullable, filled by
  the next CPM import; until then readers fall back to the site's values.

Two partial unique indexes carry the module's two invariants: one active item
per village, and one live batch per number.

Reversible: the downgrade drops exactly what the upgrade added.

Revision ID: e7b3c9d1a542
Revises: b8d4f2a6c913
Create Date: 2026-11-19
"""
import sqlalchemy as sa
from alembic import op

revision = "e7b3c9d1a542"
down_revision = "b8d4f2a6c913"
branch_labels = None
depends_on = None

_VILLAGE_COLUMNS = ("county", "district", "rural_district")


def _timestamps() -> list[sa.Column]:
    """The ``created_at`` / ``updated_at`` every model inherits from Base."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _letter_columns(prefix: str) -> list[sa.Column]:
    return [
        sa.Column(f"{prefix}_letter_no", sa.String(120)),
        sa.Column(f"{prefix}_letter_date", sa.Date),
        sa.Column(
            f"{prefix}_letter_file_id", sa.Integer, sa.ForeignKey("submission_letter_files.id")
        ),
    ]


def _create_tables(tables: set[str]) -> None:
    if "submission_settings" not in tables:
        op.create_table(
            "submission_settings",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("owner_user_id", sa.Integer, sa.ForeignKey("users.id")),
            sa.Column("updated_by", sa.Integer, sa.ForeignKey("users.id")),
            *_timestamps(),
        )
    if "submission_letter_files" not in tables:
        op.create_table(
            "submission_letter_files",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("sha256", sa.String(64), nullable=False),
            sa.Column("stored_path", sa.String(500), nullable=False),
            sa.Column("original_filename", sa.String(255), nullable=False),
            sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
            sa.Column("uploaded_by", sa.Integer, sa.ForeignKey("users.id")),
            *_timestamps(),
        )
    if "submission_batches" not in tables:
        op.create_table(
            "submission_batches",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("number", sa.Integer, nullable=False),
            sa.Column("status", sa.String(12), nullable=False),
            sa.Column("imported", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("source_filename", sa.String(255)),
            sa.Column("file_digest", sa.String(64), unique=True),
            sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id")),
            sa.Column("sent_at", sa.DateTime(timezone=True)),
            *_letter_columns("mtn"),
            *_letter_columns("ict"),
            *_letter_columns("cra"),
            *_timestamps(),
            sa.CheckConstraint(
                "status IN ('draft', 'sent', 'cancelled')", name="ck_submission_batch_status"
            ),
        )
        op.create_index("ix_submission_batches_number", "submission_batches", ["number"])
        op.create_index(
            "uq_submission_batch_number_live", "submission_batches", ["number"], unique=True,
            postgresql_where=sa.text("status <> 'cancelled'"),
            sqlite_where=sa.text("status <> 'cancelled'"),
        )
    if "submission_items" not in tables:
        op.create_table(
            "submission_items",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("batch_id", sa.Integer, sa.ForeignKey("submission_batches.id")),
            sa.Column("village_id", sa.Integer, sa.ForeignKey("villages.id"), nullable=False),
            sa.Column("site_code", sa.String(50)),
            sa.Column("site_type", sa.String(50)),
            sa.Column("village_code", sa.String(50)),
            sa.Column("reason", sa.String(20), nullable=False),
            sa.Column("source", sa.String(10), nullable=False),
            sa.Column("sent_at", sa.Date),
            sa.Column("mojri_confirmed_at", sa.Date),
            sa.Column("raised_at", sa.DateTime(timezone=True)),
            sa.Column("raised_by", sa.Integer, sa.ForeignKey("users.id")),
            sa.Column("raised_note", sa.Text),
            sa.Column("superseded_at", sa.DateTime(timezone=True)),
            sa.Column("superseded_by_id", sa.Integer, sa.ForeignKey("submission_items.id")),
            *_timestamps(),
            sa.CheckConstraint(
                "reason IN ('new_dt', 'missed', 'became_target', 'resend', 'outside', 'imported')",
                name="ck_submission_item_reason",
            ),
            sa.CheckConstraint(
                "source IN ('batch', 'import', 'mojri')", name="ck_submission_item_source"
            ),
        )
        op.create_index("ix_submission_items_batch_id", "submission_items", ["batch_id"])
        op.create_index("ix_submission_items_village_id", "submission_items", ["village_id"])
        op.create_index(
            "uq_submission_item_active_village", "submission_items", ["village_id"], unique=True,
            postgresql_where=sa.text("superseded_at IS NULL"),
            sqlite_where=sa.text("superseded_at IS NULL"),
        )
    if "cpm_village_sightings" not in tables:
        op.create_table(
            "cpm_village_sightings",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("site_code", sa.String(50), nullable=False),
            sa.Column("site_type", sa.String(50), nullable=False),
            sa.Column("village_code", sa.String(50), nullable=False),
            sa.Column("classification", sa.String(60)),
            sa.Column(
                "first_seen_batch_id", sa.Integer, sa.ForeignKey("cpm_import_batches.id")
            ),
            sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
            *_timestamps(),
            sa.UniqueConstraint(
                "site_code", "site_type", "village_code", name="uq_cpm_village_sighting"
            ),
        )


def upgrade() -> None:
    # Guarded throughout: a database built by create_all already has these.
    _create_tables(_tables())
    if "file_date" not in _columns("mojri_import_runs"):
        op.add_column("mojri_import_runs", sa.Column("file_date", sa.Date(), nullable=True))
    present = _columns("villages")
    for name in _VILLAGE_COLUMNS:
        if name not in present:
            op.add_column("villages", sa.Column(name, sa.String(120), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("villages") as batch:
        for name in reversed(_VILLAGE_COLUMNS):
            batch.drop_column(name)
    with op.batch_alter_table("mojri_import_runs") as batch:
        batch.drop_column("file_date")
    op.drop_table("cpm_village_sightings")
    op.drop_index("uq_submission_item_active_village", table_name="submission_items")
    op.drop_table("submission_items")
    op.drop_index("uq_submission_batch_number_live", table_name="submission_batches")
    op.drop_table("submission_batches")
    op.drop_table("submission_letter_files")
    op.drop_table("submission_settings")
