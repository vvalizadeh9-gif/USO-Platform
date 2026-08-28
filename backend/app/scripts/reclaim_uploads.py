"""Reclaim upload storage: old CPM workbooks, and evidence nothing references.

Two things accumulate on the uploads volume and nothing has ever removed either.

**CPM workbooks.** Every import writes its source file to ``upload_dir`` and
leaves it there permanently. The import is already recorded in
``cpm_import_batches``, and the resulting data is in the database, so the
workbook itself is a convenience copy -- useful for a few months to answer
"what exactly did we load in Mordad", not useful for ever.

**Evidence blobs.** These are content-addressed, and deleting an evidence row
deliberately does not delete the file, because a hundred other submissions may
reference the same scan. That decision is right and it is documented in
``services/evidence_store.py``. What was missing is the other half: nothing
ever counted the references and reclaimed a blob once the last one went. So a
file uploaded, then removed from its only submission, stayed on disk forever.

Neither leak is fast. Both are unbounded, on a volume that is outside the
database backup (see BACKUP-RUNBOOK.md) and that nothing monitors, and the
first symptom of a full disk is PostgreSQL failing to write.

Run it with ``--dry-run`` first. It prints what it would remove and touches
nothing::

    docker compose exec backend python -m app.scripts.reclaim_uploads --dry-run
    docker compose exec backend python -m app.scripts.reclaim_uploads

A monthly cron entry is the intended use; RUNBOOK.md has the line.
"""
from __future__ import annotations

import argparse
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.acceptance_workflow import AcceptanceEvidence

# How long an imported workbook is kept. Long enough to cover a full reporting
# cycle plus an argument about it; short enough that the volume does not grow
# without limit.
DEFAULT_KEEP_DAYS = 180

# What import_cpm writes: "cpm_<14 digits>_<safe name>".
_CPM_FILE = re.compile(r"^cpm_\d{14}_")


def _age_days(path: Path, now: datetime) -> float:
    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return (now - modified).total_seconds() / 86400


def find_old_workbooks(upload_dir: Path, keep_days: int, now: datetime) -> list[Path]:
    """CPM workbooks older than the retention window."""
    if not upload_dir.is_dir():
        return []
    return sorted(
        path
        for path in upload_dir.iterdir()
        if path.is_file()
        and _CPM_FILE.match(path.name)
        and _age_days(path, now) > keep_days
    )


def find_orphan_evidence(db, upload_dir: Path) -> list[Path]:
    """Evidence blobs on disk that no ``acceptance_evidence`` row references.

    Reads the referenced set from the database first, then walks the disk, so a
    blob written between the two is simply seen as referenced next time rather
    than deleted while a request is still writing its row.
    """
    referenced = {
        row for row in db.execute(select(AcceptanceEvidence.stored_path)).scalars()
    }
    root = upload_dir / "acceptance"
    if not root.is_dir():
        return []

    orphans = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        # ".part" files are half-written uploads left by a crash mid-write;
        # they are never referenced and always safe to remove.
        relative = str(path.relative_to(upload_dir))
        if relative not in referenced:
            orphans.append(path)
    return sorted(orphans)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be removed without removing anything.",
    )
    parser.add_argument(
        "--keep-days",
        type=int,
        default=DEFAULT_KEEP_DAYS,
        help=f"How long to keep imported CPM workbooks (default {DEFAULT_KEEP_DAYS}).",
    )
    args = parser.parse_args(argv)

    upload_dir = Path(get_settings().upload_dir)
    now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        workbooks = find_old_workbooks(upload_dir, args.keep_days, now)
        orphans = find_orphan_evidence(db, upload_dir)
    finally:
        db.close()

    reclaimed = 0
    for path in workbooks + orphans:
        size = path.stat().st_size
        what = "would remove" if args.dry_run else "removed"
        print(f"{what}: {path}  ({size / 1024:.0f} KB)")
        if not args.dry_run:
            os.unlink(path)
        reclaimed += size

    print(
        f"\n{len(workbooks)} workbook(s) older than {args.keep_days} days, "
        f"{len(orphans)} unreferenced evidence file(s), "
        f"{reclaimed / (1024 * 1024):.1f} MB "
        f"{'reclaimable' if args.dry_run else 'reclaimed'}."
    )
    if args.dry_run:
        print("Dry run: nothing was removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
