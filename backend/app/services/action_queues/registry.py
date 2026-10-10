"""Every Action Center queue, defined once.

The board, the per-owner breakdown, the daily snapshot and the digest all
read :data:`QUEUES`. Adding a queue is adding one definition here; its SLA
defaults to 14 days until an administrator changes it.

A queue with ``on_board=False`` is Home's alone (with the snapshot that feeds
Home's trends): the board and the digest leave it out.

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
    HOME_QUEUES,
    REGIONAL_MANAGER,
    STAGE_GROUP,
    QueueDefinition,
    SlaKind,
    Stage,
)

_STAFF = frozenset({PM, COORDINATOR})


#: Everyone with a Home sees the acceptance headline queues, in their scope.
_HOME_ACCEPTANCE = frozenset({PM, COORDINATOR, CONTRACTOR, REGIONAL_MANAGER})


def _q(key, stage, label, short_label, url, roles, fetch, *, sla=SlaKind.CONFIGURED,
       date_kind="since", unit="sites", on_board=True):
    return QueueDefinition(
        key=key, stage=stage, label=label, short_label=short_label, url=url,
        roles=frozenset(roles), sla=sla, date_kind=date_kind, fetch=fetch,
        unit=unit, on_board=on_board,
    )


def _acceptance_queues(authority: str) -> list[QueueDefinition]:
    stage = Stage(authority.lower())
    prefix = authority.lower()
    url = acceptance.my_work_url
    return [
        _q(f"{prefix}_pending", stage, f"Open {authority} acceptance", f"Pending {authority}",
           url(authority), _HOME_ACCEPTANCE,
           acceptance.not_approved(authority), unit="villages", on_board=False),
        _q(f"{prefix}_follow_up", stage, f"Follow up with {authority}", f"{authority} follow-up",
           url(authority, S.TAB_WITH_AUTHORITY), {PM},
           acceptance.queue(authority, S.TAB_WITH_AUTHORITY, contractor_owns=False), unit="villages"),
        _q(f"{prefix}_to_file", stage, "File villages", f"{authority} to file",
           url(authority, S.TAB_NOT_FILED), {COORDINATOR, CONTRACTOR},
           acceptance.queue(authority, S.TAB_NOT_FILED, contractor_owns=True), unit="villages"),
        _q(f"{prefix}_to_validate", stage, "Validate contractor filings", f"{authority} filings",
           url(authority, S.TAB_FILLED), {COORDINATOR},
           acceptance.queue(authority, S.TAB_FILLED, contractor_owns=False), unit="villages"),
        _q(f"{prefix}_refile", stage, "Re-file rejected villages", f"{authority} re-filing",
           url(authority, S.TAB_NEW_LETTER), {CONTRACTOR},
           acceptance.queue(authority, S.TAB_NEW_LETTER, contractor_owns=True), unit="villages"),
        _q(f"{prefix}_returned", stage, "Correct returned villages", f"{authority} corrections",
           url(authority, S.TAB_RETURNED), {CONTRACTOR},
           acceptance.queue(authority, S.TAB_RETURNED, contractor_owns=True), unit="villages"),
    ]


QUEUES: tuple[QueueDefinition, ...] = (
    # --- Health Check ----------------------------------------------------
    _q("hc_assign", Stage.HC, "Assign sites", "HC assignment",
       "/health-check?tab=pool&state=ready", _STAFF, lifecycle.sites_to_assign),
    _q("hc_review", Stage.HC, "Review HC results", "HC review",
       "/health-check?tab=review", _STAFF, lifecycle.hc_results_to_review),
    _q("hc_reroutes", Stage.HC, "Decide re-routes", "Re-routes",
       "/health-check?tab=reroutes", _STAFF, lifecycle.reroute_decisions),
    _q("hc_submit", Stage.HC, "Submit health checks", "Health checks",
       "/my-health-check", {CONTRACTOR}, lifecycle.hc_to_submit),
    _q("hc_fixes", Stage.HC, "Fix assigned problems", "Fixes",
       "/my-fix-queue", {PROBLEM_OWNER}, lifecycle.fixes, sla=SlaKind.CATEGORY,
       unit="fixes"),
    # --- Drive Test ------------------------------------------------------
    _q("dt_assign", Stage.DT, "Assign drive tests", "DT assignment",
       "/drive-test?tab=assignment", _STAFF, lifecycle.dt_to_assign),
    _q("dt_review", Stage.DT, "Review DT results", "DT review",
       "/drive-test?tab=review", _STAFF, lifecycle.dt_results_to_review),
    _q("dt_todo", Stage.DT, "Drive-test sites", "Drive tests",
       "/my-drive-tests?tab=todo&status=with_contractor", {CONTRACTOR},
       lifecycle.sites_to_drive_test),
    _q("dt_redo", Stage.DT, "Redo returned drive tests", "Returned drive tests",
       "/my-drive-tests?tab=todo&status=sent_back", {CONTRACTOR},
       lifecycle.returned_to_redo),
    # --- ICT, then CRA ---------------------------------------------------
    *(q for authority in AUTHORITIES for q in _acceptance_queues(authority)),
    # --- Plans & Data ----------------------------------------------------
    _q("plans_approve", Stage.PLANS, "Approve plans", "Plan approvals",
       "/monthly-plan?tab=plans", {PM}, plans.plans_to_approve, unit="plans"),
    _q("cpm_changes", Stage.PLANS, "Validate CPM changes", "CPM changes",
       "/admin?tab=validate", {PM}, plans.cpm_changes, unit="changes"),
    _q("plan_submit", Stage.PLANS, "Submit monthly plan", "Monthly plan",
       "/monthly-plan", {CONTRACTOR}, plans.monthly_plan_to_submit,
       sla=SlaKind.DEADLINE, date_kind="due", unit="plans"),
)

QUEUES_BY_KEY: dict[str, QueueDefinition] = {q.key: q for q in QUEUES}

assert len(QUEUES_BY_KEY) == len(QUEUES), "queue keys must be unique"


def queues_for(role: str, *, home_only: bool = False) -> list[QueueDefinition]:
    """This role's board queues; with ``home_only``, Home's own queues too."""
    return [q for q in QUEUES if role in q.roles and (q.on_board or home_only)]


def home_queues_for(role: str) -> list[QueueDefinition]:
    """The queues this role's Home shows, by :data:`HOME_QUEUES`: a card with
    a key list shows those queues in that order, any other card every board
    queue of its stages."""
    mine = queues_for(role, home_only=True)
    shown = []
    for queue in mine:
        keys = HOME_QUEUES[STAGE_GROUP[queue.stage]]
        if (keys is None and queue.on_board) or (keys is not None and queue.key in keys):
            shown.append(queue)
    order = {key: i for keys in HOME_QUEUES.values() if keys for i, key in enumerate(keys)}
    return sorted(shown, key=lambda q: order.get(q.key, -1))
