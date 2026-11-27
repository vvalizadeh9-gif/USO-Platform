"""Each work item's open journey step, cached for Explorer's list (UEP-28).

``work_items.lifecycle_stage`` is the open step's index in
``explorer_journey.STAGES`` (6 = acceptance done) and
``work_items.lifecycle_stage_since`` the day that step's clock started. The
list sorts and pages every site by these two columns in SQL; the record page
never reads them.

**One rule.** The values come from ``explorer.journey_steps`` and
``explorer_journey.open_step`` -- the record page's own step facts -- never a
SQL copy of them. Neither depends on today, so a cached row never goes stale
with time: the list computes the days in step as today minus ``since``.

**Kept in sync in one place.** A session listener notes every work item a
flush touched through any of the facts (the work item itself, its villages,
health checks, assignments, and submission items or batches) and refreshes
exactly those before the commit, in the same transaction. Writers need no
call of their own, so a new writer cannot forget one. Two safety nets cover
what an ORM listener cannot see (a bulk ``UPDATE``): rows still NULL are
filled at start-up (``core.bootstrap``), and the hourly jobs refresh all.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Iterator
from datetime import date

import logging

from sqlalchemy import event, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.core import jalali
from app.core.database import SessionLocal
from app.models.health_check import HcTask
from app.models.submission import SubmissionBatch, SubmissionItem
from app.models.workitem import Assignment, HealthCheck, Village, WorkItem
from app.services import cpm_columns as C
from app.services import explorer_journey as J

log = logging.getLogger("uep.lifecycle_stage")

CHUNK = 500

_DIRTY = "lifecycle_dirty"        # work item ids touched since the last refresh
_VILLAGES = "lifecycle_villages"  # village ids whose work item is not yet known
_BATCHES = "lifecycle_batches"    # submission batch ids, likewise
_BUSY = "lifecycle_busy"          # set while refreshing: its own writes are not facts

#: The models whose rows are step facts, and the work item each one belongs to.
_BY_WORK_ITEM = (Village, HcTask, HealthCheck, Assignment)


def stage_index(key: str) -> int:
    return J.STAGES.index(key)


def stage_key(index: int | None) -> str | None:
    return J.STAGES[index] if index is not None and 0 <= index < len(J.STAGES) else None


# --------------------------------------------------------------------------
# Computing
# --------------------------------------------------------------------------
def _chunks(ids: list[int]) -> Iterator[list[int]]:
    for i in range(0, len(ids), CHUNK):
        yield ids[i:i + CHUNK]


def _work_items(db: Session, ids: list[int]) -> list[WorkItem]:
    """The work items with their fact collections, reloaded even when the
    session already holds them: a collection loaded before this flush would
    not show the row just added. The caller has flushed, so nothing unsaved
    is lost."""
    return list(db.execute(
        select(WorkItem)
        .where(WorkItem.id.in_(ids))
        .options(
            selectinload(WorkItem.assignments),
            selectinload(WorkItem.hc_tasks),
            selectinload(WorkItem.health_checks),
        )
        .execution_options(populate_existing=True)
    ).scalars())


def _hadaf_sides(db: Session, ids: list[int]) -> dict[int, list[dict]]:
    """Each site's live هدف villages, as the step facts read them (the
    record page's rule: ``explorer._hadaf_villages``)."""
    from app.services.explorer import approval_sides

    out: dict[int, list[dict]] = defaultdict(list)
    for village in db.execute(
        select(Village.work_item_id, Village.target_classification,
               Village.ict_status, Village.cra_status)
        .where(Village.work_item_id.in_(ids), Village.deleted_at.is_(None))
    ):
        if C.is_pure_target(village.target_classification):
            out[village.work_item_id].append(approval_sides(village))
    return out


def compute(db: Session, ids: list[int], today: date | None = None) -> dict[int, tuple[int, date | None]]:
    """``{work_item_id: (stage index, since)}`` in a fixed number of queries
    per :data:`CHUNK` work items."""
    from app.services.explorer import journey_steps
    from app.services.submissions.journey import first_sent_by_work_item

    today = today or jalali.tehran_today()
    out: dict[int, tuple[int, date | None]] = {}
    for chunk in _chunks(sorted(set(ids))):
        sides = _hadaf_sides(db, chunk)
        sent = first_sent_by_work_item(db, chunk)
        for wi in _work_items(db, chunk):
            steps = journey_steps(wi, sides.get(wi.id, []), sent.get(wi.id), today)
            key, since = J.open_step(steps)
            out[wi.id] = (stage_index(key), since)
    return out


def refresh(db: Session, ids: Iterable[int]) -> int:
    """Recompute and store the stage of ``ids``. Returns how many changed.
    Flushes; the caller commits."""
    wanted = [i for i in set(ids) if i is not None]
    if not wanted:
        return 0
    db.flush()  # unsaved facts first, while the listener still notes them
    db.info[_BUSY] = True
    try:
        values = compute(db, wanted)
        changed = 0
        for wi in db.execute(select(WorkItem).where(WorkItem.id.in_(list(values)))).scalars():
            stage, since = values[wi.id]
            if (wi.lifecycle_stage, wi.lifecycle_stage_since) != (stage, since):
                wi.lifecycle_stage, wi.lifecycle_stage_since = stage, since
                changed += 1
        db.flush()
        return changed
    finally:
        db.info.pop(_BUSY, None)


def refresh_missing(db: Session) -> int:
    """Fill every live row whose stage was never computed (a new column, a
    row written around the ORM). Start-up calls this."""
    ids = db.execute(
        select(WorkItem.id).where(WorkItem.lifecycle_stage.is_(None), WorkItem.deleted_at.is_(None))
    ).scalars().all()
    return refresh(db, ids)


def refresh_all(db: Session) -> int:
    """Recompute every live row: the hourly safety net."""
    ids = db.execute(select(WorkItem.id).where(WorkItem.deleted_at.is_(None))).scalars().all()
    return refresh(db, ids)


# --------------------------------------------------------------------------
# Keeping it in sync
# --------------------------------------------------------------------------
def _note(session: Session, obj: object) -> None:
    if isinstance(obj, WorkItem):
        session.info.setdefault(_DIRTY, set()).add(obj.id)
    elif isinstance(obj, _BY_WORK_ITEM):
        session.info.setdefault(_DIRTY, set()).add(obj.work_item_id)
    elif isinstance(obj, SubmissionItem):
        session.info.setdefault(_VILLAGES, set()).add(obj.village_id)
    elif isinstance(obj, SubmissionBatch):
        session.info.setdefault(_BATCHES, set()).add(obj.id)


def _resolve(session: Session) -> set[int]:
    """Every noted work item, the submission rows turned into theirs."""
    ids = set(session.info.pop(_DIRTY, set()))
    villages = session.info.pop(_VILLAGES, set())
    batches = session.info.pop(_BATCHES, set())
    if batches:
        villages |= set(session.execute(
            select(SubmissionItem.village_id).where(SubmissionItem.batch_id.in_(batches))
        ).scalars())
    if villages:
        ids |= set(session.execute(
            select(Village.work_item_id).where(Village.id.in_(villages))
        ).scalars())
    ids.discard(None)
    return ids


@event.listens_for(SessionLocal, "after_flush")
def _collect(session: Session, _context) -> None:
    if session.info.get(_BUSY):
        return
    for obj in (*session.new, *session.dirty, *session.deleted):
        _note(session, obj)


@event.listens_for(SessionLocal, "before_commit")
def _refresh_before_commit(session: Session) -> None:
    """Refresh what this transaction touched, inside a savepoint: a fault in
    the cache never blocks the business write it follows. A failed refresh
    is logged and left for the hourly job."""
    if session.info.get(_BUSY):
        return
    session.flush()  # the commit's own pending writes are facts too
    ids = _resolve(session)
    if not ids:
        return
    try:
        with session.begin_nested():
            refresh(session, ids)
    except SQLAlchemyError:
        log.exception("lifecycle stage refresh failed; the hourly job will retry",
                      extra={"work_items": len(ids)})


@event.listens_for(SessionLocal, "after_rollback")
def _forget(session: Session) -> None:
    for key in (_DIRTY, _VILLAGES, _BATCHES):
        session.info.pop(key, None)


# --------------------------------------------------------------------------
# Late or not
# --------------------------------------------------------------------------
#: Each open step's SLA (Admin › SLA policies): terms are added up; inside a
#: term, ICT and CRA run in parallel, so the longer of the two counts.
#: On air and acceptance done have none, so they are never late.
_STAGE_SLA: dict[str, tuple[tuple[str, ...], ...]] = {
    J.STEP_HEALTH_CHECK: (("hc_assign",), ("hc_check",), ("hc_decide",)),
    J.STEP_ASSIGNED: (("dt_assign",),),
    J.STEP_DT_DONE: (("dt_test",), ("dt_review",)),
    J.STEP_SENT_TO_ICT: (("submit_cycle",),),
    J.STEP_ACCEPTANCE: (("ict_file", "cra_file"), ("validate",), ("ict_reply", "cra_reply")),
}


def stage_sla_days(db: Session, stage: str | None) -> int | None:
    """How many days ``stage`` may stay open, or None when it has no SLA."""
    from app.services import sla_policy

    terms = _STAGE_SLA.get(stage or "")
    if not terms:
        return None
    return sum(max(sla_policy.get_days(db, key) for key in term) for term in terms)


def stage_limits(db: Session) -> dict[str, int | None]:
    """Every stage's SLA at once, so a page of rows reads the policy once."""
    return {stage: stage_sla_days(db, stage) for stage in J.STAGES}


def is_late(limits: dict[str, int | None], stage: str | None, days: int | None) -> bool:
    """Over the open step's SLA. A step with no SLA, or no days, is never late."""
    limit = limits.get(stage or "")
    return days is not None and limit is not None and days > limit
