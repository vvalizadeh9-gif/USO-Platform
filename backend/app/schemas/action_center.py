"""Request and response shapes for the pending-work settings (SLA days and
the digest opt-out) and for request letters.
"""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.services.action_queues.sla import MAX_SLA_DAYS, MIN_SLA_DAYS


class QueueSlaOut(BaseModel):
    queue_key: str
    label: str
    stage: str
    sla_days: int
    #: False for queues measured against their own due date (fixes use their
    #: category's SLA, the monthly plan its deadline): changing the days does
    #: nothing there, so the admin screen shows them read-only.
    configurable: bool


class QueueSlaIn(BaseModel):
    queue_key: str
    sla_days: int = Field(ge=MIN_SLA_DAYS, le=MAX_SLA_DAYS)


class NotificationsOut(BaseModel):
    email_digest: bool


class NotificationsIn(BaseModel):
    email_digest: bool


class AuthorityRequestIn(BaseModel):
    authority: Literal["ICT", "CRA"]
    village_ids: list[int] = Field(min_length=1, max_length=500)
    letter_number: str | None = Field(default=None, max_length=120)
    letter_date: date | None = None


class AuthorityRequestOutcome(BaseModel):
    village_id: int
    recorded: bool
    reason: Literal["not_found", "already_with_authority", "not_requestable"] | None = None


class AuthorityRequestResult(BaseModel):
    recorded: int
    outcomes: list[AuthorityRequestOutcome]
