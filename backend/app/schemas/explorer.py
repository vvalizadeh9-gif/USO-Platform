"""Response shape for the Explorer record page (GET /explorer/sites/{id}).

Dates are ISO Gregorian; every day count is a whole number of days on the
Tehran calendar, computed by the server (services/explorer_journey.py).
"""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.schemas.my_work import Authority

StepKey = Literal["on_air", "health_check", "assigned", "dt_done", "sent_to_ict", "acceptance"]
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
    site_type: str | None = None
    hadaf_villages: int


class StepOut(BaseModel):
    key: StepKey
    state: StepState
    date: date | None
    gap_days: int | None


class OldestPendingOut(BaseModel):
    authority: Authority
    days: int
    villages: int


class AgingOut(BaseModel):
    # UEP-28: from the health check done date (to acceptance done when done).
    total_days: int | None
    oldest_pending: OldestPendingOut | None


class LetterOut(BaseModel):
    no: str | None
    date: date | None


class SentToIctOut(BaseModel):
    """One batch the site's villages went to ICT HQ in (UEP-21), or one
    "sent outside UEP" entry for villages found only in Mojri."""

    batch_number: int | None
    outside_uep: bool
    sent_at: date | None
    villages: int
    mtn: LetterOut | None
    ict: LetterOut | None
    cra: LetterOut | None
    in_mojri_since: date | None
    in_mojri: int


class LaneOut(BaseModel):
    """One authority's lane on the ribbon (UEP-28)."""

    approved: int
    total: int
    done_on: date | None


class LanesOut(BaseModel):
    ict: LaneOut
    cra: LaneOut


class JourneyOut(BaseModel):
    steps: list[StepOut]
    aging: AgingOut
    lanes: LanesOut
    sent_to_ict: list[SentToIctOut] = []


class CaseOut(BaseModel):
    """UEP-22: the side's acceptance case."""

    state: Literal["waiting", "rejected", "approved"]
    basket: str | None = None
    category: str | None = None
    days_in_basket: int | None = None
    over_sla: bool = False
    stale: bool = False


class SideOut(BaseModel):
    status: SideWord
    phase: SidePhase
    filed_date: date | None
    decided_date: date | None
    days: int | None
    round: int | None
    filed: bool
    refiled: bool
    case: CaseOut | None = None


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


class HistoryVillageOut(BaseModel):
    code: str | None
    name: str | None


class VillageEventOut(BaseModel):
    """One village change a CPM import raised (UEP-28)."""

    date: date | None
    kind: Literal["added", "removed"]
    villages: list[HistoryVillageOut]
    status: str  # applied | ignored | pending | archived
    decided_by: str | None
    decided_at: date | None


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
    village_history: list[VillageEventOut] = []
    workflow: WorkflowOut


# --------------------------------------------------------------------------
# The list (GET /explorer/sites) and what hangs off it
# --------------------------------------------------------------------------
class NamedOut(BaseModel):
    id: int
    name: str


class VillageRefOut(BaseModel):
    code: str | None
    name: str | None


class VillageMatchOut(VillageRefOut):
    #: How many more of the site's villages the search matched.
    more: int = 0


StageKey = Literal[
    "on_air", "health_check", "assigned", "dt_done", "sent_to_ict", "acceptance", "done"
]


class SiteRowOut(BaseModel):
    id: int
    site_code: str | None
    province: str | None
    type: str | None
    requested_technology: list[str]
    hadaf_villages: int
    dt_contractor: NamedOut | None
    village_match: VillageMatchOut | None
    # UEP-28: the open journey step, whole days in it, and over its SLA.
    stage: StageKey | None = None
    stage_days: int | None = None
    stage_late: bool = False


class SiteListOut(BaseModel):
    items: list[SiteRowOut]
    total: int
    next_cursor: str | None


class FilterOptionsOut(BaseModel):
    provinces: list[NamedOut]
    types: list[str]
    technologies: list[str]
    dt_contractors: list[NamedOut]
