"""Roles Performance: first time a site or village was seen on air.

**Purely additive.** One new table; nothing existing is altered.

``lifecycle_status_history`` records the first CPM import in which an entity
appeared in a status (today only ``on_air``). It is the fallback on-air date
for rows CPM gives no launch date for; see ``models/performance.py``.

No ``performance_event`` table is created. The brief asked for one, as an
append-only log of filings, validations, rejections and re-filings; the
acceptance submission rows already are that log (a reviewed round is never
changed, a re-filing is a new round), so the activity figures read them in
place. ARCHITECTURE.md section 5b records the decision.

The table starts empty. The first CPM import after this migration fills it and
marks those rows ``backfilled``, so they never count as on-air events.

Revision ID: c2e8f4a6b913
Revises: a1c3e5f7b902
Create Date: 2026-10-02
"""
import sqlalchemy as sa
from alembic import op

revision = "c2e8f4a6b913"
down_revision = "a1c3e5f7b902"
branch_labels = None
depends_on = None

TABLE = "lifecycle_status_history"


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if _has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entity_type", sa.String(length=10), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "cpm_import_batch_id",
            sa.Integer(),
            sa.ForeignKey("cpm_import_batches.id"),
            nullable=True,
        ),
        sa.Column(
            "backfilled", sa.Boolean(), server_default="0", nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "entity_type", "entity_id", "status", name="uq_lifecycle_status_first"
        ),
    )


def downgrade() -> None:
    if _has_table(TABLE):
        op.drop_table(TABLE)
