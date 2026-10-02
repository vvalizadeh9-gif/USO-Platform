"""Request and response shapes for the Action Center ticket board.

Dates go out as ISO 8601 UTC; the frontend renders them in Shamsi with Persian
digits.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.services.action_queues.sla import MAX_SLA_DAYS, MIN_SLA_DAYS


class TicketOut(BaseModel):
    queue_key: str
    label: str
    count: int
    overdue: int
    #: The oldest item's clock start (never earlier than 1 Mehr 1405).
    oldest_started_at: datetime | None
    #: The earliest due date, for deadline queues (``date_kind == "due"``).
    earliest_due_at: datetime | None = None
    date_kind: Literal["since", "due"]
    url: str


class StageOut(BaseModel):
    key: str
    label: str
    total: int
    tickets: list[TicketOut]


class Totals(BaseModel):
    pending: int
    overdue: int


class BoardOut(BaseModel):
    role: str
    scope_label: str
    generated_at: datetime
    totals: Totals
    stages: list[StageOut]


class OwnerRowOut(BaseModel):
    owner_type: Literal["contractor", "coordinator", "category", "role", "unassigned"]
    owner_id: int | None
    name: str
    count: int
    overdue: int
    oldest_started_at: datetime | None


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
