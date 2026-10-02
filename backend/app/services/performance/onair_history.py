"""Write ``lifecycle_status_history`` after a CPM import: the first time each
site and target village is seen on air.

Called by the CPM import inside its own transaction, so a failed import
leaves no history behind. Idempotent: an entity already recorded is skipped,
so re-running an import adds nothing.

The very first run sees everything that is already on air at once. Those rows
are marked ``backfilled``: "first seen on the day the table was created" is
not an on-air date, and they never feed a monthly flow.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.performance import (
    ENTITY_SITE,
    ENTITY_VILLAGE,
    STATUS_ON_AIR,
    LifecycleStatusHistory,
)
from app.models.workitem import Village, WorkItem
from app.services import kpi


def record_on_air(db: Session, batch_id: int | None, seen_at: datetime) -> int:
    """Record every on-air site and village not yet in the table. Returns how
    many rows were added. The caller commits."""
    db.flush()
    backfill = db.execute(select(LifecycleStatusHistory.id).limit(1)).first() is None
    already = set(
        db.execute(
            select(LifecycleStatusHistory.entity_type, LifecycleStatusHistory.entity_id)
            .where(LifecycleStatusHistory.status == STATUS_ON_AIR)
        ).all()
    )

    onair = kpi.onair_values(db) or [""]
    sites = db.execute(
        select(WorkItem.id).where(WorkItem.deleted_at.is_(None), WorkItem.last_stage.in_(onair))
    ).scalars().all()
    villages = db.execute(
        select(Village.id)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .where(
            Village.deleted_at.is_(None),
            WorkItem.deleted_at.is_(None),
            WorkItem.last_stage.in_(onair),
            Village.target_classification.in_(kpi.target_values(db) or [""]),
        )
    ).scalars().all()

    added = 0
    for kind, ids in ((ENTITY_SITE, sites), (ENTITY_VILLAGE, villages)):
        for entity_id in ids:
            if (kind, entity_id) in already:
                continue
            db.add(
                LifecycleStatusHistory(
                    entity_type=kind,
                    entity_id=entity_id,
                    status=STATUS_ON_AIR,
                    first_seen_at=seen_at,
                    cpm_import_batch_id=batch_id,
                    backfilled=backfill,
                )
            )
            added += 1
    return added
