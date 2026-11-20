"""Give every universe village its two cases, and keep waiting clocks right.

Run once at deploy (``python -m app.scripts.backfill_acceptance_cases``) and
on every Filing, Baskets and Home read after that, so a village that enters
the universe -- a drive test approved, a CPM import -- gets its cases without
anyone having to remember a job. Creating is idempotent: a case that exists is
never touched, and two requests racing on one village leave one case.

**Backfill mapping** (§5.1), from the cached side status
(``villages.ict_status`` / ``cra_status``, derived from the submissions):
Approved -> approved; Rejected -> rejected with no category ("Needs category"
until a coordinator sets one); anything else -> waiting.

**Dates** (§4.2): a waiting case starts at the village's Submissions
``sent_at`` (MTN letter) if it was sent, else the drive test's approval in the
app. A case with neither is *legacy*: it ages from the first CPM import
(``villages.first_seen_at``, else the earliest ``cpm_import_batches`` row),
never from CPM's old drive-test date.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance import CpmImportBatch
from app.models.acceptance_case import (
    BASKET_CONTRACTOR,
    EVENT_APPROVED,
    EVENT_CREATED,
    EVENT_REJECTED,
    STATE_APPROVED,
    STATE_REJECTED,
    STATE_WAITING,
    STATUS_EVENTS,
    AcceptanceCase,
    AcceptanceCaseEvent,
)
from app.models.acceptance_workflow import (
    AUTHORITIES,
    REVIEW_VALIDATED,
    AcceptanceEvidence,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.submission import SubmissionBatch, SubmissionItem
from app.models.workitem import DriveTest, Village, WorkItem
from app.services.action_queues.sources.acceptance import one_per_village
from app.services.submissions.follow_up import is_sent

from . import rules, scope

_STATE_OF_STATUS = {"Approved": STATE_APPROVED, "Rejected": STATE_REJECTED}


def state_for_status(stored_status: str | None) -> str:
    """The backfill mapping: the cached side status to a case state."""
    return _STATE_OF_STATUS.get(stored_status or "", STATE_WAITING)


def at_noon(day: date) -> datetime:
    """A day as a moment that stays on that day in Tehran and in UTC."""
    return datetime.combine(day, time(12), tzinfo=jalali.TEHRAN)


@dataclass(frozen=True)
class DtApproval:
    on: date
    by: int | None


@dataclass(frozen=True)
class Facts:
    """Everything the dates of a new case are read from, loaded in bulk."""

    dt: dict[int, DtApproval]          # work item -> app approval
    sent: dict[int, date]              # village -> first Submissions sent_at
    first_import: date | None


def dt_approvals(db: Session, work_item_ids) -> dict[int, DtApproval]:
    """Each work item's latest drive test approved in the app."""
    out: dict[int, DtApproval] = {}
    ids = list(work_item_ids)
    if not ids:
        return out
    rows = db.execute(
        select(DriveTest.work_item_id, DriveTest.coordinator_reviewed_at,
               DriveTest.coordinator_reviewed_by)
        .where(DriveTest.work_item_id.in_(ids), DriveTest.status == "Approved",
               DriveTest.coordinator_reviewed_at.isnot(None))
        .order_by(DriveTest.id)
    ).all()
    for wid, at, by in rows:
        out[wid] = DtApproval(rules.local_date(at), by)
    return out


def sent_dates(db: Session, village_ids) -> dict[int, date]:
    """Each village's first send to ICT HQ (Submissions, UEP-21)."""
    ids = list(village_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(SubmissionItem.village_id, func.min(SubmissionItem.sent_at))
        .select_from(SubmissionItem)
        .outerjoin(SubmissionBatch, SubmissionItem.batch_id == SubmissionBatch.id)
        .where(SubmissionItem.village_id.in_(ids), is_sent())
        .group_by(SubmissionItem.village_id)
    ).all()
    return {vid: sent for vid, sent in rows if sent}


def first_import_date(db: Session) -> date | None:
    return rules.local_date(db.scalar(select(func.min(CpmImportBatch.created_at))))


def load_facts(db: Session, work_item_ids, village_ids) -> Facts:
    return Facts(dt_approvals(db, work_item_ids), sent_dates(db, village_ids), first_import_date(db))


def legacy_date(first_seen_at, work_item_created, facts: Facts, today: date) -> date:
    return (rules.local_date(first_seen_at) or facts.first_import
            or rules.local_date(work_item_created) or today)


def waiting_start(village_id: int, dt: DtApproval | None, legacy_on: date, facts: Facts) -> date:
    """§4.2: Submissions sent_at, else the app's DT approval, else legacy."""
    return facts.sent.get(village_id) or (dt.on if dt else None) or legacy_on


# --------------------------------------------------------------------------
# The universe
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class UniverseVillage:
    village_id: int
    work_item_id: int
    ict_status: str
    cra_status: str
    first_seen_at: datetime | None
    work_item_created: datetime | None


def universe_villages(db: Session) -> list[UniverseVillage]:
    """The universe, one village per site, site type and village code."""
    rows = db.execute(
        select(Village.id, Village.work_item_id, Village.village_code, Village.ict_status,
               Village.cra_status, Village.first_seen_at, WorkItem.created_at)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .where(scope.universe_clause(db))
    ).all()
    return [UniverseVillage(r[0], r[1], r[3], r[4], r[5], r[6]) for r in one_per_village(rows)]


# --------------------------------------------------------------------------
# Backfilled verdicts
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Verdict:
    submission_id: int
    letter_no: str | None
    letter_date: date | None
    decided_on: date | None
    by: int | None
    comment: str | None
    evidence_id: int | None


def latest_verdicts(db: Session, village_ids) -> dict[tuple[int, str], Verdict]:
    """Each side's latest validated round: the letter behind its verdict."""
    ids = list(village_ids)
    if not ids:
        return {}
    out: dict[tuple[int, str], Verdict] = {}
    rows = db.execute(
        select(AcceptanceSubmission).where(
            AcceptanceSubmission.village_id.in_(ids),
            AcceptanceSubmission.review_status == REVIEW_VALIDATED,
        ).order_by(AcceptanceSubmission.round_no, AcceptanceSubmission.id)
    ).scalars().all()
    for s in rows:
        out[(s.village_id, s.authority)] = s
    sub_ids = [s.id for s in out.values()]
    reasons = _rejection_reasons(db, sub_ids)
    evidence = _first_evidence(db, sub_ids)
    return {
        key: Verdict(
            s.id, s.letter_number, s.letter_date,
            s.letter_date or rules.local_date(s.reviewed_at), s.reviewed_by,
            s.review_comment or reasons.get(s.id), evidence.get(s.id),
        )
        for key, s in out.items()
    }


def _rejection_reasons(db: Session, submission_ids: list[int]) -> dict[int, str]:
    if not submission_ids:
        return {}
    out: dict[int, str] = {}
    for sid, comment in db.execute(
        select(AcceptanceSubmissionTech.submission_id, AcceptanceSubmissionTech.comment)
        .where(AcceptanceSubmissionTech.submission_id.in_(submission_ids),
               AcceptanceSubmissionTech.comment.isnot(None))
        .order_by(AcceptanceSubmissionTech.id)
    ).all():
        out.setdefault(sid, comment)
    return out


def _first_evidence(db: Session, submission_ids: list[int]) -> dict[int, int]:
    if not submission_ids:
        return {}
    return dict(db.execute(
        select(AcceptanceEvidence.submission_id, func.min(AcceptanceEvidence.id))
        .where(AcceptanceEvidence.submission_id.in_(submission_ids))
        .group_by(AcceptanceEvidence.submission_id)
    ).all())


# --------------------------------------------------------------------------
# Creating
# --------------------------------------------------------------------------
def new_case(v: UniverseVillage, authority: str, facts: Facts, verdict: Verdict | None,
             today: date) -> tuple[AcceptanceCase, list[AcceptanceCaseEvent]]:
    """One village's case and its first events, by the backfill mapping."""
    dt = facts.dt.get(v.work_item_id)
    legacy_on = legacy_date(v.first_seen_at, v.work_item_created, facts, today)
    start = waiting_start(v.village_id, dt, legacy_on, facts)
    state = state_for_status(v.ict_status if authority == "ICT" else v.cra_status)
    decided = verdict.decided_on if verdict else None
    since = start if state == STATE_WAITING else (decided or start)
    case_row = AcceptanceCase(
        village_id=v.village_id, authority=authority, state=state,
        basket_role=BASKET_CONTRACTOR if state == STATE_WAITING else None,
        state_since=since, dt_approved_on=dt.on if dt else None, legacy=dt is None,
    )
    events = [AcceptanceCaseEvent(
        kind=EVENT_CREATED, created_at=at_noon(start),
        meta={"backfill": state, "legacy": dt is None, "legacy_on": legacy_on.isoformat(),
              "dt_approved_by": dt.by if dt else None},
    )]
    if state != STATE_WAITING:
        events.append(AcceptanceCaseEvent(
            kind=EVENT_APPROVED if state == STATE_APPROVED else EVENT_REJECTED,
            created_at=at_noon(since),
            letter_no=verdict.letter_no if verdict else None,
            letter_date=verdict.letter_date if verdict else None,
            evidence_id=verdict.evidence_id if verdict else None,
            comment=verdict.comment if verdict else None,
            actor_user_id=verdict.by if verdict else None,
            meta={"backfill": True, "submission_id": verdict.submission_id if verdict else None},
        ))
    return case_row, events


def _existing(db: Session) -> set[tuple[int, str]]:
    return set(db.execute(select(AcceptanceCase.village_id, AcceptanceCase.authority)).all())


def ensure_cases(db: Session, today: date | None = None) -> int:
    """Create every missing case. Returns how many. Caller commits."""
    today = today or rules.tehran_today()
    have = _existing(db)
    missing = [
        (v, a) for v in universe_villages(db) for a in AUTHORITIES
        if (v.village_id, a) not in have
    ]
    if missing:
        _create(db, missing, today)
    refresh_waiting_starts(db, today)
    return len(missing)


def _create(db: Session, missing: list[tuple[UniverseVillage, str]], today: date) -> None:
    villages = {v.village_id: v for v, _a in missing}
    facts = load_facts(db, {v.work_item_id for v in villages.values()}, villages)
    verdicts = latest_verdicts(db, villages)
    try:
        with db.begin_nested():
            for v, authority in missing:
                case_row, events = new_case(v, authority, facts, verdicts.get((v.village_id, authority)), today)
                db.add(case_row)
                db.flush()
                for event in events:
                    event.case_id = case_row.id
                    db.add(event)
            db.flush()
    except IntegrityError:
        # Another request created some of them first; theirs stand.
        pass


def refresh_waiting_starts(db: Session, today: date) -> int:  # noqa: ARG001 -- one signature
    """A waiting case that has never moved starts at its village's send to
    ICT HQ: a batch sent after the case was created moves the clock there.
    Only the cases whose start differs are loaded."""
    moved = select(AcceptanceCaseEvent.case_id).where(
        AcceptanceCaseEvent.kind.in_([k for k in STATUS_EVENTS if k != EVENT_CREATED])
    )
    first_sent = (
        select(SubmissionItem.village_id, func.min(SubmissionItem.sent_at).label("sent"))
        .select_from(SubmissionItem)
        .outerjoin(SubmissionBatch, SubmissionItem.batch_id == SubmissionBatch.id)
        .where(is_sent())
        .group_by(SubmissionItem.village_id)
        .subquery()
    )
    rows = db.execute(
        select(AcceptanceCase, first_sent.c.sent)
        .join(first_sent, first_sent.c.village_id == AcceptanceCase.village_id)
        .where(
            AcceptanceCase.state == STATE_WAITING,
            AcceptanceCase.id.not_in(moved),
            AcceptanceCase.state_since != first_sent.c.sent,
        )
    ).all()
    for case_row, sent in rows:
        case_row.state_since = sent
    return len(rows)
