"""What a filed or a confirmed letter does to a case (§5.3).

Called from ``acceptance_letters`` -- the one path every ICT or CRA letter
takes, from Filing or anywhere else:

* a **PM or coordinator**'s letter is decided at once, so the case moves now;
* a **contractor**'s letter is a claim: the case keeps its state and gets a
  comment carrying the filing (its choice and proposed category). It moves
  only when a coordinator confirms the round in ICT/CRA validation -- who may
  confirm or change the category, so a contractor cannot shift a rejection
  onto the wrong team;
* a **returned** round leaves the case waiting and records the reason as a
  comment.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.acceptance_case import (
    EVENT_COMMENT,
    STATE_REJECTED,
    AcceptanceCaseEvent,
    AcceptanceRejectionCategory,
)
from app.models.acceptance_workflow import AcceptanceSubmission
from app.models.reference import Contractor, User
from app.models.workitem import Village, WorkItem

from . import rules, transitions
from .transitions import Letter


@dataclass(frozen=True)
class CaseContext:
    """What Filing adds to a letter: the choice, its category and comment."""

    choice: str
    comment: str | None = None
    category_id: int | None = None
    request_id: str | None = None


def _side(village: Village, authority: str) -> str:
    return getattr(village, f"{authority.lower()}_status")


def _claim_reasons(submission: AcceptanceSubmission) -> str | None:
    reasons = [t.comment for t in submission.technologies if t.comment]
    return "; ".join(dict.fromkeys(reasons)) or None


def _category(db: Session, category_id: int | None) -> AcceptanceRejectionCategory | None:
    return db.get(AcceptanceRejectionCategory, category_id) if category_id else None


def _contractor_name(db: Session, village_id: int) -> str | None:
    from .scope import site_contractor

    return db.execute(
        select(Contractor.name)
        .select_from(Village).join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Contractor, Contractor.id == site_contractor())
        .where(Village.id == village_id)
    ).scalar_one_or_none()


def basket_owner(db: Session, village_id: int, category: AcceptanceRejectionCategory | None) -> str | None:
    return rules.basket_owner(
        STATE_REJECTED, category.basket_role if category else None,
        _contractor_name(db, village_id), category.label if category else None,
    )


def on_filed(db: Session, user: User, authority: str, filed, *, decided: bool,
             letter_number: str, letter_date, ctx: CaseContext | None) -> None:
    """After a letter's rounds are written: ``filed`` is (village, submission)."""
    for village, submission in filed:
        case = transitions.case_for(db, village.id, authority)
        if case is None:
            continue
        letter = Letter(letter_number, letter_date, transitions.first_evidence(db, submission.id))
        text = (ctx.comment if ctx else None) or _claim_reasons(submission)
        request_id = ctx.request_id if ctx else None
        if decided:
            category = _category(db, ctx.category_id if ctx else None)
            transitions.apply_verdict(
                db, case, user, _side(village, authority), category=category, letter=letter,
                text=text, basket_owner=basket_owner(db, village.id, category),
                request_id=request_id, meta={"submission_id": submission.id},
            )
            continue
        filing = {"submission_id": submission.id,
                  "choice": ctx.choice if ctx else _choice_of(submission),
                  "category_id": ctx.category_id if ctx else None}
        if text:
            transitions.comment(db, case, user, text, request_id=request_id,
                                meta={"filing": filing}, letter=letter)


def _choice_of(submission: AcceptanceSubmission) -> str:
    rejected = any(t.claimed_status == "Rejected" for t in submission.technologies)
    return "rejected" if rejected else "approved"


def proposed_category(db: Session, case_id: int, submission_id: int) -> int | None:
    """The category a contractor proposed when filing this round."""
    for event in db.execute(
        select(AcceptanceCaseEvent).where(
            AcceptanceCaseEvent.case_id == case_id, AcceptanceCaseEvent.kind == EVENT_COMMENT
        ).order_by(AcceptanceCaseEvent.id.desc())
    ).scalars():
        filing = (event.meta or {}).get("filing")
        if filing and filing.get("submission_id") == submission_id:
            return filing.get("category_id")
    return None


def on_reviewed(db: Session, reviewer: User, authority: str, submissions, *, returned: bool,
                reasons: dict[int, str | None], categories: dict[int, int | None]) -> None:
    """After a coordinator or PM decided contractor rounds in validation."""
    for submission in submissions:
        case = transitions.case_for(db, submission.village_id, authority)
        if case is None:
            continue
        if returned:
            reason = reasons.get(submission.id)
            if reason:
                transitions.comment(db, case, reviewer, f"Returned: {reason}",
                                    meta={"returned_submission": submission.id})
            continue
        proposed = proposed_category(db, case.id, submission.id)
        category_id = categories.get(submission.id) or proposed
        category = _category(db, category_id)
        letter = Letter(submission.letter_number, submission.letter_date,
                        transitions.first_evidence(db, submission.id))
        transitions.apply_verdict(
            db, case, reviewer, _side(submission.village, authority), category=category,
            letter=letter, text=_claim_reasons(submission),
            basket_owner=basket_owner(db, submission.village_id, category),
            meta={"submission_id": submission.id, "filed_by": submission.submitted_by,
                  "proposed_category_id": proposed},
        )


def proposed_codes(db: Session, filings: list[dict]) -> dict[int, str]:
    """Submission id -> the category code its contractor proposed, for the
    validation page's category check (§5.3). ``filings`` carry
    ``submission_id``, ``village_id`` and ``authority``."""
    from app.models.acceptance_case import AcceptanceCase

    if not filings:
        return {}
    wanted = {f["submission_id"] for f in filings}
    cases = db.execute(
        select(AcceptanceCase.id).where(
            AcceptanceCase.village_id.in_({f["village_id"] for f in filings})
        )
    ).scalars().all()
    codes = dict(db.execute(select(AcceptanceRejectionCategory.id, AcceptanceRejectionCategory.code)).all())
    out: dict[int, str] = {}
    for event in db.execute(
        select(AcceptanceCaseEvent).where(
            AcceptanceCaseEvent.case_id.in_(cases or [-1]), AcceptanceCaseEvent.kind == EVENT_COMMENT
        ).order_by(AcceptanceCaseEvent.id)
    ).scalars():
        filing = (event.meta or {}).get("filing") or {}
        sid = filing.get("submission_id")
        if sid in wanted and filing.get("category_id") in codes:
            out[sid] = codes[filing["category_id"]]
    return out
