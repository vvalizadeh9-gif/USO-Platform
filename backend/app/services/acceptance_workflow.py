"""The acceptance submission workflow: submit, review, and derive status.

Two people can put an approval into UEP — a contractor who obtained it, or a
coordinator following up with the province or region themselves — and in both
cases the same thing happens: a *claim* is recorded, and a coordinator or PM
turns it into a *fact*. Nothing a contractor types reaches the ``acceptances``
table until someone validates it, so a mistaken submission can never move a
date that has contractual consequences.

The rules that decide a verdict were set by the product owner and are not
negotiable in code:

* A village is judged only on the technologies **CPM requested** for its site.
  Asking about, or recording, a technology nobody requested is a data error.
* **Any** rejected technology rejects the whole village for that authority.
  A village approved for 3G and rejected for 4G is a rejected village.
* A village is finished only when ICT **and** CRA have both approved it.
* A site is Closed when all of its villages are approved, Open — Partial when
  some are, and Open when none are.
* Acceptance is the approval of completed drive-test work, so a site whose
  drive test is not Done cannot be submitted at all.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.acceptance import Acceptance
from app.models.acceptance_workflow import (
    AUTHORITIES,
    CLAIM_APPROVED,
    CLAIM_REJECTED,
    CLAIMS,
    REVIEW_PENDING,
    REVIEW_RETURNED,
    REVIEW_VALIDATED,
    REVIEW_WITHDRAWN,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.reference import User
from app.models.workitem import Village, WorkItem
from app.services.tech_parser import parse_technologies
from app.services.visibility import apply_work_item_scope

# Verdicts. Deliberately the same three words the ``acceptances`` table uses.
APPROVED = "Approved"
REJECTED = "Rejected"
PENDING = "Pending"

# Site rollup.
SITE_CLOSED = "Closed"
SITE_PARTIAL = "Open - Partial"
SITE_OPEN = "Open"

# Marks an ``acceptances`` verdict as decided in the app rather than seeded
# from the workbook. See models/acceptance.py for why this is recorded.
SOURCE_APP = "App"

# Acceptance is the approval step for work the drive test has finished.
DT_DONE = "Done"


class WorkflowError(ValueError):
    """A rule violation, with a message meant for the person who caused it."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Scope
# --------------------------------------------------------------------------
def visible_villages(user: User, db: Session) -> Select:
    """A ``Village`` select restricted to what this user may see.

    Built on ``apply_work_item_scope`` rather than re-deriving the rules, so a
    contractor sees exactly the villages of the sites assigned to them and a
    coordinator sees exactly their provinces — the requirement that a
    contractor reaches only their own villages is inherited, not re-invented.
    """
    work_items = select(WorkItem.id).where(WorkItem.deleted_at.is_(None))
    work_items = apply_work_item_scope(work_items, user, db)
    return select(Village).where(
        Village.deleted_at.is_(None),
        Village.work_item_id.in_(work_items),
    )


def may_see_village(db: Session, user: User, village_id: int) -> bool:
    stmt = visible_villages(user, db).where(Village.id == village_id)
    return db.execute(stmt.with_only_columns(Village.id)).first() is not None


# --------------------------------------------------------------------------
# Verdicts
# --------------------------------------------------------------------------
def requested_technologies(village: Village) -> list[str]:
    """The technologies CPM requested for this village's site."""
    work_item = village.work_item
    if work_item is None:
        return []
    return parse_technologies(work_item.requested_technology)


def authority_verdict(village: Village, authority: str) -> str:
    """This village's ICT or CRA verdict, across every requested technology.

    Rejected wins over everything: one rejected technology rejects the village.
    """
    technologies = requested_technologies(village)
    if not technologies:
        return PENDING

    field = f"{authority.lower()}_status"
    by_tech = {a.technology: a for a in village.acceptances}
    statuses = [
        getattr(by_tech[t], field) if t in by_tech else PENDING for t in technologies
    ]

    if REJECTED in statuses:
        return REJECTED
    if all(s == APPROVED for s in statuses):
        return APPROVED
    return PENDING


def village_verdict(village: Village) -> str:
    """Approved only when both authorities approved; Rejected if either did not."""
    ict = authority_verdict(village, "ICT")
    cra = authority_verdict(village, "CRA")
    if REJECTED in (ict, cra):
        return REJECTED
    if ict == APPROVED and cra == APPROVED:
        return APPROVED
    return PENDING


def site_status(work_item: WorkItem) -> str:
    """Closed / Open - Partial / Open, rolled up from the site's villages."""
    villages = [v for v in work_item.villages if v.deleted_at is None]
    if not villages:
        return SITE_OPEN
    verdicts = [village_verdict(v) for v in villages]
    if all(v == APPROVED for v in verdicts):
        return SITE_CLOSED
    if any(v == APPROVED for v in verdicts):
        return SITE_PARTIAL
    return SITE_OPEN


# --------------------------------------------------------------------------
# Submitting
# --------------------------------------------------------------------------
def _validate_claims(village: Village, claims: list[dict]) -> list[dict]:
    """Check a set of per-technology claims against what CPM requested.

    Returns the claims in the requested-technology order. Raises for a missing
    technology, an unrequested one, an unknown verdict, or a rejection with no
    stated reason.
    """
    requested = requested_technologies(village)
    if not requested:
        raise WorkflowError(
            "This village's site has no requested technology in CPM, so there "
            "is nothing to approve"
        )

    given = {}
    for claim in claims:
        technology = str(claim.get("technology", "")).upper().strip()
        if technology in given:
            raise WorkflowError(f"{technology} was given twice")
        given[technology] = claim

    unexpected = sorted(set(given) - set(requested))
    if unexpected:
        raise WorkflowError(
            f"{', '.join(unexpected)} was not requested for this site "
            f"(requested: {', '.join(requested)})"
        )
    missing = [t for t in requested if t not in given]
    if missing:
        raise WorkflowError(f"A status is required for {', '.join(missing)}")

    ordered = []
    for technology in requested:
        claim = given[technology]
        status = str(claim.get("claimed_status", "")).strip().title()
        if status not in CLAIMS:
            raise WorkflowError(
                f"{technology} status must be {' or '.join(CLAIMS)}"
            )
        comment = (claim.get("comment") or "").strip() or None
        if status == CLAIM_REJECTED and not comment:
            raise WorkflowError(
                f"A comment is required explaining why {technology} was rejected"
            )
        ordered.append(
            {"technology": technology, "claimed_status": status, "comment": comment}
        )
    return ordered


def _open_submission(
    db: Session, village_id: int, authority: str
) -> AcceptanceSubmission | None:
    return db.execute(
        select(AcceptanceSubmission).where(
            AcceptanceSubmission.village_id == village_id,
            AcceptanceSubmission.authority == authority,
            AcceptanceSubmission.review_status == REVIEW_PENDING,
        )
    ).scalar_one_or_none()


def _next_round(db: Session, village_id: int, authority: str) -> int:
    rounds = db.execute(
        select(AcceptanceSubmission.round_no).where(
            AcceptanceSubmission.village_id == village_id,
            AcceptanceSubmission.authority == authority,
        )
    ).scalars().all()
    return (max(rounds) + 1) if rounds else 1


def submit(
    db: Session,
    *,
    village: Village,
    authority: str,
    letter_number: str,
    letter_date: date | None,
    claims: list[dict],
    user: User,
    source: str,
) -> AcceptanceSubmission:
    """Record a claimed ICT or CRA verdict for one village. Caller commits."""
    authority = str(authority).upper().strip()
    if authority not in AUTHORITIES:
        raise WorkflowError(f"Authority must be {' or '.join(AUTHORITIES)}")

    work_item = village.work_item
    if work_item is None or work_item.deleted_at is not None:
        raise WorkflowError("This village is not attached to an active site")
    if work_item.dt_status != DT_DONE:
        raise WorkflowError(
            "Acceptance can only be submitted once the drive test is Done"
        )

    letter_number = (letter_number or "").strip()
    if not letter_number:
        raise WorkflowError("A letter number is required")

    if _open_submission(db, village.id, authority) is not None:
        raise WorkflowError(
            f"A {authority} submission for this village is already awaiting review"
        )
    if authority_verdict(village, authority) == APPROVED:
        raise WorkflowError(
            f"This village is already {authority}-approved for every requested "
            "technology"
        )

    validated = _validate_claims(village, claims)

    submission = AcceptanceSubmission(
        village_id=village.id,
        authority=authority,
        round_no=_next_round(db, village.id, authority),
        letter_number=letter_number,
        letter_date=letter_date,
        source=source,
        review_status=REVIEW_PENDING,
        submitted_by=user.id,
        submitted_at=_now(),
    )
    submission.technologies = [AcceptanceSubmissionTech(**c) for c in validated]
    db.add(submission)
    return submission


def update(
    db: Session,
    *,
    submission: AcceptanceSubmission,
    letter_number: str,
    letter_date: date | None,
    claims: list[dict],
) -> AcceptanceSubmission:
    """Correct a submission that has not been reviewed yet. Caller commits."""
    if submission.review_status != REVIEW_PENDING:
        raise WorkflowError("Only a submission awaiting review can be changed")

    letter_number = (letter_number or "").strip()
    if not letter_number:
        raise WorkflowError("A letter number is required")

    validated = _validate_claims(submission.village, claims)

    submission.letter_number = letter_number
    submission.letter_date = letter_date
    # Replaced wholesale rather than merged: a correction states the complete
    # set of verdicts, and delete-orphan clears what is no longer claimed.
    submission.technologies = [AcceptanceSubmissionTech(**c) for c in validated]
    return submission


def withdraw(db: Session, *, submission: AcceptanceSubmission) -> AcceptanceSubmission:
    """Take back a submission before anyone has reviewed it. Caller commits."""
    if submission.review_status != REVIEW_PENDING:
        raise WorkflowError("Only a submission awaiting review can be withdrawn")
    submission.review_status = REVIEW_WITHDRAWN
    return submission


# --------------------------------------------------------------------------
# Reviewing
# --------------------------------------------------------------------------
def _project(db: Session, submission: AcceptanceSubmission) -> None:
    """Write a validated submission through to the ``acceptances`` table.

    This is the only path by which a verdict reaches the table the Acceptance
    dashboard counts.
    """
    village = submission.village
    authority = submission.authority.lower()
    by_tech = {a.technology: a for a in village.acceptances}

    for claim in submission.technologies:
        row = by_tech.get(claim.technology)
        if row is None:
            row = Acceptance(technology=claim.technology)
            village.acceptances.append(row)
            by_tech[claim.technology] = row
        setattr(row, f"{authority}_status", claim.claimed_status)
        setattr(row, f"{authority}_date", submission.letter_date)
        setattr(row, f"{authority}_source", SOURCE_APP)


def review(
    db: Session,
    *,
    submission: AcceptanceSubmission,
    decision: str,
    comment: str | None,
    user: User,
) -> AcceptanceSubmission:
    """Validate a submission, or return it to the submitter. Caller commits."""
    if submission.review_status != REVIEW_PENDING:
        raise WorkflowError("This submission has already been reviewed")

    decision = str(decision).strip().title()
    comment = (comment or "").strip() or None

    if decision == REVIEW_VALIDATED:
        _project(db, submission)
    elif decision == REVIEW_RETURNED:
        if not comment:
            raise WorkflowError(
                "A reason is required when returning a submission, so the "
                "submitter knows what to correct"
            )
    else:
        raise WorkflowError(
            f"Decision must be {REVIEW_VALIDATED} or {REVIEW_RETURNED}"
        )

    submission.review_status = decision
    submission.review_comment = comment
    submission.reviewed_by = user.id
    submission.reviewed_at = _now()
    return submission
