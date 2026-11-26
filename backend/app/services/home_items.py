"""The lists behind Home's numbers (UEP-27 §4.5, §6.2).

Every list is a queue's own fetch -- the same items its Home row counts --
given Home's status (``sla.home_status``) and described by ``details``. The
list panel, its Excel export and the summary panels all read this module, so
the file always holds exactly what the panel showed.

* :func:`queue_rows`   -- one queue's items for this user, cached for a few
  seconds per user and queue (typing in the search box re-reads nothing);
* :func:`select_rows`  -- status filter, search, grouping and order;
* :func:`done_rows`    -- this week's finished acts;
* :func:`pip_rows`     -- each contractor's delivery against their PIP.

Scope is never decided here: a fetch is already confined to the user, and a
queue outside the user's Home is refused (:class:`UnknownQueue`).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.core import count_cache, jalali
from app.models.reference import User
from app.services.action_queues import details, done, sla
from app.services.action_queues.context import QueueContext
from app.services.action_queues.registry import home_queues_for
from app.services.action_queues.types import PM, PendingItem, QueueDefinition, SlaKind
from app.services.home import NO_DONE_ROLES, require_home_role

GROUPINGS: tuple[str, ...] = ("none", "province", "contractor")
#: The group an item with no province or contractor falls into.
NO_GROUP = {"province": "No province", "contractor": "No contractor"}
_RANK = {status: i for i, status in enumerate(sla.STATUS_ORDER)}
#: Owners a list never names: the PM's own decisions say nothing by naming "PM".
_UNNAMED = frozenset({"role"})
#: Roles that may read the per-contractor PIP (UEP-27 §6.2).
PIP_ROLES = frozenset({PM, "Viewer"})


class UnknownQueue(LookupError):
    """Not one of this user's Home queues."""


@dataclass(frozen=True)
class Selection:
    """A list panel's choices."""

    status: str | None = None
    q: str = ""
    group: str = "none"


@dataclass(frozen=True)
class Selected:
    rows: list[dict]
    counts_by_status: dict[str, int]
    groups: list[dict]


# --------------------------------------------------------------------------
# One queue
# --------------------------------------------------------------------------
def home_queue(user: User, queue_key: str) -> QueueDefinition:
    """The queue, if it is one of this user's Home queues."""
    role = require_home_role(user)
    for queue in home_queues_for(role):
        if queue.key == queue_key:
            return queue
    raise UnknownQueue(queue_key)


def _age(item: PendingItem, queue: QueueDefinition, now: datetime) -> int | None:
    if sla.has_no_date(item):
        return None
    if queue.sla is SlaKind.CONFIGURED:
        return max(0, (now - sla.effective_start(item.started_at)).days)
    start = sla.as_datetime(item.started_at)
    return max(0, (now - start).days) if start else None


def _sla_days(item: PendingItem, queue: QueueDefinition, configured: int) -> int | None:
    """The configured SLA, or an item's own span from start to due date."""
    if sla.has_no_date(item):
        return None
    if queue.sla is SlaKind.CONFIGURED:
        return configured
    start, due = sla.as_datetime(item.started_at), sla.as_datetime(item.due_at)
    return max(0, (due - start).days) if start and due else None


def _holder(item: PendingItem) -> str | None:
    owner = item.owner
    return owner.name if owner and owner.type not in _UNNAMED else None


def _row(item: PendingItem, queue: QueueDefinition, detail: details.ItemDetail,
         configured: int, now: datetime, window: timedelta) -> dict:
    status = sla.home_status(item, queue.sla, configured, now, window)
    owner = item.owner
    return {
        "id": str(item.entity_id),
        "label": detail.label,
        "site_id": detail.site_id,
        "village_name": detail.village_name,
        "province": detail.province,
        "cra_region": detail.cra_region,
        "holder_name": _holder(item),
        "contractor": owner.name if owner and owner.type == "contractor" else detail.contractor,
        "status": status,
        "age_days": _age(item, queue, now),
        "sla_days": _sla_days(item, queue, configured),
        "due_at": None if status == sla.NO_DATE else sla.due_at_for(item, queue.sla, configured),
        "url": f"/explorer/sites/{detail.work_item_id}" if detail.work_item_id else queue.url,
    }


def _build_rows(db: Session, user: User, queue: QueueDefinition) -> list[dict]:
    ctx = QueueContext(db, user)
    items = queue.fetch(ctx)
    configured = sla.sla_days_by_queue(db, [queue.key])[queue.key]
    described = details.describe(db, queue.entity, [i.entity_id for i in items])
    window = sla.due_soon_window()
    return [_row(i, queue, described[i.entity_id], configured, ctx.now, window) for i in items]


def queue_rows(db: Session, user: User, queue: QueueDefinition) -> list[dict]:
    """This user's items in one queue, shared for a few seconds."""
    key = ("home-items", user.id, user.role_id, user.contractor_id, queue.key)
    return count_cache.get_or_compute(key, lambda: _build_rows(db, user, queue))


# --------------------------------------------------------------------------
# Filter, search, group, order
# --------------------------------------------------------------------------
_SEARCHED = ("label", "id", "site_id", "village_name", "province", "cra_region",
             "holder_name", "contractor")


def _matches(row: dict, needle: str) -> bool:
    return any(needle in str(row[k]).casefold() for k in _SEARCHED if row.get(k))


def order_key(row: dict) -> tuple:
    """Late first, then due, on time, no date; oldest first inside each, and
    the nearest due date where there is no age."""
    due = row["due_at"]
    return (
        _RANK[row["status"]],
        -(row["age_days"] if row["age_days"] is not None else -1),
        due.timestamp() if due else float("inf"),
        row["label"],
    )


def group_of(row: dict, group: str) -> str:
    return row.get(group) or NO_GROUP[group]


def select_rows(rows: list[dict], sel: Selection) -> Selected:
    """``sel`` applied: the chips count the searched list, the rows are the
    searched list narrowed to one status, ordered (by group first when
    grouped, largest group first)."""
    needle = sel.q.strip().casefold()
    searched = [r for r in rows if _matches(r, needle)] if needle else list(rows)
    counts = Counter(r["status"] for r in searched)
    counts_by_status = {s: counts.get(s, 0) for s in sla.STATUS_ORDER}
    shown = [r for r in searched if not sel.status or r["status"] == sel.status]
    shown.sort(key=order_key)
    if sel.group == "none":
        return Selected(shown, counts_by_status, [])
    sizes = Counter(group_of(r, sel.group) for r in shown)
    late = Counter(group_of(r, sel.group) for r in shown if r["status"] == sla.LATE)
    order = sorted(sizes, key=lambda g: (-sizes[g], g))
    rank = {g: i for i, g in enumerate(order)}
    shown.sort(key=lambda r: rank[group_of(r, sel.group)])
    groups = [{"key": g, "count": sizes[g], "late": late.get(g, 0)} for g in order]
    return Selected(shown, counts_by_status, groups)


# --------------------------------------------------------------------------
# Done this week
# --------------------------------------------------------------------------
def done_rows(db: Session, user: User, today: date | None = None) -> tuple[date, list[dict]]:
    """Acts this user finished since Saturday, newest first."""
    role = require_home_role(user)
    today = today or jalali.tehran_today()
    since = done.week_start(today)
    if role in NO_DONE_ROLES:
        return since, []
    acts = done.done_acts(db, user, role, since)
    by_kind: dict[str, list] = {}
    for act in acts:
        by_kind.setdefault(act.rule.entity, []).append(act.row_id)
    described = {kind: details.describe(db, kind, ids) for kind, ids in by_kind.items()}
    rows = []
    for act in acts:
        detail = described[act.rule.entity][act.row_id]
        rows.append({
            "id": f"{act.rule.key}:{act.row_id}",
            "action": act.rule.action,
            "closed_at": act.when,
            "province": detail.province,
            "label": detail.label if detail.label != str(act.row_id) else None,
        })
    return since, rows


# --------------------------------------------------------------------------
# Contractor PIP
# --------------------------------------------------------------------------
def pip_rows(db: Session, user: User) -> dict:
    """Each contractor's delivered sites against their approved PIP for the
    running month, from the same scorecard as Home's PIP bar."""
    if user.role.name not in PIP_ROLES:
        raise PermissionError("The PIP by contractor is for the PM and Viewer")
    from app.services import monthly_plan

    month = monthly_plan.running_month(db, user)
    year, number = month["shamsi_year"], month["shamsi_month"]
    day = jalali.to_shamsi_date(jalali.tehran_today())[2]
    rows = [
        {"contractor": r.get("name") or f"Contractor {cid}", "delivered": r["delivered"],
         "target": r.get("pip")}
        for cid, r in month["rows"].items()
    ]
    rows.sort(key=lambda r: (r["target"] is None, -(r["target"] or 0), r["contractor"]))
    return {
        "month_name": month["shamsi_month_name"],
        "days_left": max(0, jalali.days_in_month(year, number) - day),
        "rows": rows,
    }
