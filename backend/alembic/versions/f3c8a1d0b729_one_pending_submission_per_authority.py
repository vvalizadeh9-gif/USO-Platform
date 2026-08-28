"""At most one pending acceptance submission per village and authority.

``acceptance_workflow.submit`` refuses a second pending submission by reading
the table first and raising if it finds one. That is a read-then-write with
nothing between the two, so two requests arriving together both read "none
pending", both insert, and the village ends up with two.

The consequence is worse than a duplicate row. ``_open_submission`` uses
``scalar_one_or_none()``, so from that moment every submit, every review and
every queue refresh touching that village and authority raises
``MultipleResultsFound`` -- a permanent 500 for that village, with no route to
recovery through the interface.

A partial unique index is what actually prevents it. The application check
stays, because it produces a readable message in the ordinary case; this is the
guarantee underneath it, and the only thing that can hold under concurrency.

Any duplicates already in the table are withdrawn before the index is built,
keeping the newest round of each pair -- the one a reviewer would have acted on
-- rather than deleting anything. Withdrawal is an existing, meaningful state,
so the history stays readable.

Revision ID: f3c8a1d0b729
Revises: e2b6d4f8a017
Create Date: 2026-08-28

"""
import sqlalchemy as sa
from alembic import op

revision = "f3c8a1d0b729"
down_revision = "e2b6d4f8a017"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_acc_sub_one_pending_per_authority"


def _indexes() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if "acceptance_submissions" not in inspector.get_table_names():
        return set()
    return {i["name"] for i in inspector.get_indexes("acceptance_submissions")}


def upgrade() -> None:
    bind = op.get_bind()

    # Guarded the same way as 5348276120bb, for the same reason: a database
    # built from the ORM models and stamped at an older revision already has
    # this index, and CREATE INDEX would fail against it.
    if INDEX_NAME in _indexes():
        return

    # Withdraw every pending submission except the newest per (village,
    # authority). Ordering by round_no then id matches how the application
    # itself picks the latest round in _submission_facts.
    bind.execute(
        sa.text(
            """
            UPDATE acceptance_submissions
               SET review_status = 'Withdrawn',
                   review_comment = COALESCE(review_comment, '')
                       || 'Withdrawn automatically: a duplicate pending '
                       || 'submission existed for this village and authority.'
             WHERE review_status = 'Pending'
               AND id NOT IN (
                     SELECT keep.id FROM (
                       SELECT id,
                              ROW_NUMBER() OVER (
                                  PARTITION BY village_id, authority
                                  ORDER BY round_no DESC, id DESC
                              ) AS rn
                         FROM acceptance_submissions
                        WHERE review_status = 'Pending'
                     ) AS keep
                    WHERE keep.rn = 1
                   )
            """
        )
    )

    # Partial index: the constraint applies only to rows awaiting review. A
    # village legitimately accumulates many validated, returned and withdrawn
    # submissions over its rounds, and those must stay unconstrained.
    op.create_index(
        INDEX_NAME,
        "acceptance_submissions",
        ["village_id", "authority"],
        unique=True,
        postgresql_where=sa.text("review_status = 'Pending'"),
        sqlite_where=sa.text("review_status = 'Pending'"),
    )


def downgrade() -> None:
    if INDEX_NAME in _indexes():
        op.drop_index(INDEX_NAME, table_name="acceptance_submissions")
