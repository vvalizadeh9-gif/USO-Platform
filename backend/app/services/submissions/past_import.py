"""Import past batches (#1-#39) from their 18-column Excel files (UEP-21 §5.3).

Same pattern as the Mojri import: :func:`preview` reads and writes nothing;
:func:`commit` re-reads the same file (checked by SHA-256) and is the only
writer. Idempotent by digest: a file already imported is a no-op.

* The batch number comes from the file name (``..._Drive_Test_39...``) or the
  sheet name (``#39``).
* Rows match on (Site ID, نوع سایت, کد آبادی) with ``mojri_tracker.match_key``.
  A row whose هدف/اقماری cell is not pure هدف is skipped.
* ``sent_at`` is the batch's MTN letter date, which Confirm requires. The
  preview prefills it with the date saved inside the workbook (PM decision:
  an uploaded file carries no reliable modified time).
* Never writes acceptance or drive tests.
"""
from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from fastapi import HTTPException
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.reference import User
from app.models.submission import (
    BATCH_CANCELLED,
    BATCH_SENT,
    REASON_IMPORTED,
    SOURCE_IMPORT,
    SubmissionBatch,
    SubmissionItem,
)
from app.services import cpm_columns as C
from app.services import mojri_tracker
from app.services.submissions import batches

SITE_ID = "site id"
SITE_TYPE = "نوع سایت"
VILLAGE_CODE = "کد آبادی"
TARGET_FLAG = "هدف/ اقماری"
_NAME_NUMBER = re.compile(r"drive[_ ]?test[_ ]?(\d+)", re.IGNORECASE)
_SHEET_NUMBER = re.compile(r"#\s*(\d+)")
_MAX_LISTED = 100
_HEADER_SCAN = 10


def digest_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _norm(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


@dataclass
class ParsedFile:
    number: int | None
    workbook_date: date | None
    #: (row number, site id, site type, village code, target flag)
    rows: list[tuple] = field(default_factory=list)


def number_from(filename: str, sheet_title: str) -> int | None:
    found = _NAME_NUMBER.search(filename or "") or _SHEET_NUMBER.search(sheet_title or "")
    return int(found.group(1)) if found else None


def _header(sheet) -> tuple[int, dict[str, int]]:
    for row_number in range(1, _HEADER_SCAN + 1):
        names = {
            _norm(cell.value): index
            for index, cell in enumerate(sheet[row_number], start=1)
            if cell.value is not None
        }
        if _norm(SITE_ID) in names and _norm(VILLAGE_CODE) in names:
            return row_number, names
    raise HTTPException(400, "No header row with Site ID and کد آبادی was found in that file.")


def _workbook_date(workbook) -> date | None:
    moment = workbook.properties.modified or workbook.properties.created
    return moment.date() if isinstance(moment, datetime) else None


def parse(content: bytes, filename: str) -> ParsedFile:
    try:
        workbook = load_workbook(io.BytesIO(content), data_only=True, read_only=False)
    except Exception:  # noqa: BLE001 -- any parser failure is "not a workbook"
        raise HTTPException(400, "That file could not be read as an .xlsx workbook.") from None
    sheet = workbook.worksheets[0]
    header_row, names = _header(sheet)
    cols = [names.get(_norm(n)) for n in (SITE_ID, SITE_TYPE, VILLAGE_CODE, TARGET_FLAG)]
    parsed = ParsedFile(number_from(filename, sheet.title), _workbook_date(workbook))
    for row_number in range(header_row + 1, sheet.max_row + 1):
        values = [sheet.cell(row=row_number, column=c).value if c else None for c in cols]
        if all(v is None or str(v).strip() == "" for v in values[:3]):
            continue
        parsed.rows.append((row_number, *values))
    return parsed


@dataclass
class Matched:
    village_ids: list[int] = field(default_factory=list)
    unmatched: list[dict] = field(default_factory=list)
    skipped: int = 0


def _match(db: Session, parsed: ParsedFile) -> Matched:
    index = mojri_tracker.live_villages_by_key(db)
    out = Matched()
    seen: set[int] = set()
    for row_number, site_id, site_type, code, flag in parsed.rows:
        if flag is not None and not C.is_pure_target(flag):
            out.skipped += 1
            continue
        villages = index.get(mojri_tracker.match_key(site_id, site_type, code) or ("",) * 3)
        if not villages:
            out.unmatched.append({"row": row_number, "site_code": site_id,
                                  "site_type": site_type, "village_code": code})
            continue
        for village in villages:
            if village.id not in seen:
                seen.add(village.id)
                out.village_ids.append(village.id)
    return out


def _existing(db: Session, digest: str) -> SubmissionBatch | None:
    return db.execute(
        select(SubmissionBatch).where(SubmissionBatch.file_digest == digest)
    ).scalar_one_or_none()


def _number_taken(db: Session, number: int | None) -> bool:
    if number is None:
        return False
    return db.execute(
        select(SubmissionBatch.id).where(
            SubmissionBatch.number == number, SubmissionBatch.status != BATCH_CANCELLED
        )
    ).first() is not None


def preview(db: Session, content: bytes, filename: str) -> dict:
    parsed = parse(content, filename)
    matched = _match(db, parsed)
    digest = digest_of(content)
    recorded = batches.active_village_ids(db, matched.village_ids)
    return {
        "filename": filename,
        "digest": digest,
        "number": parsed.number,
        "workbook_date": parsed.workbook_date,
        "rows": len(parsed.rows),
        "matched": len(matched.village_ids),
        "already_recorded": len(recorded),
        "unmatched": len(matched.unmatched),
        "skipped": matched.skipped,
        "unmatched_rows": matched.unmatched[:_MAX_LISTED],
        "already_imported": _existing(db, digest) is not None,
        "number_taken": _number_taken(db, parsed.number),
    }


def commit(
    db: Session, user: User, content: bytes, filename: str, digest: str,
    letter_date: date, letter_no: str | None = None, number: int | None = None,
) -> tuple[SubmissionBatch, bool]:
    """Returns (batch, created). ``created`` is False for a re-upload."""
    if digest_of(content) != digest:
        raise HTTPException(400, "That file is not the one that was previewed. Preview it again.")
    existing = _existing(db, digest)
    if existing is not None:
        return existing, False
    parsed = parse(content, filename)
    number = number or parsed.number
    if number is None:
        raise HTTPException(400, "The batch number could not be read from the file name or sheet.")
    if _number_taken(db, number):
        raise HTTPException(409, f"Batch #{number} is already recorded.")
    matched = _match(db, parsed)
    fresh = [v for v in matched.village_ids if v not in batches.active_village_ids(db, matched.village_ids)]
    if not fresh:
        raise HTTPException(400, "No row in that file matches a UEP village that is not already recorded.")
    batch = SubmissionBatch(
        number=number, status=BATCH_SENT, imported=True,
        source_filename=(filename or "")[:255], file_digest=digest,
        created_by=user.id, sent_at=datetime.now(timezone.utc),
        mtn_letter_date=letter_date, mtn_letter_no=(letter_no or "").strip()[:120] or None,
    )
    db.add(batch)
    db.flush()
    _add_items(db, batch, fresh, letter_date)
    return batch, True


def _add_items(db: Session, batch: SubmissionBatch, village_ids: list[int], sent: date) -> None:
    index = {v.id: v for vs in mojri_tracker.live_villages_by_key(db).values() for v in vs}
    for vid in village_ids:
        village = index[vid]
        wi = village.work_item
        db.add(SubmissionItem(
            batch_id=batch.id, village_id=vid,
            site_code=wi.site.site_code if wi and wi.site else None,
            site_type=wi.site_type if wi else None, village_code=village.village_code,
            reason=REASON_IMPORTED, source=SOURCE_IMPORT, sent_at=sent,
        ))
    db.flush()
