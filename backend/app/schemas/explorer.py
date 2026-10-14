"""Response shape for the Explorer record page (GET /explorer/sites/{id}).

Dates are ISO Gregorian; every day count is a whole number of days on the
Tehran calendar, computed by the server (services/explorer_journey.py).
"""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

StepKey = Literal["on_air", "health_check", "assigned", "dt_done", "acceptance"]
StepState = Literal["done", "in_progress", "upcoming"]
SideWord = Literal["approved", "pending", "rejected"]
SidePhase = Literal[
    "decided", "rejected", "not_filed", "with_authority", "with_coordinator", "returned"
]


class SiteStatusOut(BaseModel):
    step: StepKey
    state: Literal["done", "in_progress"]


class GeneralOut(BaseModel):
    on_air_date: date | None
    dt_date: date | None
    site_contractor: str | None
    dt_contractor: str | None
    requested_technology: list[str]
    province: str | None
    hadaf_villages: int


class StepOut(BaseModel):
    key: StepKey
    state: StepState
    date: date | None
    gap_days: int | None


class LongestStepOut(BaseModel):
    # "from" is a Python keyword; the wire name is kept by the alias.
    from_: StepKey = Field(alias="from")
    to: StepKey
    days: int


class OldestPendingOut(BaseModel):
    authority: Literal["ICT", "CRA"]
    days: int
    villages: int


class AgingOut(BaseModel):
    total_days: int | None
    current_step_days: int | None
    longest_step: LongestStepOut | None
    oldest_pending: OldestPendingOut | None


class JourneyOut(BaseModel):
    steps: list[StepOut]
    aging: AgingOut


class SideOut(BaseModel):
    status: SideWord
    phase: SidePhase
    filed_date: date | None
    decided_date: date | None
    days: int | None
    round: int | None
    filed: bool
    refiled: bool


class VillageOut(BaseModel):
    id: int
    code: str | None
    name: str | None
    ict: SideOut
    cra: SideOut


class CountOut(BaseModel):
    approved: int
    pending: int
    rejected: int


class CountsOut(BaseModel):
    ict: CountOut
    cra: CountOut


class WorkflowOut(BaseModel):
    current_stage: str
    active_drive_test_id: int | None
    dt_submission_date: date | None


class SiteRecordOut(BaseModel):
    id: int
    site_code: str | None
    status: SiteStatusOut
    general: GeneralOut
    journey: JourneyOut
    acceptance_started: bool
    villages: list[VillageOut]
    counts: CountsOut
    workflow: WorkflowOut
