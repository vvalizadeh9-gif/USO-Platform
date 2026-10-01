"""One village on My Work, and the lookups around it.

The right-hand side of the page: the CPM facts the Requested card shows, each
authority's side with its full history, the same-site villages "+ N from
SITE" ticks, and turning pasted codes into villages. Every lookup goes through
``my_work_query.base_select``, so nothing here can reach a village the list
would not show.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.digits import normalize_code
from app.models.acceptance_workflow import (
    AUTHORITIES,
    REVIEW_PENDING,
    AcceptanceSubmission,
)
from app.models.reference import User
from app.models.workitem import Site, Village
from app.services import acceptance_rounds as rounds
from app.services import my_work_status as S
from app.services.my_work_query import SideFacts, base_select, side_facts


@dataclass
class SideDetail:
    facts: SideFacts
    history: rounds.SideHistory
    same_letter: tuple[str, int] | None  # (letter_number, confirmable count)


def side_details(db: Session, village: Village, viewer: User) -> dict[str, SideDetail]:
    """Both sides of one village, as this viewer may act on them."""
    submissions = db.execute(
        select(AcceptanceSubmission).where(AcceptanceSubmission.village_id == village.id)
    ).scalars().all()
    details = {}
    for authority in AUTHORITIES:
        own = [s for s in submissions if s.authority == authority]
        pending = next((s for s in own if s.review_status == REVIEW_PENDING), None)
        facts = side_facts(
            S.display_status(getattr(village, f"{authority.lower()}_status")),
            max((s.round_no for s in own), default=None),
            pending.submitted_by if pending else None,
            viewer=viewer,
        )
        details[authority] = SideDetail(
            facts=facts,
            history=rounds.side_history(village, authority, own),
            same_letter=_same_letter(db, viewer, authority, pending) if facts.reviewable else None,
        )
    return details


def _same_letter(db: Session, viewer: User, authority: str, pending) -> tuple[str, int] | None:
    """The letter a reviewable round came in on, when it covers others too."""
    ids = rounds.confirmable_on_letter(
        db, viewer, authority=authority, letter_number=pending.letter_number
    )
    return (pending.letter_number, len(ids)) if len(ids) > 1 else None


def suggestions(
    db: Session, viewer: User, village: Village, authority: str, *, scope: str
) -> list[tuple[int, str | None, str | None, str]]:
    """Other villages on this village's site whose ``authority`` side the
    viewer can file now: ``(village_id, code, name, status)``."""
    if S.is_read_only(viewer.role.name):
        return []
    column = Village.ict_status if authority == "ICT" else Village.cra_status
    editable = [S.stored_status(s) for s in sorted(S.EDITABLE)]
    stmt = (
        base_select(db, viewer, scope=scope)
        .with_only_columns(Village.id, Village.village_code, Village.village_name, column)
        .where(
            Site.id == village.work_item.site_id,
            Village.id != village.id,
            column.in_(editable),
        )
        .order_by(Village.village_name, Village.id)
    )
    return [(i, c, n, S.display_status(s)) for i, c, n, s in db.execute(stmt).all()]


def resolve_codes(
    db: Session, viewer: User, codes: list[str], *, scope: str
) -> tuple[int, list[tuple[str, int]], list[str]]:
    """Pasted codes -> ``(total, [(code, village_id)], unmatched)``.

    Matched only inside the list this viewer sees in ``scope``. A code that
    belongs to another contractor is unmatched, exactly like one that does not
    exist -- the response cannot be used to learn whose villages are whose.
    """
    wanted = list(dict.fromkeys(c for c in (normalize_code(x) for x in codes) if c))
    if not wanted:
        return 0, [], []
    found = dict(
        db.execute(
            base_select(db, viewer, scope=scope)
            .with_only_columns(func.upper(Village.village_code), Village.id)
            .where(func.upper(Village.village_code).in_(wanted))
        ).all()
    )
    matched = [(code, found[code]) for code in wanted if code in found]
    unmatched = [code for code in wanted if code not in found]
    return len(wanted), matched, unmatched

