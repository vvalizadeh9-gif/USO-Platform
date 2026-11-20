"""Which villages have cases, who sees which cases, and the one case read.

**The universe** (§4.1): live, pure هدف, drive test done, on air -- My Work's
"remaining" population before its not-yet-approved filter
(``acceptance_universe.dt_done_universe`` and ``my_work_scope.onair_clause``),
one village per site, site type and village code
(``action_queues.sources.acceptance.one_per_village``). Lifecycle Gaps counts
the same villages without the on-air rule, so its figures are untouched.

**Who sees what** (§4.4):

* PM, Viewer, Coordinator (and a Regional manager, for Home's two headline
  rows): every case in their row scope (``visibility.visible_work_item_ids``:
  province grants, which UEP-17 keeps in step with the CRA regions).
* Contractor: their own sites (the site contractor, else the CPM drive-test
  contractor) -- waiting cases, and rejections in the Contractor category.
* A team role: rejections in its own basket, every region.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import ColumnElement, Select, and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import (
    CONTRACTOR,
    COORDINATOR,
    PM,
    REGIONAL,
    TEAM_BASKET_ROLES,
    VIEWER,
)
from app.models.acceptance_case import (
    BASKET_CONTRACTOR,
    OPEN_STATES,
    STATE_REJECTED,
    STATE_WAITING,
    AcceptanceCase,
    AcceptanceRejectionCategory,
)
from app.models.reference import Contractor, Province, User
from app.models.workitem import Site, Village, WorkItem
from app.services import acceptance_universe
from app.services.my_work_scope import onair_clause
from app.services.visibility import visible_work_item_ids

from . import rules

KIND_STAFF = "staff"
KIND_CONTRACTOR = "contractor"
KIND_TEAM = "team"
#: Internal: no role clause, for a village the caller may already read.
KIND_ANY = "any"

#: Roles that read every case in their row scope.
STAFF_ROLES = (PM, COORDINATOR, VIEWER, REGIONAL)
#: Roles that may move a case's basket (§4.4) and whose saves land directly.
DECIDING_ROLES = (PM, COORDINATOR)


class ScopeError(PermissionError):
    """This role has no Filing at all."""


def viewer_kind(user: User) -> str | None:
    name = user.role.name
    if name in STAFF_ROLES:
        return KIND_STAFF
    if name == CONTRACTOR and user.contractor_id is not None:
        return KIND_CONTRACTOR
    if name in TEAM_BASKET_ROLES:
        return KIND_TEAM
    return None


def require_kind(user: User) -> str:
    kind = viewer_kind(user)
    if kind is None:
        raise ScopeError("Filing is not available for this role")
    return kind


def site_contractor() -> ColumnElement:
    """The village's site contractor: the CPM master field, else the CPM
    drive-test contractor (the master field is filled by the next import)."""
    return func.coalesce(WorkItem.site_contractor_id, WorkItem.dt_sc_contractor_id)


def universe_clause(db: Session) -> ColumnElement[bool]:
    """Expects ``Village`` joined to ``WorkItem``."""
    return and_(acceptance_universe.dt_done_universe(db), onair_clause(db))


def _role_clause(db: Session, user: User, kind: str) -> ColumnElement[bool] | None:
    if kind == KIND_STAFF:
        return WorkItem.id.in_(visible_work_item_ids(user, db))
    if kind == KIND_CONTRACTOR:
        return and_(
            site_contractor() == user.contractor_id,
            or_(
                AcceptanceCase.state == STATE_WAITING,
                and_(AcceptanceCase.state == STATE_REJECTED,
                     AcceptanceCase.basket_role == BASKET_CONTRACTOR),
            ),
        )
    if kind == KIND_TEAM:
        return and_(AcceptanceCase.state == STATE_REJECTED,
                    AcceptanceCase.basket_role == user.role.name)
    return None


def _side_status(authority_col) -> ColumnElement:
    return case((authority_col == "ICT", Village.ict_status), else_=Village.cra_status)


def case_select(db: Session, user: User, *columns, kind: str | None = None) -> Select:
    """Cases in the universe this user may see, with village, site and
    province joined. Callers add authority, state or id filters."""
    kind = kind or require_kind(user)
    stmt = (
        select(*columns)
        .select_from(AcceptanceCase)
        .join(Village, AcceptanceCase.village_id == Village.id)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(universe_clause(db))
    )
    clause = _role_clause(db, user, kind)
    return stmt.where(clause) if clause is not None else stmt


# --------------------------------------------------------------------------
# The one read
# --------------------------------------------------------------------------
@dataclass
class CaseRow:
    """One case as every screen reads it, with its derived figures."""

    case_id: int
    village_id: int
    authority: str
    state: str
    category_id: int | None
    category_code: str | None
    category_label: str | None
    basket_role: str | None
    state_since: date
    dt_approved_on: date | None
    legacy: bool
    last_comment_at: datetime | None
    village_code: str | None
    village_name: str | None
    work_item_id: int
    site_code: str | None
    province: str | None
    tech: str | None
    contractor_id: int | None
    contractor_name: str | None
    in_validation: bool
    # Derived with a Clock (see derive()).
    days_in_basket: int = 0
    stale: bool = False
    over_sla: bool = False
    bucket: str = "u3"
    basket_key: str | None = None
    basket_owner: str | None = None
    comment_age: int | None = None

    def derive(self, clock: rules.Clock) -> CaseRow:
        self.days_in_basket = rules.days_since(self.state_since, clock.today) or 0
        self.stale = rules.is_stale(self.state, self.last_comment_at, clock)
        self.over_sla = rules.is_over_sla(self.state, self.days_in_basket, clock)
        self.bucket = rules.bucket_of(self.days_in_basket)
        self.basket_key = rules.basket_key(self.state, self.basket_role, self.contractor_id)
        self.basket_owner = rules.basket_owner(
            self.state, self.basket_role, self.contractor_name, self.category_label
        )
        self.comment_age = rules.comment_age(self.last_comment_at, clock.today)
        return self


def _columns() -> tuple:
    return (
        AcceptanceCase.id, AcceptanceCase.village_id, AcceptanceCase.authority,
        AcceptanceCase.state, AcceptanceCase.category_id,
        AcceptanceRejectionCategory.code, AcceptanceRejectionCategory.label,
        AcceptanceCase.basket_role, AcceptanceCase.state_since,
        AcceptanceCase.dt_approved_on, AcceptanceCase.legacy, AcceptanceCase.last_comment_at,
        Village.village_code, Village.village_name, WorkItem.id, Site.site_code,
        Province.name, WorkItem.requested_technology, site_contractor(), Contractor.name,
        _side_status(AcceptanceCase.authority),
    )


def load_cases(
    db: Session, user: User, clock: rules.Clock, *,
    authority: str | None = None, open_only: bool = True,
    village_ids: list[int] | None = None, kind: str | None = None,
) -> list[CaseRow]:
    """Every case this user may see, derived against ``clock``."""
    stmt = (
        case_select(db, user, *_columns(), kind=kind)
        .outerjoin(AcceptanceRejectionCategory,
                   AcceptanceCase.category_id == AcceptanceRejectionCategory.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .outerjoin(Contractor, Contractor.id == site_contractor())
    )
    if authority:
        stmt = stmt.where(AcceptanceCase.authority == authority)
    if open_only:
        stmt = stmt.where(AcceptanceCase.state.in_(OPEN_STATES))
    if village_ids is not None:
        stmt = stmt.where(AcceptanceCase.village_id.in_(village_ids or [-1]))
    out = []
    for r in db.execute(stmt.order_by(AcceptanceCase.id)).all():
        out.append(CaseRow(
            case_id=r[0], village_id=r[1], authority=r[2], state=r[3], category_id=r[4],
            category_code=r[5], category_label=r[6], basket_role=r[7], state_since=r[8],
            dt_approved_on=r[9], legacy=bool(r[10]), last_comment_at=r[11],
            village_code=r[12], village_name=r[13], work_item_id=r[14], site_code=r[15],
            province=r[16], tech=r[17], contractor_id=r[18], contractor_name=r[19],
            in_validation=r[20] == "Pending",
        ).derive(clock))
    return out


def may_read_village(db: Session, user: User, village_id: int) -> bool:
    """A village's two status boxes and history are readable when the user may
    see either of its cases (a contractor reads the other box too)."""
    stmt = case_select(db, user, AcceptanceCase.id).where(AcceptanceCase.village_id == village_id)
    return db.execute(stmt.limit(1)).first() is not None


def all_cases_of_village(db: Session, user: User, clock: rules.Clock, village_id: int) -> list[CaseRow]:
    """Both of a readable village's cases, whatever their state, once
    :func:`may_read_village` has said yes."""
    if not may_read_village(db, user, village_id):
        return []
    return load_cases(db, user, clock, open_only=False, village_ids=[village_id], kind=KIND_ANY)
