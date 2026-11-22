"""Seed ``cpm_village_sightings`` from the CPM workbooks kept in the database.

Run once at the UEP-21 deploy. Non-هدف rows were never stored, so without
this a village that moved from اقماری to هدف *before* the deploy would look
brand new, and the CPM hook would send its site back to drive test instead of
listing it as "Became هدف".

Every import keeps its workbook forever in ``stored_files``, linked by
``cpm_import_batches.source_sha256`` (UEP-20; workbooks from an old uploads
folder are linked by ``migrate_uploads_to_db``). This reads them oldest first
and records each non-هدف key once, dated by its import. Safe to repeat: known
keys are skipped. ``--dry-run`` reports and writes nothing::

    docker compose exec backend python -m app.scripts.seed_sightings --dry-run
    docker compose exec backend python -m app.scripts.seed_sightings
"""
from __future__ import annotations

import argparse
import io
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.acceptance import CpmImportBatch
from app.services import cpm_columns as C
from app.services import evidence_store
from app.services.submissions import sightings


def stored_workbooks(db: Session) -> list[tuple[datetime, str, str]]:
    """``(imported at, filename, sha256)`` of every kept workbook, oldest first."""
    rows = db.execute(
        select(CpmImportBatch.created_at, CpmImportBatch.filename, CpmImportBatch.source_sha256)
        .where(CpmImportBatch.source_sha256.isnot(None))
        .order_by(CpmImportBatch.created_at, CpmImportBatch.id)
    ).all()
    return [
        (stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc), name, sha)
        for stamp, name, sha in rows
    ]


def _cell(raw: list, name: str) -> object:
    index = C.COL[name]
    return raw[index] if index < len(raw) else None


def non_target_rows(source) -> list[tuple]:
    df = pd.read_excel(source, sheet_name=C.SHEET_NAME, header=C.HEADER_ROW)
    out = []
    for raw in df.values.tolist():
        site_code, site_type = C.clean(_cell(raw, "site_code")), C.clean(_cell(raw, "site_type"))
        flag = _cell(raw, "target_flag")
        if site_code is None or site_type is None or C.is_pure_target(flag):
            continue
        out.append((site_code, site_type, _cell(raw, "village_code"), C.clean(flag)))
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report without writing.")
    args = parser.parse_args(argv)
    db = SessionLocal()
    try:
        total = 0
        for stamp, name, sha in stored_workbooks(db):
            try:
                rows = non_target_rows(io.BytesIO(evidence_store.read_digest(db, sha)))
            except Exception as exc:  # noqa: BLE001 -- one bad file must not stop the rest
                print(f"skip {name}: {exc}")
                continue
            added = sightings.record(db, rows, stamp)
            db.flush()
            total += added
            print(f"{name} ({stamp:%Y-%m-%d}): {len(rows)} non-هدف rows, {added} new keys")
        if args.dry_run:
            db.rollback()
            print(f"dry run: {total} keys would be recorded")
        else:
            db.commit()
            print(f"recorded {total} keys")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
