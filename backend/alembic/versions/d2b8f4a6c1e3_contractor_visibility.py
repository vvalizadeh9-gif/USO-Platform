"""UEP-31: which contractors appear in Drive test, and contractors added by hand.

Adds two columns to ``contractors`` (``created_at`` is already there, as on
every table):

* ``show_in_drive_test`` (default true): Drive test's Assign columns list only
  these. ``active`` is left alone: search, data import, Monthly Plan and
  analytics read it;
* ``source`` (``cpm`` | ``manual``, default ``cpm``).

Then hides every drive-test contractor with no health check and no drive test
assigned in the last 180 days and no open work, and logs their names. Adds the
``contractors`` feature (View, Edit): PM and Admin edit, Viewer views.

Idempotent: a column that exists is skipped, every insert is skipped when its
row exists. Reversible: the downgrade drops what the upgrade added.

Revision ID: d2b8f4a6c1e3
Revises: c5e1a7d3b920
Create Date: 2026-11-28
"""
import logging
from datetime import datetime, timedelta, timezone

import sqlalchemy as sa
from alembic import op

revision = "d2b8f4a6c1e3"
down_revision = "c5e1a7d3b920"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

FEATURE_KEY = "contractors"
#: (key, app, label, description, levels, sort_order)
FEATURE = (
    FEATURE_KEY, "Admin", "Contractors",
    "Which contractors appear in Drive test, and contractors added by hand", "view,edit", 325,
)
#: (role, level)
GRANTS = [("PM", "edit"), ("Admin", "edit"), ("Viewer", "view")]

INACTIVE_DAYS = 180


def upgrade() -> None:
    bind = op.get_bind()
    have = {c["name"] for c in sa.inspect(bind).get_columns("contractors")}
    if "show_in_drive_test" not in have:
        op.add_column("contractors", sa.Column("show_in_drive_test", sa.Boolean(), nullable=False, server_default=sa.true()))
    if "source" not in have:
        op.add_column("contractors", sa.Column("source", sa.String(10), nullable=False, server_default="cpm"))
    if "show_in_drive_test" not in have:
        hide_inactive(bind, datetime.now(timezone.utc))
    seed(bind)


def hide_inactive(bind, now: datetime) -> list[str]:
    """Hide drive-test contractors with no work assigned in the last 180 days
    and none open; return and log their names."""
    rows = bind.execute(sa.text(
        "SELECT c.id, c.name FROM contractors c "
        "WHERE c.type = 'drive_test' AND c.show_in_drive_test = :t "
        "AND NOT EXISTS (SELECT 1 FROM hc_assignments h WHERE h.contractor_id = c.id AND h.assigned_at >= :since) "
        "AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.contractor_id = c.id AND a.assigned_at >= :since) "
        "AND NOT EXISTS (SELECT 1 FROM hc_tasks t JOIN hc_assignments h ON h.id = t.hc_assignment_id "
        "                WHERE h.contractor_id = c.id AND t.completed_at IS NULL) "
        "AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.contractor_id = c.id AND a.is_active = :t "
        "                AND a.returned_at IS NULL) "
        "ORDER BY c.name"
    ), {"t": True, "since": now - timedelta(days=INACTIVE_DAYS)}).all()
    if rows:
        bind.execute(
            sa.text("UPDATE contractors SET show_in_drive_test = :f WHERE id IN :ids").bindparams(sa.bindparam("ids", expanding=True)),
            {"f": False, "ids": [r.id for r in rows]},
        )
    names = [r.name for r in rows]
    log.info("UEP-31: %s drive-test contractors hidden from Drive test: %s", len(names), ", ".join(names) or "none")
    return names


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
    log.info("UEP-31: %s role grants seeded", granted)


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM role_feature_grants WHERE feature_key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("DELETE FROM user_feature_overrides WHERE feature_key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("DELETE FROM features WHERE key = :k"), {"k": FEATURE_KEY})
    bind.execute(sa.text("UPDATE access_version SET version = version + 1"))
    with op.batch_alter_table("contractors") as batch:
        batch.drop_column("source")
        batch.drop_column("show_in_drive_test")
