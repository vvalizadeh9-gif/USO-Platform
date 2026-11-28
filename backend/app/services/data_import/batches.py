"""Batches: numbering, staging a preview, the PM's decisions, expiry, history.

A preview is staged server-side (``import_rows`` / ``import_changes``) so
Confirm never re-reads the file. Nothing outside those tables is written
before Confirm. A preview not confirmed within 24 hours expires.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from app.core import audit_actions, jalali
from app.models.data_import import (
    DECISION_FILE,
    DECISIONS,
    ENTITY_DT,
    KIND_CONFLICT,
    KIND_EFFECT,
    KIND_NEW,
    STATUS_APPLIED,
    STATUS_EXPIRED,
    STATUS_PREVIEWED,
    ImportBatch,
    ImportChange,
    ImportRow,
)
from app.models.reference import User
from app.services import evidence_store
from app.services.audit import record_audit

from . import columns as C
from . import current, diff, reader, validate

MODULE = "data_import"
EXPIRY = timedelta(hours=24)


class ImportError_(ValueError):
    """A refusal with a message for the person and an HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def next_number(db: Session) -> int:
    return (db.scalar(select(func.max(ImportBatch.number))) or 0) + 1


def is_expired(batch: ImportBatch, now: datetime | None = None) -> bool:
    return batch.status == STATUS_PREVIEWED and (now or _now()) - _aware(batch.uploaded_at) > EXPIRY


def expire_stale(db: Session, now: datetime | None = None) -> int:
    """Mark previews older than 24 h expired and drop their staging rows."""
    cutoff = (now or _now()) - EXPIRY
    ids = list(db.execute(
        select(ImportBatch.id).where(
            ImportBatch.status == STATUS_PREVIEWED, ImportBatch.uploaded_at < cutoff
        )
    ).scalars())
    if not ids:
        return 0
    db.execute(ImportChange.__table__.delete().where(ImportChange.batch_id.in_(ids)))
    db.execute(update(ImportBatch).where(ImportBatch.id.in_(ids)).values(status=STATUS_EXPIRED))
    return len(ids)


# --------------------------------------------------------------------------
# Preview
# --------------------------------------------------------------------------
def preview(db: Session, user: User, filename: str, content: bytes) -> ImportBatch:
    """Read, check and diff a file, and stage the result. Caller commits."""
    try:
        evidence_store.validate(filename, content)
    except evidence_store.EvidenceError as exc:
        raise ImportError_(str(exc)) from None
    if not filename.lower().endswith(".xlsx"):
        raise ImportError_("Only .xlsx files are accepted")
    try:
        read = reader.read(content)
    except reader.FileRefused as exc:
        raise ImportError_(str(exc)) from None

    today = jalali.tehran_today()
    universe = current.load_universe(db, user)
    from app.services import mojri_tracker

    wi_ids = set()
    for raw in read.rows:
        key = mojri_tracker.match_key(raw.cells.get("site_id"), raw.cells.get("site_type"),
                                      raw.cells.get("village_code"))
        for v in universe.by_key.get(key, []) if key else []:
            wi_ids.add(v.work_item_id)
    dt_now = current.dt_values(db, wi_ids, universe)
    checked = validate.check(read.rows, universe, dt_now, today)
    village_ids = {r.village_ids[0] for r in checked.rows if r.acc}
    acc_now = current.acceptance_values(db, village_ids)
    changes, counts = diff.build(checked, dt_now, acc_now)

    digest = evidence_store.store_retained(db, "xlsx", content)
    warnings = [f"Unknown column ignored: {h}" for h in read.unknown_headers] + checked.warnings
    earlier = db.scalar(
        select(ImportBatch.number).where(
            ImportBatch.file_sha256 == digest, ImportBatch.status == STATUS_APPLIED
        ).order_by(ImportBatch.number.desc()).limit(1)
    )
    counts.update({
        "rows": len(checked.rows),
        "row_errors": sum(1 for r in checked.rows if r.status != "ok"),
        "warnings": warnings,
        "already_imported_as": earlier,
    })

    batch = ImportBatch(
        number=next_number(db), filename=evidence_store.safe_filename(filename)[:255],
        file_sha256=digest, evidence_file_id=digest, status=STATUS_PREVIEWED,
        uploaded_by=user.id, uploaded_at=_now(), counts=counts,
    )
    db.add(batch)
    db.flush()

    row_ids: dict[int, int] = {}
    db_rows = []
    for row in checked.rows:
        raw = {k: reader.as_text(v) for k, v in row.raw.cells.items()}
        raw["_village_ids"] = row.village_ids
        db_rows.append(ImportRow(
            batch_id=batch.id, row_no=row.raw.row_no, key_text=row.key_text[:200],
            work_item_id=row.work_item_id, village_id=row.village_ids[0] if row.village_ids else None,
            status=row.status, errors=row.errors or None, raw=raw,
        ))
    db.add_all(db_rows)
    db.flush()
    for row, db_row in zip(checked.rows, db_rows, strict=True):
        row_ids[id(row)] = db_row.id

    if changes:
        db.execute(insert(ImportChange), [
            {
                "batch_id": batch.id, "row_id": row_ids[id(c.row)], "entity_type": c.entity_type,
                "entity_id": c.entity_id, "field": c.field, "old_value": c.old, "new_value": c.new,
                "kind": c.kind, "decision": None, "old_source": c.old_source, "applied": False,
            }
            for c in changes
        ])
    record_audit(
        db, user_id=user.id, action=audit_actions.DATA_IMPORT_PREVIEWED, module=MODULE,
        entity_type="ImportBatch", entity_id=batch.id,
        new_value={"number": batch.number, "filename": batch.filename,
                   "sha256": digest, "counts": _audit_counts(counts)},
    )
    return batch


def _audit_counts(counts: dict) -> dict:
    return {k: v for k, v in counts.items() if k != "warnings"}


# --------------------------------------------------------------------------
# Reading a batch
# --------------------------------------------------------------------------
def get(db: Session, batch_id: int) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise ImportError_("Batch not found", 404)
    if is_expired(batch):
        expire_stale(db)
        db.commit()
        db.refresh(batch)
    return batch


def require_previewed(batch: ImportBatch) -> None:
    if batch.status == STATUS_EXPIRED:
        raise ImportError_("This preview expired after 24 hours. Upload the file again.", 409)
    if batch.status != STATUS_PREVIEWED:
        raise ImportError_(f"Batch #{batch.number} is {batch.status}; it cannot be changed.", 409)


def decision_counts(db: Session, batch_id: int) -> dict:
    rows = db.execute(
        select(ImportChange.kind, ImportChange.decision, func.count())
        .where(ImportChange.batch_id == batch_id, ImportChange.kind != KIND_EFFECT)
        .group_by(ImportChange.kind, ImportChange.decision)
    ).all()
    new = sum(n for k, _d, n in rows if k == KIND_NEW)
    conflicts = sum(n for k, _d, n in rows if k == KIND_CONFLICT)
    undecided = sum(n for k, d, n in rows if k == KIND_CONFLICT and d is None)
    use_file = sum(n for k, d, n in rows if k == KIND_CONFLICT and d == DECISION_FILE)
    return {"new": new, "conflicts": conflicts, "undecided": undecided,
            "use_file": use_file, "to_apply": new + use_file}


def summary(db: Session, batch: ImportBatch) -> dict:
    names = dict(db.execute(select(User.id, User.full_name).where(
        User.id.in_([i for i in (batch.uploaded_by, batch.applied_by, batch.undone_by) if i])
    )).all())
    counts = batch.counts or {}
    return {
        "id": batch.id,
        "number": batch.number,
        "filename": batch.filename,
        "status": STATUS_EXPIRED if is_expired(batch) else batch.status,
        "uploaded_by": names.get(batch.uploaded_by),
        "uploaded_at": _aware(batch.uploaded_at).isoformat() if batch.uploaded_at else None,
        "applied_by": names.get(batch.applied_by),
        "applied_at": _aware(batch.applied_at).isoformat() if batch.applied_at else None,
        "undone_by": names.get(batch.undone_by),
        "undone_at": _aware(batch.undone_at).isoformat() if batch.undone_at else None,
        "counts": counts,
        "decisions": decision_counts(db, batch.id),
        "expires_at": (_aware(batch.uploaded_at) + EXPIRY).isoformat()
        if batch.status == STATUS_PREVIEWED else None,
    }


def history(db: Session, limit: int = 100) -> list[dict]:
    batches = db.execute(
        select(ImportBatch).order_by(ImportBatch.number.desc()).limit(limit)
    ).scalars().all()
    return [summary(db, b) for b in batches]


PAGE = 50
TABS = ("conflicts", "errors", "changes")


def _field_label(field: str) -> str:
    return C.label(field)


def preview_page(db: Session, batch: ImportBatch, *, tab: str, field: str | None,
                 q: str | None, page: int) -> dict:
    if tab not in TABS:
        raise ImportError_(f"tab must be one of {', '.join(TABS)}")
    page = max(page, 1)
    if tab == "errors":
        stmt = select(ImportRow).where(ImportRow.batch_id == batch.id, ImportRow.status != "ok")
        if q:
            stmt = stmt.where(ImportRow.key_text.ilike(f"%{q.strip()}%"))
        total = db.scalar(select(func.count()).select_from(stmt.subquery()))
        rows = db.execute(stmt.order_by(ImportRow.row_no).offset((page - 1) * PAGE).limit(PAGE)).scalars()
        items = []
        for r in rows:
            raw = r.raw or {}
            items.append({
                "row": r.row_no, "site_id": raw.get("site_id"), "site_type": raw.get("site_type"),
                "village_code": raw.get("village_code"), "status": r.status,
                "messages": [e.get("message") for e in (r.errors or [])],
            })
        return {"tab": tab, "total": total, "page": page, "page_size": PAGE, "items": items,
                "fields": []}

    kinds = [KIND_CONFLICT] if tab == "conflicts" else [KIND_NEW, KIND_CONFLICT]
    base = (
        select(ImportChange, ImportRow)
        .join(ImportRow, ImportRow.id == ImportChange.row_id)
        .where(ImportChange.batch_id == batch.id, ImportChange.kind.in_(kinds))
    )
    if tab == "changes":
        base = base.where(
            (ImportChange.kind == KIND_NEW) | (ImportChange.decision == DECISION_FILE)
        )
    fields = Counter(
        f for (f,) in db.execute(
            select(ImportChange.field).where(ImportChange.batch_id == batch.id,
                                             ImportChange.kind.in_(kinds))
        ).all()
    )
    if field:
        base = base.where(ImportChange.field == field)
    if q:
        base = base.where(ImportRow.key_text.ilike(f"%{q.strip()}%"))
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.execute(
        base.order_by(ImportRow.row_no, ImportChange.id).offset((page - 1) * PAGE).limit(PAGE)
    ).all()
    items = []
    for change, row in rows:
        raw = row.raw or {}
        items.append({
            "id": change.id,
            "row": row.row_no,
            "site_id": raw.get("site_id"), "site_type": raw.get("site_type"),
            "village_code": None if change.entity_type == ENTITY_DT else raw.get("village_code"),
            "scope": "site" if change.entity_type == ENTITY_DT else "village",
            "field": change.field, "field_label": _field_label(change.field),
            "uep_value": change.old_value, "uep_source": change.old_source,
            "file_value": change.new_value, "kind": change.kind, "decision": change.decision,
        })
    return {
        "tab": tab, "total": total, "page": page, "page_size": PAGE, "items": items,
        "fields": [{"field": f, "label": _field_label(f), "count": n}
                   for f, n in sorted(fields.items(), key=lambda kv: list(C.BY_KEY).index(kv[0])
                                      if kv[0] in C.BY_KEY else 99)],
    }


def decide(db: Session, batch: ImportBatch, *, decision: str, change_ids: list[int] | None,
           field: str | None, all_conflicts: bool) -> int:
    """Set Keep UEP / Use file on conflicts: by id, by field, or all."""
    require_previewed(batch)
    if decision not in DECISIONS:
        raise ImportError_("decision must be keep or file")
    stmt = update(ImportChange).where(
        ImportChange.batch_id == batch.id, ImportChange.kind == KIND_CONFLICT
    )
    if change_ids:
        stmt = stmt.where(ImportChange.id.in_(change_ids))
    elif field:
        stmt = stmt.where(ImportChange.field == field)
    elif not all_conflicts:
        raise ImportError_("Name the conflicts: change_ids, a field, or all")
    result = db.execute(stmt.values(decision=decision))
    return result.rowcount or 0
