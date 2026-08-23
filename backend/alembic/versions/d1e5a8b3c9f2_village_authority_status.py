"""villages: cache the per-authority acceptance status for the My Work queue

Revision ID: d1e5a8b3c9f2
Revises: c4a91f7e2b58
Create Date: 2026-08-23

Where a village stands with ICT and with CRA has always been derived — from
``acceptances`` for the verdict, and from ``acceptance_submissions`` for what is
in flight. That is still the truth, and this revision does not change it.

What it adds is a cache. The My Work workspace groups a contractor's four
hundred villages into buckets, filters them, sorts them by how long they have
been waiting and counts each bucket for the filter chips. Deriving that in
Python means loading every village's acceptance graph on every keystroke. Two
indexed columns let the same questions be answered in SQL.

``services/acceptance_workflow.py`` writes both columns through in the same
transaction as every state change that could alter them, and the backfill below
calls the very same ``derive_authority_status`` the application calls, so the
cache cannot be seeded with a second interpretation of the rule.

Additive only. No existing column is altered and no existing row is rewritten
beyond the two new columns.
"""
from alembic import op
import sqlalchemy as sa

revision = "d1e5a8b3c9f2"
down_revision = "c4a91f7e2b58"
branch_labels = None
depends_on = None

_DEFAULT = "NotFiled"


def _inspector():
    return sa.inspect(op.get_bind())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in _inspector().get_indexes(table)}


def _backfill() -> None:
    """Compute both columns for every village from what is already recorded.

    Deliberately reads through the application's own derivation rather than
    restating it in SQL: the requested-technology list is a CPM string that
    needs parsing ("2G3G4G"), and a rejected technology rejecting the whole
    village is a rule, not a join. One implementation, called from two places.
    """
    from app.services.acceptance_workflow import (
        APPROVED,
        PENDING,
        REJECTED,
        derive_authority_status,
    )
    from app.services.tech_parser import parse_technologies

    bind = op.get_bind()

    requested = {
        village_id: parse_technologies(technology)
        for village_id, technology in bind.execute(
            sa.text(
                "SELECT v.id, w.requested_technology "
                "FROM villages v JOIN work_items w ON w.id = v.work_item_id"
            )
        )
    }
    if not requested:
        return

    # Per village, the ICT and CRA status of each technology already recorded.
    verdicts: dict[tuple[int, str], dict[str, str]] = {}
    for village_id, technology, ict, cra in bind.execute(
        sa.text(
            "SELECT village_id, technology, ict_status, cra_status FROM acceptances"
        )
    ):
        verdicts.setdefault((village_id, "ICT"), {})[technology] = ict
        verdicts.setdefault((village_id, "CRA"), {})[technology] = cra

    # Per village and authority, whether something is awaiting review and how
    # the most recent round was decided. Ordering by round then id matches
    # _submission_facts() in the service.
    facts: dict[tuple[int, str], list] = {}
    for village_id, authority, status, round_no, sub_id in bind.execute(
        sa.text(
            "SELECT village_id, authority, review_status, round_no, id "
            "FROM acceptance_submissions"
        )
    ):
        facts.setdefault((village_id, authority), []).append(
            (status, round_no, sub_id)
        )

    updates = []
    for village_id, technologies in requested.items():
        row = {"village_id": village_id}
        for authority in ("ICT", "CRA"):
            recorded = verdicts.get((village_id, authority), {})
            statuses = [recorded.get(t, PENDING) for t in technologies]
            if not technologies:
                verdict = PENDING
            elif REJECTED in statuses:
                verdict = REJECTED
            elif all(s == APPROVED for s in statuses):
                verdict = APPROVED
            else:
                verdict = PENDING

            rounds = facts.get((village_id, authority), [])
            row[authority.lower()] = derive_authority_status(
                verdict=verdict,
                has_pending=any(s == "Pending" for s, _r, _i in rounds),
                latest_review_status=(
                    max(rounds, key=lambda r: (r[1], r[2]))[0] if rounds else None
                ),
            )
        if row["ict"] != _DEFAULT or row["cra"] != _DEFAULT:
            updates.append(row)

    if not updates:
        return

    statement = sa.text(
        "UPDATE villages SET ict_status = :ict, cra_status = :cra "
        "WHERE id = :village_id"
    )
    # Chunked so a fifteen-thousand-village database does not build one
    # enormous parameter set.
    for start in range(0, len(updates), 500):
        bind.execute(statement, updates[start : start + 500])


def upgrade() -> None:
    present = _columns("villages")
    for column in ("ict_status", "cra_status"):
        if column not in present:
            op.add_column(
                "villages",
                sa.Column(
                    column,
                    sa.String(length=20),
                    nullable=False,
                    server_default=_DEFAULT,
                ),
            )

    existing = _indexes("villages")
    for column in ("ict_status", "cra_status"):
        name = f"ix_villages_{column}"
        if name not in existing:
            op.create_index(name, "villages", [column])

    _backfill()


def downgrade() -> None:
    existing = _indexes("villages")
    for column in ("ict_status", "cra_status"):
        name = f"ix_villages_{column}"
        if name in existing:
            op.drop_index(name, table_name="villages")

    present = _columns("villages")
    for column in ("ict_status", "cra_status"):
        if column in present:
            op.drop_column("villages", column)
