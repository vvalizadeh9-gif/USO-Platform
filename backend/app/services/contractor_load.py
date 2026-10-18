"""Each contractor's workload, for the assign panel's contractor cards.

One row per active contractor the caller may assign to:

* ``open`` -- sites with them in this process now, inside the caller's scope:
  the pipeline's "In check" items for a health check, "In test" plus "Sent
  back" for a drive test. Read from the same queue fetches the strip counts,
  so a card's figure adds up to the step's;
* ``late`` -- the subset past its queue's SLA, by the same ``is_overdue``;
* ``avg_submit_days`` -- the mean of assigned → submitted over the last 90
  days, or None with fewer than :data:`MIN_SAMPLES` submissions;
* ``provinces`` -- where at least :data:`MIN_SHARE` of their work in this
  process was assigned in the last 90 days, highest share first, at most
  :data:`MAX_PROVINCES`. Used only to suggest a contractor.

Reads over the existing assignment, task and drive-test tables; nothing new is
stored.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta

from sqlalchemy import select

from app.models.health_check import HcAssignment, HcTask
from app.models.reference import Contractor, Province
from app.models.workitem import Assignment, DriveTest, Site, WorkItem
from app.services import pipeline
from app.services.action_queues import sla
from app.services.action_queues.context import QueueContext
from app.services.visibility import visible_work_item_ids

WINDOW = timedelta(days=90)
MIN_SAMPLES = 5
MIN_SHARE = 0.2
MAX_PROVINCES = 5

#: The queues whose items are "with the contractor", per process.
OPEN_QUEUES = {"hc": ("hc_in_check",), "dt": ("dt_in_test", "dt_sent_back")}


def _open_and_late(ctx: QueueContext, process: str) -> tuple[Counter, Counter]:
    keys = list(OPEN_QUEUES[process])
    days = pipeline.sla_days_for(ctx.db, keys)
    open_, late = Counter(), Counter()
    for key in keys:
        queue = pipeline.queue_for(key)
        for item in queue.fetch(ctx):
            if item.owner is None or item.owner.id is None:
                continue
            open_[item.owner.id] += 1
            if sla.is_overdue(item, queue.sla, days[key], ctx.now):
                late[item.owner.id] += 1
    return open_, late


def _mean_days(spans: list[timedelta]) -> float | None:
    if len(spans) < MIN_SAMPLES:
        return None
    return round(sum(s.total_seconds() for s in spans) / len(spans) / 86400, 1)


def _shares(by_province: Counter) -> list[dict]:
    total = sum(by_province.values())
    if not total:
        return []
    shares = [
        {"province": name, "share": round(n / total, 2)}
        for name, n in by_province.items()
        if n / total >= MIN_SHARE
    ]
    shares.sort(key=lambda s: (-s["share"], s["province"]))
    return shares[:MAX_PROVINCES]


def _hc_history(ctx: QueueContext, since) -> tuple[dict, dict]:
    """Submit spans and assigned provinces per contractor, last 90 days."""
    scoped = visible_work_item_ids(ctx.user, ctx.db)
    spans: dict[int, list[timedelta]] = defaultdict(list)
    provinces: dict[int, Counter] = defaultdict(Counter)
    rows = ctx.db.execute(
        select(HcAssignment.contractor_id, HcAssignment.assigned_at, HcTask.completed_at, Province.name)
        .join(HcTask, HcTask.hc_assignment_id == HcAssignment.id)
        .join(WorkItem, HcTask.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(HcTask.work_item_id.in_(scoped))
    ).all()
    for contractor_id, assigned_at, completed_at, province in rows:
        assigned = sla.as_datetime(assigned_at)
        completed = sla.as_datetime(completed_at)
        if completed is not None and assigned is not None and completed >= since:
            spans[contractor_id].append(completed - assigned)
        if assigned is not None and assigned >= since and province:
            provinces[contractor_id][province] += 1
    return spans, provinces


def _dt_history(ctx: QueueContext, since) -> tuple[dict, dict]:
    """The same for drive tests: a submission is credited to the assignment
    that held the site when it was submitted (the latest one before it)."""
    scoped = visible_work_item_ids(ctx.user, ctx.db)
    assignments: dict[int, list] = defaultdict(list)
    provinces: dict[int, Counter] = defaultdict(Counter)
    for wi_id, contractor_id, assigned_at, province in ctx.db.execute(
        select(Assignment.work_item_id, Assignment.contractor_id, Assignment.assigned_at, Province.name)
        .join(WorkItem, Assignment.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(Assignment.work_item_id.in_(scoped), Assignment.assignment_type == "official")
        .order_by(Assignment.assigned_at.asc(), Assignment.id.asc())
    ):
        assigned = sla.as_datetime(assigned_at)
        assignments[wi_id].append((assigned, contractor_id))
        if assigned is not None and assigned >= since and province:
            provinces[contractor_id][province] += 1

    spans: dict[int, list[timedelta]] = defaultdict(list)
    for wi_id, submitted_at in ctx.db.execute(
        select(DriveTest.work_item_id, DriveTest.submitted_at).where(
            DriveTest.work_item_id.in_(scoped), DriveTest.submitted_at.isnot(None)
        )
    ):
        submitted = sla.as_datetime(submitted_at)
        if submitted is None or submitted < since:
            continue
        held = [(a, c) for a, c in assignments.get(wi_id, []) if a is not None and a <= submitted]
        if held:
            assigned, contractor_id = held[-1]
            spans[contractor_id].append(submitted - assigned)
    return spans, provinces


def contractor_load(ctx: QueueContext, process: str) -> list[dict]:
    """``process`` is ``"hc"`` or ``"dt"``. Lowest open load first."""
    since = ctx.now - WINDOW
    open_, late = _open_and_late(ctx, process)
    spans, provinces = (_hc_history if process == "hc" else _dt_history)(ctx, since)
    contractors = ctx.db.execute(
        # Drive-test contractors only: site (execution) contractors and the
        # status words an old CPM import turned into contractors never take
        # a health check or a drive test (UEP-14 §5.1).
        select(Contractor.id, Contractor.name).where(
            Contractor.active.is_(True), Contractor.type == "drive_test"
        )
    ).all()
    rows = [
        {
            "contractor_id": cid,
            "name": name,
            "open": open_.get(cid, 0),
            "late": late.get(cid, 0),
            "avg_submit_days": _mean_days(spans.get(cid, [])),
            "provinces": _shares(provinces.get(cid, Counter())),
        }
        for cid, name in contractors
    ]
    rows.sort(key=lambda r: (r["open"], r["name"]))
    return rows
