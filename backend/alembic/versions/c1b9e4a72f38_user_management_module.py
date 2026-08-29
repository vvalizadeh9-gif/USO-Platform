"""User management: names, email, account status, and an audit log that says what happened.

Four changes, all of them to tables that already existed:

**users** gains ``first_name``, ``family_name``, ``email``, ``status``,
``must_change_password``, and loses ``full_name`` and ``active``.

``full_name`` was one column holding two facts. Splitting it is what lets the
platform address someone by family name in a letter and sort a list by it,
which a single string can only do by guessing where the boundary is -- a guess
that is wrong for a good share of Persian names. The backfill below makes the
same guess *once*, on data that already exists and cannot be recovered any
other way, and puts the result somewhere a person can correct it. That is
strictly better than making it silently on every read forever.

``active`` was a boolean answering "may this person sign in". An administrator
needs to answer two questions, not one: whether the account is in use, and why
it is not. "Left the company" and "locked pending an investigation" were the
same row, and the difference is exactly what someone reading the trail a year
later needs. ``status`` carries Active / Inactive / Suspended; ``active = false``
becomes Inactive, which is what it almost always meant.

``deactivated_at`` / ``deactivated_by`` are renamed to ``status_changed_at`` /
``status_changed_by``, because they now record a move to any non-Active status
rather than to one of them.

**audit_logs** gains ``action`` and ``result``. The table recorded who, which
record, and the before/after values, but never a plain statement of what
happened -- that was inferred by the frontend from the shape of ``new_value``
and the wording of a free-text ``reason``. Existing rows are backfilled from
those same signals, once, here: the inference is no worse than the one the
frontend was making live, and this way it stops being made again on every page
load. ``result`` defaults to Success for history, which is accurate -- nothing
before this migration recorded a failed attempt at all.

**password_reset_requests** is new: a small queue of "I cannot sign in"
messages from the login page. It grants nothing; see ``models/auth.py``.

Every step is guarded, following the pattern in ``e2b6d4f8a017``: a database
built from the ORM models and then stamped at an older revision already has
some of these, and an unguarded ALTER fails against it.

Revision ID: c1b9e4a72f38
Revises: a4d7e2c9b613
Create Date: 2026-08-29

"""
import sqlalchemy as sa
from alembic import op

revision = "c1b9e4a72f38"
down_revision = "a4d7e2c9b613"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def _foreign_keys(table: str) -> set[str]:
    return {fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys(table)}


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------
def _split_names() -> None:
    """Fill first_name / family_name from the single full_name column.

    Last space wins: "Ali Reza Ahmadi" becomes "Ali Reza" + "Ahmadi", which is
    right for a compound given name and wrong for a compound surname. Both
    orders are common in the data this platform holds and no rule gets both;
    the split that keeps more information in the field a person is most likely
    to check is the better default, and an administrator can correct any row in
    the console afterwards.

    A name with no space at all goes entirely into ``family_name``: a
    one-word name is far more often a surname here, and leaving ``first_name``
    empty would violate the NOT NULL the column is about to acquire.
    """
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, full_name FROM users ORDER BY id")
    ).fetchall()
    for user_id, full_name in rows:
        whole = (full_name or "").strip()
        if " " in whole:
            first, _, family = whole.rpartition(" ")
        else:
            # Never both empty: the columns are about to be NOT NULL, and a
            # user row with no name at all is worse than one placeholder.
            first, family = "", whole or f"user{user_id}"
        bind.execute(
            sa.text(
                "UPDATE users SET first_name = :first, family_name = :family "
                "WHERE id = :id"
            ),
            {"first": first, "family": family, "id": user_id},
        )


def _upgrade_users() -> None:
    cols = _columns("users")

    if "first_name" not in cols:
        # Added nullable with a default, filled, then tightened: adding a NOT
        # NULL column to a table with rows in it fails outright, and a
        # server_default of "" would leave every existing user permanently
        # named nothing.
        op.add_column(
            "users",
            sa.Column("first_name", sa.String(length=80), nullable=False,
                      server_default=""),
        )
    if "family_name" not in cols:
        op.add_column(
            "users",
            sa.Column("family_name", sa.String(length=80), nullable=False,
                      server_default=""),
        )
    if "full_name" in cols and ("first_name" not in cols or "family_name" not in cols):
        _split_names()

    if "email" not in cols:
        op.add_column("users", sa.Column("email", sa.String(length=255), nullable=True))
        # Unique, but nullable: several accounts may have no address, and in
        # both PostgreSQL and SQLite NULLs do not collide under a unique index.
        #
        # A real UNIQUE *constraint* on PostgreSQL, named exactly as SQLAlchemy
        # would name the one on the model's ``unique=True``. A database built
        # by these migrations and one built by ``create_all`` have to come out
        # byte-identical -- tests/test_migrations.py compares them column by
        # column and constraint by constraint, and that comparison is the only
        # thing standing between this platform and the schema drift the
        # consolidation was written to end. SQLite cannot add a constraint to
        # an existing table without rebuilding it, so it gets the equivalent
        # unique index; only the test suite runs on SQLite.
        if _is_postgres():
            op.create_unique_constraint("users_email_key", "users", ["email"])
        else:
            op.create_index("users_email_key", "users", ["email"], unique=True)

    if "status" not in cols:
        op.add_column(
            "users",
            sa.Column("status", sa.String(length=20), nullable=False,
                      server_default="Active"),
        )
        if "active" in cols:
            # false becomes Inactive. Nothing in the old schema could express
            # Suspended, so no existing row can be one.
            op.execute(
                sa.text(
                    "UPDATE users SET status = 'Inactive' "
                    "WHERE active = :false_value"
                ).bindparams(false_value=False)
            )
        op.create_index("ix_users_status", "users", ["status"])

    if "must_change_password" not in cols:
        op.add_column(
            "users",
            sa.Column("must_change_password", sa.Boolean(), nullable=False,
                      server_default=sa.false()),
        )

    # The two rename cases are separate from the add cases: a database that
    # already has the new names must not get the old ones back.
    cols = _columns("users")
    if "deactivated_at" in cols and "status_changed_at" not in cols:
        op.alter_column("users", "deactivated_at", new_column_name="status_changed_at")
    if "deactivated_by" in cols and "status_changed_by" not in cols:
        op.alter_column("users", "deactivated_by", new_column_name="status_changed_by")
        # PostgreSQL keeps a constraint's name when the column under it is
        # renamed, so without this the foreign key would still be called
        # users_deactivated_by_fkey -- named for a column that no longer
        # exists, and a name a freshly created database does not use.
        if _is_postgres() and "users_deactivated_by_fkey" in _foreign_keys("users"):
            op.execute(
                "ALTER TABLE users RENAME CONSTRAINT users_deactivated_by_fkey "
                "TO users_status_changed_by_fkey"
            )

    # A database built from the ORM models and then stamped at an older
    # revision arrives here with *both* pairs: status_changed_* from the models,
    # and deactivated_* added by revision 5348276120bb, which ran afterwards
    # and could not know the columns had been renamed. The old pair is empty
    # and duplicated; leaving it would mean an upgraded database and a fresh
    # one no longer match.
    cols = _columns("users")
    if "status_changed_by" in cols and "deactivated_by" in cols:
        if _is_postgres() and "users_deactivated_by_fkey" in _foreign_keys("users"):
            op.drop_constraint("users_deactivated_by_fkey", "users", type_="foreignkey")
        op.drop_column("users", "deactivated_by")
    cols = _columns("users")
    if "status_changed_at" in cols and "deactivated_at" in cols:
        op.drop_column("users", "deactivated_at")

    cols = _columns("users")
    if "active" in cols:
        op.drop_column("users", "active")
    if "full_name" in cols:
        op.drop_column("users", "full_name")


# ---------------------------------------------------------------------------
# audit_logs
# ---------------------------------------------------------------------------
#
# How an existing row's action is recovered. Ordered: the first matching rule
# wins, and the last is the catch-all. These read the same signals the frontend
# was reading at render time, so nothing becomes less accurate -- it stops
# being re-derived on every page load, and becomes something that can be
# filtered and counted.
_BACKFILL_RULES = [
    # (SQL predicate, action)
    ("entity_type = 'CpmImportBatch'", "IMPORTED"),
    ("entity_type = 'CpmDataWipe'", "DATA_WIPED"),
    ("entity_type = 'User' AND reason LIKE '%deactivated%'", "USER_DEACTIVATED"),
    ("entity_type = 'User' AND reason LIKE '%Password changed%'", "PASSWORD_CHANGED"),
    ("entity_type = 'User' AND reason LIKE '%updated%'", "USER_UPDATED"),
    ("entity_type = 'User'", "USER_CREATED"),
    ("module = 'Assignment'", "ASSIGNED"),
    ("module = 'DriveTest'", "SUBMITTED"),
    ("entity_type = 'HcTask'", "REVIEWED"),
    ("entity_type = 'AcceptanceSubmission'", "SUBMITTED"),
    ("entity_type = 'CpmChangeRequest'", "UPDATED"),
]


def _upgrade_audit_logs() -> None:
    cols = _columns("audit_logs")

    if "action" not in cols:
        op.add_column(
            "audit_logs",
            sa.Column("action", sa.String(length=60), nullable=False,
                      server_default="UPDATED"),
        )
        for predicate, action in _BACKFILL_RULES:
            op.execute(
                sa.text(
                    f"UPDATE audit_logs SET action = :action "  # noqa: S608 - fixed strings above
                    f"WHERE action = 'UPDATED' AND ({predicate})"
                ).bindparams(action=action)
            )
        op.create_index("ix_audit_logs_action", "audit_logs", ["action"])

    if "result" not in cols:
        # Success for everything historical, and accurately so: before this
        # change nothing recorded an attempt that failed.
        op.add_column(
            "audit_logs",
            sa.Column("result", sa.String(length=20), nullable=False,
                      server_default="Success"),
        )

    existing = _indexes("audit_logs")
    if "ix_audit_logs_created_at" not in existing:
        op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    if "ix_audit_logs_user_created" not in existing:
        op.create_index(
            "ix_audit_logs_user_created", "audit_logs", ["user_id", "created_at"]
        )


# ---------------------------------------------------------------------------
# password_reset_requests
# ---------------------------------------------------------------------------
def _upgrade_reset_requests() -> None:
    if "password_reset_requests" in _tables():
        return
    op.create_table(
        "password_reset_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("submitted_identifier", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requested_ip", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False,
                  server_default="Pending"),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handled_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_password_reset_requests_status_time",
        "password_reset_requests",
        ["status", "requested_at"],
    )


def upgrade() -> None:
    _upgrade_users()
    _upgrade_audit_logs()
    _upgrade_reset_requests()


def downgrade() -> None:
    """Put the old shape back, as far as it can be put back.

    ``full_name`` is reassembled from the two halves, so nothing is lost there.
    ``status`` collapses to a boolean, which does lose something: an account
    that was Suspended comes back as merely inactive, because the old schema
    had nowhere to say otherwise. That is inherent in going backwards, and the
    audit log still records every suspension that ever happened.
    """
    if "password_reset_requests" in _tables():
        op.drop_table("password_reset_requests")

    cols = _columns("audit_logs")
    existing = _indexes("audit_logs")
    if "ix_audit_logs_user_created" in existing:
        op.drop_index("ix_audit_logs_user_created", table_name="audit_logs")
    if "ix_audit_logs_created_at" in existing:
        op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    if "result" in cols:
        op.drop_column("audit_logs", "result")
    if "action" in cols:
        if "ix_audit_logs_action" in existing:
            op.drop_index("ix_audit_logs_action", table_name="audit_logs")
        op.drop_column("audit_logs", "action")

    cols = _columns("users")
    if "full_name" not in cols:
        op.add_column(
            "users",
            sa.Column("full_name", sa.String(length=150), nullable=False,
                      server_default=""),
        )
        op.execute(
            "UPDATE users SET full_name = "
            "TRIM(COALESCE(first_name, '') || ' ' || COALESCE(family_name, ''))"
        )
    if "active" not in cols:
        op.add_column(
            "users",
            sa.Column("active", sa.Boolean(), nullable=False,
                      server_default=sa.true()),
        )
        if "status" in cols:
            op.execute(
                sa.text("UPDATE users SET active = :false_value "
                        "WHERE status <> 'Active'").bindparams(false_value=False)
            )

    cols = _columns("users")
    if "status_changed_at" in cols and "deactivated_at" not in cols:
        op.alter_column("users", "status_changed_at", new_column_name="deactivated_at")
    if "status_changed_by" in cols and "deactivated_by" not in cols:
        op.alter_column("users", "status_changed_by", new_column_name="deactivated_by")
        if _is_postgres() and "users_status_changed_by_fkey" in _foreign_keys("users"):
            op.execute(
                "ALTER TABLE users RENAME CONSTRAINT users_status_changed_by_fkey "
                "TO users_deactivated_by_fkey"
            )

    cols = _columns("users")
    existing = _indexes("users")
    if "must_change_password" in cols:
        op.drop_column("users", "must_change_password")
    if "status" in cols:
        if "ix_users_status" in existing:
            op.drop_index("ix_users_status", table_name="users")
        op.drop_column("users", "status")
    if "email" in cols:
        # Dropping the column takes its unique constraint or index with it on
        # both dialects, so there is nothing to drop first.
        op.drop_column("users", "email")
    if "family_name" in cols:
        op.drop_column("users", "family_name")
    if "first_name" in cols:
        op.drop_column("users", "first_name")
