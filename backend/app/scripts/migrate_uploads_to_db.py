"""Copy an old uploads folder into the database, once (UEP-20).

Needed only where an older UEP installation kept uploads on a disk volume
(``uep_uploads``). A new database starts empty and needs nothing.

What it does, for the folder given by ``--upload-dir``:

* every blob under ``acceptance/`` (``<aa>/<bb>/<sha256>.<ext>``): checks the
  SHA-256 of its bytes equals its name, then inserts it into ``stored_files``
  (skipped when already there). A file whose bytes do not match its name is
  reported and not copied;
* every CPM workbook ``cpm_<YYYYmmddHHMMSS>_<name>``: inserted with
  ``retain = true`` (kept forever) and linked to its ``cpm_import_batches``
  row -- only when exactly one import of that file name started within a few
  hours after the file was written, and no other workbook claims that import.
  Anything ambiguous stays stored but unlinked, and is listed;
* then checks every row of every table in ``evidence_store.FILE_REFERENCES``
  and reports, per table, the rows whose file is still missing.

Safe to run twice; never deletes or changes a source file. Exits non-zero if
any referencing row points at a missing file. ``--dry-run`` writes nothing::

    python -m app.scripts.migrate_uploads_to_db --upload-dir /data/uploads --dry-run
    python -m app.scripts.migrate_uploads_to_db --upload-dir /data/uploads
"""
from __future__ import annotations

import argparse
import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.acceptance import CpmImportBatch
from app.models.stored_file import StoredFile
from app.services import evidence_store

_CPM_FILE = re.compile(r"^cpm_(\d{14})_(.+)$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")

#: An import is matched to a workbook written up to this long before it.
#: import_cpm wrote the file and then started the import at once; the window
#: only absorbs clock skew and a slow parse.
_EARLY = timedelta(minutes=5)
_LATE = timedelta(hours=3)


@dataclass
class Report:
    copied: int = 0
    already_present: int = 0
    mismatched: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    workbooks_linked: list[tuple[str, int]] = field(default_factory=list)
    workbooks_unlinked: list[str] = field(default_factory=list)
    missing: dict[str, list[str]] = field(default_factory=dict)

    @property
    def missing_rows(self) -> int:
        return sum(len(v) for v in self.missing.values())


def _present(db: Session) -> set[str]:
    return set(db.execute(select(StoredFile.sha256)).scalars())


def _copy(db: Session, report: Report, present: set[str], digest: str, ext: str,
          content: bytes, *, retain: bool, dry_run: bool) -> None:
    if digest in present:
        report.already_present += 1
        if retain and not dry_run:
            # Present as an ordinary file: as a workbook it must still be kept.
            evidence_store.put(db, digest, ext, content, retain=True)
            db.commit()
        return
    report.copied += 1
    present.add(digest)
    if not dry_run:
        evidence_store.put(db, digest, ext, content, retain=retain)
        db.commit()


def _blobs(db: Session, root: Path, report: Report, present: set[str], dry_run: bool) -> None:
    folder = root / "acceptance"
    if not folder.is_dir():
        return
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        name = path.name
        digest, _, ext = name.partition(".")
        if not _DIGEST.match(digest) or not ext or "." in ext:
            # ".part" files are uploads a crash interrupted; never referenced.
            report.skipped.append(str(path.relative_to(root)))
            continue
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != digest:
            report.mismatched.append(str(path.relative_to(root)))
            continue
        _copy(db, report, present, digest, ext.lower()[:8], content, retain=False, dry_run=dry_run)


def _workbooks(db: Session, root: Path, report: Report, present: set[str], dry_run: bool) -> None:
    found: list[tuple[datetime, str, str, Path]] = []  # (stamp, safe name, digest, path)
    for path in sorted(p for p in root.iterdir() if p.is_file()):
        match = _CPM_FILE.match(path.name)
        if not match:
            continue
        try:
            stamp = datetime.strptime(match.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            report.skipped.append(path.name)
            continue
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        ext = evidence_store.extension_of(path.name) or "xlsx"
        _copy(db, report, present, digest, ext, content, retain=True, dry_run=dry_run)
        found.append((stamp, match.group(2), digest, path))

    # Which imports each workbook could belong to, and the reverse.
    batches = db.execute(select(CpmImportBatch)).scalars().all()
    by_name: dict[str, list[CpmImportBatch]] = defaultdict(list)
    for batch in batches:
        by_name[evidence_store.safe_filename(batch.filename or "")].append(batch)

    def _aware(moment: datetime) -> datetime:
        return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)

    candidates: dict[Path, list[CpmImportBatch]] = {}
    claimed: dict[int, int] = defaultdict(int)
    for stamp, name, _digest, path in found:
        matches = [
            b for b in by_name.get(name, [])
            if stamp - _EARLY <= _aware(b.created_at) <= stamp + _LATE
        ]
        candidates[path] = matches
        for b in matches:
            claimed[b.id] += 1

    for _stamp, _name, digest, path in sorted(found):
        matches = candidates[path]
        batch = matches[0] if len(matches) == 1 else None
        if batch is None or claimed[batch.id] != 1 or batch.source_sha256 not in (None, digest):
            report.workbooks_unlinked.append(path.name)
            continue
        report.workbooks_linked.append((path.name, batch.id))
        if not dry_run and batch.source_sha256 is None:
            batch.source_sha256 = digest
            db.commit()


def _check_references(db: Session, report: Report, present: set[str]) -> None:
    for column in evidence_store.FILE_REFERENCES:
        model = column.class_
        rows = db.execute(select(model.id, column).where(column.isnot(None))).all()
        missing = [f"id {row_id}: {digest}" for row_id, digest in rows if digest not in present]
        report.missing[model.__tablename__] = missing


def migrate(db: Session, upload_dir: Path, *, dry_run: bool) -> Report:
    report = Report()
    present = _present(db)
    _blobs(db, upload_dir, report, present, dry_run)
    _workbooks(db, upload_dir, report, present, dry_run)
    if dry_run:
        db.rollback()
    _check_references(db, report, present)
    return report


def _print(report: Report, dry_run: bool) -> None:
    verb = "would copy" if dry_run else "copied"
    print(f"Files {verb}: {report.copied}")
    print(f"Already in the database: {report.already_present}")
    print(f"Hash does not match the file name (not copied): {len(report.mismatched)}")
    for name in report.mismatched:
        print(f"  {name}")
    if report.skipped:
        print(f"Not a stored file (skipped): {len(report.skipped)}")
        for name in report.skipped:
            print(f"  {name}")
    print(f"CPM workbooks linked to their import: {len(report.workbooks_linked)}")
    for name, batch_id in report.workbooks_linked:
        print(f"  {name} -> import {batch_id}")
    print(f"CPM workbooks stored but not linked (ambiguous or no matching import): {len(report.workbooks_unlinked)}")
    for name in report.workbooks_unlinked:
        print(f"  {name}")
    print("Rows whose file is missing, per table:")
    for table, rows in report.missing.items():
        print(f"  {table}: {len(rows)}")
        for row in rows:
            print(f"    {row}")
    if dry_run:
        print("Dry run: nothing was written.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--upload-dir", required=True, type=Path, help="The old uploads folder.")
    parser.add_argument("--dry-run", action="store_true", help="Report without writing anything.")
    args = parser.parse_args(argv)
    if not args.upload_dir.is_dir():
        parser.error(f"{args.upload_dir} is not a folder")

    db = SessionLocal()
    try:
        report = migrate(db, args.upload_dir, dry_run=args.dry_run)
    finally:
        db.close()
    _print(report, args.dry_run)
    return 1 if report.missing_rows else 0


if __name__ == "__main__":
    raise SystemExit(main())
