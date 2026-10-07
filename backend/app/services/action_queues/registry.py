"""Every Action Center queue, defined once.

The board, the per-owner breakdown, the daily snapshot and the digest all
read :data:`QUEUES`. Adding a queue is adding one definition here; its SLA
defaults to 14 days until an administrator changes it.

Order matters: within a stage, tickets appear in the order listed.
"""
from __future__ import annotations

from app.models.acceptance_workflow import AUTHORITIES
from app.services import my_work_status as S
from app.services.action_queues.sources import acceptance, lifecycle, plans
from app.services.action_queues.types import (
    CONTRACTOR,
    COORDINATOR,
    PM,
    PROBLEM_OWNER,
    QueueDefinition,
    SlaKind,
    Stage,
)

_STAFF = frozenset({PM, COORDINATOR})


def _q(key, stage, label, url, roles, fetch, *, sla=SlaKind.CONFIGURED, date_kind="since"):
    return QueueDefinition(
        key=key, stage=stage, label=label, url=url, roles=frozenset(roles),
        sla=sla, date_kind=date_kind, fetch=fetch,
    )


def _acceptance_queues(authority: str) -> list[QueueDefinition]:
    stage = Stage(authority.lower())
    prefix = authority.lower()
    url = acceptance.my_work_url
    return [
        _q(f"{prefix}_follow_up", stage, f"Follow up with {authority}",
           url(authority, S.TAB_WITH_AUTHORITY), {PM},
           acceptance.queue(authority, S.TAB_WITH_AUTHORITY, contractor_owns=False)),
        _q(f"{prefix}_to_file", stage, "File villages",
           url(authority, S.TAB_NOT_FILED), {COORDINATOR, CONTRACTOR},
           acceptance.queue(authority, S.TAB_NOT_FILED, contractor_owns=True)),
        _q(f"{prefix}_to_validate", stage, "Validate contractor filings",
           url(authority, S.TAB_FILLED), {COORDINATOR},
           acceptance.queue(authority, S.TAB_FILLED, contractor_owns=False)),
        _q(f"{prefix}_refile", stage, "Re-file rejected villages",
           url(authority, S.TAB_NEW_LETTER), {CONTRACTOR},
           acceptance.queue(authority, S.TAB_NEW_LETTER, contractor_owns=True)),
        _q(f"{prefix}_returned", stage, "Correct returned villages",
           url(authority, S.TAB_RETURNED), {CONTRACTOR},
           acceptance.queue(authority, S.TAB_RETURNED, contractor_owns=True)),
    ]


QUEUES: tuple[QueueDefinition, ...] = (
    # --- Health Check ----------------------------------------------------
    _q("hc_assign", Stage.HC, "Assign sites",
       "/health-check?tab=pool&state=ready", _STAFF, lifecycle.sites_to_assign),
    _q("hc_review", Stage.HC, "Review HC results",
       "/health-check?tab=review", _STAFF, lifecycle.hc_results_to_review),
    _q("hc_reroutes", Stage.HC, "Decide re-routes",
       "/health-check?tab=reroutes", _STAFF, lifecycle.reroute_decisions),
    _q("hc_submit", Stage.HC, "Submit health checks",
       "/my-health-check", {CONTRACTOR}, lifecycle.hc_to_submit),
    _q("hc_fixes", Stage.HC, "Fix assigned problems",
       "/my-fix-queue", {PROBLEM_OWNER}, lifecycle.fixes, sla=SlaKind.CATEGORY),
    # --- Drive Test ------------------------------------------------------
    _q("dt_assign", Stage.DT, "Assign drive tests",
       "/drive-test?tab=assignment", _STAFF, lifecycle.dt_to_assign),
    _q("dt_review", Stage.DT, "Review DT results",
       "/drive-test?tab=review", _STAFF, lifecycle.dt_results_to_review),
    _q("dt_todo", Stage.DT, "Drive-test sites",
       "/my-drive-tests?tab=todo&status=with_contractor", {CONTRACTOR},
       lifecycle.sites_to_drive_test),
    _q("dt_redo", Stage.DT, "Redo returned drive tests",
       "/my-drive-tests?tab=todo&status=sent_back", {CONTRACTOR},
       lifecycle.returned_to_redo),
    # --- ICT, then CRA ---------------------------------------------------
    *(q for authority in AUTHORITIES for q in _acceptance_queues(authority)),
    # --- Plans & Data ----------------------------------------------------
    _q("plans_approve", Stage.PLANS, "Approve plans",
       "/monthly-plan?tab=plans", {PM}, plans.plans_to_approve),
    _q("cpm_changes", Stage.PLANS, "Validate CPM changes",
       "/admin?tab=validate", {PM}, plans.cpm_changes),
    _q("plan_submit", Stage.PLANS, "Submit monthly plan",
       "/monthly-plan", {CONTRACTOR}, plans.monthly_plan_to_submit,
       sla=SlaKind.DEADLINE, date_kind="due"),
)

QUEUES_BY_KEY: dict[str, QueueDefinition] = {q.key: q for q in QUEUES}

assert len(QUEUES_BY_KEY) == len(QUEUES), "queue keys must be unique"


def queues_for(board_role: str) -> list[QueueDefinition]:
    return [q for q in QUEUES if board_role in q.roles]
