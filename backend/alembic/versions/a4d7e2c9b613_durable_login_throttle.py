"""Move login throttling and captcha replay out of process memory.

Both counters lived in a dict on the backend process. That was documented and
was a reasonable trade for one container, with two acknowledged consequences:
they reset on restart, and a second backend would count separately.

The restart case is the one that matters today. A deploy restarts the backend,
so any lockout in progress was cleared by the next `docker compose up -d`.

These two tables put both in the database. No new component: it is already
there, already backed up, already on the path of every request.

Revision ID: a4d7e2c9b613
Revises: f3c8a1d0b729
Create Date: 2026-08-28

"""
import sqlalchemy as sa
from alembic import op

revision = "a4d7e2c9b613"
down_revision = "f3c8a1d0b729"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    # Guarded the same way as 5348276120bb: a database built from the ORM
    # models and stamped at an older revision already has these.
    existing = _tables()

    if "login_attempts" not in existing:
        op.create_table(
            "login_attempts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("key", sa.String(length=200), nullable=False),
            sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
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
        )
        # Every read is "attempts for this key since this moment".
        op.create_index(
            "ix_login_attempts_key_time",
            "login_attempts",
            ["key", "attempted_at"],
        )

    if "spent_captchas" not in existing:
        op.create_table(
            "spent_captchas",
            sa.Column("jti", sa.String(length=64), primary_key=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
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
        )
        op.create_index(
            "ix_spent_captchas_expires_at", "spent_captchas", ["expires_at"]
        )


def downgrade() -> None:
    existing = _tables()
    if "spent_captchas" in existing:
        op.drop_index("ix_spent_captchas_expires_at", table_name="spent_captchas")
        op.drop_table("spent_captchas")
    if "login_attempts" in existing:
        op.drop_index("ix_login_attempts_key_time", table_name="login_attempts")
        op.drop_table("login_attempts")
