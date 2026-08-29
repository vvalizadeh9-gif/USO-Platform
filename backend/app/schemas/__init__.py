"""Pydantic schemas (request/response contracts)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.user_status import USER_STATUSES


class ORMModel(BaseModel):
    """Base for schemas read from ORM objects."""

    model_config = ConfigDict(from_attributes=True)


#: The closed set of account statuses, as a type. Built from the tuple in
#: ``core/user_status.py`` rather than written out again, so the schema and the
#: model cannot disagree about what a valid status is -- a typo becomes a 422
#: naming the field instead of a row nobody can sign in as.
UserStatusLiteral = Literal[USER_STATUSES]  # type: ignore[valid-type]


class EmailStr(str):
    """An email address, validated for shape and normalised to lower case.

    Hand-rolled rather than pulled from ``email-validator``: that package
    resolves MX records by default and carries an IDNA dependency tree, and
    this platform runs on a server with no route to the public internet. What
    is actually needed here is to catch a typo in an admin form -- an address
    is a way to reach a colleague, not a credential and not something the
    application ever sends to.
    """

    @classmethod
    def __get_pydantic_core_schema__(cls, source, handler):
        from pydantic_core import core_schema

        return core_schema.no_info_after_validator_function(
            cls._validate,
            core_schema.str_schema(strip_whitespace=True, max_length=255),
        )

    @staticmethod
    def _validate(value: str) -> str:
        # Deliberately permissive: one @, something either side, a dot in the
        # domain, no spaces. Anything stricter starts rejecting addresses that
        # genuinely work, which is a worse failure than accepting one that does
        # not -- nothing here depends on the address being deliverable.
        local, _, domain = value.partition("@")
        if not local or not domain or "@" in domain:
            raise ValueError("Enter an email address, for example name@example.com")
        if "." not in domain or domain.startswith(".") or domain.endswith("."):
            raise ValueError("Enter an email address, for example name@example.com")
        if any(c.isspace() for c in value):
            raise ValueError("An email address cannot contain spaces")
        return value.lower()


# ---------- Auth ----------
class LoginRequest(BaseModel):
    username: str
    password: str


def _checked_password(value: str, username: str | None = None) -> str:
    """Run the shared policy, reporting failures as a 422 on the right field."""
    from app.core.passwords import PasswordError, validate_password

    try:
        return validate_password(value, username=username)
    except PasswordError as exc:
        raise ValueError(str(exc)) from None


class PasswordChange(BaseModel):
    """A user changing their own password.

    The current one is required even though the request is authenticated: it is
    what stops a borrowed unlocked laptop becoming a permanent takeover.
    """

    current_password: str = Field(min_length=1, max_length=200)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _policy(cls, value: str) -> str:
        # The username is not in this payload, so the "not built from the
        # username" check runs in the endpoint, which knows who is calling.
        return _checked_password(value)


class CaptchaChallenge(BaseModel):
    token: str
    num1: int
    num2: int


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Reference ----------
class ProvinceOut(ORMModel):
    id: int
    name: str


class RegionOut(ORMModel):
    id: int
    name: str


class ContractorOut(ORMModel):
    id: int
    name: str
    type: str
    active: bool


class ContractorCreate(BaseModel):
    name: str
    type: str = "drive_test"


class ProblemCategoryOut(ORMModel):
    id: int
    name: str
    active: bool


class ProblemCategoryCreate(BaseModel):
    name: str


class RoleOut(ORMModel):
    id: int
    name: str


# ---------- Users ----------
class UserOut(ORMModel):
    """A user as every screen sees them.

    There is no password field of any kind, and there never will be: the
    plaintext does not exist anywhere to put in one, and the hash is not
    something a browser has any use for.
    """

    id: int
    username: str
    first_name: str
    family_name: str
    # Derived from the two names above, not stored. Sent because roughly twenty
    # places display a person's name and none of them should be assembling it
    # themselves.
    full_name: str
    email: str | None = None
    role: RoleOut
    contractor_id: int | None = None
    sees_all_provinces: bool
    # Active / Inactive / Suspended. See app/core/user_status.py.
    status: str
    # Whether this status permits signing in. Redundant with ``status`` today,
    # and kept because it is what the interface actually branches on -- so a
    # fourth status would not need every screen to relearn which ones count.
    active: bool
    status_changed_at: datetime | None = None
    status_changed_by: int | None = None
    # True while the account is working off a temporary password an
    # administrator issued, and can do nothing but replace it.
    must_change_password: bool = False
    last_login_at: datetime | None = None
    provinces: list[ProvinceOut] = []


class UserCreate(BaseModel):
    # Lengths match the columns in models/reference.py. Without them an
    # oversized value travels all the way to the database to be refused there,
    # as a 500 rather than a 422 naming the field.
    username: str = Field(min_length=1, max_length=80)
    password: str
    first_name: str = Field(min_length=1, max_length=80)
    family_name: str = Field(min_length=1, max_length=80)
    # Optional, because some users genuinely have no work address. Validated
    # for shape when given, so a typo is caught at the form rather than
    # discovered when someone needs to reach that person about their account.
    email: EmailStr | None = None
    role_id: int
    contractor_id: int | None = None
    sees_all_provinces: bool = False
    province_ids: list[int] = []
    status: UserStatusLiteral = "Active"

    @model_validator(mode="after")
    def _policy(self) -> "UserCreate":
        _checked_password(self.password, self.username)
        return self


class UserUpdate(BaseModel):
    """The fields an administrator may change on someone else's account.

    Note what is *not* here: ``username``, which is the identifier the audit
    log and every reviewer column point at by name, and ``password``, which now
    has its own endpoint. Password setting was folded into this general-purpose
    update, which meant a routine "fix the spelling of their surname" request
    and a credential reset were the same call, indistinguishable in the log
    afterwards. They are separate operations and are now separate routes.

    ``extra="forbid"`` so that a caller still sending ``password`` here gets a
    422 naming the field rather than a 200 that quietly did not set it. On a
    credential operation, silently ignoring the request is the worst of the
    available answers: the administrator believes the password was changed, and
    finds out otherwise from the person who cannot sign in.
    """

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    family_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: EmailStr | None = None
    role_id: int | None = None
    contractor_id: int | None = None
    sees_all_provinces: bool | None = None
    province_ids: list[int] | None = None
    status: UserStatusLiteral | None = None
    # Why the status is changing. Optional for everything else, because a
    # corrected surname explains itself; a suspension does not.
    status_reason: str | None = Field(default=None, max_length=500)


class UserStatusChange(BaseModel):
    """Move one account between Active, Inactive and Suspended."""

    status: UserStatusLiteral
    reason: str | None = Field(default=None, max_length=500)


class AdminPasswordReset(BaseModel):
    """An administrator resetting somebody else's password.

    ``password`` is optional and usually omitted: leaving it out has the server
    generate one, which is the better path -- a password an administrator
    invents for someone else tends to be a pattern they reuse for everyone
    else. Supplying one is allowed for the case where it has to be read down a
    phone line and the recipient needs it to be sayable.
    """

    password: str | None = None
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("password")
    @classmethod
    def _policy(cls, value: str | None) -> str | None:
        # The username is not in this payload; the endpoint adds that check,
        # where the target account is known.
        return _checked_password(value) if value is not None else None


class AdminPasswordResetResult(BaseModel):
    """What the administrator is shown once, and never again.

    The temporary password is in the response body because this is the only
    moment it exists in readable form -- what is stored is an Argon2id hash,
    and nothing can turn that back into text. If the administrator loses it
    before handing it over, the answer is another reset, not a lookup.
    """

    status: str = "ok"
    username: str
    temporary_password: str
    must_change_password: bool = True


class PasswordResetRequestIn(BaseModel):
    """Someone on the sign-in page saying they cannot get in.

    One free-text field, because the person typing it should not have to know
    whether the platform identifies them by username or by email address.
    """

    identifier: str = Field(min_length=1, max_length=255)


class PasswordResetRequestOut(ORMModel):
    id: int
    submitted_identifier: str
    user_id: int | None = None
    # Filled in by the endpoint when the identifier matched a real account, so
    # the console can show a name rather than only what was typed.
    user_full_name: str | None = None
    username: str | None = None
    requested_at: datetime
    requested_ip: str | None = None
    status: str
    handled_at: datetime | None = None
    handled_by: int | None = None


class PasswordResetRequestDecision(BaseModel):
    """Close a reset request that is not going to be actioned."""

    reason: str | None = Field(default=None, max_length=500)


# ---------- Work Item / Village ----------
class AcceptanceOut(ORMModel):
    id: int
    technology: str
    ict_status: str
    ict_date: date | None
    cra_status: str
    cra_date: date | None


class VillageOut(ORMModel):
    id: int
    village_code: str | None
    village_name: str | None
    households: int | None
    population: int | None
    acceptances: list[AcceptanceOut] = []


class WorkItemListItem(ORMModel):
    """One row of the Work Items list.

    Carries the union of every column any stage tab needs; the frontend picks
    which subset to render per stage. Fields are None when not applicable
    (e.g. ``dt_approval_date`` before a coordinator has approved), so a single
    endpoint serves all tabs rather than one endpoint per stage.
    """

    id: int
    site_code: str | None = None
    site_type: str
    requested_technology: str | None
    current_stage: str
    project_name: str | None

    # Assignment (latest active, else latest ever)
    assignment_date: datetime | None = None
    assignment_user: str | None = None
    contractor_name: str | None = None
    returned_date: datetime | None = None

    # Drive test (latest active)
    dt_submission_date: date | None = None
    dt_approval_date: datetime | None = None
    dt_approval_user: str | None = None
    # Whole days between assignment and DT submission.
    aging_days: int | None = None


class WorkItemDetail(ORMModel):
    id: int
    site_type: str
    requested_technology: str | None
    deployed_technology: str | None
    project_name: str | None
    pm_name: str | None
    power_status: str | None
    current_stage: str
    villages: list[VillageOut] = []
    # The drive test currently awaiting/holding a decision, if any. The
    # coordinator's approve/reject panel needs its id to act on.
    active_drive_test_id: int | None = None
    dt_submission_date: date | None = None


# ---------- Workflow actions ----------
class HealthCheckCreate(BaseModel):
    status: str  # Ready | Problematic
    problem_category_id: int | None = None
    comment: str | None = None


class AssignmentCreate(BaseModel):
    assignment_type: str  # first | official
    contractor_id: int
    remarks: str | None = None


# How many records one bulk request may name. The acceptance endpoint already
# capped its list at 200; these two were written without one, and bulk_assign
# runs a scoped query per id, so an unbounded list holds a transaction open for
# as long as the caller cares to make it. 500 is comfortably more than the
# largest real batch (a monthly CPM import touches ~15k rows, but nobody
# assigns that many sites to one contractor in one action).
MAX_BULK_IDS = 500


class BulkAssignmentCreate(BaseModel):
    work_item_ids: list[int] = Field(min_length=1, max_length=MAX_BULK_IDS)
    contractor_id: int
    assignment_type: str = "official"  # bulk assign defaults to official
    remarks: str | None = None


class DriveTestCreate(BaseModel):
    execution_date: date | None = None
    report_link: str | None = None


class ReturnToCoordinatorRequest(BaseModel):
    """Contractor hands a site back before attempting drive test."""

    reason: str = Field(min_length=3, max_length=1000)


class ReviewRequest(BaseModel):
    decision: str  # Approved | Rejected | Returned
    comment: str | None = None


class AcceptanceUpdate(BaseModel):
    ict_status: str | None = None
    ict_date: date | None = None
    cra_status: str | None = None
    cra_date: date | None = None



# ---------- Acceptance submissions ----------
#
# The vocabulary the My Work workspace renders. These are labels only — what
# each one *means*, and which one a village is in, is decided in
# services/acceptance_workflow.py, whose STATUS_* constants carry the same
# spellings. Nothing here is a rule.
AuthorityStatus = Literal["Approved", "Rejected", "Returned", "Pending", "NotFiled"]
"""Where one village stands with one authority (ICT or CRA).

``Approved``  a validated submission approved every requested technology
``Rejected``  a validated submission rejected at least one
``Returned``  the most recent submission was sent back, awaiting a new round
``Pending``   the most recent submission is awaiting a PM or coordinator
``NotFiled``  nothing has ever been submitted
"""

RollupStatus = Literal["Closed", "Partial", "Open"]
"""A village or a site, rolled up.

For a village: ``Closed`` when ICT *and* CRA are Approved, ``Partial`` when one
is and the other is not, ``Open`` when neither is. For a site: ``Closed`` when
every village it serves is closed, ``Partial`` when some are, ``Open`` when
none are.
"""


class TechnologyClaim(BaseModel):
    """One technology's claimed verdict inside a submission."""

    technology: str
    claimed_status: str  # Approved | Rejected
    # Required by the service when the status is Rejected.
    comment: str | None = None


class AcceptanceSubmissionCreate(BaseModel):
    authority: str  # ICT | CRA
    letter_number: str = Field(min_length=1, max_length=120)
    # Shamsi, "1404/05/29". Converted to Gregorian for storage by the endpoint,
    # so the calendar conversion lives in one place rather than in the browser.
    letter_date_shamsi: str | None = None
    technologies: list[TechnologyClaim]


class AcceptanceSubmissionUpdate(BaseModel):
    letter_number: str = Field(min_length=1, max_length=120)
    letter_date_shamsi: str | None = None
    technologies: list[TechnologyClaim]


class AcceptanceReviewRequest(BaseModel):
    decision: str  # Validated | Returned
    comment: str | None = None


class EvidenceOut(ORMModel):
    id: int
    original_filename: str
    content_type: str | None
    size_bytes: int
    uploaded_at: datetime


class TechnologyClaimOut(ORMModel):
    technology: str
    claimed_status: str
    comment: str | None


class AcceptanceSubmissionOut(ORMModel):
    id: int
    village_id: int
    authority: str
    round_no: int
    letter_number: str
    letter_date: date | None
    letter_date_shamsi: str | None = None
    source: str
    review_status: str
    submitted_by_name: str | None = None
    submitted_at: datetime
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    technologies: list[TechnologyClaimOut] = []
    evidence: list[EvidenceOut] = []
    # Context, so a review queue row is readable without a second request.
    village_name: str | None = None
    village_code: str | None = None
    site_code: str | None = None
    province_name: str | None = None


class AcceptanceVillageRow(BaseModel):
    """One village on the acceptance list, with its derived verdicts."""

    village_id: int
    village_code: str | None
    village_name: str | None
    site_code: str | None
    work_item_id: int
    province_name: str | None
    requested_technologies: list[str]
    ict_verdict: str
    cra_verdict: str
    verdict: str
    # Where each authority stands as the queue reads it — wider than the three
    # verdicts above, because "returned to me" and "waiting on a reviewer" are
    # different work even though both are Pending as a verdict.
    ict_status: AuthorityStatus = "NotFiled"
    cra_status: AuthorityStatus = "NotFiled"
    village_status: RollupStatus = "Open"
    site_status: RollupStatus
    # Which queue group this village belongs to, so the workspace can head its
    # list without re-deriving the server's partition in the browser.
    bucket: Literal[
        "needs_attention", "ready", "awaiting_review", "closed"
    ] = "ready"
    # Days since this village's acceptance last moved — a submission sent, a
    # validation, a return. None when nothing has been filed yet. This is what
    # lets the list answer "how long has this been sitting with ICT", which is
    # the question that actually moves a province office.
    waiting_days: int | None = None
    pending_authorities: list[str] = []
    returned_authorities: list[str] = []
    can_submit: list[str] = []


class AcceptanceVillageList(BaseModel):
    total: int
    rows: list[AcceptanceVillageRow]


class AcceptanceBucketCounts(BaseModel):
    """How much work sits in each queue bucket, for the filter chips.

    The four buckets partition the villages this user can see, so they always
    sum to ``total`` — a village is in exactly one of them, which is what lets
    the left pane be read as a whole book of work rather than four overlapping
    searches.
    """

    needs_attention: int
    ready: int
    awaiting_review: int
    closed: int
    total: int


class BulkSubmissionCreate(BaseModel):
    """One letter, many villages.

    An ICT letter routinely covers a hundred villages at once. Filing them one
    at a time is the same form a hundred times, and the hundredth is where the
    typo goes in.
    """

    village_ids: list[int] = Field(min_length=1, max_length=200)
    authority: str  # ICT | CRA
    letter_number: str = Field(min_length=1, max_length=120)
    letter_date_shamsi: str | None = None
    # The same per-technology verdicts are applied to every village. A village
    # whose requested technologies differ from the claim fails validation, and
    # the whole batch rolls back naming it — a partial batch would leave the
    # submitter with no way to tell which villages went in.
    technologies: list[TechnologyClaim]


class BulkSubmissionRow(BaseModel):
    village_id: int
    submission_id: int


class BulkSubmissionResult(BaseModel):
    created: list[BulkSubmissionRow]
    letter_number: str
    count: int


class AcceptanceVillageDetail(BaseModel):
    village: AcceptanceVillageRow
    dt_status: str | None
    submissions: list[AcceptanceSubmissionOut]


class AcceptanceUploadLimits(BaseModel):
    accepted_extensions: list[str]
    max_file_mb: int
    max_files_per_submission: int


# ---------- Letters ----------
class LetterCreate(BaseModel):
    letter_number: str
    letter_date: date | None = None
    authority: str
    province_id: int | None = None
    comment: str | None = None
    village_ids: list[int] = []


class LetterOut(ORMModel):
    id: int
    letter_number: str
    letter_date: date | None
    authority: str
    attachment_path: str | None
    comment: str | None


class CpmWipeRequest(BaseModel):
    confirm: str  # must exactly match the required confirmation phrase


class CpmWipeResult(BaseModel):
    deleted: dict[str, int]
    total_deleted: int


# ---------- CPM ----------
class CpmImportSummary(ORMModel):
    id: int
    filename: str
    total_rows: int
    new_count: int
    new_villages_count: int = 0
    changed_count: int
    changed_village_qty: int = 0
    changed_site_type: int = 0
    changed_requested_tech: int = 0
    unchanged_count: int
    skipped_satellite: int
    created_at: datetime


class CpmChangeRequestOut(ORMModel):
    id: int
    site_code: str
    change_type: str = "field"
    field_name: str
    old_value: str | None
    new_value: str | None
    detail: str | None = None
    payload_json: str | None = None
    status: str


class CpmDecisionRequest(BaseModel):
    decision: str  # Accepted | Ignored | Archived


# ---------- Notifications ----------
class NotificationOut(ORMModel):
    id: int
    type: str
    message: str
    is_read: bool
    created_at: datetime


# ---------- Action Center ----------
class ActionItem(BaseModel):
    """One concrete thing a user needs to do or knows about, live-derived
    from current state (self-clearing) or a past event folded in from the
    notification log. Never a static/aggregate row — every item points at
    exactly one entity via ``url`` so clicking it goes straight there."""

    id: str
    category: str  # drive_test | assignment | cpm | health_check | event
    label: str
    subtitle: str | None = None
    url: str
    created_at: datetime | None = None
    source: str = "action"  # "action" (derived, clears itself) | "event" (dismissible)


# ---------- Health Check workflow (Phase A) ----------
class HcBasketItem(BaseModel):
    work_item_id: int
    site_code: str | None
    site_type: str
    province: str | None
    requested_technologies: list[str]
    # 1 for a first-ever check; 2+ for a site coming back after its fixes were
    # closed. ``returning_reason`` says what was fixed, and is None on round 1.
    round_no: int = 1
    returning_reason: str | None = None


class HcAssignmentCreate(BaseModel):
    contractor_id: int
    work_item_ids: list[int] = Field(min_length=1, max_length=MAX_BULK_IDS)
    remarks: str | None = None


class HcTechResult(BaseModel):
    technology: str
    result: str  # Normal | NotNormal
    reason_category: str | None = None
    comment: str | None = None


class HcTaskResultSubmit(BaseModel):
    technology_results: list[HcTechResult] = Field(min_length=1)


class HcTechnologyOut(ORMModel):
    technology: str
    result: str | None
    reason_category: str | None
    comment: str | None


class HcTaskOut(ORMModel):
    id: int
    work_item_id: int
    site_code: str | None = None
    site_type: str | None = None
    province: str | None = None
    requested_technologies: list[str] = []
    overall_result: str | None
    problem_category: str | None
    problem_categories: list[str] = []
    round_no: int = 1
    reviewed: bool = False
    technologies: list[HcTechnologyOut] = []


class HcReviewSubmit(BaseModel):
    """Coordinator/PM triage of a completed HC task.

    A Not-Ready site takes one *or more* categories — a site blocked by both
    power and planning opens a fix for each, worked in parallel. Ready sites
    send an empty list.

    ``problem_category`` is the superseded single-value field, still accepted
    so an older client keeps working; when both are sent the list wins.
    """
    problem_categories: list[str] = []
    problem_category: str | None = None

    def selected(self) -> list[str]:
        if self.problem_categories:
            return self.problem_categories
        return [self.problem_category] if self.problem_category else []


class HcRemediationOut(BaseModel):
    """One open fix in a category owner's queue."""
    id: int
    work_item_id: int
    site_code: str | None = None
    province: str | None = None
    category: str | None = None
    round_no: int = 1
    technologies: list[str] = []
    issue: str | None = None
    days_open: int = 0
    days_late: int = 0
    due_at: datetime | None = None
    also_waiting_on: list[str] = []
    reroute_pending: bool = False


class HcRemediationClose(BaseModel):
    note: str | None = None


class HcRerouteRequest(BaseModel):
    to_category: str
    reason: str


class HcRerouteDecision(BaseModel):
    approve: bool


class HcHistoryEvent(BaseModel):
    """One entry on a site's health-check timeline."""
    at: datetime | None = None
    round_no: int = 1
    kind: str  # assigned | passed | failed | routed | fixed
    title: str
    detail: str | None = None
    actor: str | None = None
    aging: str | None = None


class HcAssignmentOut(ORMModel):
    id: int
    code: str
    title: str | None = None
    contractor_id: int
    status: str
    remarks: str | None
    created_at: datetime
    tasks: list[HcTaskOut] = []


class HcAssignmentListItem(ORMModel):
    id: int
    code: str
    contractor_id: int
    status: str
    created_at: datetime
    task_count: int = 0
    # Feedback breakdown for the HC History detail view. All additive/optional
    # so older clients that ignore them keep working unchanged.
    sites_ready: int = 0
    sites_not_ready: int = 0
    sites_pending: int = 0
    feedback_received_at: datetime | None = None
    aging_days: int | None = None
    aging_ongoing: bool = False


class HcResultRow(BaseModel):
    task_id: int | None = None
    work_item_id: int
    site_code: str | None
    site_type: str
    overall_result: str | None
    problem_category: str | None
    problem_categories: list[str] = []
    round_no: int = 1
    reviewed: bool = False
    assignment_code: str
    contractor_name: str | None = None       # the subcontractor (SC) who did the HC
    technologies: list[HcTechnologyOut] = []  # per-technology Normal/NotNormal detail


# ---------- Drive Test Project dashboard ----------
class KpiWithDelta(BaseModel):
    """A KPI value with its month-over-month delta and optional percentage."""

    value: int
    delta: int | None = None          # +/- vs last month; None = no prior data
    percent_of_onair: float | None = None  # share of total on-air, where relevant


class DriveTestKpis(BaseModel):
    total_onair: KpiWithDelta
    total_dt_done: KpiWithDelta
    total_remaining: KpiWithDelta
    total_ongoing: KpiWithDelta
    total_problematic: KpiWithDelta
    current_month_dt_done: KpiWithDelta


class ChartPoint(BaseModel):
    name: str
    value: int


class ProvinceProgressPoint(BaseModel):
    name: str
    onair: int
    done: int
    remaining: int
    done_percent: float


class DriveTestOverview(BaseModel):
    kpis: DriveTestKpis
    ongoing_by_contractor: list[ChartPoint]
    problematic_by_category: list[ChartPoint]
    dt_done_by_contractor: list[ChartPoint]
    dt_done_yearly: list[ChartPoint]
    dt_done_monthly: list[dict]
    progress_by_province: list[ProvinceProgressPoint]
    current_month_label: str


# ----- Acceptance dashboard -----
class AcceptanceKpis(BaseModel):
    """Overview KPI cards. Counts are of every (site, village) row in the
    DT-Done هدف universe — duplicates are not removed."""

    total_dt_done_villages: int
    total_ict_approval: int
    total_ict_remained: int
    total_cra_approval: int
    total_cra_remained: int


class AcceptanceAnalysis(BaseModel):
    """Work-item (site) and village level cross tabs of ICT vs CRA approval."""

    sites_ict_full: int
    sites_cra_full: int
    sites_ict_and_cra_full: int
    sites_ict_not_cra: int
    sites_cra_not_ict: int
    villages_ict_not_cra: int
    villages_cra_not_ict: int


class ProvinceAcceptanceRow(BaseModel):
    """Per-province ICT & CRA approval status."""

    name: str
    total: int
    ict_approved: int
    ict_remained: int
    ict_approved_pct: float
    ict_remained_pct: float
    cra_approved: int
    cra_remained: int
    cra_approved_pct: float
    cra_remained_pct: float


class AcceptanceOverview(BaseModel):
    kpis: AcceptanceKpis
    analysis: AcceptanceAnalysis
    provinces: list[ProvinceAcceptanceRow]


# ---------- Admin Dashboard ----------
class AdminStatsOut(BaseModel):
    active_users_count: int
    active_contractors_count: int
    users_by_role: dict[str, int]
    users_without_province_access: int
    dormant_users: int


class LastCpmImportOut(BaseModel):
    filename: str
    imported_by: str | None = None
    created_at: datetime
    total_rows: int
    new_count: int
    changed_count: int


class SystemHealthOut(BaseModel):
    db_status: str  # ok | error
    alembic_current_revision: str | None = None
    alembic_head_revision: str | None = None
    alembic_mismatch: bool
    last_cpm_import: LastCpmImportOut | None = None
    pending_change_requests_count: int


class AuditLogOut(BaseModel):
    """One audit entry, with the user resolved to a name.

    The field order is the order the requirements list them in, and the order
    the table renders: who, what, where, which record, when, what changed, from
    where, and whether it worked.
    """

    id: int
    user_id: int | None
    user_full_name: str | None = None
    username: str | None = None
    action: str
    module: str
    entity_type: str
    entity_id: int | None
    created_at: datetime
    old_value: dict | None = None
    new_value: dict | None = None
    reason: str | None = None
    ip_address: str | None = None
    result: str


class AuditLogListOut(BaseModel):
    total_count: int
    items: list[AuditLogOut]


UserOut.model_rebuild()
TokenResponse.model_rebuild()
