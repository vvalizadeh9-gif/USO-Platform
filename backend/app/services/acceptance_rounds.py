"""A village's rounds, read as history: what was filed, what came of it.

Every filing is a round, per village per authority, numbered 1, 2, 3, ... and
never changed once decided (models/acceptance_workflow.py). This module reads
them for the work surface: the history newest first, what carries over into
the next round, and the reason the last round went against the village.

It decides nothing. What the next round must claim is
``acceptance_workflow.techs_to_file`` -- read from the ``acceptances``
projection, so a verdict seeded from the CPM workbook with no round behind it
still counts as approved.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.acceptance_workflow import (
    CLAIM_APPROVED,
    REVIEW_PENDING,
    REVIEW_RETURNED,
    REVIEW_WITHDRAWN,
    AcceptanceSubmission,
)
from app.models.reference import User
from app.models.workitem import Village
from app.services import acceptance_workflow as flow
from app.services.visibility import visible_work_item_ids

RESULT_PENDING = "pending"
RESULT_APPROVED = "approved"
RESULT_REJECTED = "rejected"
RESULT_RETURNED = "returned"
RESULT_WITHDRAWN = "withdrawn"

_CLAIM_RESULT = {CLAIM_APPROVED: RESULT_APPROVED}


@dataclass
class Claim:
    tech: str
    result: str
    reason: str | None


@dataclass
class Round:
    submission_id: int
    round_no: int
    letter_number: str
    letter_date: date | None
    result: str
    source: str
    submitted_by: int | None
    submitted_at: datetime
    reviewed_by: int | None
    reviewed_at: datetime | None
    return_reason: str | None
    claims: list[Claim]
    scan: tuple[int, str] | None  # (evidence_id, filename)


@dataclass
class CarriedTech:
    tech: str
    result: str
    round_no: int | None


@dataclass
class LastReason:
    round_no: int
    kind: str  # rejected | returned
    techs: list[str]
    reason: str | None


@dataclass
class SideHistory:
    to_file: list[str]
    carry_over: list[CarriedTech] = field(default_factory=list)
    last_reason: LastReason | None = None
    history: list[Round] = field(default_factory=list)


def claim_result(claimed_status: str) -> str:
    return _CLAIM_RESULT.get(claimed_status, RESULT_REJECTED)


def round_result(submission: AcceptanceSubmission) -> str:
    """One round's outcome: a validated round is rejected if any tech was."""
    status = submission.review_status
    if status == REVIEW_PENDING:
        return RESULT_PENDING
    if status == REVIEW_RETURNED:
        return RESULT_RETURNED
    if status == REVIEW_WITHDRAWN:
        return RESULT_WITHDRAWN
    claims = [claim_result(t.claimed_status) for t in submission.technologies]
    return RESULT_REJECTED if RESULT_REJECTED in claims else RESULT_APPROVED


def _round(submission: AcceptanceSubmission) -> Round:
    evidence = submission.evidence[0] if submission.evidence else None
    return Round(
        submission_id=submission.id,
        round_no=submission.round_no,
        letter_number=submission.letter_number,
        letter_date=submission.letter_date,
        result=round_result(submission),
        source=submission.source,
        submitted_by=submission.submitted_by,
        submitted_at=submission.submitted_at,
        reviewed_by=submission.reviewed_by,
        reviewed_at=submission.reviewed_at,
        return_reason=(
            submission.review_comment
            if submission.review_status == REVIEW_RETURNED
            else None
        ),
        claims=[
            Claim(t.technology, claim_result(t.claimed_status), t.comment)
            for t in submission.technologies
        ],
        scan=(evidence.id, evidence.original_filename) if evidence else None,
    )


def newest_first(submissions) -> list[AcceptanceSubmission]:
    return sorted(submissions, key=lambda s: (s.round_no, s.id), reverse=True)


def carry_over(village: Village, authority: str, rounds: list[Round]) -> list[CarriedTech]:
    """Per requested tech, the latest decision on it and the round it came in.

    A tech approved in the projection with no validated round behind it (a
    seeded verdict) carries over as approved with no round number.
    """
    to_file = set(flow.techs_to_file(village, authority))
    carried = []
    for tech in flow.requested_technologies(village):
        decided = next(
            (
                (claim.result, r.round_no)
                for r in rounds
                if r.result in (RESULT_APPROVED, RESULT_REJECTED)
                for claim in r.claims
                if claim.tech == tech
            ),
            None,
        )
        if decided is not None:
            carried.append(CarriedTech(tech, decided[0], decided[1]))
        elif tech not in to_file:
            carried.append(CarriedTech(tech, RESULT_APPROVED, None))
    return carried


def last_reason(rounds: list[Round]) -> LastReason | None:
    """Why the latest decided round went against the village, if it did."""
    latest = next(
        (r for r in rounds if r.result not in (RESULT_PENDING, RESULT_WITHDRAWN)),
        None,
    )
    if latest is None or latest.result == RESULT_APPROVED:
        return None
    if latest.result == RESULT_RETURNED:
        return LastReason(latest.round_no, RESULT_RETURNED, [], latest.return_reason)
    refused = [c for c in latest.claims if c.result == RESULT_REJECTED]
    reasons = [c.reason for c in refused if c.reason]
    return LastReason(
        latest.round_no,
        RESULT_REJECTED,
        [c.tech for c in refused],
        " · ".join(dict.fromkeys(reasons)) or None,
    )


def side_history(
    village: Village, authority: str, submissions: list[AcceptanceSubmission]
) -> SideHistory:
    rounds = [_round(s) for s in newest_first(submissions)]
    return SideHistory(
        to_file=flow.techs_to_file(village, authority),
        carry_over=carry_over(village, authority, rounds),
        last_reason=last_reason(rounds),
        history=rounds,
    )


def confirmable_on_letter(
    db: Session, viewer: User, *, authority: str, letter_number: str
) -> list[int]:
    """Pending submissions this viewer may confirm under one letter.

    Same authority and letter number, inside the viewer's scope, and not filed
    by the viewer -- nobody confirms their own filing. This is the "Confirm all
    N on this letter" set, and ``acceptance_letters.review_letter`` resolves a
    letter number through it, so the count shown is the count confirmed.
    """
    rows = db.execute(
        select(AcceptanceSubmission.id)
        .join(Village, AcceptanceSubmission.village_id == Village.id)
        .where(
            AcceptanceSubmission.authority == authority,
            AcceptanceSubmission.letter_number == letter_number,
            AcceptanceSubmission.review_status == REVIEW_PENDING,
            Village.deleted_at.is_(None),
            Village.work_item_id.in_(visible_work_item_ids(viewer, db)),
            func.coalesce(AcceptanceSubmission.submitted_by, -1) != viewer.id,
        )
        .order_by(AcceptanceSubmission.id)
    ).scalars()
    return list(rows)
