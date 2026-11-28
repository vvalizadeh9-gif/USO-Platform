"""UEP-29: bulk data import (drive test + acceptance) from Admin.

Creates ``import_batches``, ``import_rows`` and ``import_changes``; adds
``source`` (``app`` | ``import``) and ``import_batch_id`` to ``assignments``,
``drive_tests``, ``hc_assignments`` and ``hc_tasks`` (none of them had a source
column); adds the ``data_import`` feature (View, Edit) and grants it to PM at
Edit. ``acceptance_submissions.source`` takes the new value ``Import`` with no
schema change (it is a free String(20)).

Idempotent: a table, column or index that already exists (a database built by
``create_all``) is skipped, and every insert is skipped when its row exists.
Reversible: the downgrade drops what the upgrade added.

Revision ID: c5e1a7d3b920
Revises: a8c4e2f7b913
Create Date: 2026-11-28
"""
import logging

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c5e1a7d3b920"
down_revision = "a8c4e2f7b913"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

FEATURE_KEY = "data_import"
#: (key, app, label, description, levels, sort_order)
FEATURE = (
    FEATURE_KEY, "Admin", "Data import",
    "Load drive test and acceptance data from Excel, review, apply and undo", "view,edit", 405,
)
#: (role, level)
GRANTS = [("PM", "edit")]

SOURCE_TABLES = ("assignments", "drive_tests", "hc_assignments", "hc_tasks")


def _json():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "import_batches" not in tables:
        op.create_table(
            "import_batches",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("number", sa.Integer(), nullable=False, unique=True),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("file_sha256", sa.String(64), nullable=False, index=True),
            sa.Column("evidence_file_id", sa.String(64), nullable=True),
            sa.Column("status", sa.String(12), nullable=False, server_default="previewed"),
            sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("applied_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("undone_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("counts", _json(), nullable=True),
            *_timestamps(),
        )
    if "import_rows" not in tables:
        op.create_table(
            "import_rows",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("batch_id", sa.Integer(), sa.ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=False),
            sa.Column("row_no", sa.Integer(), nullable=False),
            sa.Column("key_text", sa.String(200), nullable=False),
            sa.Column("work_item_id", sa.Integer(), sa.ForeignKey("work_items.id"), nullable=True),
            sa.Column("village_id", sa.Integer(), sa.ForeignKey("villages.id"), nullable=True),
            sa.Column("status", sa.String(12), nullable=False, server_default="ok"),
            sa.Column("errors", _json(), nullable=True),
            sa.Column("raw", _json(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_import_rows_batch", "import_rows", ["batch_id", "row_no"])
    if "import_changes" not in tables:
        op.create_table(
            "import_changes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("batch_id", sa.Integer(), sa.ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=False),
            sa.Column("row_id", sa.Integer(), sa.ForeignKey("import_rows.id", ondelete="CASCADE"), nullable=True),
            sa.Column("entity_type", sa.String(30), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("field", sa.String(40), nullable=False),
            sa.Column("old_value", _json(), nullable=True),
            sa.Column("new_value", _json(), nullable=True),
            sa.Column("kind", sa.String(10), nullable=False),
            sa.Column("decision", sa.String(10), nullable=True),
            sa.Column("old_source", sa.Text(), nullable=True),
            sa.Column("applied", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_record_type", sa.String(40), nullable=True),
            sa.Column("created_record_id", sa.Integer(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_import_changes_batch", "import_changes", ["batch_id"])
        op.create_index("ix_import_changes_entity", "import_changes", ["entity_type", "entity_id"])

    for table in SOURCE_TABLES:
        columns = {c["name"] for c in sa.inspect(bind).get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "source" not in columns:
                batch.add_column(sa.Column("source", sa.String(10), nullable=False, server_default="app"))
            if "import_batch_id" not in columns:
                batch.add_column(sa.Column("import_batch_id", sa.Integer(), nullable=True))
                # PostgreSQL's own default name, so a database built by
                # create_all and one built by this migration match.
                batch.create_foreign_key(
                    f"{table}_import_batch_id_fkey", "import_batches", ["import_batch_id"], ["id"]
                )
        indexes = {i["name"] for i in sa.inspect(bind).get_indexes(table)}
        name = f"ix_{table}_import_batch_id"
        if name not in indexes:
            op.create_index(name, table, ["import_batch_id"])

    seed(bind)


def seed(bind) -> None:
    key, app, label, description, levels, order = FEATURE
    if bind.execute(sa.text("SELECT 1 FROM features WHERE key = :k"), {"k": key}).first() is None:
        bind.execute(sa.text(
            "INSERT INTO features (key, app, label, description, levels, sort_order) "
            "VALUES (:k, :a, :l, :d, :v, :o)"
        ), {"k": key, "a": app, "l": label, "d": description, "v": levels, "o": order})

    granted = 0
    for role, level in GRANTS:
        role_id = bind.execute(sa.text("SELECT id FROM roles WHERE name = :n"), {"n": role}).scalar()
        if role_id is None:
            continue
        exists = bind.execute(sa.text(
            "SELECT 1 FROM role_feature_grants WHERE role_id = :r AND feature_key = :k"
        ), {"r": role_id, "k": key}).first()
        if exists is None:
            bind.execute(sa.text(
                "INSERT INTO role_feature_grants (role_id, feature_key, level, hidden_in_menus) "
                "VALUES (:r, :k, :l, :h)"
            ), {"r": role_id, "k": key, "l": level, "h": False})
            granted += 1
    if granted:
        bind.execute(sa.text("UPDATE access_version SET version = version + 1"))
    log.info("UEP-29: %s role grants seeded", granted)


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM role_feature_grants WHERE feature_key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("DELETE FROM user_feature_overrides WHERE feature_key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("DELETE FROM features WHERE key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("UPDATE access_version SET version = version + 1"))

    for table in SOURCE_TABLES:
        op.drop_index(f"ix_{table}_import_batch_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"{table}_import_batch_id_fkey", type_="foreignkey")
            batch.drop_column("import_batch_id")
            batch.drop_column("source")

    op.drop_table("import_changes")
    op.drop_table("import_rows")
    op.drop_table("import_batches")
