"""Request letters sent to ICT or CRA, and which of them are still unanswered.

A village side is *with the authority* from the moment a request letter is
sent until somebody records what the authority decided -- that is, until a
submission (any review state but Withdrawn) is filed for the same village and
authority at or after the request. That one rule, :func:`open_request_clause`,
is what My Work's "With authority" tab lists and what the PM's "Follow up with
ICT / CRA" ticket counts; nothing else restates it.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import ColumnElement, and_, exists, func, select
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.models.acceptance_workflow import (
    AUTHORITIES,
    REVIEW_WITHDRAWN,
    AcceptanceAuthorityRequest,
    AcceptanceSubmission,
)
from app.models.reference import User
from app.models.workitem import Village
from app.services import acceptance_workflow as flow
from app.services.audit import record_audit

#: A side may be sent to the authority while nothing is filed for it, or after
#: the authority rejected a technology and it has to be asked again.
REQUESTABLE_STATUSES = frozenset({flow.STATUS_NOT_FILED, flow.STATUS_REJECTED})


def _answered(request) -> ColumnElement[bool]:
    """A submission recorded for the same side at or after this request."""
    return exists().where(
        AcceptanceSubmission.village_id == request.village_id,
        AcceptanceSubmission.authority == request.authority,
        AcceptanceSubmission.review_status != REVIEW_WITHDRAWN,
        AcceptanceSubmission.submitted_at >= request.sent_at,
    )


def _open_requests(village_id: ColumnElement, authorities: tuple[str, ...]):
    r = AcceptanceAuthorityRequest
    return and_(
        r.village_id == village_id,
        r.authority.in_(authorities),
        ~_answered(r),
    )


def open_request_clause(
    village_id: ColumnElement, authorities: tuple[str, ...] = AUTHORITIES
) -> ColumnElement[bool]:
    """Whether the village has an unanswered request with any of ``authorities``."""
    return exists().where(_open_requests(village_id, authorities))


def open_since(
    village_id: ColumnElement, authorities: tuple[str, ...] = AUTHORITIES
) -> ColumnElement:
    """When the newest unanswered request was sent, as a correlated scalar."""
    return (
        select(func.max(AcceptanceAuthorityRequest.sent_at))
        .where(_open_requests(village_id, authorities))
        .correlate_except(AcceptanceAuthorityRequest)
        .scalar_subquery()
    )


# --------------------------------------------------------------------------
# Recording
# --------------------------------------------------------------------------
class RequestError(ValueError):
    """A request the rules refuse, with a machine-readable code."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class RequestOutcome:
    village_id: int
    recorded: bool
    reason: str | None = None


def record_requests(
    db: Session,
    user: User,
    *,
    village_ids: list[int],
    authority: str,
    letter_number: str | None,
    letter_date: date | None,
) -> list[RequestOutcome]:
    """Record that a request letter went to ``authority`` for each village.

    Villages the caller cannot see are reported as not found, exactly as for a
    village that does not exist. A side already with the authority, or one
    whose state does not need asking (filed, returned for paperwork, approved),
    is skipped with its reason; the rest are recorded together. Caller commits.
    """
    if authority not in AUTHORITIES:
        raise RequestError("authority must be ICT or CRA", "invalid_authority")
    if not village_ids:
        raise RequestError("Choose at least one village", "no_villages")

    status_col = Village.ict_status if authority == "ICT" else Village.cra_status
    visible = {
        vid: (status, already_open)
        for vid, status, already_open in db.execute(
            flow.visible_villages(user, db)
            .where(Village.id.in_(village_ids))
            .with_only_columns(
                Village.id,
                status_col,
                open_request_clause(Village.id, (authority,)),
            )
        ).all()
    }

    now = datetime.now(timezone.utc)
    outcomes: list[RequestOutcome] = []
    for vid in dict.fromkeys(village_ids):
        if vid not in visible:
            outcomes.append(RequestOutcome(vid, False, "not_found"))
            continue
        status, already_open = visible[vid]
        if already_open:
            outcomes.append(RequestOutcome(vid, False, "already_with_authority"))
            continue
        if status not in REQUESTABLE_STATUSES:
            outcomes.append(RequestOutcome(vid, False, "not_requestable"))
            continue
        request = AcceptanceAuthorityRequest(
            village_id=vid, authority=authority, letter_number=letter_number,
            letter_date=letter_date, sent_at=now, sent_by=user.id,
        )
        db.add(request)
        db.flush()
        record_audit(
            db, user_id=user.id, action=audit_actions.SUBMITTED,
            module="acceptance", entity_type="AcceptanceAuthorityRequest",
            entity_id=request.id,
            new_value={"village_id": vid, "authority": authority,
                       "letter_number": letter_number},
        )
        outcomes.append(RequestOutcome(vid, True))
    return outcomes
