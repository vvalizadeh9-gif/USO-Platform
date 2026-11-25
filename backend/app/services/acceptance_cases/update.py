"""One save on the Filing page (§3.1 "Update", §4.4, §5.2).

The three choices, for one village or many in one transaction:

* ``waiting`` -- on a waiting case, a comment; on a rejected case, "Fixed ·
  back to contractor".
* ``approved`` / ``rejected`` -- a letter (number, Shamsi date, scan), filed
  through ``acceptance_letters.file_letter`` like every other letter: a PM's or
  coordinator's lands at once, a contractor's goes to ICT/CRA validation and
  the case moves when a coordinator confirms it (``validation_link``).

A comment is required on every save. A save carrying a ``request_id`` that
was already applied is answered as applied and not repeated.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import audit_actions
from app.models.acceptance_case import (
    STATE_REJECTED,
    AcceptanceCaseEvent,
    AcceptanceRejectionCategory,
)
from app.models.acceptance_workflow import AUTHORITIES
from app.models.reference import User
from app.models.workitem import Village, WorkItem
from app.services import acceptance_letters as letters
from app.services import acceptance_workflow as flow
from app.services import scan_tokens
from app.services.audit import record_audit

from . import counts, scope, transitions
from .scope import CaseRow
from .validation_link import CaseContext, basket_owner

CHOICE_WAITING = "waiting"
CHOICE_APPROVED = "approved"
CHOICE_REJECTED = "rejected"
CHOICES = (CHOICE_WAITING, CHOICE_APPROVED, CHOICE_REJECTED)
MAX_VILLAGES = letters.MAX_VILLAGES
MODULE = "AcceptanceCase"


class UpdateError(Exception):
    """Nothing was saved; ``errors`` names every field and village at fault."""

    def __init__(self, message: str, errors: list[dict] | None = None, status: int = 400):
        super().__init__(message)
        self.message = message
        self.errors = errors or []
        self.status = status


@dataclass(frozen=True)
class UpdateRequest:
    village_ids: tuple[int, ...]
    authority: str
    choice: str
    comment: str | None
    category: str | None = None        # rejection category code
    letter_no: str | None = None
    letter_date: str | None = None     # Shamsi
    scan_ids: tuple[str, ...] = ()
    request_id: str | None = None


@dataclass
class UpdateOutcome:
    authority: str
    choice: str
    applied: list[int] = field(default_factory=list)
    in_validation: list[int] = field(default_factory=list)
    replayed: bool = False


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------
def _authority(raw: str) -> str:
    authority = str(raw or "").upper().strip()
    if authority not in AUTHORITIES:
        raise UpdateError("Authority must be ICT or CRA", [{"field": "authority", "code": "invalid"}])
    return authority


def field_errors(req: UpdateRequest) -> list[dict]:
    """The required fields per choice (§3.1): comment always; category on a
    rejection; letter number and date on approved or rejected."""
    errors = []
    if req.choice not in CHOICES:
        return [{"field": "choice", "code": "invalid"}]
    if not (req.comment or "").strip():
        errors.append({"field": "comment", "code": "missing"})
    if req.choice == CHOICE_REJECTED and not req.category:
        errors.append({"field": "category", "code": "missing"})
    if req.choice != CHOICE_WAITING:
        if not (req.letter_no or "").strip():
            errors.append({"field": "letter_no", "code": "missing"})
        if not (req.letter_date or "").strip():
            errors.append({"field": "letter_date", "code": "missing"})
    if not 1 <= len(req.village_ids) <= MAX_VILLAGES:
        errors.append({"field": "village_ids", "code": "invalid_count"})
    return errors


def may_save(user: User, kind: str, choice: str, row: CaseRow) -> bool:
    """§4.4. The scope already narrowed a contractor to their own waiting
    cases and Contractor-category rejections, and a team to its basket."""
    role = user.role.name
    if role in scope.DECIDING_ROLES:
        return True
    if kind == scope.KIND_CONTRACTOR:
        return True
    if kind == scope.KIND_TEAM:
        return choice == CHOICE_WAITING and row.state == STATE_REJECTED
    return False


def _category(db: Session, code: str | None) -> AcceptanceRejectionCategory | None:
    if not code:
        return None
    found = db.execute(
        select(AcceptanceRejectionCategory).where(
            AcceptanceRejectionCategory.code == code, AcceptanceRejectionCategory.active.is_(True)
        )
    ).scalar_one_or_none()
    if found is None:
        raise UpdateError("Unknown rejection category", [{"field": "category", "code": "invalid"}])
    return found


def already_applied(db: Session, user: User, request_id: str | None) -> bool:
    if not request_id:
        return False
    return db.execute(
        select(AcceptanceCaseEvent.id).where(
            AcceptanceCaseEvent.request_id == request_id,
            AcceptanceCaseEvent.actor_user_id == user.id,
        ).limit(1)
    ).first() is not None


def _rows(db: Session, user: User, kind: str, req: UpdateRequest, authority: str) -> list[CaseRow]:
    c = counts.clock(db)
    rows = scope.load_cases(db, user, c, authority=authority, open_only=True,
                            village_ids=list(req.village_ids), kind=kind)
    found = {r.village_id for r in rows}
    missing = [v for v in dict.fromkeys(req.village_ids) if v not in found]
    if missing:
        # One answer for "no such case", "approved already" and "not yours".
        raise UpdateError("Some villages are not in your inbox",
                          [{"field": "village_ids", "code": "not_found", "village_id": v} for v in missing],
                          status=404)
    denied = [r.village_id for r in rows if not may_save(user, kind, req.choice, r)]
    if denied:
        raise UpdateError("You cannot record this for these villages",
                          [{"field": "choice", "code": "forbidden", "village_id": v} for v in denied],
                          status=403)
    return rows


# --------------------------------------------------------------------------
# Saving
# --------------------------------------------------------------------------
def save(db: Session, user: User, req: UpdateRequest) -> UpdateOutcome:
    """Apply one save. Caller commits, or rolls back on an error."""
    authority = _authority(req.authority)
    kind = scope.require_kind(user)
    outcome = UpdateOutcome(authority=authority, choice=req.choice)
    if already_applied(db, user, req.request_id):
        outcome.replayed = True
        return outcome
    errors = field_errors(req)
    if errors:
        raise UpdateError("Some fields are missing", errors)
    category = _category(db, req.category) if req.choice == CHOICE_REJECTED else None
    rows = _rows(db, user, kind, req, authority)
    transitions.lock(db, [r.case_id for r in rows])
    text = req.comment.strip()
    if req.choice == CHOICE_WAITING:
        _save_waiting(db, user, rows, text, req.request_id, outcome)
    else:
        _save_letter(db, user, rows, req, authority, category, text, outcome)
    _audit(db, user, req, authority, category, outcome)
    return outcome


def _save_waiting(db: Session, user: User, rows: list[CaseRow], text: str,
                  request_id: str | None, outcome: UpdateOutcome) -> None:
    for row in rows:
        case = transitions.case_for(db, row.village_id, row.authority)
        if row.state == STATE_REJECTED:
            transitions.fix(db, case, user, text, contractor=row.contractor_name, request_id=request_id)
        else:
            transitions.comment(db, case, user, text, request_id=request_id)
        outcome.applied.append(row.village_id)


def _claims(village: Village, authority: str, choice: str, text: str) -> tuple:
    result = "approved" if choice == CHOICE_APPROVED else "rejected"
    reason = text if result == "rejected" else None
    return tuple(letters.ClaimInput(t, result, reason) for t in flow.techs_to_file(village, authority))


def _villages(db: Session, ids: list[int]) -> dict[int, Village]:
    stmt = select(Village).where(Village.id.in_(ids)).options(
        selectinload(Village.acceptances), selectinload(Village.work_item).selectinload(WorkItem.site),
    )
    return {v.id: v for v in db.execute(stmt).scalars()}


def _save_letter(db: Session, user: User, rows: list[CaseRow], req: UpdateRequest, authority: str,
                 category: AcceptanceRejectionCategory | None, text: str, outcome: UpdateOutcome) -> None:
    villages = _villages(db, [r.village_id for r in rows])
    filing = letters.LetterFiling(
        authority=authority, letter_number=req.letter_no, letter_date=req.letter_date,
        scan_id=req.scan_ids[0] if req.scan_ids else None, scan_ids=tuple(req.scan_ids),
        items=tuple(
            letters.LetterItem(r.village_id, _claims(villages[r.village_id], authority, req.choice, text))
            for r in rows
        ),
    )
    ctx = CaseContext(choice=req.choice, comment=text,
                      category_id=category.id if category else None, request_id=req.request_id)
    try:
        result = letters.file_letter(db, user, filing, case_context=ctx)
    except letters.LetterError as exc:
        raise UpdateError(exc.message, [_letter_error(e) for e in exc.errors], status=exc.status_code) from None
    target = outcome.applied if result.decided else outcome.in_validation
    target.extend(r.village_id for r in result.results)


def _letter_error(e) -> dict:
    field_map = {"letter_number": "letter_no", "scan_id": "scan", "scan_ids": "scan"}
    return {"field": field_map.get(e.field, e.field), "code": e.code,
            "message": e.message, "village_id": e.village_id}


def _audit(db: Session, user: User, req: UpdateRequest, authority: str,
           category: AcceptanceRejectionCategory | None, outcome: UpdateOutcome) -> None:
    record_audit(
        db, user_id=user.id, action=audit_actions.UPDATED, module=MODULE,
        entity_type="AcceptanceCase", entity_id=None,
        new_value={
            "authority": authority, "choice": req.choice,
            "category": category.code if category else None,
            "letter_no": req.letter_no, "applied": outcome.applied,
            "in_validation": outcome.in_validation, "request_id": req.request_id,
        },
        reason=req.comment,
    )


# --------------------------------------------------------------------------
# A rejection owner on its own basket (UEP-24 F10)
# --------------------------------------------------------------------------
OWNER_COMMENT = "comment"
OWNER_FIXED = "fixed"
OWNER_ACTIONS = (OWNER_COMMENT, OWNER_FIXED)


def owner_action(db: Session, user: User, case_id: int, action: str, comment: str | None,
                 scan_ids: tuple[str, ...] = (), request_id: str | None = None) -> CaseRow:
    """A team whose role owns a basket comments on, or marks fixed, a case in
    that basket. Marking fixed sends it to the Contractor basket (the
    contractor gets the approval). Never an ICT/CRA outcome, never another
    team's basket: a case outside the caller's own basket is 404, the same
    answer as for no case at all. Caller commits."""
    if scope.viewer_kind(user) != scope.KIND_TEAM:
        raise UpdateError("Only the team that owns a basket can do this", status=403)
    if action not in OWNER_ACTIONS:
        raise UpdateError("Choose comment or fixed", [{"field": "action", "code": "invalid"}])
    text = (comment or "").strip()
    if not text:
        raise UpdateError("Add a comment, then save again", [{"field": "comment", "code": "missing"}])
    c = counts.clock(db)
    rows = [r for r in scope.load_cases(db, user, c, open_only=True, kind=scope.KIND_TEAM)
            if r.case_id == case_id]
    if not rows:
        raise UpdateError("Case not found", status=404)
    row = rows[0]
    files = []
    for scan_id in scan_ids:
        try:
            scan = scan_tokens.redeem(scan_id, user_id=user.id)
        except scan_tokens.ScanError as exc:
            raise UpdateError(str(exc), [{"field": "scan", "code": exc.code}]) from None
        files.append({"sha256": scan.sha256, "filename": scan.filename,
                      "stored_path": scan.stored_path})
    case = transitions.lock(db, [case_id])[0]
    if action == OWNER_FIXED:
        transitions.fix(db, case, user, text, contractor=row.contractor_name,
                        request_id=request_id, meta={"files": files} if files else None)
    else:
        transitions.comment(db, case, user, text, request_id=request_id,
                            meta={"files": files} if files else None)
    record_audit(
        db, user_id=user.id, action=audit_actions.UPDATED, module=MODULE,
        entity_type="AcceptanceCase", entity_id=case_id,
        old_value={"state": row.state, "basket_role": row.basket_role},
        new_value={"owner_action": action, "files": [f["filename"] for f in files],
                   **({"state": "waiting", "basket_role": "Contractor"} if action == OWNER_FIXED else {})},
        reason=text,
    )
    return row


# --------------------------------------------------------------------------
# Changing a basket (PM / coordinator only)
# --------------------------------------------------------------------------
def change_basket(db: Session, user: User, case_id: int, category_id: int, reason: str | None) -> CaseRow:
    if user.role.name not in scope.DECIDING_ROLES:
        raise UpdateError("Only a PM or coordinator can change a basket", status=403)
    if not (reason or "").strip():
        raise UpdateError("Say why the basket changes", [{"field": "reason", "code": "missing"}])
    c = counts.clock(db)
    rows = [r for r in scope.load_cases(db, user, c, open_only=True) if r.case_id == case_id]
    if not rows:
        raise UpdateError("Case not found", status=404)
    category = db.get(AcceptanceRejectionCategory, category_id)
    if category is None or not category.active:
        raise UpdateError("Unknown rejection category", [{"field": "category_id", "code": "invalid"}])
    if rows[0].state != STATE_REJECTED:
        raise UpdateError("Only a rejected case changes basket; record a rejection instead",
                          [{"field": "case", "code": "not_rejected"}], status=409)
    case = transitions.lock(db, [case_id])[0]
    transitions.change_basket(db, case, user, category, reason.strip(),
                              basket_owner=basket_owner(db, case.village_id, category))
    record_audit(
        db, user_id=user.id, action=audit_actions.UPDATED, module=MODULE,
        entity_type="AcceptanceCase", entity_id=case_id,
        old_value={"category_id": rows[0].category_id, "basket_role": rows[0].basket_role},
        new_value={"category_id": category.id, "basket_role": category.basket_role},
        reason=reason,
    )
    return rows[0]

