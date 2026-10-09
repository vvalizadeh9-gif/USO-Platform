"""What this user finished: each act that takes an item off one of their queues.

"Done" is read from the actor and timestamp columns the domain tables already
keep, so nothing new is written anywhere and nothing can be forgotten on a
write path. A rule is defined once per *completing act*, not per queue:
filing, re-filing and correcting a village are three queues but one act (a
submission), and a per-queue rule would count that act three times.

A rule applies to a user when their board has any queue it drains. Two
queues have no rule, deliberately:

* **Decide re-routes** -- ``reroute_by`` is who *proposed* the re-route; the
  PM's decision records no actor.
* **Follow up with ICT/CRA** -- the item leaves when the authority answers,
  which is not the PM's act.

Counts are acts, not distinct items: a plan returned and later approved by the
same PM is two things that person did.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.acceptance import CpmChangeRequest
from app.models.acceptance_workflow import AUTHORITIES, AcceptanceSubmission
from app.models.health_check import HcAssignment, HcRemediation, HcTask
from app.models.monthly_plan import ContractorMonthlyPlan
from app.models.reference import User
from app.models.workitem import Assignment, DriveTest
from app.services.action_queues import sla
from app.services.action_queues.registry import queues_for

#: Builds the selects of one rule. Each yields ``(row id, when)`` rows from
#: ``since`` on; ids de-duplicate a row that two selects both reach.
SelectsFor = Callable[[User, datetime], list[Select]]


@dataclass(frozen=True)
class DoneRule:
    key: str
    #: The queues this act takes items off.
    drains: frozenset[str]
    selects: SelectsFor


def _acceptance_keys(*suffixes: str) -> frozenset[str]:
    return frozenset(f"{a.lower()}_{s}" for a in AUTHORITIES for s in suffixes)


RULES: tuple[DoneRule, ...] = (
    DoneRule("hc_assigned", frozenset({"hc_assign"}), lambda u, since: [
        # One assignment carries many sites; each site left the pool.
        select(HcTask.id, HcAssignment.assigned_at)
        .join(HcAssignment, HcTask.hc_assignment_id == HcAssignment.id)
        .where(HcAssignment.assigned_by == u.id, HcAssignment.assigned_at >= since),
    ]),
    DoneRule("hc_reviewed", frozenset({"hc_review"}), lambda u, since: [
        select(HcTask.id, HcTask.reviewed_at)
        .where(HcTask.reviewed_by == u.id, HcTask.reviewed_at >= since),
    ]),
    DoneRule("hc_submitted", frozenset({"hc_submit"}), lambda u, since: [
        select(HcTask.id, HcTask.completed_at)
        .join(HcAssignment, HcTask.hc_assignment_id == HcAssignment.id)
        .where(HcAssignment.contractor_id == u.contractor_id, HcTask.completed_at >= since),
    ]),
    DoneRule("fixes_closed", frozenset({"hc_fixes"}), lambda u, since: [
        select(HcRemediation.id, HcRemediation.closed_at)
        .where(HcRemediation.closed_by == u.id, HcRemediation.closed_at >= since),
    ]),
    DoneRule("dt_assigned", frozenset({"dt_assign"}), lambda u, since: [
        select(Assignment.id, Assignment.assigned_at)
        .where(Assignment.assigned_by == u.id, Assignment.assigned_at >= since),
    ]),
    DoneRule("dt_reviewed", frozenset({"dt_review"}), lambda u, since: [
        select(DriveTest.id, DriveTest.coordinator_reviewed_at)
        .where(DriveTest.coordinator_reviewed_by == u.id,
               DriveTest.coordinator_reviewed_at >= since),
        select(DriveTest.id, DriveTest.pm_reviewed_at)
        .where(DriveTest.pm_reviewed_by == u.id, DriveTest.pm_reviewed_at >= since),
    ]),
    DoneRule("dt_submitted", frozenset({"dt_todo", "dt_redo"}), lambda u, since: [
        select(DriveTest.id, DriveTest.submitted_at)
        .join(Assignment, Assignment.work_item_id == DriveTest.work_item_id)
        .where(Assignment.contractor_id == u.contractor_id, Assignment.is_active.is_(True),
               DriveTest.submitted_at >= since),
    ]),
    DoneRule("acceptance_filed", _acceptance_keys("to_file", "refile", "returned"), lambda u, since: [
        select(AcceptanceSubmission.id, AcceptanceSubmission.submitted_at)
        .where(AcceptanceSubmission.submitted_by == u.id,
               AcceptanceSubmission.submitted_at >= since),
    ]),
    DoneRule("acceptance_validated", _acceptance_keys("to_validate"), lambda u, since: [
        select(AcceptanceSubmission.id, AcceptanceSubmission.reviewed_at)
        .where(AcceptanceSubmission.reviewed_by == u.id,
               AcceptanceSubmission.reviewed_at >= since),
    ]),
    DoneRule("plans_decided", frozenset({"plans_approve"}), lambda u, since: [
        select(ContractorMonthlyPlan.id, ContractorMonthlyPlan.decided_at)
        .where(ContractorMonthlyPlan.decided_by == u.id,
               ContractorMonthlyPlan.decided_at >= since),
    ]),
    DoneRule("cpm_decided", frozenset({"cpm_changes"}), lambda u, since: [
        select(CpmChangeRequest.id, CpmChangeRequest.decided_at)
        .where(CpmChangeRequest.decided_by == u.id, CpmChangeRequest.decided_at >= since),
    ]),
    DoneRule("plan_submitted", frozenset({"plan_submit"}), lambda u, since: [
        select(ContractorMonthlyPlan.id, ContractorMonthlyPlan.submitted_at)
        .where(ContractorMonthlyPlan.submitted_by == u.id,
               ContractorMonthlyPlan.submitted_at >= since),
    ]),
)


def rules_for(board_role: str) -> list[DoneRule]:
    keys = {q.key for q in queues_for(board_role)}
    return [r for r in RULES if r.drains & keys]


def start_of_day(day: date) -> datetime:
    """Midnight in Tehran, the day "today" means everywhere on the board."""
    return datetime.combine(day, time.min, tzinfo=sla.TEHRAN)


def done_by_day(db: Session, user: User, board_role: str, today: date) -> tuple[int, int]:
    """(done today, done yesterday) for this user, in Tehran days.

    One query per select of each rule that applies -- a fixed handful,
    whatever the size of the programme.
    """
    yesterday = today - timedelta(days=1)
    since = start_of_day(yesterday)
    counts = {today: 0, yesterday: 0}
    for rule in rules_for(board_role):
        seen: set = set()
        for stmt in rule.selects(user, since):
            for row_id, when in db.execute(stmt).all():
                if row_id in seen or when is None:
                    continue
                seen.add(row_id)
                day = sla.as_datetime(when).astimezone(sla.TEHRAN).date()
                if day in counts:
                    counts[day] += 1
    return counts[today], counts[yesterday]
