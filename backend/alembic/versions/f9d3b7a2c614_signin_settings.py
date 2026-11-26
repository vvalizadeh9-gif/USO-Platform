"""UEP-26: sign-in page settings, and the ``signin_settings`` feature.

Creates ``signin_settings`` with its one empty row (id = 1), adds the
``signin_settings`` feature to the catalogue and grants it to Admin at Edit.
The access version is bumped so every pod re-reads the grants.

Idempotent: the table is skipped when it exists (a legacy database built by
``create_all``), and every insert is skipped when its row exists. Runs at
start-up through ``app.scripts.migrate_with_lock``.

Revision ID: f9d3b7a2c614
Revises: e3b7c1d9f425
Create Date: 2026-11-26
"""
import logging

import sqlalchemy as sa
from alembic import op

revision = "f9d3b7a2c614"
down_revision = "e3b7c1d9f425"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

FEATURE_KEY = "signin_settings"
#: (key, app, label, description, levels, sort_order)
FEATURE = (
    FEATURE_KEY, "Admin", "Sign-in page",
    "Support contact and planned-update notice on the sign-in page", "view,edit", 335,
)
#: (role, level)
GRANTS = [("Admin", "edit")]


def upgrade() -> None:
    bind = op.get_bind()
    if "signin_settings" not in set(sa.inspect(bind).get_table_names()):
        op.create_table(
            "signin_settings",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("support_name", sa.String(80), nullable=True),
            sa.Column("support_hours", sa.String(80), nullable=True),
            sa.Column("support_email", sa.String(254), nullable=True),
            sa.Column("support_phone", sa.String(40), nullable=True),
            sa.Column("notice_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("notice_text", sa.String(140), nullable=True),
            sa.Column("notice_from", sa.DateTime(timezone=True), nullable=True),
            sa.Column("notice_to", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    seed(bind)


def seed(bind) -> None:
    """The empty settings row, the feature and Admin's grant. Each skipped
    when already there."""
    if bind.execute(sa.text("SELECT 1 FROM signin_settings WHERE id = 1")).first() is None:
        bind.execute(sa.text("INSERT INTO signin_settings (id, notice_enabled) VALUES (1, :f)"), {"f": False})
        log.info("UEP-26: sign-in settings row seeded")

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
    log.info("UEP-26: %s role grants seeded", granted)


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM role_feature_grants WHERE feature_key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("DELETE FROM user_feature_overrides WHERE feature_key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("DELETE FROM features WHERE key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("UPDATE access_version SET version = version + 1"))
    op.drop_table("signin_settings")
