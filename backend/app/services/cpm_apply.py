"""Apply an accepted CPM change request.

Because validation is strict (changes are blocked at import time), the actual
mutation happens here, only when a PM accepts. Three change types are handled:

* requested_tech — set the work item's requested_technology to new_value.
* site_type      — create the new work item (site + new type) from payload.
* village_qty    — add/remove villages on the work item from payload.
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.models.acceptance import CpmChangeRequest
from app.models.workitem import Site, Village, WorkItem


def apply_change_request(db: Session, cr: CpmChangeRequest) -> None:
    """Apply the change described by ``cr``. Caller sets status/commits."""
    if cr.change_type == "requested_tech":
        _apply_requested_tech(db, cr)
    elif cr.change_type == "site_type":
        _apply_site_type(db, cr)
    elif cr.change_type == "village_qty":
        _apply_village_qty(db, cr)
    else:
        # Legacy simple field change.
        if cr.work_item_id is not None:
            wi = db.get(WorkItem, cr.work_item_id)
            if wi is not None and hasattr(wi, cr.field_name):
                setattr(wi, cr.field_name, cr.new_value)


def _apply_requested_tech(db: Session, cr: CpmChangeRequest) -> None:
    if cr.work_item_id is None:
        return
    wi = db.get(WorkItem, cr.work_item_id)
    if wi is not None:
        wi.requested_technology = cr.new_value


def _apply_site_type(db: Session, cr: CpmChangeRequest) -> None:
    if not cr.payload_json:
        return
    data = json.loads(cr.payload_json)
    site_id = data["site_id"]
    site_type = data["site_type"]
    fields = data.get("fields", {})
    # Guard against double-apply.
    existing = (
        db.query(WorkItem)
        .filter(WorkItem.site_id == site_id, WorkItem.site_type == site_type)
        .one_or_none()
    )
    if existing is not None:
        return
    wi = WorkItem(site_id=site_id, site_type=site_type, **fields)
    db.add(wi)
    db.flush()


def _apply_village_qty(db: Session, cr: CpmChangeRequest) -> None:
    if cr.work_item_id is None or not cr.payload_json:
        return
    wi = db.get(WorkItem, cr.work_item_id)
    if wi is None:
        return
    payload = json.loads(cr.payload_json)

    for v in payload.get("added", []):
        exists = any(x.village_code == v["village_code"] for x in wi.villages)
        if exists:
            continue
        db.add(
            Village(
                work_item_id=wi.id,
                village_code=v.get("village_code"),
                village_name=v.get("village_name"),
                # Carried from the import payload; without it an accepted
                # village lands with a NULL classification and stays invisible
                # to the Acceptance KPIs, which count only هدف.
                target_classification=v.get("target_classification"),
                households=v.get("households"),
                population=v.get("population"),
                latitude=v.get("latitude"),
                longitude=v.get("longitude"),
            )
        )

    for code in payload.get("removed", []):
        village = next((x for x in wi.villages if x.village_code == code), None)
        if village is not None:
            # Remove dependent acceptance rows first (no DB-level cascade).
            for acc in list(village.acceptances):
                db.delete(acc)
            db.delete(village)

    db.flush()
