"""Action Center ticket board: SLA per queue, daily snapshot, digest log.

Adds what the Action Center needs that live state cannot answer:

* ``action_queue_sla``              days each queue's items may wait (default
                                    14, a missing row means the default);
* ``action_daily_snapshot``         each user's board per day, unique on
                                    (date, user, queue);
* ``digest_log``                    one email per user per day, unique on
                                    (user, date), with failures recorded;
* ``users.email_digest_enabled``    the opt-out, on by default;
* ``acceptance_authority_requests`` the request letter sent to ICT or CRA,
                                    the clock for the PM's "Follow up with
                                    ICT / CRA" ticket. It is the only queue
                                    whose clock-start date did not exist.

Every other queue already records when its clock starts (``assigned_at``,
``completed_at``, ``reroute_at``, ``returned_at``, ``submitted_at``,
``coordinator_reviewed_at``, ``opened_at`` / ``due_at``, ``created_at``, and
the pool's own waiting-since), so no timestamp column is added elsewhere.
Undated items start at the tracking epoch, 1 Mehr 1405; that is a read rule
(``services/action_queues/sla.py``), not a backfill, so nothing is rewritten.

Guarded per object, like its siblings: a database built from the ORM models
and stamped at an older revision may already have some of them.

Revision ID: a1c3e5f7b902
Revises: b7d3e5a1c826
Create Date: 2026-10-01

"""
import sqlalchemy as sa
from alembic import op

revision = "a1c3e5f7b902"
down_revision = "b7d3e5a1c826"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _timestamps() -> list[sa.Column]:
    """``created_at`` / ``updated_at``, as ``Base`` declares them."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    tables = _tables()

    if "action_queue_sla" not in tables:
        op.create_table(
            "action_queue_sla",
            sa.Column("queue_key", sa.String(50), primary_key=True),
            sa.Column("sla_days", sa.Integer(), nullable=False, server_default="14"),
            sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id")),
            *_timestamps(),
        )

    if "action_daily_snapshot" not in tables:
        op.create_table(
            "action_daily_snapshot",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("snapshot_date", sa.Date(), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("queue_key", sa.String(50), nullable=False),
            sa.Column("count", sa.Integer(), nullable=False),
            sa.Column("overdue", sa.Integer(), nullable=False),
            *_timestamps(),
            sa.UniqueConstraint(
                "snapshot_date", "user_id", "queue_key", name="uq_action_snapshot_day"
            ),
        )
        op.create_index(
            "ix_action_daily_snapshot_snapshot_date",
            "action_daily_snapshot", ["snapshot_date"],
        )
        op.create_index(
            "ix_action_daily_snapshot_user_id", "action_daily_snapshot", ["user_id"]
        )

    if "digest_log" not in tables:
        op.create_table(
            "digest_log",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("digest_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("error", sa.Text()),
            sa.Column("sent_at", sa.DateTime(timezone=True)),
            *_timestamps(),
            sa.UniqueConstraint("user_id", "digest_date", name="uq_digest_user_day"),
        )

    if "acceptance_authority_requests" not in tables:
        op.create_table(
            "acceptance_authority_requests",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("village_id", sa.Integer(), sa.ForeignKey("villages.id"),
                      nullable=False),
            sa.Column("authority", sa.String(10), nullable=False),
            sa.Column("letter_number", sa.String(120)),
            sa.Column("letter_date", sa.Date()),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("sent_by", sa.Integer(), sa.ForeignKey("users.id")),
            *_timestamps(),
        )
        op.create_index(
            "ix_acc_req_village_authority",
            "acceptance_authority_requests",
            ["village_id", "authority", "sent_at"],
        )

    if "email_digest_enabled" not in _columns("users"):
        op.add_column(
            "users",
            sa.Column("email_digest_enabled", sa.Boolean(), nullable=False,
                      server_default=sa.true()),
        )


def downgrade() -> None:
    if "email_digest_enabled" in _columns("users"):
        with op.batch_alter_table("users") as batch:
            batch.drop_column("email_digest_enabled")
    tables = _tables()
    for table in (
        "acceptance_authority_requests",
        "digest_log",
        "action_daily_snapshot",
        "action_queue_sla",
    ):
        if table in tables:
            op.drop_table(table)
