"""Response shapes for Roles Performance (``/kpi/month``, ``/area``,
``/performance``, ``/compare``).

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


class MonthEntry(Month):
    key: str


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


class MonthRow(Compared):
    key: str
    label: str
    unit: str
    villages: Compared | None
    owners: list[OwnerEntry] | None


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
    undated_on_air: int
    last_cpm_import: datetime | None


# ----- Area -----------------------------------------------------------------


class AreaCard(BaseModel):
    key: str
    label: str
    count: int
    rate: float | None
    base: int
    base_label: str
    national_rate: float | None
    remaining: int | None = None


class RateCell(BaseModel):
    rate: float | None
    count: int
    national: float | None


class AreaRow(BaseModel):
    name: str
    gaps_key: str | None
    attributed: bool
    villages: int
    dt_done: int
    on_air_only: int
    not_on_air: int
    ict: RateCell
    cra: RateCell
    remaining: int
    low_sample: bool


class OpenWork(BaseModel):
    key: str
    label: str
    count: int
    gap: str | None = None


class AreaPayload(BaseModel):
    scope: ScopeOut
    as_of: datetime | None
    read_only: bool
    cards: list[AreaCard]
    breakdown: str
    breakdowns: list[str]
    rows: list[AreaRow]
    open_work: list[OpenWork]
    low_sample_threshold: int


# ----- Performance ----------------------------------------------------------


class Tile(BaseModel):
    key: str
    label: str
    rate: float | None
    count: int
    base: int
    movement: int | None
    movement_month: Month
    national_rate: float | None
    national_gap: float | None
    role_average: float | None
    role_gap: float | None


class Counted(BaseModel):
    count: int | None
    recorded: bool


class SeriesMonth(MonthEntry):
    running: bool
    dt_done: Counted
    ict_approved: Counted
    cra_approved: Counted
    ict_role_average: float | None


class Results(BaseModel):
    tiles: list[Tile]
    series: list[SeriesMonth]


class TrendMonth(MonthEntry):
    recorded: bool
    filed: int | None
    validated: int | None


class ResponseTime(BaseModel):
    key: str
    label: str
    median_days: float | None
    pairs: int
    low_sample: bool
    role_median_days: float | None


class ActivityOut(BaseModel):
    accounts: int
    trend: list[TrendMonth]
    totals: dict[str, int]
    response_times: list[ResponseTime]


class PerformancePayload(BaseModel):
    scope: ScopeOut
    months: list[Month]
    current_month: Month
    results: Results | None
    activity: ActivityOut | None
    last_cpm_import: datetime | None


# ----- Compare --------------------------------------------------------------


class CompareSeries(MonthEntry):
    count: int | None
    recorded: bool
    median_days: float | None = None


class CompareRow(BaseModel):
    name: str
    label: str
    rate: float | None
    count: int | None
    base: int | None
    delta: float | None
    low_sample: bool
    current: bool
    rank: int | None
    series: list[CompareSeries]


class Named(BaseModel):
    name: str
    value: float | None


class Headline(BaseModel):
    national: float | None
    average: float | None
    highest: Named | None
    lowest: Named | None


class KindChip(BaseModel):
    key: str
    label: str
    count: int
    speed: bool


class ComparePayload(BaseModel):
    kind: str
    measure: str
    period: str
    period_month: Month | None
    kinds: list[KindChip]
    series_months: list[Month]
    low_sample_threshold: int
    unit: str
    lower_is_better: bool
    speed_measure: str | None = None
    speed_label: str | None = None
    rows: list[CompareRow]
    headline: Headline
    recorded: bool
    last_cpm_import: datetime | None
