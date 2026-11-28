"""What one Confirm carries through: the batch, the user, and every record the
batch creates or changes (its *effects*), which Undo later reads."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy.orm import Session

from app.models.data_import import KIND_EFFECT, ImportBatch
from app.models.health_check import HcAssignment
from app.models.reference import User
from app.services.acceptance_cases.sync import at_noon

from .current import IMPORT_TAG


@dataclass
class Effect:
    row_id: int | None
    entity_type: str
    record: object | None       # resolved to an id after the flush
    entity_id: int | None
    field: str
    old: object
    new: object
    created: bool = False


@dataclass
class Ctx:
    db: Session
    user: User
    batch: ImportBatch
    effects: list[Effect] = field(default_factory=list)
    hc_assignment: HcAssignment | None = None
    touched_work_items: set[int] = field(default_factory=set)
    touched_villages: set[int] = field(default_factory=set)

    @property
    def tag(self) -> str:
        return IMPORT_TAG.format(n=self.batch.number)

    def tagged(self, text: str | None) -> str:
        return f"{self.tag} · {text}" if text else self.tag

    def created(self, row_id, entity_type: str, record, new=None) -> None:
        self.effects.append(Effect(row_id, entity_type, record, None, "created", None, new, True))

    def changed(self, row_id, entity_type: str, record, field_name: str, old, new) -> None:
        self.effects.append(Effect(row_id, entity_type, record, None, field_name, old, new))

    def effect_rows(self) -> list[dict]:
        out = []
        for e in self.effects:
            entity_id = e.entity_id if e.entity_id is not None else getattr(e.record, "id", None)
            out.append({
                "batch_id": self.batch.id, "row_id": e.row_id, "entity_type": e.entity_type,
                "entity_id": entity_id or 0, "field": e.field, "old_value": e.old,
                "new_value": e.new, "kind": KIND_EFFECT, "applied": True,
                "created_record_type": e.entity_type if e.created else None,
                "created_record_id": entity_id if e.created else None,
            })
        return out


def noon(day: date | str | None):
    if day is None:
        return None
    if isinstance(day, str):
        day = date.fromisoformat(day)
    return at_noon(day)
