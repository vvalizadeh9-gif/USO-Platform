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


class HomeGroupOut(BaseModel):
    key: Literal["drive_test", "acceptance", "plans"]
    label: str
    tickets: list[HomeTicketOut]


class HomeTotalsOut(BaseModel):
    pending: int
    queues: int
    overdue: int
    due_soon: int
    #: None when there is no snapshot from seven days ago.
    pending_week_delta: int | None
    overdue_week_delta: int | None
    done_today: int
    done_yesterday: int


class HomePlanOut(BaseModel):
    stream: str
    shamsi_year: int
    shamsi_month: int
    month_name: str
    #: None when no plan is approved for the month -- never 0.
    pip: int | None
    delivered: int
    days_left: int


class HomeSummaryOut(BaseModel):
    role: str
    scope_label: str
    generated_at: datetime
    due_soon_days: int
    #: The SLA every configured queue shares, or None when they differ.
    sla_uniform_days: int | None
    sla_days: dict[str, int]
    totals: HomeTotalsOut
    up_next: str | None
    groups: list[HomeGroupOut]
    plan: HomePlanOut | None
    #: Pending items per app, keyed by the path a ticket opens.
    app_badges: dict[str, int]
