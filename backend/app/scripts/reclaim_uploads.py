"""Reclaim database space taken by uploaded files nothing references any more.

Uploaded files live in ``stored_files`` (UEP-20), content-addressed and shared:
one ICT letter covering a hundred villages is stored once. Deleting an
evidence or letter row therefore deliberately never deletes the file -- other
rows may point at the same digest. This job is the other half: it removes a
file once nothing points at it.

A file is removed only when **all** of these hold:

* ``retain`` is false. CPM workbooks are stored with ``retain = true`` and are
  kept forever; nothing deletes them.
* No column in ``evidence_store.FILE_REFERENCES`` names it -- acceptance
  evidence, drive-test evidence, MTN submission letters and CPM import
  batches. That list is the only place the referencing tables are named.
* It was stored, and last re-uploaded, more than ``--grace-days`` ago (default
  7). A scan is stored the moment it is attached in My Work, before the letter
  that references it is filed.

The previous, disk-based version of this script counted references from
``acceptance_evidence`` only, while drive-test evidence and MTN submission
letters shared the same folder: run as documented, it would have deleted them.
Reading every reference from one registry, kept complete by a test
(``tests/test_file_references_complete.py``), is what stops that recurring.

There is no scheduler, and the Kubernetes namespace allows no Jobs or CronJobs,
so this is a manual command (RUNBOOK.md). Run it with ``--dry-run`` first::

    python -m app.scripts.reclaim_uploads --dry-run
    python -m app.scripts.reclaim_uploads
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.stored_file import StoredFile
from app.services.evidence_store import FILE_REFERENCES

DEFAULT_GRACE_DAYS = 7


def _reclaimable(cutoff: datetime):
    """The WHERE clause: not retained, not referenced anywhere, old enough."""
    return (
        StoredFile.retain.is_(False),
        StoredFile.created_at < cutoff,
        StoredFile.updated_at < cutoff,
        *(~exists().where(column == StoredFile.sha256) for column in FILE_REFERENCES),
    )


def find_reclaimable(db: Session, now: datetime, grace_days: int = DEFAULT_GRACE_DAYS) -> list[tuple[str, int]]:
    """``(sha256, size_bytes)`` of every file the job would remove."""
    cutoff = now - timedelta(days=grace_days)
    return [
        (sha, size)
        for sha, size in db.execute(
            select(StoredFile.sha256, StoredFile.size_bytes)
            .where(*_reclaimable(cutoff))
            .order_by(StoredFile.created_at)
        )
    ]


def reclaim(db: Session, now: datetime, grace_days: int = DEFAULT_GRACE_DAYS, *, dry_run: bool) -> list[tuple[str, int]]:
    """Remove (or, dry run, only list) unreferenced files. Returns what it found.

    The delete repeats every condition rather than trusting the list it just
    read, so a file that gained a reference in between is kept.
    """
    found = find_reclaimable(db, now, grace_days)
    if found and not dry_run:
        cutoff = now - timedelta(days=grace_days)
        db.execute(
            delete(StoredFile)
            .where(StoredFile.sha256.in_([sha for sha, _ in found]), *_reclaimable(cutoff))
            .execution_options(synchronize_session=False)
        )
        db.commit()
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="List what would be removed without removing anything.")
    parser.add_argument(
        "--grace-days", type=int, default=DEFAULT_GRACE_DAYS,
        help=f"Keep unreferenced files younger than this (default {DEFAULT_GRACE_DAYS}).",
    )
    args = parser.parse_args(argv)
    if args.grace_days < 1:
        parser.error("--grace-days must be at least 1")

    db = SessionLocal()
    try:
        found = reclaim(db, datetime.now(timezone.utc), args.grace_days, dry_run=args.dry_run)
    finally:
        db.close()

    what = "would remove" if args.dry_run else "removed"
    for sha, size in found:
        print(f"{what}: {sha}  ({size / 1024:.0f} KB)")
    total = sum(size for _, size in found)
    print(
        f"\n{len(found)} unreferenced file(s), {total / (1024 * 1024):.1f} MB "
        f"{'reclaimable' if args.dry_run else 'reclaimed'}."
    )
    if args.dry_run:
        print("Dry run: nothing was removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
