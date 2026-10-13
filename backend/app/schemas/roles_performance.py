"""Response shapes for Roles Performance (``/kpi/month`` and ``/kpi/area``).

Contract rules, stated once:

* a Shamsi month is ``{year, month, label_fa}``;
* every comparison carries ``now``, ``ref``, ``delta`` and
  ``lower_is_better``;
* a value that was not recorded is ``null`` with ``recorded: false``, never 0.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class Month(BaseModel):
    year: int
    month: int
    label_fa: str


class Compared(BaseModel):
    now: float | None
    ref: float | None
    delta: float | None
    lower_is_better: bool
    recorded: bool
    ref_recorded: bool


class ScopeOut(BaseModel):
    lens: str
    key: str
    label: str
    chip: str
    selectable: bool
    past: bool
    provinces: int
    cra_regions: int


# ----- Month ----------------------------------------------------------------


class OwnerEntry(Compared):
    name: str


class OwnersBy(BaseModel):
    contractor: list[OwnerEntry]
    rm: list[OwnerEntry]
    coordinator: list[OwnerEntry]


class MonthRow(Compared):
    key: str
    label: str
    unit: str
    villages: Compared | None
    #: ``by=coordinator|contractor|rm``: one list (the export).
    owners: list[OwnerEntry] | None
    #: ``by=owners``: the three lists the screen shows side by side.
    owners_by: OwnersBy | None = None


class Block(BaseModel):
    value: int
    unit: str


class MonthSection(BaseModel):
    key: str
    title: str
    block: Block
    rows: list[MonthRow]


class MonthPayload(BaseModel):
    month: Month
    ref_month: Month
    running: bool
    day: int | None
    days_in_month: int
    ref_day: int
    by: str
    sections: list[MonthSection]
    recorded_from: Month
    current_month: Month
    first_year: int
    undated_on_air: int
    last_cpm_import: datetime | None


# ----- Area -----------------------------------------------------------------


class Measured(BaseModel):
    count: int
    rate: float | None


class AreaMeasures(BaseModel):
    onair: Measured
    dt: Measured
    full: Measured
    ict: Measured
    cra: Measured


class AreaTotals(AreaMeasures):
    villages: int


class NationalRates(BaseModel):
    onair: float | None
    dt: float | None
    full: float | None
    ict: float | None
    cra: float | None


class AreaRow(BaseModel):
    name: str
    gaps_key: str | None
    villages: int
    measures: AreaMeasures
    low_sample: bool


class AreaPayload(BaseModel):
    scope: ScopeOut
    as_of: datetime | None
    read_only: bool
    totals: AreaTotals
    national: NationalRates
    breakdown: str
    breakdowns: list[str]
    rows: list[AreaRow]
    low_sample_threshold: int
