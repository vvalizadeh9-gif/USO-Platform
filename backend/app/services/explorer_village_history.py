"""A site's village history: villages CPM imports added or removed (UEP-28).

Read from ``cpm_change_requests`` of type ``village_qty``: the import that saw
the change, the villages it named, and what the PM decided. Two queries
whatever the history's length -- the requests with their batch dates, then the
deciders' names.

A request can both add and remove villages; it becomes one event per kind.
Removed villages were stored as bare codes until UEP-28 and as
``{"village_code", "village_name"}`` since (``cpm_import``); both shapes are
read. An old code-only removal shows its name only when the village is still
on the site (a removal the PM ignored), otherwise the code alone.

There is no "site created" event: a work item carries no link to the import
that created it, and guessing one from timestamps would be wrong on some data.
"""
from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.acceptance import CpmChangeRequest, CpmImportBatch
from app.models.reference import User
from app.services.performance.periods import tehran_day

CHANGE_TYPE = "village_qty"

KIND_ADDED = "added"
KIND_REMOVED = "removed"

#: The request's status, in the history's words.
_STATUS = {"Accepted": "applied", "Ignored": "ignored", "Pending": "pending", "Archived": "archived"}


def removed_code(entry: str | dict) -> str | None:
    """A removed village's code, from either payload shape."""
    return entry.get("village_code") if isinstance(entry, dict) else entry


def _ref(code: str | None, name: str | None) -> dict:
    return {"code": code, "name": name}


def _added(payload: dict) -> list[dict]:
    return [_ref(v.get("village_code"), v.get("village_name")) for v in payload.get("added") or []]


def _removed(payload: dict, names: dict[str, str | None]) -> list[dict]:
    out = []
    for entry in payload.get("removed") or []:
        code = removed_code(entry)
        stored = entry.get("village_name") if isinstance(entry, dict) else None
        out.append(_ref(code, stored or names.get(code)))
    return out


def _payload(raw: str | None) -> dict:
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _user_names(db: Session, ids: Iterable[int | None]) -> dict[int, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {
        uid: f"{first or ''} {family or ''}".strip()
        for uid, first, family in db.execute(
            select(User.id, User.first_name, User.family_name).where(User.id.in_(wanted))
        )
    }


def _event(kind: str, villages: list[dict], when: date | None, row, users: dict) -> dict:
    return {
        "date": when,
        "kind": kind,
        "villages": villages,
        "status": _STATUS.get(row.status, row.status.lower()),
        "decided_by": users.get(row.decided_by),
        "decided_at": tehran_day(row.decided_at),
    }


def village_history(
    db: Session, work_item_id: int, names: dict[str, str | None] | None = None
) -> list[dict]:
    """The site's village events, newest first.

    ``names``: the site's current villages (code -> name), to name old
    code-only removals of villages that are still there. The caller has
    already checked the site is in scope.
    """
    r, b = CpmChangeRequest, CpmImportBatch
    rows = db.execute(
        select(r.id, r.payload_json, r.status, r.decided_by, r.decided_at,
               b.created_at.label("imported_at"))
        .join(b, r.import_batch_id == b.id)
        .where(r.work_item_id == work_item_id, r.change_type == CHANGE_TYPE)
        .order_by(b.created_at.desc(), r.id.desc())
    ).all()
    users = _user_names(db, (row.decided_by for row in rows))
    known = names or {}
    events: list[dict] = []
    for row in rows:
        payload = _payload(row.payload_json)
        when = tehran_day(row.imported_at)
        for kind, villages in ((KIND_ADDED, _added(payload)),
                               (KIND_REMOVED, _removed(payload, known))):
            if villages:
                events.append(_event(kind, villages, when, row, users))
    return events
