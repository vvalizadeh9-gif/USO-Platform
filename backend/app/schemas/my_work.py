"""Request and response shapes for My Work (docs/design/my-work-api.md).

Every key is role-neutral -- ``filled``, not "To check" -- and every label is
the frontend's. Dates go out twice, ISO Gregorian and Shamsi.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Authority = Literal["ICT", "CRA"]
SideStatus = Literal["waiting", "filled", "returned", "rejected", "approved"]
TabKey = Literal["your_move", "new_letter", "returned", "not_filed", "filled", "all"]
ClaimResult = Literal["approved", "rejected"]
RoundResult = Literal["pending", "approved", "rejected", "returned", "withdrawn"]
Scope = Literal["remaining", "universe"]


class SideOut(BaseModel):
    status: SideStatus
    round_no: int | None
    next_round_no: int | None
    editable: bool
    reviewable: bool


class MyWorkRow(BaseModel):
    village_id: int
    village_code: str | None
    village_name: str | None
    site_id: int
    site_code: str | None
    work_item_id: int
    province_name: str | None
    contractor_name: str | None
    requested_technologies: list[str]
    dt_date: date | None
    dt_date_shamsi: str | None
    days_waiting: int | None
    long_wait: bool
    refiling_round: int | None
    sides: dict[Authority, SideOut]


class TabCount(BaseModel):
    key: TabKey
    count: int


class AuthorityTotals(BaseModel):
    kind: Literal["not_approved", "to_check"]
    ICT: int
    CRA: int


class MyWorkList(BaseModel):
    scope: Scope
    tab: TabKey
    view: Literal["contractor", "staff"]
    read_only: bool
    tabs: list[TabCount]
    authority_totals: AuthorityTotals
    total: int
    rows: list[MyWorkRow]
    next_cursor: str | None
    long_wait_days: int


# ---------- Village detail ----------
class CpmFacts(BaseModel):
    site_id: int | None
    site_code: str | None
    province_name: str | None
    village_code: str | None
    village_name: str | None
    requested_technologies: list[str]
    dt_date: date | None
    dt_date_shamsi: str | None


class ClaimOut(BaseModel):
    tech: str
    result: ClaimResult
    reason: str | None


class ScanOut(BaseModel):
    evidence_id: int
    filename: str


class RoundOut(BaseModel):
    submission_id: int
    round_no: int
    letter_number: str
    letter_date: date | None
    letter_date_shamsi: str | None
    result: RoundResult
    source: str
    submitted_by_name: str | None
    submitted_at: datetime
    reviewed_by_name: str | None
    reviewed_at: datetime | None
    return_reason: str | None
    claims: list[ClaimOut]
    scan: ScanOut | None


class CarriedOut(BaseModel):
    tech: str
    result: ClaimResult
    round_no: int | None


class LastReasonOut(BaseModel):
    round_no: int
    kind: Literal["rejected", "returned"]
    techs: list[str]
    reason: str | None


class SameLetterOut(BaseModel):
    letter_number: str
    count: int


class SideDetailOut(SideOut):
    to_file: list[str]
    carry_over: list[CarriedOut]
    last_reason: LastReasonOut | None
    same_letter: SameLetterOut | None
    history: list[RoundOut]


# ---------- Suggestions and code resolution ----------
class SuggestedVillage(BaseModel):
    village_id: int
    village_code: str | None
    village_name: str | None
    status: SideStatus


class Suggestions(BaseModel):
    site_id: int
    site_code: str | None
    villages: list[SuggestedVillage]


class ResolveRequest(BaseModel):
    codes: list[str] = Field(min_length=1, max_length=500)
    scope: Scope = "remaining"


class ResolvedCode(BaseModel):
    code: str
    village_id: int


class ResolveResult(BaseModel):
    total: int
    matched: list[ResolvedCode]
    unmatched: list[str]


# ---------- Scans and letters ----------
class ScanUploaded(BaseModel):
    scan_id: str
    filename: str
    content_type: str
    size_bytes: int
    expires_at: datetime


class ClaimIn(BaseModel):
    tech: str = Field(min_length=1, max_length=10)
    result: ClaimResult
    reason: str | None = Field(None, max_length=2000)


class LetterItemIn(BaseModel):
    village_id: int
    claims: list[ClaimIn] = Field(min_length=1, max_length=3)


class LetterIn(BaseModel):
    authority: Authority
    letter_number: str | None = Field(None, max_length=120)
    letter_date: str | None = Field(None, max_length=20)
    scan_id: str | None = Field(None, max_length=4000)
    items: list[LetterItemIn] = Field(min_length=1, max_length=500)


class VillageOutcomeOut(BaseModel):
    village_id: int
    submission_id: int
    round_no: int
    status: SideStatus


class LetterFiled(BaseModel):
    authority: Authority
    letter_number: str
    decided: bool
    count: int
    results: list[VillageOutcomeOut]


class LetterReviewIn(BaseModel):
    authority: Authority
    letter_number: str | None = Field(None, max_length=120)
    submission_ids: list[int] | None = Field(None, min_length=1, max_length=500)
    decision: Literal["confirm", "return"]
    reason: str | None = Field(None, max_length=2000)


class LetterReviewed(BaseModel):
    decision: Literal["confirm", "return"]
    count: int
    results: list[VillageOutcomeOut]
