"""Confirm: apply a previewed batch in one transaction.

Refused while any conflict has no decision, and refused when UEP changed one
of the staged values since the file was checked (the preview would no longer
say what happens). Any failure raises, and the caller rolls the whole
transaction back: nothing is applied.

No notification, email or digest is sent for imported events: nothing here
calls ``audit.notify`` or the mailer.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import insert, select, update

from app.core import audit_actions
from app.core.request_context import current_client_ip
from app.models.acceptance import AuditLog
from app.models.data_import import (
    DECISION_FILE,
    ENTITY_DT,
    KIND_CONFLICT,
    KIND_NEW,
    STATUS_APPLIED,
    ImportBatch,
    ImportChange,
    ImportRow,
)
from app.models.reference import User

from . import apply_acceptance, apply_dt, current
from .batches import MODULE, ImportError_, decision_counts, require_previewed
from .context import Ctx
from .diff import _norm


def _to_apply(db, batch: ImportBatch) -> list[ImportChange]:
    return list(db.execute(
        select(ImportChange).where(
            ImportChange.batch_id == batch.id,
            ImportChange.kind.in_([KIND_NEW, KIND_CONFLICT]),
            (ImportChange.kind == KIND_NEW) | (ImportChange.decision == DECISION_FILE),
        ).order_by(ImportChange.id)
    ).scalars())


def apply(db, batch: ImportBatch, user: User) -> dict:
    require_previewed(batch)
    counts = decision_counts(db, batch.id)
    if counts["undecided"]:
        raise ImportError_(
            f"{counts['undecided']} conflicts still need a choice (Keep UEP or Use file).", 409
        )
    changes = _to_apply(db, batch)

    universe = current.load_universe(db, None)
    dt_changes = [c for c in changes if c.entity_type == ENTITY_DT]
    acc_changes = [c for c in changes if c.entity_type != ENTITY_DT]
    dt_now = current.dt_values(db, {c.entity_id for c in dt_changes}, universe)
    acc_now = current.acceptance_values(db, {c.entity_id for c in acc_changes})

    stale = 0
    for c in dt_changes:
        if _norm(dt_now.get(c.entity_id, {}).get(c.field, current.Value(None)).value) != _norm(c.old_value):
            stale += 1
    for c in acc_changes:
        authority = "ICT" if c.entity_type == "ict" else "CRA"
        field = c.field.split("_", 1)[1]
        if _norm(acc_now.get((c.entity_id, authority), {}).get(field, current.Value(None)).value) \
                != _norm(c.old_value):
            stale += 1
    if stale:
        raise ImportError_(
            f"{stale} values changed in UEP since this file was checked. "
            "Upload the file again to see the current differences.", 409
        )

    rows_by_id = {r.id: r for r in db.execute(
        select(ImportRow).where(ImportRow.batch_id == batch.id)
    ).scalars()}

    ctx = Ctx(db, user, batch)
    apply_dt.apply_sites(ctx, apply_dt.group_plans(dt_changes), dt_now, universe)
    db.flush()
    apply_acceptance.apply_villages(
        ctx, apply_acceptance.group_plans(acc_changes, rows_by_id), acc_now, universe
    )
    db.flush()

    effects = ctx.effect_rows()
    if effects:
        db.execute(insert(ImportChange), effects)
        ip = current_client_ip()
        db.execute(insert(AuditLog), [
            {
                "user_id": user.id, "action": audit_actions.DATA_IMPORT_APPLIED, "module": MODULE,
                "entity_type": e["entity_type"], "entity_id": e["entity_id"] or None,
                "old_value": {"value": e["old_value"]} if e["old_value"] is not None else None,
                "new_value": {"batch": batch.number, "field": e["field"], "value": e["new_value"]},
                "reason": f"Imported · batch #{batch.number}", "ip_address": ip,
                "result": audit_actions.SUCCESS,
            }
            for e in effects
        ])
    if changes:
        db.execute(update(ImportChange).where(ImportChange.id.in_([c.id for c in changes]))
                   .values(applied=True))
    batch.status = STATUS_APPLIED
    batch.applied_by = user.id
    batch.applied_at = datetime.now(timezone.utc)
    batch.counts = {**(batch.counts or {}), "applied_changes": len(changes),
                    "records": len(effects),
                    "sites": len(ctx.touched_work_items), "villages": len(ctx.touched_villages)}
    db.flush()
    return {"applied_changes": len(changes), "records": len(effects)}
