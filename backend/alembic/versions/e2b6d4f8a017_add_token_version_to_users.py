"""Add users.token_version, so a password change can end existing sessions.

Access tokens were stateless in the fullest sense: they carried a user id and
an expiry, and nothing else was ever consulted. Deactivating an account worked,
because ``get_current_user`` reads ``users.active`` on every request -- but
changing a password did not, because nothing in the request path looked at the
password at all. The standard response to a compromised account therefore left
the attacker's session running for up to another eight hours.

``token_version`` closes that. It is stamped into every token at login and
compared on every request; bumping it invalidates that user's tokens and
nobody else's. Existing tokens issued before this migration carry no version
claim and are treated as version 0, which is the default here, so deploying
this does not sign anybody out.

Revision ID: e2b6d4f8a017
Revises: d1e5a8b3c9f2
Create Date: 2026-08-28

"""
import sqlalchemy as sa
from alembic import op

revision = "e2b6d4f8a017"
down_revision = "d1e5a8b3c9f2"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}


def upgrade() -> None:
    # Guarded, following 5348276120bb: a database built from the ORM models and
    # then stamped at an older revision -- which is what the legacy-repair path
    # in tests/test_migrations.py reproduces, and what a real database that grew
    # through the old create_all() looks like -- already has this column, and an
    # unguarded ADD COLUMN fails against it.
    if "token_version" in _columns():
        return

    # server_default, not just a Python-side default: existing rows need a
    # value, and the column is NOT NULL.
    op.add_column(
        "users",
        sa.Column(
            "token_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    if "token_version" in _columns():
        op.drop_column("users", "token_version")
