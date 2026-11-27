"""The shape of ``GET /home/summary``. Dates go out as ISO 8601 UTC."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class SubmissionMetaOut(BaseModel):
    next_number: int
    due_in: int | None = None
    sites: int = 0
    oldest_days: int | None = None


class CaseMetaOut(BaseModel):
    """Acceptance case rows only (UEP-22): from the Filing inbox's counts."""

    count: int
    over_sla: int
    no_comment: int


class MojriMetaOut(BaseModel):
    """The Mojri tracker row (UEP-24 F9): days since the last upload."""

    age_days: int | None = None
    stale: bool
    follow_up_days: int
    as_of: date | None = None


class HomeTicketOut(BaseModel):
    queue_key: str
    #: The action, verb first ("Review DT results").
    label: str
    #: The queue as a noun ("DT review").
    short_label: str
    #: What one item is: "sites", "villages", "fixes", "plans" or "changes".
    unit: str
    count: int
    #: Who acts next (UEP-27): "self" (To do), "others" (Waiting on others)
    #: or "reminder" (counted in neither).
    holder: Literal["self", "others", "reminder"] = "self"
    #: on_time + due_soon + late + no_date == count. ``late`` never counts an
    #: undated item; those are ``no_date``.
    on_time: int
    due_soon: int
    late: int
    no_date: int = 0
    oldest_started_at: datetime | None
    earliest_due_at: datetime | None
    date_kind: Literal["since", "due"]
    url: str
    #: Up to two holders of these items, most items first; never the viewer.
    owners: list[str]
    owners_more: int
    #: How many distinct holders there are in all.
    owners_total: int
    #: What the holders are, plural ("contractors"); None when none is named.
    owner_type: str | None = None
    #: Whole days the oldest item has waited.
    oldest_days: int | None = None
    #: Submissions rows only (UEP-21): the next batch and its cycle.
    submission: SubmissionMetaOut | None = None
    #: Acceptance case rows only (UEP-22): over SLA and no fresh comment.
    acceptance: CaseMetaOut | None = None
    #: The Mojri tracker row only (UEP-24 F9).
    mojri: MojriMetaOut | None = None


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
    # --- UEP-27 -----------------------------------------------------------
    #: The ``self`` tickets: todo_late + todo_due_soon + todo_on_time +
    #: todo_no_date == todo.
    todo: int = 0
    todo_late: int = 0
    todo_due_soon: int = 0
    todo_on_time: int = 0
    todo_no_date: int = 0
    #: The ``others`` tickets.
    waiting: int = 0
    waiting_late: int = 0
    waiting_no_date: int = 0
    #: Saturday to today, and the whole week before (Tehran days); None for a
    #: role with no done count.
    done_this_week: int | None = None
    done_last_week: int | None = None
    #: To do now less To do seven days ago; None without that day's snapshot.
    todo_change_7d: int | None = None


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
    #: Rail-only queues (UEP-16): a page's own count and lateness, on no card.
    rail_tickets: list[HomeTicketOut] = []
    #: When the last CPM workbook was imported (UEP-27 footer).
    cpm_imported_at: datetime | None = None


class SystemStatusOut(BaseModel):
    #: UEP-25: the System health verdict, the same one Admin Overview shows.
    #: "normal"; "attention" when System health has a red item; "degraded"
    #: when the database does not answer.
    status: Literal["normal", "attention", "degraded"]
    #: "All systems normal" or the first problem.
    headline: str = "All systems normal"
    checked_at: datetime


class MeHomeOut(HomeSummaryOut):
    """``GET /me/home``: the summary plus the footer's status and version."""

    system: SystemStatusOut
    version: str


# --------------------------------------------------------------------------
# UEP-27: the lists behind Home's numbers
# --------------------------------------------------------------------------
ItemStatus = Literal["late", "due_soon", "on_time", "no_date"]


class QueueItemOut(BaseModel):
    #: The queue's own id for the item (stable key).
    id: str
    #: What the list shows: the site ID, or the village ID.
    label: str
    site_id: str | None = None
    village_name: str | None = None
    province: str | None = None
    cra_region: str | None = None
    holder_name: str | None = None
    contractor: str | None = None
    status: ItemStatus
    #: Whole days since the clock started; None with no start.
    age_days: int | None = None
    #: The SLA the item is measured against, in days; None when it has none.
    sla_days: int | None = None
    due_at: datetime | None = None
    url: str


class QueueGroupOut(BaseModel):
    key: str
    count: int
    late: int


class QueueItemsOut(BaseModel):
    queue_key: str
    label: str
    unit: str
    url: str
    holder: Literal["self", "others", "reminder"]
    #: Items matching the filter and search (before paging).
    total: int
    #: Every status's count in the whole queue (the chips), search applied.
    counts_by_status: dict[str, int]
    group: Literal["none", "province", "contractor"]
    groups: list[QueueGroupOut]
    page: int
    size: int
    items: list[QueueItemOut]


class DoneItemOut(BaseModel):
    id: str
    action: str
    closed_at: datetime
    province: str | None = None
    label: str | None = None


class DoneListOut(BaseModel):
    period: Literal["week"]
    since: date
    total: int
    items: list[DoneItemOut]


class PipContractorOut(BaseModel):
    contractor: str
    delivered: int
    #: None when the contractor has no approved plan for the month.
    target: int | None


class PipByContractorOut(BaseModel):
    month_name: str
    days_left: int
    rows: list[PipContractorOut]
