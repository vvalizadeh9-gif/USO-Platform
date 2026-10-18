"""SLA policies (UEP-15): one SLA in days per workflow step.

* ``sla_policy`` and ``sla_policy_history``.
* Seeded from ``action_queue_sla`` (each queue's row copied to its step) and
  from ``problem_categories.sla_days`` (one ``remediation:<id>`` per
  category), then the defaults wherever nothing was stored. One ``System``
  history entry records the seed.
* ``hc_remediations.sla_days_applied`` / ``on_time``: recorded on close.

``action_queue_sla`` and ``problem_categories.sla_days`` stay, read-only, for
one release; a later migration drops them.

Revision ID: c5e1a9d7f342
Revises: b8d2f6a4c019
Create Date: 2026-10-18
"""
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "c5e1a9d7f342"
down_revision = "b8d2f6a4c019"
branch_labels = None
depends_on = None

#: Copied, not imported: a migration must not change when app code does.
DEFAULTS = {
    "hc_assign": 14, "hc_check": 2, "hc_decide": 1,
    "dt_assign": 14, "dt_test": 14, "dt_review": 1,
    "pip_share": 5, "pip_approve": 2,
    "ict_file": 14, "cra_file": 14, "validate": 2,
    "ict_reply": 30, "cra_reply": 30, "refile": 7,
}
#: queue key -> step key. When several queues share a step, the first stored
#: one in this order wins.
QUEUE_STEP = (
    ("hc_assign", "hc_assign"), ("hc_in_check", "hc_check"), ("hc_submit", "hc_check"),
    ("hc_review", "hc_decide"),
    ("dt_assign", "dt_assign"), ("dt_in_test", "dt_test"), ("dt_todo", "dt_test"),
    ("dt_redo", "dt_test"), ("dt_sent_back", "dt_test"), ("dt_review", "dt_review"),
    ("plans_approve", "pip_approve"),
    ("ict_to_file", "ict_file"), ("cra_to_file", "cra_file"),
    ("ict_to_validate", "validate"), ("cra_to_validate", "validate"),
    ("ict_follow_up", "ict_reply"), ("cra_follow_up", "cra_reply"),
    ("ict_refile", "refile"), ("cra_refile", "refile"),
)


def _timestamps() -> list[sa.Column]:
    """The ``created_at`` / ``updated_at`` every model inherits from Base."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "sla_policy",
        sa.Column("step_key", sa.String(80), primary_key=True),
        sa.Column("days", sa.Integer, nullable=False),
        sa.Column("updated_by", sa.Integer, sa.ForeignKey("users.id")),
        *_timestamps(),
        sa.CheckConstraint("days >= 1 AND days <= 365", name="ck_sla_policy_days"),
    )
    op.create_table(
        "sla_policy_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("change_id", sa.Uuid, nullable=False),
        sa.Column("step_key", sa.String(80), nullable=False),
        sa.Column("old_days", sa.Integer),
        sa.Column("new_days", sa.Integer, nullable=False),
        sa.Column("changed_by", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_sla_policy_history_change_id", "sla_policy_history", ["change_id"])
    with op.batch_alter_table("hc_remediations") as batch:
        batch.add_column(sa.Column("sla_days_applied", sa.Integer))
        batch.add_column(sa.Column("on_time", sa.Boolean))

    bind = op.get_bind()
    values: dict[str, int] = {}
    stored = dict(bind.execute(sa.text("SELECT queue_key, sla_days FROM action_queue_sla")).all())
    for queue, step in QUEUE_STEP:
        if step not in values and stored.get(queue):
            values[step] = int(stored[queue])
    for cat_id, days in bind.execute(sa.text("SELECT id, sla_days FROM problem_categories")).all():
        values[f"remediation:{cat_id}"] = int(days) if days else 7
    for step, days in DEFAULTS.items():
        values.setdefault(step, days)
    values = {k: min(max(v, 1), 365) for k, v in values.items()}

    now = datetime.now(timezone.utc)
    policy = sa.table(
        "sla_policy", sa.column("step_key"), sa.column("days"), sa.column("updated_at"),
    )
    history = sa.table(
        "sla_policy_history", sa.column("change_id", sa.Uuid), sa.column("step_key"),
        sa.column("old_days"), sa.column("new_days"), sa.column("changed_at"),
    )
    change_id = uuid.uuid4()
    op.bulk_insert(policy, [{"step_key": k, "days": v, "updated_at": now} for k, v in values.items()])
    op.bulk_insert(history, [
        {"change_id": change_id, "step_key": k, "old_days": None, "new_days": v, "changed_at": now}
        for k, v in values.items()
    ])


def downgrade() -> None:
    with op.batch_alter_table("hc_remediations") as batch:
        batch.drop_column("on_time")
        batch.drop_column("sla_days_applied")
    op.drop_index("ix_sla_policy_history_change_id", "sla_policy_history")
    op.drop_table("sla_policy_history")
    op.drop_table("sla_policy")
