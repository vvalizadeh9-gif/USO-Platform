"""Seed ``cpm_village_sightings`` from the CPM workbooks kept on the upload volume.

Run once at the UEP-21 deploy. Non-هدف rows were never stored, so without
this a village that moved from اقماری to هدف *before* the deploy would look
brand new, and the CPM hook would send its site back to drive test instead of
listing it as "Became هدف".

Every import keeps its source file as ``cpm_<YYYYmmddHHMMSS>_<name>.xlsx``
(``reclaim_uploads`` removes them after 180 days). This reads them oldest
first and records each non-هدف key once, dated by its file. Safe to repeat:
known keys are skipped. ``--dry-run`` reports and writes nothing::

    docker compose exec backend python -m app.scripts.seed_sightings --dry-run
    docker compose exec backend python -m app.scripts.seed_sightings
"""
from __future__ import annotations

import argparse
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services import cpm_columns as C
from app.services.submissions import sightings

_CPM_FILE = re.compile(r"^cpm_(\d{14})_.*\.xlsx$", re.IGNORECASE)


def stored_files(folder: Path) -> list[tuple[datetime, Path]]:
    found = []
    for path in folder.iterdir():
        match = _CPM_FILE.match(path.name)
        if match:
            stamp = datetime.strptime(match.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
            found.append((stamp, path))
    return sorted(found)


def _cell(raw: list, name: str) -> object:
    index = C.COL[name]
    return raw[index] if index < len(raw) else None


def non_target_rows(path: Path) -> list[tuple]:
    df = pd.read_excel(path, sheet_name=C.SHEET_NAME, header=C.HEADER_ROW)
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
    folder = Path(get_settings().upload_dir)
    db = SessionLocal()
    try:
        total = 0
        for stamp, path in stored_files(folder):
            try:
                rows = non_target_rows(path)
            except Exception as exc:  # noqa: BLE001 -- one bad file must not stop the rest
                print(f"skip {path.name}: {exc}")
                continue
            added = sightings.record(db, rows, stamp)
            db.flush()
            total += added
            print(f"{path.name}: {len(rows)} non-هدف rows, {added} new keys")
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
