"""Every pending-work queue, defined once.

Home, the app rail counts, the daily snapshot, the digest and the Admin SLA
settings all read :data:`QUEUES`. Adding a queue is adding one definition here; its SLA
defaults to 14 days until an administrator changes it.

A queue with ``on_board=False`` is Home's alone (with the snapshot that feeds
Home's trends): the digest leaves it out.

Order matters: within a stage, tickets appear in the order listed.
"""
from __future__ import annotations

from app.models.acceptance_workflow import AUTHORITIES
from app.services import my_work_status as S
from app.services.action_queues.sources import (
    acceptance,
    cases,
    lifecycle,
    oversight,
    plans,
    submissions,
)
from app.services.action_queues.types import (
    CONTRACTOR,
    COORDINATOR,
    PM,
    PROBLEM_OWNER,
    HOME_ONLY,
    HOME_QUEUES,
    RAIL_QUEUES,
    REGIONAL_MANAGER,
    STAGE_GROUP,
    QueueDefinition,
    SlaKind,
    Stage,
)

_STAFF = frozenset({PM, COORDINATOR})


#: Everyone with a Home sees the acceptance headline queues, in their scope.
_HOME_ACCEPTANCE = frozenset({PM, COORDINATOR, CONTRACTOR, REGIONAL_MANAGER})
#: UEP-22: staff read Pending ICT / Pending CRA; a contractor reads their own
#: baskets (Waiting for ICT, Waiting for CRA, Rejected · Contractor).
_HOME_PENDING = frozenset({PM, COORDINATOR, REGIONAL_MANAGER})


def _q(key, stage, label, short_label, url, roles, fetch, *, holder, entity, sla=SlaKind.CONFIGURED,
       date_kind="since", unit="sites", on_board=True):
    return QueueDefinition(
        key=key, stage=stage, label=label, short_label=short_label, url=url,
        roles=frozenset(roles), sla=sla, date_kind=date_kind, fetch=fetch,
        holder=holder, entity=entity, unit=unit, on_board=on_board,
    )


# Who acts next (UEP-27 §5.1). ``SELF`` is Home's To do, ``OTHERS`` its
# Waiting on others, ``REMINDER`` neither.
SELF, OTHERS, REMINDER = "self", "others", "reminder"


def _acceptance_queues(authority: str) -> list[QueueDefinition]:
    stage = Stage(authority.lower())
    prefix = authority.lower()
    url = acceptance.my_work_url
    return [
        # UEP-22: read from the acceptance cases (open cases on this side).
        _q(f"{prefix}_pending", stage, f"Open {authority} acceptance", f"Pending {authority}",
           cases.filing_url(authority), _HOME_PENDING,
           cases.queue(f"{prefix}_pending"), holder=OTHERS, entity="case",
           unit="villages", on_board=False),
        _q(f"{prefix}_case_waiting", stage, f"Get {authority} approval", f"Waiting for {authority}",
           cases.filing_url(authority, "waiting"), {CONTRACTOR},
           cases.queue(f"{prefix}_case_waiting"), holder=OTHERS, entity="case",
           unit="villages", on_board=False),
        # The authority answers; the PM only chases.
        _q(f"{prefix}_follow_up", stage, f"Follow up with {authority}", f"{authority} follow-up",
           url(authority, S.TAB_WITH_AUTHORITY), {PM},
           acceptance.queue(authority, S.TAB_WITH_AUTHORITY, contractor_owns=False),
           holder=OTHERS, entity="village", unit="villages"),
        _q(f"{prefix}_to_file", stage, "File villages", f"{authority} to file",
           url(authority, S.TAB_NOT_FILED), {COORDINATOR, CONTRACTOR},
           acceptance.queue(authority, S.TAB_NOT_FILED, contractor_owns=True),
           holder=SELF, entity="village", unit="villages"),
        # The PM validates too (UEP-16), so the PM's Home row, rail badge and
        # page header read the same number as a coordinator's.
        _q(f"{prefix}_to_validate", stage, "Validate contractor filings", f"{authority} filings",
           acceptance.validation_url(authority), _STAFF,
           acceptance.queue(authority, S.TAB_FILLED, contractor_owns=False),
           holder=SELF, entity="village", unit="villages"),
        _q(f"{prefix}_refile", stage, "Re-file rejected villages", f"{authority} re-filing",
           url(authority, S.TAB_NEW_LETTER), {CONTRACTOR},
           acceptance.queue(authority, S.TAB_NEW_LETTER, contractor_owns=True),
           holder=SELF, entity="village", unit="villages"),
        _q(f"{prefix}_returned", stage, "Correct returned villages", f"{authority} corrections",
           url(authority, S.TAB_RETURNED), {CONTRACTOR},
           acceptance.queue(authority, S.TAB_RETURNED, contractor_owns=True),
           holder=SELF, entity="village", unit="villages"),
    ]


QUEUES: tuple[QueueDefinition, ...] = (
    # --- Health Check ----------------------------------------------------
    _q("hc_assign", Stage.HC, "Assign sites", "HC assignment",
       "/health-check?tab=assign", _STAFF, lifecycle.sites_to_assign,
       holder=SELF, entity="work_item"),
    _q("hc_review", Stage.HC, "Review HC results", "HC review",
       "/health-check?tab=checks&filter=to_decide", _STAFF, lifecycle.hc_results_to_review,
       holder=SELF, entity="hc_task"),
    _q("hc_reroutes", Stage.HC, "Decide re-routes", "Re-routes",
       "/health-check?tab=reroutes", _STAFF, lifecycle.reroute_decisions,
       holder=SELF, entity="remediation"),
    _q("hc_submit", Stage.HC, "Submit health checks", "Health checks",
       "/my-health-check", {CONTRACTOR}, lifecycle.hc_to_submit,
       holder=SELF, entity="hc_task"),
    _q("hc_fixes", Stage.HC, "Fix assigned problems", "Fixes",
       "/my-fix-queue", {PROBLEM_OWNER}, lifecycle.fixes, sla=SlaKind.CATEGORY,
       holder=SELF, entity="remediation", unit="fixes"),
    # --- Drive Test ------------------------------------------------------
    _q("dt_assign", Stage.DT, "Assign drive tests", "DT assignment",
       "/drive-test?tab=assign", _STAFF, lifecycle.dt_to_assign,
       holder=SELF, entity="work_item"),
    _q("dt_review", Stage.DT, "Review DT results", "DT review",
       "/drive-test?tab=tests&view=review", _STAFF, lifecycle.dt_results_to_review,
       holder=SELF, entity="drive_test"),
    _q("dt_todo", Stage.DT, "Drive-test sites", "Drive tests",
       "/my-drive-tests?tab=todo&status=with_contractor", {CONTRACTOR},
       lifecycle.sites_to_drive_test, holder=SELF, entity="work_item"),
    _q("dt_redo", Stage.DT, "Redo returned drive tests", "Returned drive tests",
       "/my-drive-tests?tab=todo&status=sent_back", {CONTRACTOR},
       lifecycle.returned_to_redo, holder=SELF, entity="work_item"),
    # UEP-24 F9: work stuck with others, on the PM's and coordinators' Home
    # and in their digest. Late past the DT SLA (SLA policies) and past each
    # fix's own due date. Contractors and teams hold it (UEP-27: others).
    _q("dt_with_contractors", Stage.DT, "Chase drive tests with contractors",
       "DT with contractors", "/drive-test?tab=in-progress", _STAFF,
       oversight.dt_with_contractors, holder=OTHERS, entity="work_item"),
    _q("fixes_open", Stage.DT, "Chase open fixes", "Fixes open",
       "/health-check?tab=remediation", _STAFF, oversight.fixes_open,
       sla=SlaKind.CATEGORY, holder=OTHERS, entity="remediation", unit="fixes"),
    # --- ICT, then CRA ---------------------------------------------------
    *(q for authority in AUTHORITIES for q in _acceptance_queues(authority)),
    # The Filing page's rail badge (UEP-16 §2): villages in Filing's own
    # buckets, each once -- the number in the Filing header. Home's cards do
    # not show it (types.RAIL_QUEUES).
    # UEP-22: the Filing badge is the viewer's whole inbox, both authorities.
    _q("acceptance_filing", Stage.ICT, "Update acceptance cases", "Filing",
       cases.FILING_URL, _HOME_ACCEPTANCE | {PROBLEM_OWNER}, cases.queue("acceptance_filing"),
       holder=SELF, entity="case", unit="villages", on_board=False),
    _q("case_rejected_contractor", Stage.ICT, "Fix rejected villages", "Rejected · Contractor",
       cases.filing_url("ICT", "rejected"), {CONTRACTOR},
       cases.queue("case_rejected_contractor"), holder=SELF, entity="case",
       unit="villages", on_board=False),
    _q("case_team_basket", Stage.ICT, "Fix rejected villages", "Your basket",
       cases.filing_url("ICT", "rejected"), {PROBLEM_OWNER},
       cases.queue("case_team_basket"), holder=SELF, entity="case",
       unit="villages", on_board=False),
    # UEP-24 F9: rejected villages waiting in any team's basket (late after
    # 30 days), and the Mojri tracker's age (late past the follow-up days).
    _q("acceptance_team_baskets", Stage.ICT, "Chase team baskets", "In team baskets",
       "/insights/acceptance-baskets", _STAFF, oversight.team_baskets,
       sla=SlaKind.DEADLINE, holder=OTHERS, entity="case", unit="villages"),
    # A reminder, never a count (UEP-27): its one item is the tracker itself.
    _q("mojri_tracker", Stage.ICT, "Refresh the Mojri tracker", "Mojri tracker",
       "/submissions?view=follow-up", _STAFF, oversight.mojri_tracker,
       sla=SlaKind.DEADLINE, holder=REMINDER, entity="none", unit="days"),
    # Submissions to ICT (UEP-21 §5.8): Home's Drive test card, for the owner
    # coordinator and the PM (everyone else's fetch is empty). Not on the
    # board, so the digest is unchanged. Keyed apart from ``ict_follow_up``,
    # which is the PM's follow-up of ICT's acceptance verdicts.
    _q("submit_to_ict", Stage.DT, "Submit to ICT", "Submit to ICT",
       "/submissions", _STAFF, submissions.submit_to_ict,
       holder=SELF, entity="village", unit="villages", on_board=False),
    # ICT HQ answers; the owner chases.
    _q("ict_mojri_follow_up", Stage.DT, "Follow up with ICT", "Follow up with ICT",
       "/submissions?view=follow-up", _STAFF, submissions.mojri_follow_up,
       holder=OTHERS, entity="submission_item", unit="villages", on_board=False),
    # --- Plans & Data ----------------------------------------------------
    _q("plans_approve", Stage.PLANS, "Approve plans", "Plan approvals",
       "/monthly-plan?tab=approvals", {PM}, plans.plans_to_approve,
       holder=SELF, entity="plan", unit="plans"),
    _q("cpm_changes", Stage.PLANS, "Validate CPM changes", "CPM changes",
       "/admin?tab=validate", {PM}, plans.cpm_changes,
       holder=SELF, entity="cpm_change", unit="changes"),
    _q("plan_submit", Stage.PLANS, "Submit monthly plan", "Monthly plan",
       "/monthly-plan", {CONTRACTOR}, plans.monthly_plan_to_submit,
       sla=SlaKind.DEADLINE, date_kind="due", holder=SELF, entity="plan", unit="plans"),
)

QUEUES_BY_KEY: dict[str, QueueDefinition] = {q.key: q for q in QUEUES}

assert len(QUEUES_BY_KEY) == len(QUEUES), "queue keys must be unique"


def queues_for(role: str, *, home_only: bool = False) -> list[QueueDefinition]:
    """This role's board queues; with ``home_only``, Home's own queues too.
    Rail-only queues are neither (:func:`rail_queues_for`)."""
    return [
        q for q in QUEUES
        if role in q.roles and (q.on_board or home_only) and q.key not in RAIL_QUEUES
    ]


def rail_queues_for(role: str) -> list[QueueDefinition]:
    """This role's rail-only queues (:data:`types.RAIL_QUEUES`): counted with
    Home, shown on no card."""
    return [q for q in QUEUES if q.key in RAIL_QUEUES and role in q.roles]


def home_queues_for(role: str) -> list[QueueDefinition]:
    """The queues this role's Home shows, by :data:`HOME_QUEUES`: a card with
    a key list shows those queues in that order, any other card every board
    queue of its stages."""
    mine = queues_for(role, home_only=True)
    shown = []
    for queue in mine:
        keys = HOME_QUEUES[STAGE_GROUP[queue.stage]]
        board = queue.on_board or queue.key in HOME_ONLY
        if (keys is None and board) or (keys is not None and queue.key in keys):
            shown.append(queue)
    order = {key: i for keys in HOME_QUEUES.values() if keys for i, key in enumerate(keys)}
    return sorted(shown, key=lambda q: order.get(q.key, -1))
