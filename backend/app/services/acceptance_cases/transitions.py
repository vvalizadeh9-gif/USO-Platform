"""The only code that changes a case: each move writes its event.

Three states, and the moves between them (§4.2):

    waiting  --approved-->  approved
    waiting  --rejected-->  rejected (basket from the category)
    rejected --fixed----->  waiting  (back to the site contractor)
    rejected --approved/rejected / basket change--> as above

Entering a state or a basket restarts ``state_since``; a comment only moves
``last_comment_at``. Callers check who may do what; these do not.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.acceptance_case import (
    BASKET_CONTRACTOR,
    EVENT_APPROVED,
    EVENT_BASKET_CHANGED,
    EVENT_COMMENT,
    EVENT_FIXED,
    EVENT_REJECTED,
    STATE_APPROVED,
    STATE_REJECTED,
    STATE_WAITING,
    AcceptanceCase,
    AcceptanceCaseEvent,
    AcceptanceRejectionCategory,
)
from app.models.acceptance_workflow import AcceptanceEvidence
from app.models.reference import User

from . import rules


@dataclass(frozen=True)
class Letter:
    no: str | None = None
    day: date | None = None
    evidence_id: int | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def case_for(db: Session, village_id: int, authority: str) -> AcceptanceCase | None:
    return db.execute(
        select(AcceptanceCase).where(
            AcceptanceCase.village_id == village_id, AcceptanceCase.authority == authority
        )
    ).scalar_one_or_none()


def lock(db: Session, case_ids) -> list[AcceptanceCase]:
    """The cases, row-locked in id order until the commit."""
    ids = sorted(set(case_ids))
    if not ids:
        return []
    return list(db.execute(
        select(AcceptanceCase).where(AcceptanceCase.id.in_(ids))
        .order_by(AcceptanceCase.id).with_for_update()
    ).scalars())


def first_evidence(db: Session, submission_id: int | None) -> int | None:
    if submission_id is None:
        return None
    return db.scalar(
        select(AcceptanceEvidence.id).where(AcceptanceEvidence.submission_id == submission_id)
        .order_by(AcceptanceEvidence.id).limit(1)
    )


def _event(db: Session, case: AcceptanceCase, kind: str, actor: User | None, *,
           comment: str | None = None, letter: Letter | None = None,
           category_id: int | None = None, request_id: str | None = None,
           meta: dict | None = None) -> AcceptanceCaseEvent:
    letter = letter or Letter()
    event = AcceptanceCaseEvent(
        case_id=case.id, kind=kind, category_id=category_id, letter_no=letter.no,
        letter_date=letter.day, evidence_id=letter.evidence_id, comment=comment,
        actor_user_id=actor.id if actor else None, meta=meta or None, request_id=request_id,
    )
    db.add(event)
    if comment:
        case.last_comment_at = _now()
    return event


def _enter(case: AcceptanceCase, state: str, basket_role: str | None,
           category_id: int | None, today: date | None = None) -> None:
    case.state = state
    case.basket_role = basket_role
    case.category_id = category_id
    case.state_since = today or rules.tehran_today()


def comment(db: Session, case: AcceptanceCase, actor: User, text: str, *,
            request_id: str | None = None, meta: dict | None = None,
            letter: Letter | None = None) -> AcceptanceCaseEvent:
    return _event(db, case, EVENT_COMMENT, actor, comment=text, request_id=request_id,
                  meta=meta, letter=letter)


def approve(db: Session, case: AcceptanceCase, actor: User, *, letter: Letter,
            text: str | None, request_id: str | None = None, meta: dict | None = None) -> None:
    _enter(case, STATE_APPROVED, None, None)
    _event(db, case, EVENT_APPROVED, actor, comment=text, letter=letter,
           request_id=request_id, meta=meta)


def reject(db: Session, case: AcceptanceCase, actor: User, *,
           category: AcceptanceRejectionCategory | None, letter: Letter, text: str | None,
           basket_owner: str | None = None, request_id: str | None = None,
           meta: dict | None = None) -> None:
    _enter(case, STATE_REJECTED, category.basket_role if category else None,
           category.id if category else None)
    _event(db, case, EVENT_REJECTED, actor, comment=text, letter=letter,
           category_id=category.id if category else None, request_id=request_id,
           meta={**(meta or {}), "basket_owner": basket_owner})


def fix(db: Session, case: AcceptanceCase, actor: User, text: str, *,
        contractor: str | None = None, request_id: str | None = None,
        meta: dict | None = None) -> None:
    """A rejection marked fixed goes back to the site contractor (§4.2)."""
    previous = case.category_id
    _enter(case, STATE_WAITING, BASKET_CONTRACTOR, None)
    _event(db, case, EVENT_FIXED, actor, comment=text, category_id=previous,
           request_id=request_id, meta={"contractor": contractor, **(meta or {})})


def change_basket(db: Session, case: AcceptanceCase, actor: User,
                  category: AcceptanceRejectionCategory, reason: str, *,
                  basket_owner: str | None = None) -> None:
    """PM/coordinator move a rejection to another category's basket."""
    old = {"category_id": case.category_id, "basket_role": case.basket_role}
    _enter(case, STATE_REJECTED, category.basket_role, category.id)
    _event(db, case, EVENT_BASKET_CHANGED, actor, comment=reason, category_id=category.id,
           meta={"from": old, "basket_owner": basket_owner})


def apply_verdict(db: Session, case: AcceptanceCase, actor: User, side_status: str, *,
                  category: AcceptanceRejectionCategory | None, letter: Letter,
                  text: str | None, basket_owner: str | None = None,
                  request_id: str | None = None, meta: dict | None = None) -> bool:
    """Move a case to what the authority's letter now says (the village's side
    status after the round was decided). False when it says neither."""
    if side_status == "Approved":
        approve(db, case, actor, letter=letter, text=text, request_id=request_id, meta=meta)
        return True
    if side_status == "Rejected":
        reject(db, case, actor, category=category, letter=letter, text=text,
               basket_owner=basket_owner, request_id=request_id, meta=meta)
        return True
    return False
