"""One letter, one authority, many villages: filing it and deciding it.

An ICT or CRA letter routinely covers a hundred villages. Here it is filed
once -- one number, one date, its evidence files (a scan, an email; up to
``evidence_store.MAX_FILES_PER_SUBMISSION``) -- and becomes one round per village,
each with that village's own per-technology claims, through the same
``acceptance_workflow`` rules a single filing goes through.

Both operations are **all-or-nothing**. Every village is checked, every
failure is collected, and if there is any the caller rolls the transaction
back and reports all of them: a partly-filed letter would leave the
submitter unable to tell which villages went in.

Who files decides what the round is:

* a **contractor**'s round is a claim, pending until a coordinator or PM
  confirms or returns it (:func:`review_letter`);
* a **coordinator or PM**'s round is recorded decided at once
  (``flow.record_decided``) -- they are entering a letter they received
  themselves, and there is no one else in the loop to confirm it.

ICT and CRA never touch each other: one authority per request, and nothing
here reads or writes the other side.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import audit_actions
from app.core.digits import to_latin
from app.core.jalali import parse_shamsi
from app.models.acceptance_workflow import (
    AUTHORITIES,
    CLAIM_APPROVED,
    CLAIM_REJECTED,
    REVIEW_PENDING,
    REVIEW_RETURNED,
    REVIEW_VALIDATED,
    SOURCE_CONTRACTOR,
    SOURCE_COORDINATOR,
    AcceptanceEvidence,
    AcceptanceSubmission,
)
from app.models.reference import User
from app.models.workitem import Village, WorkItem
from app.services import acceptance_rounds as rounds
from app.services import acceptance_workflow as flow
from app.services import my_work_status as S
from app.services import evidence_store, scan_tokens
from app.services.audit import notify, notify_roles, record_audit

MAX_VILLAGES = 500
MODULE = "Acceptance"

DECISION_CONFIRM = "confirm"
DECISION_RETURN = "return"
_REVIEW_STATUS = {DECISION_CONFIRM: REVIEW_VALIDATED, DECISION_RETURN: REVIEW_RETURNED}
_CLAIM_STATUS = {"approved": CLAIM_APPROVED, "rejected": CLAIM_REJECTED}

#: Codes meaning "this changed since you loaded it", answered with 409.
CONFLICT_CODES = frozenset({"not_editable", "not_pending", "stale"})


# --------------------------------------------------------------------------
# Inputs, outputs, errors
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class ClaimInput:
    tech: str
    result: str  # approved | rejected
    reason: str | None = None


@dataclass(frozen=True)
class LetterItem:
    village_id: int
    claims: tuple[ClaimInput, ...]


@dataclass(frozen=True)
class LetterFiling:
    authority: str
    letter_number: str | None
    letter_date: str | None  # Shamsi
    scan_id: str | None
    items: tuple[LetterItem, ...]
    #: Every evidence file of the letter (UEP-16). ``scan_id`` alone is still
    #: accepted for one release.
    scan_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ReviewItem:
    """One filing to decide, as the reviewer saw it."""

    submission_id: int
    #: The version the reviewer loaded; a different one now is a 409.
    version: int | None = None
    #: This village's own return reason, over the shared one.
    reason: str | None = None


@dataclass(frozen=True)
class ItemError:
    code: str
    message: str | None = None
    field: str | None = None
    village_id: int | None = None
    tech: str | None = None
    submission_id: int | None = None
    #: For a stale item: who decided it, when, and how it stands now.
    decided_by: str | None = None
    decided_at: str | None = None
    status: str | None = None


class LetterError(Exception):
    """Nothing was filed or decided; ``errors`` says everything that was wrong."""

    def __init__(self, message: str, errors: list[ItemError], *, status: int | None = None):
        super().__init__(message)
        self.message = message
        self.errors = errors
        self._status = status

    @property
    def status_code(self) -> int:
        if self._status is not None:
            return self._status
        codes = {e.code for e in self.errors}
        return 409 if codes and codes <= CONFLICT_CODES else 400


@dataclass
class VillageOutcome:
    village_id: int
    submission_id: int
    round_no: int
    status: str


@dataclass
class LetterOutcome:
    authority: str
    letter_number: str
    decided: bool
    results: list[VillageOutcome] = field(default_factory=list)


@dataclass
class ReviewOutcome:
    decision: str
    results: list[VillageOutcome] = field(default_factory=list)


def normalize_letter_number(raw: str | None) -> str:
    return to_latin(raw or "").strip()


def _authority(raw: str) -> str:
    authority = str(raw or "").upper().strip()
    if authority not in AUTHORITIES:
        raise LetterError(
            "Authority must be ICT or CRA",
            [ItemError("invalid_authority", field="authority")],
        )
    return authority


def _side_status(village: Village, authority: str) -> str:
    return S.display_status(getattr(village, f"{authority.lower()}_status"))


# --------------------------------------------------------------------------
# Filing
# --------------------------------------------------------------------------
def _redeem_scans(filing: LetterFiling, user: User) -> tuple[list[ItemError], list[scan_tokens.Scan]]:
    """Every evidence file the letter names, once each by content."""
    if not filing.scan_ids:
        try:
            return [], [scan_tokens.redeem(filing.scan_id, user_id=user.id)]
        except scan_tokens.ScanError as exc:
            return [ItemError(exc.code, str(exc), field="scan_id")], []
    limit = evidence_store.MAX_FILES_PER_SUBMISSION
    if len(filing.scan_ids) > limit:
        return [ItemError("too_many_files", f"At most {limit} files per letter", field="scan_ids")], []
    errors: list[ItemError] = []
    scans: dict[str, scan_tokens.Scan] = {}
    for scan_id in filing.scan_ids:
        try:
            scan = scan_tokens.redeem(scan_id, user_id=user.id)
        except scan_tokens.ScanError as exc:
            errors.append(ItemError(exc.code, str(exc), field="scan_ids"))
            continue
        scans.setdefault(scan.sha256, scan)
    return errors, list(scans.values())


def _letter_field_errors(filing: LetterFiling, user: User) -> tuple[list[ItemError], date | None, list[scan_tokens.Scan]]:
    errors: list[ItemError] = []
    if not normalize_letter_number(filing.letter_number):
        errors.append(ItemError("missing", field="letter_number"))

    letter_date = None
    if not (filing.letter_date or "").strip():
        errors.append(ItemError("missing", field="letter_date"))
    else:
        try:
            letter_date = parse_shamsi(filing.letter_date)
        except ValueError as exc:
            errors.append(ItemError("invalid_date", str(exc), field="letter_date"))

    scan_errors, scans = _redeem_scans(filing, user)
    return errors + scan_errors, letter_date, scans


def _duplicate_errors(items: tuple[LetterItem, ...]) -> list[ItemError]:
    seen: set[int] = set()
    errors = []
    for item in items:
        if item.village_id in seen:
            errors.append(ItemError("duplicate_village", village_id=item.village_id))
        seen.add(item.village_id)
    return errors


def _load_villages(db: Session, user: User, village_ids: list[int]) -> dict[int, Village]:
    flow.lock_villages(db, village_ids)
    stmt = flow.visible_villages(user, db).where(Village.id.in_(village_ids)).options(
        selectinload(Village.acceptances),
        selectinload(Village.work_item).selectinload(WorkItem.site),
    )
    return {v.id: v for v in db.execute(stmt).unique().scalars()}


def _claims(item: LetterItem) -> list[dict]:
    return [
        {
            "technology": c.tech,
            "claimed_status": _CLAIM_STATUS.get(str(c.result).lower(), c.result),
            "comment": c.reason,
        }
        for c in item.claims
    ]


def _file_one(
    db: Session, user: User, village: Village, item: LetterItem, *,
    authority: str, letter_number: str, letter_date: date | None,
) -> AcceptanceSubmission:
    """One village's round, pending or decided by who is filing. Raises WorkflowError."""
    common = dict(
        village=village, authority=authority, letter_number=letter_number,
        letter_date=letter_date, claims=_claims(item), user=user,
    )
    if S.decides_directly(user.role.name):
        return flow.record_decided(db, source=SOURCE_COORDINATOR, **common)
    return flow.submit(db, source=SOURCE_CONTRACTOR, carry_over=True, **common)


def _attach_scans(db: Session, scans: list[scan_tokens.Scan], submissions, user: User) -> None:
    """Link every file to every submission on the letter. The bytes are
    stored once (content-addressed); each link is one row."""
    now = datetime.now(timezone.utc)
    for submission in submissions:
        for scan in scans:
            db.add(AcceptanceEvidence(
                submission_id=submission.id,
                sha256=scan.sha256,
                stored_path=scan.stored_path,
                original_filename=scan.filename,
                content_type=scan.content_type,
                size_bytes=scan.size_bytes,
                uploaded_by=user.id,
                uploaded_at=now,
            ))


def _failure_message(errors: list[ItemError], total: int) -> str:
    failed = {e.village_id for e in errors if e.village_id is not None}
    if not failed:
        return "The letter could not be filed"
    return f"{len(failed)} of {total} villages could not be filed, so none were"


def file_letter(db: Session, user: User, filing: LetterFiling) -> LetterOutcome:
    """File one letter for many villages. Caller commits, or rolls back on error."""
    authority = _authority(filing.authority)
    if not 1 <= len(filing.items) <= MAX_VILLAGES:
        raise LetterError(
            f"A letter covers 1 to {MAX_VILLAGES} villages",
            [ItemError("invalid_count", field="items")],
        )

    errors, letter_date, scans = _letter_field_errors(filing, user)
    errors += _duplicate_errors(filing.items)
    # A placeholder keeps the per-village checks running when the number is
    # missing, so one response names every problem; nothing is kept.
    letter_number = normalize_letter_number(filing.letter_number) or "-"

    ids = list(dict.fromkeys(i.village_id for i in filing.items))
    villages = _load_villages(db, user, ids)
    filed: list[tuple[Village, AcceptanceSubmission]] = []
    for item in {i.village_id: i for i in filing.items}.values():
        village = villages.get(item.village_id)
        if village is None:
            # The same answer for "no such village" and "not yours", so ids
            # cannot be probed.
            errors.append(ItemError("not_found", village_id=item.village_id))
            continue
        try:
            submission = _file_one(
                db, user, village, item, authority=authority,
                letter_number=letter_number, letter_date=letter_date,
            )
        except flow.WorkflowError as exc:
            errors.append(ItemError(exc.code, str(exc), village_id=village.id, tech=exc.tech))
            continue
        filed.append((village, submission))

    if errors:
        raise LetterError(_failure_message(errors, len(filing.items)), errors)

    db.flush()
    _attach_scans(db, scans, [s for _v, s in filed], user)
    decided = S.decides_directly(user.role.name)
    _record_filing(db, user, authority, letter_number, filed, decided=decided)
    return LetterOutcome(
        authority=authority,
        letter_number=letter_number,
        decided=decided,
        results=[
            VillageOutcome(v.id, s.id, s.round_no, _side_status(v, authority))
            for v, s in filed
        ],
    )


def _record_filing(db: Session, user: User, authority: str, letter_number: str, filed, *, decided: bool) -> None:
    record_audit(
        db, user_id=user.id,
        action=audit_actions.REVIEWED if decided else audit_actions.SUBMITTED,
        module=MODULE, entity_type="AcceptanceSubmission", entity_id=None,
        new_value={
            "authority": authority,
            "letter_number": letter_number,
            "decided_by_filer": decided,
            "village_ids": [v.id for v, _s in filed],
            "submission_ids": [s.id for _v, s in filed],
        },
        reason=(
            "Acceptance letter recorded as decided by a coordinator/PM"
            if decided else "Acceptance letter filed"
        ),
    )
    if not decided:
        # One notification per letter, not per village.
        notify_roles(
            db, role_names=list(S.DECIDING_ROLES), type="AcceptanceBulkSubmitted",
            message=f"{authority} letter {letter_number} filed for {len(filed)} villages",
            entity_type="AcceptanceSubmission", entity_id=filed[0][1].id,
        )


# --------------------------------------------------------------------------
# Deciding
# --------------------------------------------------------------------------
def _resolve_by_ids(db: Session, user: User, authority: str, ids: list[int]) -> tuple[list[AcceptanceSubmission], list[ItemError]]:
    found = {
        s.id: s
        for s in db.execute(
            select(AcceptanceSubmission).where(AcceptanceSubmission.id.in_(ids))
        ).scalars()
    }
    visible = set(
        db.execute(
            flow.visible_villages(user, db)
            .where(Village.id.in_({s.village_id for s in found.values()}))
            .with_only_columns(Village.id)
        ).scalars()
    )
    submissions, errors = [], []
    for sid in dict.fromkeys(ids):
        submission = found.get(sid)
        if submission is None or submission.village_id not in visible or submission.authority != authority:
            errors.append(ItemError("not_found", field="submission_ids"))
            continue
        submissions.append(submission)
    return submissions, errors


def _resolve(db: Session, user: User, authority: str, letter_number: str | None, submission_ids: list[int] | None):
    if bool(letter_number) == bool(submission_ids):
        raise LetterError(
            "Give a letter number or submission ids, not both",
            [ItemError("invalid_target", field="letter_number")],
        )
    if submission_ids:
        return _resolve_by_ids(db, user, authority, submission_ids)
    ids = rounds.confirmable_on_letter(
        db, user, authority=authority, letter_number=normalize_letter_number(letter_number)
    )
    if not ids:
        raise LetterError(
            "Nothing on this letter is waiting for you",
            [ItemError("nothing_to_review", field="letter_number")],
        )
    return _resolve_by_ids(db, user, authority, ids)


def _reason_errors(items: list[ReviewItem], shared: str | None, submissions) -> list[ItemError]:
    """Return needs a reason on every filing: its own, or the shared one."""
    village_of = {s.id: s.village_id for s in submissions}
    return [
        ItemError("reason_missing", "A reason is required to return", field="reason",
                  submission_id=i.submission_id, village_id=village_of.get(i.submission_id))
        for i in items
        if not ((i.reason or "").strip() or shared)
    ]


def _stale_errors(db: Session, submissions, versions: dict[int, int | None]) -> list[ItemError]:
    """Filings someone else decided, or the contractor changed or withdrew,
    since the reviewer loaded them -- with who and when, for the 409."""
    stale = [
        s for s in submissions
        if s.review_status != REVIEW_PENDING
        or (versions.get(s.id) is not None and versions[s.id] != (s.version or 0))
    ]
    if not stale:
        return []
    reviewer_ids = {s.reviewed_by for s in stale if s.reviewed_by}
    names = dict(db.execute(
        select(User.id, User.full_name).where(User.id.in_(reviewer_ids))
    ).all()) if reviewer_ids else {}
    errors = []
    for s in stale:
        at = s.reviewed_at or s.updated_at
        errors.append(ItemError(
            "stale", "Already decided or changed by someone else",
            submission_id=s.id, village_id=s.village_id,
            decided_by=names.get(s.reviewed_by),
            decided_at=at.isoformat() if at else None,
            status=_side_status(s.village, s.authority) if s.village else None,
        ))
    return errors


def _evidence_errors(submissions) -> list[ItemError]:
    return [
        ItemError("evidence_unchecked",
                  "This filing has no evidence file: tick that you checked it outside UEP",
                  field="evidence_checked_outside", submission_id=s.id, village_id=s.village_id)
        for s in submissions if not s.evidence
    ]


def review_letter(
    db: Session, user: User, *, authority: str, decision: str,
    letter_number: str | None = None, submission_ids: list[int] | None = None,
    reason: str | None = None, items: list[ReviewItem] | None = None,
    shared_reason: str | None = None, evidence_checked_outside: bool = False,
) -> ReviewOutcome:
    """Confirm or return pending rounds. Caller commits, or rolls back on error.

    ``items`` (UEP-16) names each filing with the version the reviewer saw
    and, on return, its own reason; ``shared_reason`` covers the rest. Any
    stale item makes the whole request a 409 listing who decided what. A
    filing without evidence is confirmed only with ``evidence_checked_outside``.
    """
    authority = _authority(authority)
    decision = str(decision).lower()
    review_status = _REVIEW_STATUS.get(decision)
    if review_status is None:
        raise LetterError("Decision must be confirm or return", [ItemError("invalid_decision", field="decision")])
    shared = (shared_reason or reason or "").strip() or None
    returning = review_status == REVIEW_RETURNED

    if items:
        if letter_number or submission_ids:
            raise LetterError(
                "Give items, or a letter number or submission ids, not both",
                [ItemError("invalid_target", field="items")],
            )
        items = list({i.submission_id: i for i in items}.values())
        submissions, errors = _resolve_by_ids(db, user, authority, [i.submission_id for i in items])
        if returning and not errors:
            reason_errors = _reason_errors(items, shared, submissions)
            if reason_errors:
                raise LetterError("Every filing returned needs a reason", reason_errors, status=422)
    else:
        if returning and not shared:
            raise LetterError("A reason is required to return", [ItemError("reason_missing", field="reason")])
        submissions, errors = _resolve(db, user, authority, letter_number, submission_ids)
        items = [ReviewItem(s.id) for s in submissions]
    if errors:
        raise LetterError("Nothing was decided", errors)

    flow.lock_villages(db, [s.village_id for s in submissions])
    for submission in submissions:
        # Read again under the lock: the version check must see the last commit.
        db.refresh(submission)
    stale = _stale_errors(db, submissions, {i.submission_id: i.version for i in items})
    if stale:
        raise LetterError(f"{len(stale)} already decided by someone else", stale)
    if not returning and not evidence_checked_outside:
        unchecked = _evidence_errors(submissions)
        if unchecked:
            raise LetterError("Some filings have no evidence file", unchecked, status=422)

    own = {i.submission_id: (i.reason or "").strip() or None for i in items}
    decided: list[AcceptanceSubmission] = []
    for submission in submissions:
        comment = (own.get(submission.id) or shared) if returning else None
        try:
            flow.review(db, submission=submission, decision=review_status, comment=comment, user=user)
        except flow.WorkflowError as exc:
            errors.append(ItemError(exc.code, str(exc), village_id=submission.village_id,
                                    submission_id=submission.id))
            continue
        decided.append(submission)
    if errors:
        raise LetterError("Nothing was decided", errors)

    _record_review(
        db, user, authority, decision, decided, shared,
        own_reasons={k: v for k, v in own.items() if v} if returning else None,
        evidence_checked_outside=evidence_checked_outside,
    )
    return ReviewOutcome(
        decision=decision,
        results=[
            VillageOutcome(s.village_id, s.id, s.round_no, _side_status(s.village, authority))
            for s in decided
        ],
    )


def _record_review(
    db: Session, user: User, authority: str, decision: str, decided, reason: str | None,
    *, own_reasons: dict[int, str] | None = None, evidence_checked_outside: bool = False,
) -> None:
    new_value = {
        "authority": authority,
        "decision": decision,
        "submission_ids": [s.id for s in decided],
        "results": {s.id: rounds.round_result(s) for s in decided},
    }
    if own_reasons:
        new_value["reasons"] = own_reasons
    if evidence_checked_outside:
        # The reviewer's word that they saw the evidence elsewhere (UEP-16 §4).
        new_value["evidence_checked_outside"] = True
        new_value["without_evidence"] = [s.id for s in decided if not s.evidence]
    record_audit(
        db, user_id=user.id,
        action=audit_actions.RETURNED if decision == DECISION_RETURN else audit_actions.REVIEWED,
        module=MODULE, entity_type="AcceptanceSubmission", entity_id=None,
        new_value=new_value,
        reason=reason,
    )
    by_filer: dict[int, int] = {}
    for submission in decided:
        if submission.submitted_by:
            by_filer[submission.submitted_by] = by_filer.get(submission.submitted_by, 0) + 1
    for filer, count in by_filer.items():
        notify(
            db, user_id=filer, type="AcceptanceReviewed",
            message=f"{authority}: {count} village(s) {'returned' if decision == DECISION_RETURN else 'decided'}",
            entity_type="AcceptanceSubmission", entity_id=decided[0].id,
        )
