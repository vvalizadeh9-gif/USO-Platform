"""SLA policies (UEP-15): the one place every SLA in UEP is read from.

Each workflow step has one SLA in calendar days, stored in ``sla_policy``.
When a step was never stored, the default below applies. Remediation has one
step per problem category (``remediation:<category_id>``), so a new category
gets its own row with :data:`DEFAULT_REMEDIATION_DAYS`.

Values are cached on the request's session (``db.info``) and the cache is
dropped by :func:`update`, so a change applies on the very next read.

How each clock starts and stops stays in the queue code; this module only says
how many days it may run.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.health_check import HcRemediation
from app.models.reference import ProblemCategory, User
from app.models.sla_policy import SlaPolicy, SlaPolicyHistory

MIN_DAYS = 1
MAX_DAYS = 365
DEFAULT_REMEDIATION_DAYS = 7
REMEDIATION_PREFIX = "remediation:"

_CACHE_KEY = "sla_policy_cache"

#: Areas in lifecycle order: (key, label).
AREAS = (
    ("health_check", "Health check"),
    ("remediation", "Remediation"),
    ("drive_test", "Drive test"),
    ("monthly_plan", "Monthly plan"),
    ("acceptance", "Acceptance"),
)


@dataclass(frozen=True)
class Step:
    key: str
    area: str
    label: str
    meta: str
    default: int


#: Every fixed step, in display order. Remediation rows come from categories.
STEPS: tuple[Step, ...] = (
    Step("hc_assign", "health_check", "Assign health check", "PM, coordinator · on air → assigned", 14),
    Step("hc_check", "health_check", "Health check", "Contractor · assigned → result submitted (per batch)", 2),
    Step("hc_decide", "health_check", "Decide result", "PM, coordinator · submitted → Ready/Problematic", 1),
    Step("dt_assign", "drive_test", "Assign drive test", "PM · health check confirmed → assigned", 14),
    Step("dt_test", "drive_test", "Drive test", "Contractor · assigned → DT submitted (per site, per round)", 14),
    Step("dt_review", "drive_test", "Review drive test", "PM, coordinator · submitted → accepted / sent back", 1),
    Step("pip_share", "monthly_plan", "Share contractor PIP", "Contractor · month start → plan shared", 5),
    Step("pip_approve", "monthly_plan", "Approve contractor PIP", "PM · shared → approved / returned", 2),
    Step("ict_file", "acceptance", "File ICT", "Contractor, coordinator · DT done → ICT filed", 14),
    Step("cra_file", "acceptance", "File CRA", "Contractor, coordinator · DT done → CRA filed", 14),
    Step("validate", "acceptance", "Validate filing", "Coordinator · contractor filed → validated", 2),
    Step("ict_reply", "acceptance", "ICT decision", "ICT (external, tracking) · filed → approved/rejected", 30),
    Step("cra_reply", "acceptance", "CRA decision", "CRA (external, tracking) · filed → approved/rejected", 30),
    Step("refile", "acceptance", "Re-file after rejection", "Contractor · rejected → re-filed", 7),
)
STEPS_BY_KEY = {s.key: s for s in STEPS}

#: Each action queue (and pipeline-only queue) whose SLA is a day count, and
#: the step it reads. Queues absent here are listed in the UEP-15 PR: they keep
#: their legacy ``action_queue_sla`` value until the product owner maps them.
QUEUE_STEP: dict[str, str] = {
    "hc_assign": "hc_assign",
    "hc_submit": "hc_check",
    "hc_in_check": "hc_check",
    "hc_review": "hc_decide",
    "dt_assign": "dt_assign",
    "dt_todo": "dt_test",
    "dt_in_test": "dt_test",
    "dt_redo": "dt_test",
    "dt_sent_back": "dt_test",
    "dt_review": "dt_review",
    "plans_approve": "pip_approve",
    "ict_to_file": "ict_file",
    "cra_to_file": "cra_file",
    "ict_to_validate": "validate",
    "cra_to_validate": "validate",
    "ict_follow_up": "ict_reply",
    "cra_follow_up": "cra_reply",
    "ict_refile": "refile",
    "cra_refile": "refile",
}


class StaleChange(Exception):
    """Someone saved meanwhile: ``stale`` maps step key to its current days."""

    def __init__(self, stale: dict[str, int]):
        super().__init__("These SLAs were changed by someone else")
        self.stale = stale


def remediation_key(category_id: int) -> str:
    return f"{REMEDIATION_PREFIX}{category_id}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _categories(db: Session) -> list[ProblemCategory]:
    return list(
        db.execute(select(ProblemCategory).order_by(ProblemCategory.name)).scalars()
    )


def _defaults(db: Session) -> dict[str, int]:
    out = {s.key: s.default for s in STEPS}
    # A category with no policy row yet (created after the migration, e.g. by
    # first-start seeding) starts from its own seeded value, else 7.
    for cat in _categories(db):
        out[remediation_key(cat.id)] = cat.sla_days or DEFAULT_REMEDIATION_DAYS
    return out


def get_all(db: Session) -> dict[str, int]:
    """Every step's SLA in days, stored value else default. Cached per session."""
    cached = db.info.get(_CACHE_KEY)
    if cached is not None:
        return cached
    values = _defaults(db)
    values.update(dict(db.execute(select(SlaPolicy.step_key, SlaPolicy.days)).all()))
    db.info[_CACHE_KEY] = values
    return values


def invalidate(db: Session) -> None:
    db.info.pop(_CACHE_KEY, None)


def get_days(db: Session, step_key: str) -> int:
    values = get_all(db)
    if step_key in values:
        return values[step_key]
    if step_key.startswith(REMEDIATION_PREFIX):
        return DEFAULT_REMEDIATION_DAYS
    raise KeyError(step_key)


def is_known_step(db: Session, step_key: str) -> bool:
    return step_key in get_all(db)


def _apply(db: Session, changes: dict[str, int], user: User | None, change_id: uuid.UUID) -> dict[str, int]:
    """Write ``changes`` and their history. Returns the previous values."""
    current = get_all(db)
    now = _now()
    old = {}
    for key, days in changes.items():
        old[key] = current[key]
        row = db.get(SlaPolicy, key)
        if row is None:
            row = SlaPolicy(step_key=key)
            db.add(row)
        row.days = days
        row.updated_by = user.id if user else None
        row.updated_at = now
        db.add(SlaPolicyHistory(
            change_id=change_id, step_key=key, old_days=old[key], new_days=days,
            changed_by=user.id if user else None, changed_at=now,
        ))
        if key.startswith(REMEDIATION_PREFIX):
            _reschedule_open_fixes(db, int(key[len(REMEDIATION_PREFIX):]), days)
    db.flush()
    invalidate(db)
    return old


def _reschedule_open_fixes(db: Session, category_id: int, days: int) -> None:
    """Open fixes are due at opened + current SLA, so a change moves them too.

    Closed fixes keep the ``sla_days_applied`` and ``on_time`` they closed with.
    """
    for rem in db.execute(
        select(HcRemediation).where(
            HcRemediation.problem_category_id == category_id,
            HcRemediation.closed_at.is_(None),
        )
    ).scalars():
        if rem.opened_at is not None:
            rem.due_at = rem.opened_at + timedelta(days=days)


def update(db: Session, changes: list[dict], user: User) -> uuid.UUID:
    """Apply ``[{step_key, days, expected_days}]`` atomically.

    Raises ``KeyError`` for an unknown step, ``ValueError`` for a value out of
    range and :class:`StaleChange` when any ``expected_days`` is not current.
    The caller commits.
    """
    current = get_all(db)
    wanted: dict[str, int] = {}
    stale: dict[str, int] = {}
    for c in changes:
        key, days = c["step_key"], c["days"]
        if key not in current:
            raise KeyError(key)
        if not isinstance(days, int) or not MIN_DAYS <= days <= MAX_DAYS:
            raise ValueError(f"Use {MIN_DAYS}–{MAX_DAYS} days")
        if c.get("expected_days") is not None and c["expected_days"] != current[key]:
            stale[key] = current[key]
        wanted[key] = days
    if stale:
        raise StaleChange(stale)
    wanted = {k: v for k, v in wanted.items() if v != current[k]}
    change_id = uuid.uuid4()
    if wanted:
        _apply(db, wanted, user, change_id)
    return change_id


def revert(db: Session, change_id: uuid.UUID, user: User) -> uuid.UUID:
    """Restore the values before ``change_id``, as a new change."""
    rows = db.execute(
        select(SlaPolicyHistory).where(SlaPolicyHistory.change_id == change_id)
    ).scalars().all()
    if not rows:
        raise LookupError(str(change_id))
    current = get_all(db)
    restore = {
        r.step_key: r.old_days for r in rows
        if r.old_days is not None and r.step_key in current and current[r.step_key] != r.old_days
    }
    new_id = uuid.uuid4()
    if restore:
        _apply(db, restore, user, new_id)
    return new_id


def history(db: Session, limit: int = 50) -> list[dict]:
    """Changes, newest first: ``[{change_id, by, at, changes:[...]}]``."""
    ids = db.execute(
        select(SlaPolicyHistory.change_id, func.max(SlaPolicyHistory.changed_at).label("at"))
        .group_by(SlaPolicyHistory.change_id)
        .order_by(func.max(SlaPolicyHistory.changed_at).desc())
        .limit(limit)
    ).all()
    if not ids:
        return []
    rows = db.execute(
        select(SlaPolicyHistory).where(SlaPolicyHistory.change_id.in_([i[0] for i in ids]))
        .order_by(SlaPolicyHistory.id)
    ).scalars().all()
    users = _names(db, {r.changed_by for r in rows})
    labels = step_labels(db)
    grouped: dict[uuid.UUID, list[SlaPolicyHistory]] = {}
    for r in rows:
        grouped.setdefault(r.change_id, []).append(r)
    out = []
    for change_id, at in ids:
        entries = grouped.get(change_id, [])
        by = entries[0].changed_by if entries else None
        out.append({
            "change_id": str(change_id),
            "by": users.get(by) if by else "System",
            "at": at,
            "changes": [
                {"step_key": e.step_key, "label": labels.get(e.step_key, e.step_key),
                 "old_days": e.old_days, "new_days": e.new_days}
                for e in entries
            ],
        })
    return out


def _names(db: Session, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {
        uid: f"{first} {family}".strip()
        for uid, first, family in db.execute(
            select(User.id, User.first_name, User.family_name).where(User.id.in_(ids))
        ).all()
    }


def step_labels(db: Session) -> dict[str, str]:
    labels = {s.key: s.label for s in STEPS}
    for cat in _categories(db):
        labels[remediation_key(cat.id)] = cat.name
    return labels


def listing(db: Session) -> dict:
    """The Admin page's rows, in lifecycle order, and the last change."""
    values = get_all(db)
    stored = {p.step_key: p for p in db.execute(select(SlaPolicy)).scalars()}
    users = _names(db, {p.updated_by for p in stored.values()})

    def row(key, area, label, meta):
        p = stored.get(key)
        return {
            "step_key": key, "area": area, "label": label, "meta": meta,
            "days": values[key],
            "updated_at": p.updated_at if p else None,
            "updated_by": users.get(p.updated_by) if p and p.updated_by else None,
        }

    rows = []
    for area, _label in AREAS:
        if area == "remediation":
            for cat in _categories(db):
                if not cat.active:
                    continue
                team = cat.owner_role.name if cat.owner_role else "Owning team"
                rows.append(row(remediation_key(cat.id), area, cat.name,
                                f"{team} · problematic → fix closed"))
        else:
            rows.extend(row(s.key, s.area, s.label, s.meta) for s in STEPS if s.area == area)
    last = history(db, limit=1)
    return {
        "areas": [{"key": k, "label": label} for k, label in AREAS],
        "rows": rows,
        "last_change": {"by": last[0]["by"], "at": last[0]["at"]} if last else None,
    }
