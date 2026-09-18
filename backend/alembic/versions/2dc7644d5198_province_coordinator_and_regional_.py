"""Province coordinator and regional manager assignment.

**Purely additive.** Two nullable FK columns on ``provinces``, pointing at
``users``: ``coordinator_user_id`` and ``regional_manager_user_id``.

Neither Coordinator nor Regional Manager has a village-level attribution the
way a Contractor does (``work_items.dt_sc_contractor_id``) -- "which
coordinator owns this village" was previously only derivable indirectly, from
which provinces a coordinator happens to hold read access to via
``user_province_access``, and that table answers "can see", not "is
responsible for". These columns record the actual assignment Admin makes in
the Province Assignments screen, so the Acceptance Dashboard (and anything
else that needs it later) can filter by coordinator or regional manager the
same direct way it already filters by contractor.

Nullable, because a fresh or partially-staffed province has no assignment yet,
and that must not block anything from loading -- a report filtering by an
unset assignment simply finds nothing there.

Revision ID: 2dc7644d5198
Revises: 2048d4a336ff
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "2dc7644d5198"
down_revision = "2048d4a336ff"
branch_labels = None
depends_on = None

PROVINCES = "provinces"
COLUMNS = ("coordinator_user_id", "regional_manager_user_id")


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(PROVINCES)}


def _fk_name(column: str) -> str:
    return f"fk_{PROVINCES}_{column}_users"


def upgrade() -> None:
    existing = _columns()
    for name in COLUMNS:
        if name not in existing:
            op.add_column(PROVINCES, sa.Column(name, sa.Integer(), nullable=True))

    # SQLite cannot add a constraint to an existing table without rebuilding
    # it (see 5348276120bb, which hit this first). Only the test suite runs
    # on SQLite, where foreign keys are not enforced by default anyway;
    # production is PostgreSQL, where the constraint is real.
    if op.get_bind().dialect.name != "postgresql":
        return

    already = {fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys(PROVINCES)}
    for name in COLUMNS:
        fk_name = _fk_name(name)
        if fk_name not in already:
            op.create_foreign_key(fk_name, PROVINCES, "users", [name], ["id"])


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        already = {
            fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys(PROVINCES)
        }
        for name in reversed(COLUMNS):
            fk_name = _fk_name(name)
            if fk_name in already:
                op.drop_constraint(fk_name, PROVINCES, type_="foreignkey")

    existing = _columns()
    for name in reversed(COLUMNS):
        if name in existing:
            op.drop_column(PROVINCES, name)
