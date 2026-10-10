"""The shape of ``GET /home/summary``. Dates go out as ISO 8601 UTC."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HomeTicketOut(BaseModel):
    queue_key: str
    #: The action, verb first ("Review DT results").
    label: str
    #: The queue as a noun ("DT review").
    short_label: str
    #: What one item is: "sites", "villages", "fixes", "plans" or "changes".
    unit: str
    count: int
    #: on_time + due_soon + late == count.
    on_time: int
    due_soon: int
    late: int
    oldest_started_at: datetime | None
    earliest_due_at: datetime | None
    date_kind: Literal["since", "due"]
    url: str
    #: Up to two holders of these items, most items first; never the viewer.
    owners: list[str]
    owners_more: int
    #: How many distinct holders there are in all.
    owners_total: int


class HomeGroupOut(BaseModel):
    key: Literal["drive_test", "acceptance", "plans"]
    label: str
    #: The scope its counts are inside, on a card that names it (Acceptance).
    scope_label: str | None
    tickets: list[HomeTicketOut]


class HomeTotalsOut(BaseModel):
    """Every figure is summed from the tickets in ``groups``, and nothing else."""

    pending: int
    queues: int
    overdue: int
    due_soon: int
    #: None for a role with no "Done today" (Regional Manager).
    done_today: int | None
    done_yesterday: int | None
    #: Today less seven days ago; None without a figure for that day.
    pending_week_delta: int | None
    overdue_week_delta: int | None
    due_soon_week_delta: int | None


class HomeTrendsOut(BaseModel):
    """One point per day, oldest first, ending today. None is a day with no
    figure (drawn as a gap, never as zero)."""

    days: list[str]
    pending: list[int | None]
    overdue: list[int | None]
    due_soon: list[int | None]
    #: None for a role with no "Done today".
    done: list[int] | None


class HomePlanOut(BaseModel):
    stream: str
    shamsi_year: int
    shamsi_month: int
    month_name: str
    #: None when no plan is approved for the month -- never 0.
    pip: int | None
    delivered: int
    days_left: int


class HomeBadgePartOut(BaseModel):
    label: str
    count: int


class HomeBadgeOut(BaseModel):
    count: int
    #: The tickets the badge adds up, for its tooltip.
    parts: list[HomeBadgePartOut]


class HomeSummaryOut(BaseModel):
    role: str
    scope_label: str
    generated_at: datetime
    #: Today in Tehran, Shamsi, as YYYY-MM-DD; the page formats it.
    shamsi_date: str
    due_soon_days: int
    #: The SLA every configured queue shares, or None when they differ.
    sla_uniform_days: int | None
    sla_days: dict[str, int]
    totals: HomeTotalsOut
    trends: HomeTrendsOut
    groups: list[HomeGroupOut]
    plan: HomePlanOut | None
    #: Pending items per app, keyed by the path a ticket opens.
    app_badges: dict[str, HomeBadgeOut]
