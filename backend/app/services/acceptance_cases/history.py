"""A case's timeline (§3.1 right column), written by nobody by hand.

Oldest first: the drive test's approval (or "Imported from CPM" for a legacy
case), the village's sends to ICT HQ read live from Submissions, then every
case event, then "Now" for an open case. Each status step carries the days
since the previous status step; a comment never resets that count.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.jalali import format_shamsi
from app.models.acceptance_case import (
    EVENT_APPROVED,
    EVENT_BASKET_CHANGED,
    EVENT_COMMENT,
    EVENT_CREATED,
    EVENT_FIXED,
    EVENT_REJECTED,
    AcceptanceCaseEvent,
    AcceptanceRejectionCategory,
)
from app.models.reference import User
from app.models.submission import SubmissionBatch, SubmissionItem
from app.services.submissions.follow_up import is_sent

from . import rules
from .scope import CaseRow


@dataclass
class Step:
    kind: str
    title: str
    day: date
    status: bool = True
    sub: str | None = None
    note: str | None = None
    actor: str | None = None
    letter: dict | None = None
    meta: dict = field(default_factory=dict)

    def out(self, delta: int | None) -> dict:
        return {
            "kind": self.kind, "title": self.title, "date": self.day.isoformat(),
            "status_step": self.status, "sub": self.sub, "note": self.note,
            "actor": self.actor, "letter": self.letter, "delta_days": delta, **self.meta,
        }


def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all())


def _labels(db: Session) -> dict[int, str]:
    return dict(db.execute(select(AcceptanceRejectionCategory.id, AcceptanceRejectionCategory.label)).all())


def events_of(db: Session, case_id: int) -> list[AcceptanceCaseEvent]:
    return list(db.execute(
        select(AcceptanceCaseEvent).where(AcceptanceCaseEvent.case_id == case_id)
        .order_by(AcceptanceCaseEvent.created_at, AcceptanceCaseEvent.id)
    ).scalars())


def letter_of(no: str | None, day: date | None, evidence_id: int | None = None) -> dict | None:
    if not (no or day or evidence_id):
        return None
    return {"no": no, "date": day.isoformat() if day else None,
            "date_shamsi": format_shamsi(day), "evidence_id": evidence_id}


def dt_step(row: CaseRow, created: AcceptanceCaseEvent | None, names: dict[int, str]) -> Step:
    meta = (created.meta or {}) if created else {}
    if row.dt_approved_on and not row.legacy:
        by = names.get(meta.get("dt_approved_by"))
        return Step("dt", "DT approved", row.dt_approved_on, sub=f"by {by}" if by else None)
    legacy_on = meta.get("legacy_on")
    day = date.fromisoformat(legacy_on) if legacy_on else row.state_since
    return Step("dt", "Imported from CPM", day, sub="No DT approval date in UEP")


def submitted_steps(db: Session, row: CaseRow) -> list[Step]:
    """Every send of this village to ICT HQ (Submissions, UEP-21)."""
    rows = db.execute(
        select(SubmissionItem.sent_at, SubmissionBatch)
        .select_from(SubmissionItem)
        .outerjoin(SubmissionBatch, SubmissionItem.batch_id == SubmissionBatch.id)
        .where(SubmissionItem.village_id == row.village_id, is_sent())
        .order_by(SubmissionItem.sent_at)
    ).all()
    out = []
    for sent_at, batch in rows:
        kind = "cra" if row.authority == "CRA" and batch is not None and batch.cra_letter_no else "mtn"
        no = getattr(batch, f"{kind}_letter_no", None) if batch else None
        when = getattr(batch, f"{kind}_letter_date", None) if batch else None
        label = f"Batch #{batch.number}" if batch else "Sent outside UEP"
        out.append(Step("submitted", f"Submitted to {row.authority}", sent_at, sub=label,
                        letter=letter_of(no, when or sent_at)))
    return out


def _event_step(e: AcceptanceCaseEvent, row: CaseRow, names: dict, labels: dict) -> Step | None:
    day = rules.local_date(e.created_at)
    actor = names.get(e.actor_user_id)
    letter = letter_of(e.letter_no, e.letter_date, e.evidence_id)
    meta = e.meta or {}
    category = labels.get(e.category_id)
    if e.kind == EVENT_APPROVED:
        return Step(e.kind, "Approved", day, actor=actor, letter=letter, note=e.comment)
    if e.kind == EVENT_REJECTED:
        basket = meta.get("basket_owner")
        sub = f"to {basket} basket" if basket else None
        return Step(e.kind, f"Rejected · {category or 'Needs category'}", day, actor=actor,
                    letter=letter, note=e.comment, sub=sub)
    if e.kind == EVENT_FIXED:
        to = meta.get("contractor") or row.contractor_name or "contractor"
        return Step(e.kind, f"Fixed · back to {to}", day, actor=actor, note=e.comment,
                    sub=f"by {actor}" if actor else None)
    if e.kind == EVENT_BASKET_CHANGED:
        return Step(e.kind, f"Basket changed · {category or meta.get('basket_owner') or ''}".rstrip(" ·"),
                    day, actor=actor, note=e.comment, sub=f"by {actor}" if actor else None)
    if e.kind == EVENT_COMMENT:
        title = f"Comment · {actor}" if actor else "Comment"
        filed = meta.get("filing")
        sub = f"Filed {filed['choice']} · in validation" if filed else None
        return Step(e.kind, title, day, status=False, actor=actor, note=e.comment, sub=sub,
                    letter=letter if filed else None)
    return None


def with_deltas(steps: list[Step]) -> list[dict]:
    out, prev = [], None
    for s in steps:
        delta = None
        if s.status and prev is not None:
            delta = (s.day - prev).days
        if s.status:
            prev = s.day
        out.append(s.out(delta))
    return out


def build(db: Session, row: CaseRow, today: date) -> dict:
    events = events_of(db, row.case_id)
    created = next((e for e in events if e.kind == EVENT_CREATED), None)
    names = _names(db, [e.actor_user_id for e in events]
                   + [((created.meta or {}).get("dt_approved_by") if created else None)])
    labels = _labels(db)
    first = dt_step(row, created, names)
    steps = [first, *submitted_steps(db, row)]
    steps += [s for s in (_event_step(e, row, names, labels) for e in events) if s]
    steps.sort(key=lambda s: s.day)
    steps.remove(first)
    steps.insert(0, first)
    timeline = with_deltas(steps)
    if rules.is_open(row.state):
        timeline.append({
            "kind": "now", "title": f"Now · in {row.basket_owner} basket", "date": today.isoformat(),
            "status_step": True, "delta_days": row.days_in_basket, "over_sla": row.over_sla,
            "state": row.state, "sub": None, "note": None, "actor": None, "letter": None,
        })
    return {
        "authority": row.authority,
        "dt_date": first.day.isoformat(),
        "dt_legacy": first.title != "DT approved",
        "days_since_dt": max((today - first.day).days, 0),
        "steps": timeline,
    }


def case_summaries(db: Session, user: User, village_ids: list[int]) -> dict[tuple[int, str], dict]:
    """Explorer's Acceptance step (§5.8): each village side's case state,
    basket and days. The site page already decided the caller may see it."""
    from . import counts, scope

    c = counts.clock(db)
    rows = scope.load_cases(db, user, c, open_only=False, village_ids=village_ids, kind=scope.KIND_ANY)
    return {
        (r.village_id, r.authority): {
            "state": r.state, "basket": r.basket_owner, "category": r.category_label,
            "days_in_basket": r.days_in_basket if rules.is_open(r.state) else None,
            "over_sla": r.over_sla, "stale": r.stale,
        }
        for r in rows
    }


def latest_comment(db: Session, case_ids: list[int]) -> dict[int, dict]:
    """Each case's latest comment text, author and moment (any event kind)."""
    if not case_ids:
        return {}
    rows = db.execute(
        select(AcceptanceCaseEvent.case_id, AcceptanceCaseEvent.comment,
               AcceptanceCaseEvent.actor_user_id, AcceptanceCaseEvent.created_at)
        .where(AcceptanceCaseEvent.case_id.in_(case_ids), AcceptanceCaseEvent.comment.isnot(None),
               AcceptanceCaseEvent.actor_user_id.isnot(None))
        .order_by(AcceptanceCaseEvent.created_at, AcceptanceCaseEvent.id)
    ).all()
    names = _names(db, [r[2] for r in rows])
    out: dict[int, dict] = {}
    for case_id, text, actor, at in rows:
        out[case_id] = {"text": text, "author": names.get(actor), "at": _iso(at)}
    return out


def _iso(at: datetime | None) -> str | None:
    return at.isoformat() if at else None
