"""CPM data wipe service.

Deletes only CPM-derived operational data so an admin can start fresh with
a new import. Deliberately preserves: users, roles, contractors, provinces,
regions, problem categories, and the audit log itself (per the agreed scope
— this is NOT a full factory reset).

Deletion order matters (children before parents) since we do explicit,
auditable deletes rather than relying on database-level CASCADE — this
keeps the operation fully visible and reviewable in one place.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.acceptance import (
    Acceptance,
    CpmChangeRequest,
    CpmImportBatch,
    Letter,
    MonthlySnapshot,
    letter_villages,
)
from app.models.health_check import HcAssignment, HcTask, HcTaskTechnology
from app.models.workitem import Assignment, DriveTest, HealthCheck, Site, Village, WorkItem

# The exact confirmation phrase the caller must supply. Enforced both here
# (defense in depth) and in the API layer, so a direct API call without the
# UI can't trigger this by accident.
REQUIRED_CONFIRMATION_PHRASE = "ERASE ALL CPM DATA"


def wipe_cpm_data(db: Session) -> dict[str, int]:
    """Delete all CPM-imported data. Returns a dict of deleted row counts.

    Caller is responsible for checking the confirmation phrase before
    invoking this — see the API endpoint for that check.
    """
    counts: dict[str, int] = {}

    # Many-to-many join table first (letters <-> villages).
    counts["letter_villages"] = db.execute(letter_villages.delete()).rowcount

    counts["letters"] = db.query(Letter).delete(synchronize_session=False)
    counts["acceptances"] = db.query(Acceptance).delete(synchronize_session=False)
    # New health-check workflow tables (children before parents).
    counts["hc_task_technologies"] = db.query(HcTaskTechnology).delete(
        synchronize_session=False
    )
    counts["hc_tasks"] = db.query(HcTask).delete(synchronize_session=False)
    counts["hc_assignments"] = db.query(HcAssignment).delete(
        synchronize_session=False
    )
    counts["health_checks"] = db.query(HealthCheck).delete(synchronize_session=False)
    counts["assignments"] = db.query(Assignment).delete(synchronize_session=False)
    counts["drive_tests"] = db.query(DriveTest).delete(synchronize_session=False)
    counts["villages"] = db.query(Village).delete(synchronize_session=False)
    counts["cpm_change_requests"] = db.query(CpmChangeRequest).delete(
        synchronize_session=False
    )
    counts["work_items"] = db.query(WorkItem).delete(synchronize_session=False)
    counts["sites"] = db.query(Site).delete(synchronize_session=False)
    counts["cpm_import_batches"] = db.query(CpmImportBatch).delete(
        synchronize_session=False
    )
    counts["monthly_snapshots"] = db.query(MonthlySnapshot).delete(
        synchronize_session=False
    )

    return counts
