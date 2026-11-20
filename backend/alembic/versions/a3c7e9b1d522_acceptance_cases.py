"""Acceptance cases (UEP-22): cases, case events, rejection categories.

* ``acceptance_rejection_categories``: master data, seeded with the seven
  categories and the basket each sends a rejection to.
* ``acceptance_cases``: one per village and authority (ICT, CRA). Empty here:
  cases are created, and existing acceptance data backfilled into them, by
  ``services/acceptance_cases/sync.py`` -- run once at deploy with
  ``python -m app.scripts.backfill_acceptance_cases`` and kept current on every
  read after that, so a village entering the universe gets its cases.
* ``acceptance_case_events``: append-only history.
* Role ``CpgPso``: the CPG PSO basket's team role (not a problem-category
  owner). Approved by the product owner for UEP-22; CPG PMO reuses
  ``CpgRolloutPM``.

Reversible: the downgrade drops the three tables, and the role when no user
holds it.

Revision ID: a3c7e9b1d522
Revises: e7b3c9d1a542
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "a3c7e9b1d522"
down_revision = "e7b3c9d1a542"
branch_labels = None
depends_on = None

CPG_PSO = "CpgPso"

#: (code, label, basket_role, sort)
CATEGORIES = (
    ("parked", "Parked", "PM", 10),
    ("nwg_rnd", "NWG R&D", "NwgPlanning", 20),
    ("contractor", "Contractor", "Contractor", 30),
    ("cpg_pso", "CPG PSO", CPG_PSO, 40),
    ("cpg_pmo", "CPG PMO", "CpgRolloutPM", 50),
    ("cpg_power", "CPG Power", "CpgPower", 60),
    ("ms", "MS", "ManagedService", 70),
)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _create_categories() -> None:
    table = op.create_table(
        "acceptance_rejection_categories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(30), nullable=False, unique=True),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("basket_role", sa.String(50), nullable=False),
        sa.Column("sort", sa.Integer, nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_timestamps(),
    )
    op.bulk_insert(table, [
        {"code": c, "label": label, "basket_role": role, "sort": sort, "active": True}
        for c, label, role, sort in CATEGORIES
    ])


def _create_cases() -> None:
    op.create_table(
        "acceptance_cases",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("village_id", sa.Integer, sa.ForeignKey("villages.id"), nullable=False),
        sa.Column("authority", sa.String(10), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("category_id", sa.Integer, sa.ForeignKey("acceptance_rejection_categories.id")),
        sa.Column("basket_role", sa.String(50)),
        sa.Column("state_since", sa.Date, nullable=False),
        sa.Column("dt_approved_on", sa.Date),
        sa.Column("legacy", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("last_comment_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.UniqueConstraint("village_id", "authority", name="uq_acceptance_case_village_authority"),
        sa.CheckConstraint("authority IN ('ICT', 'CRA')", name="ck_acceptance_case_authority"),
        sa.CheckConstraint(
            "state IN ('waiting', 'rejected', 'approved')", name="ck_acceptance_case_state"
        ),
    )
    op.create_index("ix_acceptance_cases_village_id", "acceptance_cases", ["village_id"])
    op.create_index(
        "ix_acceptance_cases_state_basket", "acceptance_cases", ["authority", "state", "basket_role"]
    )


def _create_events() -> None:
    op.create_table(
        "acceptance_case_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("case_id", sa.Integer, sa.ForeignKey("acceptance_cases.id"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("category_id", sa.Integer, sa.ForeignKey("acceptance_rejection_categories.id")),
        sa.Column("letter_no", sa.String(120)),
        sa.Column("letter_date", sa.Date),
        sa.Column("evidence_id", sa.Integer, sa.ForeignKey("acceptance_evidence.id")),
        sa.Column("comment", sa.Text),
        sa.Column("actor_user_id", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("meta", sa.JSON().with_variant(JSONB(), "postgresql")),
        sa.Column("request_id", sa.String(64)),
        *_timestamps(),
        sa.CheckConstraint(
            "kind IN ('created', 'submitted', 'approved', 'rejected', 'fixed', 'comment', 'basket_changed')",
            name="ck_acceptance_case_event_kind",
        ),
    )
    op.create_index("ix_acceptance_case_events_case", "acceptance_case_events", ["case_id", "created_at"])
    op.create_index("ix_acceptance_case_events_request", "acceptance_case_events", ["request_id"])


def _add_role() -> None:
    bind = op.get_bind()
    exists = bind.execute(sa.text("SELECT 1 FROM roles WHERE name = :n"), {"n": CPG_PSO}).first()
    if not exists:
        bind.execute(
            sa.text("INSERT INTO roles (name, is_category_owner, created_at, updated_at) "
                    "VALUES (:n, :f, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
            {"n": CPG_PSO, "f": False},
        )


def upgrade() -> None:
    tables = _tables()
    if "acceptance_rejection_categories" not in tables:
        _create_categories()
    if "acceptance_cases" not in tables:
        _create_cases()
    if "acceptance_case_events" not in tables:
        _create_events()
    _add_role()


def downgrade() -> None:
    op.drop_table("acceptance_case_events")
    op.drop_table("acceptance_cases")
    op.drop_table("acceptance_rejection_categories")
    op.get_bind().execute(
        sa.text("DELETE FROM roles WHERE name = :n "
                "AND NOT EXISTS (SELECT 1 FROM users u WHERE u.role_id = roles.id)"),
        {"n": CPG_PSO},
    )
