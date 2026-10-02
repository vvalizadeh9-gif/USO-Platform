"""My Work's vocabulary: what a side is called, and which tab a village is in.

One village has two independent *sides*, ICT and CRA. Each side's status is
the cached ``villages.ict_status`` / ``cra_status`` (see
``acceptance_workflow.derive_authority_status``), read here in the words the
work surface uses -- "whose move is it":

=========  ==============  =============================================
Status     Stored as       Meaning
=========  ==============  =============================================
waiting    ``NotFiled``    nobody has filed anything (contractor's move)
filled     ``Pending``     filed, not yet decided (coordinator's move)
returned   ``Returned``    sent back for a paperwork issue (contractor)
rejected   ``Rejected``    the office refused a technology (contractor)
approved   ``Approved``    done
=========  ==============  =============================================

The stored words are not renamed: the Acceptance dashboard, Lifecycle Gaps and
an Alembic backfill read them. This module is the only translation.

The tab rule is stated **once**, as :data:`EXCLUSIVE_TABS` plus two unions,
and both :func:`tabs_of` (Python) and :func:`tab_clause` (SQL) are built from
it, so the list, its counts and the sidebar badge cannot disagree. The tabs are
**not** a partition: ``filled`` overlaps the other three, because a village
whose ICT is with the coordinator while its CRA is unfiled is work for both.
"""
from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import ColumnElement, and_, false, or_, true

from app.core.deps import CONTRACTOR, COORDINATOR, PM
from app.services import acceptance_workflow as flow

# --------------------------------------------------------------------------
# Side statuses
# --------------------------------------------------------------------------
WAITING = "waiting"
FILLED = "filled"
RETURNED = "returned"
REJECTED = "rejected"
APPROVED = "approved"
STATUSES = (WAITING, FILLED, RETURNED, REJECTED, APPROVED)

_FROM_STORED = {
    flow.STATUS_NOT_FILED: WAITING,
    flow.STATUS_PENDING: FILLED,
    flow.STATUS_RETURNED: RETURNED,
    flow.STATUS_REJECTED: REJECTED,
    flow.STATUS_APPROVED: APPROVED,
}
_TO_STORED = {display: stored for stored, display in _FROM_STORED.items()}

#: A side the submitter may file a letter for.
EDITABLE = frozenset({WAITING, RETURNED, REJECTED})
#: A side that is being filed again after a decision went against it.
REFILING = frozenset({RETURNED, REJECTED})


def display_status(stored: str | None) -> str:
    """The work-surface word for a stored authority status."""
    return _FROM_STORED.get(stored or flow.STATUS_NOT_FILED, WAITING)


def stored_status(display: str) -> str:
    return _TO_STORED[display]


# --------------------------------------------------------------------------
# Tabs
# --------------------------------------------------------------------------
TAB_YOUR_MOVE = "your_move"
TAB_NEW_LETTER = "new_letter"
TAB_RETURNED = "returned"
TAB_NOT_FILED = "not_filed"
TAB_FILLED = "filled"
TAB_ALL = "all"
#: Staff only: a request letter is with ICT or CRA and unanswered. Not a side
#: status -- the side is still ``waiting`` or ``rejected`` -- so its clause is
#: over the request table rather than the status columns (see
#: ``acceptance_requests.open_request_clause``).
TAB_WITH_AUTHORITY = "with_authority"
#: The tabs decided by the side statuses alone -- :func:`tabs_of` and
#: :func:`tab_clause` answer for exactly these.
STATUS_TABS = (TAB_YOUR_MOVE, TAB_NEW_LETTER, TAB_RETURNED, TAB_NOT_FILED, TAB_FILLED, TAB_ALL)
TABS = (*STATUS_TABS[:-1], TAB_WITH_AUTHORITY, TAB_ALL)

#: Evaluated in order; a village lands in the first whose status any side holds.
EXCLUSIVE_TABS: tuple[tuple[str, str], ...] = (
    (TAB_NEW_LETTER, REJECTED),
    (TAB_RETURNED, RETURNED),
    (TAB_NOT_FILED, WAITING),
)
#: "Your move" is the three exclusive tabs together.
YOUR_MOVE_TABS = tuple(tab for tab, _status in EXCLUSIVE_TABS)


def exclusive_tab(statuses: Sequence[str]) -> str | None:
    """The one exclusive tab these side statuses fall in, if any."""
    for tab, status in EXCLUSIVE_TABS:
        if status in statuses:
            return tab
    return None


def tabs_of(statuses: Sequence[str]) -> set[str]:
    """Every tab a village with these side statuses appears under."""
    tabs = {TAB_ALL}
    exclusive = exclusive_tab(statuses)
    if exclusive is not None:
        tabs |= {exclusive, TAB_YOUR_MOVE}
    if FILLED in statuses:
        tabs.add(TAB_FILLED)
    return tabs


def _any_side(sides: Sequence[ColumnElement], status: str) -> ColumnElement[bool]:
    stored = stored_status(status)
    return or_(*(side == stored for side in sides)) if sides else false()


def tab_clause(tab: str, sides: Sequence[ColumnElement]) -> ColumnElement[bool]:
    """:func:`tabs_of` as SQL, over stored status columns (or literals).

    ``sides`` is normally ``(Village.ict_status, Village.cra_status)``; one
    column when the list is narrowed to one authority.
    """
    if tab not in STATUS_TABS:
        raise ValueError(f"{tab!r} is not decided by side status; use my_work_query.tab_predicate")
    if tab == TAB_ALL:
        return true()
    if tab == TAB_FILLED:
        return _any_side(sides, FILLED)
    if tab == TAB_YOUR_MOVE:
        return or_(*(_any_side(sides, s) for _t, s in EXCLUSIVE_TABS))
    earlier: list[ColumnElement[bool]] = []
    for name, status in EXCLUSIVE_TABS:
        if name == tab:
            return and_(_any_side(sides, status), *(~c for c in earlier))
        earlier.append(_any_side(sides, status))
    raise ValueError(f"Unknown tab {tab!r}")


# --------------------------------------------------------------------------
# Who is looking
# --------------------------------------------------------------------------
VIEW_CONTRACTOR = "contractor"
VIEW_STAFF = "staff"

CONTRACTOR_TABS = (TAB_YOUR_MOVE, TAB_NEW_LETTER, TAB_RETURNED, TAB_NOT_FILED, TAB_FILLED)
STAFF_TABS = (
    TAB_FILLED, TAB_NOT_FILED, TAB_NEW_LETTER, TAB_RETURNED, TAB_WITH_AUTHORITY, TAB_ALL,
)

#: Roles that file letters, and the subset that also decides them.
FILING_ROLES = (CONTRACTOR, COORDINATOR, PM)
DECIDING_ROLES = (COORDINATOR, PM)

#: Contractor totals count sides not yet approved; staff totals, sides to check.
TOTALS_NOT_APPROVED = "not_approved"
TOTALS_TO_CHECK = "to_check"

#: At this many days waiting, the row's day count reads as overdue.
LONG_WAIT_DAYS = 60


def view_for(role_name: str) -> str:
    return VIEW_CONTRACTOR if role_name == CONTRACTOR else VIEW_STAFF


def is_read_only(role_name: str) -> bool:
    return role_name not in FILING_ROLES


def decides_directly(role_name: str) -> bool:
    """A staff filing is recorded decided; a contractor's waits for review."""
    return role_name in DECIDING_ROLES


def tabs_for(view: str, *, universe: bool) -> tuple[str, ...]:
    """The tabs this viewer sees, in order; the first is the default.

    Under the dashboard's universe a fully approved village is in no other
    tab, so a contractor gets ``all`` too.
    """
    if view == VIEW_STAFF:
        return STAFF_TABS
    return CONTRACTOR_TABS + ((TAB_ALL,) if universe else ())


def totals_kind(view: str) -> str:
    return TOTALS_NOT_APPROVED if view == VIEW_CONTRACTOR else TOTALS_TO_CHECK


def totals_clause(view: str, side: ColumnElement) -> ColumnElement[bool]:
    """Whether one side counts toward the PageBar's per-authority total."""
    if view == VIEW_CONTRACTOR:
        return side != stored_status(APPROVED)
    return side == stored_status(FILLED)
