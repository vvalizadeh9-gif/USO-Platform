"""Explorer: one site's record -- passport, journey, acceptance, village history.

Read-only. Loads one work item under the caller's scope and answers in a
fixed number of queries however many villages the site has: the work item
with its graph (``selectinload``), its villages with their acceptance rows,
then this site's rounds and request letters as plain columns.

Nothing is redefined here. "هدف" is ``cpm_columns.is_pure_target``, a side's
state is My Work's cached column read through ``my_work_status``, an approval
date is ``acceptance_workflow.authority_verdict_date``, and acceptance starts
when the drive test is Done (``acceptance_universe``). The arithmetic lives in
``explorer_journey``.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import jalali
from app.models.acceptance_workflow import (
    AcceptanceAuthorityRequest,
    AcceptanceSubmission,
)
from app.models.reference import User
from app.models.workitem import Site, Village, WorkItem
from app.services import acceptance_workflow as flow
from app.services import cpm_columns as C
from app.services import explorer_journey as J
from app.services import my_work_status as S
from app.services.explorer_village_history import village_history
from app.services.submissions import journey as submission_journey
from app.services.drive_test_analytics import is_dt_done
from app.services.performance.periods import tehran_day
from app.services.tech_parser import parse_technologies
from app.services.visibility import explorer_work_item_ids
from app.services.work_item_rows import active_drive_test, relevant_assignment

AUTHORITIES = ("ICT", "CRA")


class SiteNotFound(LookupError):
    """No such live work item."""


class SiteForbidden(PermissionError):
    """A live work item outside this user's Explorer scope (answered 403)."""


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------
def _work_item(db: Session, user: User, work_item_id: int) -> WorkItem:
    stmt = select(WorkItem).where(
        WorkItem.id == work_item_id,
        WorkItem.deleted_at.is_(None),
        WorkItem.id.in_(explorer_work_item_ids(user, db)),
    )
    stmt = stmt.options(
        selectinload(WorkItem.site).selectinload(Site.province),
        selectinload(WorkItem.assignments),
        selectinload(WorkItem.drive_tests),
        selectinload(WorkItem.hc_tasks),
        selectinload(WorkItem.health_checks),
        selectinload(WorkItem.dt_sc_contractor),
        selectinload(WorkItem.site_contractor),
    )
    wi = db.execute(stmt).scalars().one_or_none()
    if wi is None:
        raise_missing(db, work_item_id)
    return wi


def raise_missing(db: Session, work_item_id: int) -> None:
    """Why a site could not be loaded: :class:`SiteForbidden` when it exists
    but is outside the caller's scope (a 403, the no-access screen), else
    :class:`SiteNotFound`."""
    exists = db.execute(
        select(WorkItem.id).where(
            WorkItem.id == work_item_id, WorkItem.deleted_at.is_(None)
        )
    ).first()
    if exists is not None:
        raise SiteForbidden(work_item_id)
    raise SiteNotFound(work_item_id)


def _hadaf_villages(db: Session, wi: WorkItem) -> list[Village]:
    """The site's live هدف villages, acceptance rows attached, in code order."""
    rows = db.execute(
        select(Village)
        .where(Village.work_item_id == wi.id, Village.deleted_at.is_(None))
        .options(selectinload(Village.acceptances))
        .order_by(Village.village_code, Village.id)
    ).scalars().all()
    return [v for v in rows if C.is_pure_target(v.target_classification)]


def _rounds(db: Session, village_ids: list[int]) -> dict[tuple[int, str], list[J.RoundFact]]:
    out: dict[tuple[int, str], list[J.RoundFact]] = {}
    if not village_ids:
        return out
    s = AcceptanceSubmission
    for r in db.execute(
        select(s.village_id, s.authority, s.round_no, s.review_status,
               s.submitted_at, s.reviewed_at)
        .where(s.village_id.in_(village_ids))
    ):
        out.setdefault((r.village_id, r.authority), []).append(J.RoundFact(
            round_no=r.round_no,
            review_status=r.review_status,
            submitted_on=tehran_day(r.submitted_at),
            reviewed_on=tehran_day(r.reviewed_at),
        ))
    return out


def _requests(db: Session, village_ids: list[int]) -> dict[tuple[int, str], list[J.RequestFact]]:
    out: dict[tuple[int, str], list[J.RequestFact]] = {}
    if not village_ids:
        return out
    r = AcceptanceAuthorityRequest
    for row in db.execute(
        select(r.village_id, r.authority, r.sent_at, r.letter_date)
        .where(r.village_id.in_(village_ids))
    ):
        out.setdefault((row.village_id, row.authority), []).append(
            J.RequestFact(sent_on=tehran_day(row.sent_at), letter_date=row.letter_date)
        )
    return out


# --------------------------------------------------------------------------
# General information
# --------------------------------------------------------------------------
def on_air_date(wi: WorkItem) -> date | None:
    """CPM's Gregorian launch date, else its Shamsi one converted."""
    if wi.launch_date_gregorian is not None:
        return wi.launch_date_gregorian
    try:
        return jalali.parse_shamsi(wi.launch_date_shamsi)
    except ValueError:
        return None


def _general(wi: WorkItem, hadaf_count: int) -> dict:
    site = wi.site
    return {
        "on_air_date": on_air_date(wi),
        "dt_date": wi.dt_date_gregorian,
        "site_contractor": wi.site_contractor.name if wi.site_contractor else None,
        "dt_contractor": wi.dt_sc_contractor.name if wi.dt_sc_contractor else None,
        "requested_technology": parse_technologies(wi.requested_technology),
        "province": site.province.name if site is not None and site.province else None,
        "site_type": wi.site_type,
        "hadaf_villages": hadaf_count,
    }


# --------------------------------------------------------------------------
# Journey
# --------------------------------------------------------------------------
def health_check_date(wi: WorkItem) -> date | None:
    """When the site last passed its health check.

    The current workflow's checks (``hc_tasks``, a Ready result) first; the
    legacy ``health_checks`` table only for data from before it.
    """
    passed = [
        t.completed_at for t in wi.hc_tasks
        if t.completed_at is not None and t.overall_result == "Ready"
    ]
    if not passed:
        passed = [
            h.checked_at for h in wi.health_checks
            if h.status == "Ready" and h.checked_at is not None
        ]
    return max(tehran_day(moment) for moment in passed) if passed else None


def approval_sides(village) -> dict:
    """A village as the step facts read it: whether each side is approved.

    ``explorer_journey.side_status`` calls a side approved exactly when My
    Work's cached column does, so this is the same answer without the rounds
    and letters the record's full side needs (``services.lifecycle_stage``).
    ``village`` is a Village or any row with its ``ict_status``/``cra_status``.
    """
    return {
        authority.lower(): {
            "status": (
                J.SIDE_APPROVED
                if S.display_status(getattr(village, f"{authority.lower()}_status")) == S.APPROVED
                else J.SIDE_PENDING
            ),
            "decided_date": None,
        }
        for authority in AUTHORITIES
    }


def journey_steps(
    wi: WorkItem, villages: list[dict], sent_on: date | None, today: date
) -> list[dict]:
    """The step path: one rule for the record page and the list's stage."""
    return J.build_steps(_step_facts(wi, villages, is_dt_done(wi), sent_on), today)


def _step_facts(
    wi: WorkItem, villages: list[dict], accepting: bool, sent_on: date | None = None
) -> list[J.StepFact]:
    assignment = relevant_assignment(wi)
    hc_date = health_check_date(wi)
    accepted = accepting and bool(villages) and all(J.is_fully_approved(v) for v in villages)
    return [
        J.StepFact(J.STEP_ON_AIR, C.is_onair_stage(wi.last_stage), on_air_date(wi)),
        J.StepFact(J.STEP_HEALTH_CHECK, hc_date is not None, hc_date),
        J.StepFact(
            J.STEP_ASSIGNED,
            assignment is not None,
            tehran_day(assignment.assigned_at) if assignment else None,
        ),
        J.StepFact(J.STEP_DT_DONE, is_dt_done(wi), wi.dt_date_gregorian),
        J.StepFact(J.STEP_SENT_TO_ICT, sent_on is not None, sent_on),
        J.StepFact(
            J.STEP_ACCEPTANCE, accepted, J.acceptance_done_on(villages) if accepted else None
        ),
    ]


# --------------------------------------------------------------------------
# Villages
# --------------------------------------------------------------------------
def _rejected_on(village: Village, authority: str) -> date | None:
    status, when = f"{authority.lower()}_status", f"{authority.lower()}_date"
    dates = [
        getattr(a, when) for a in village.acceptances
        if getattr(a, status) == flow.REJECTED and getattr(a, when) is not None
    ]
    return max(dates) if dates else None


def _village(village: Village, wi: WorkItem, rounds, requests, today: date) -> dict:
    out = {"id": village.id, "code": village.village_code, "name": village.village_name}
    for authority in AUTHORITIES:
        key = (village.id, authority)
        facts = J.SideFacts(
            stored_status=getattr(village, f"{authority.lower()}_status"),
            approved_on=flow.authority_verdict_date(village, authority),
            rejected_on=_rejected_on(village, authority),
            rounds=tuple(rounds.get(key, ())),
            requests=tuple(requests.get(key, ())),
            dt_date=wi.dt_date_gregorian,
        )
        out[authority.lower()] = J.side_status(facts, today)
    return out


def _attach_cases(db: Session, user: User, villages: list[dict]) -> None:
    """UEP-22: each side's acceptance case -- state, basket and days in it."""
    from app.services.acceptance_cases.history import case_summaries

    found = case_summaries(db, user, [v["id"] for v in villages])
    for village in villages:
        for authority in AUTHORITIES:
            village[authority.lower()]["case"] = found.get((village["id"], authority))


def _workflow(wi: WorkItem) -> dict:
    """What the Take action drawer needs: the same facts the old detail
    page gated its forms on."""
    dt = active_drive_test(wi)
    return {
        "current_stage": wi.current_stage,
        "active_drive_test_id": dt.id if dt else None,
        "dt_submission_date": dt.execution_date if dt else None,
    }


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
def site_record(
    db: Session, user: User, work_item_id: int, today: date | None = None
) -> dict:
    """The whole record page for one site. Raises :class:`SiteNotFound`."""
    today = today or jalali.tehran_today()
    wi = _work_item(db, user, work_item_id)
    hadaf = _hadaf_villages(db, wi)
    ids = [v.id for v in hadaf]
    rounds, requests = _rounds(db, ids), _requests(db, ids)
    villages = [_village(v, wi, rounds, requests, today) for v in hadaf]
    _attach_cases(db, user, villages)

    accepting = is_dt_done(wi)
    sends = submission_journey.site_sends(db, wi.id)
    steps = journey_steps(wi, villages, submission_journey.first_sent(sends), today)
    return {
        "id": wi.id,
        "site_code": wi.site.site_code if wi.site else None,
        "status": J.site_status(steps),
        "general": _general(wi, len(hadaf)),
        "journey": {
            "steps": steps,
            "aging": J.aging(steps, villages if accepting else [], today),
            "lanes": J.lanes(villages),
            "sent_to_ict": sends,
        },
        "acceptance_started": accepting,
        "villages": villages,
        "counts": J.counts(villages),
        "village_history": village_history(db, wi.id, {v.village_code: v.village_name for v in hadaf}),
        "workflow": _workflow(wi),
    }
