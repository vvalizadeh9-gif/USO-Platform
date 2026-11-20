"""Every acceptance-case number, from one read (§5.2).

The inbox tabs, the Filing rail badge, Home's queues and the Baskets grid all
count :func:`open_cases` -- the same rows through the same predicates -- so
they cannot disagree (a consistency test holds them together).
"""
from __future__ import annotations

from collections.abc import Callable, Iterable

from sqlalchemy.orm import Session

from app.models.acceptance_case import BASKET_CONTRACTOR, STATE_REJECTED, STATE_WAITING
from app.models.reference import User
from app.services import sla_policy

from . import rules, scope, sync
from .scope import CaseRow

TAB_ALL = "all"
TAB_WAITING = "waiting"
TAB_REJECTED = "rejected"
TAB_NO_COMMENT = "no_comment"
TABS = (TAB_ALL, TAB_WAITING, TAB_REJECTED, TAB_NO_COMMENT)

_TAB_TEST: dict[str, Callable[[CaseRow], bool]] = {
    TAB_ALL: lambda r: True,
    TAB_WAITING: lambda r: r.state == STATE_WAITING,
    TAB_REJECTED: lambda r: r.state == STATE_REJECTED,
    TAB_NO_COMMENT: lambda r: r.stale,
}


def clock(db: Session) -> rules.Clock:
    """Today and the two SLA policy values (§5.5), read once per request."""
    return rules.Clock(
        today=rules.tehran_today(),
        sla_days=sla_policy.get_days(db, rules.SLA_BASKET),
        fresh_days=sla_policy.get_days(db, rules.SLA_FRESHNESS),
    )


def ensure_synced(db: Session) -> None:
    """Create any case a village is owed, and commit only if something moved.
    Cheap when nothing is owed: two id reads and one join (``sync``)."""
    created = sync.ensure_cases(db)
    if created or db.dirty:
        db.commit()


def open_cases(db: Session, user: User, c: rules.Clock, authority: str | None = None) -> list[CaseRow]:
    return scope.load_cases(db, user, c, authority=authority, open_only=True)


def in_tab(row: CaseRow, tab: str) -> bool:
    return _TAB_TEST[tab](row)


def tab_counts(rows: Iterable[CaseRow]) -> dict[str, int]:
    rows = list(rows)
    return {tab: sum(1 for r in rows if in_tab(r, tab)) for tab in TABS}


def summary(rows: Iterable[CaseRow]) -> dict[str, int]:
    """A queue's three figures: count, over SLA, no fresh comment."""
    rows = list(rows)
    return {
        "count": len(rows),
        "over_sla": sum(1 for r in rows if r.over_sla),
        "no_comment": sum(1 for r in rows if r.stale),
    }


# --------------------------------------------------------------------------
# Home's queues (§5.7): each a predicate over the same open cases
# --------------------------------------------------------------------------
def _waiting(authority: str) -> Callable[[CaseRow], bool]:
    return lambda r: r.authority == authority and r.state == STATE_WAITING


def _contractor_rejection(r: CaseRow) -> bool:
    return r.state == STATE_REJECTED and r.basket_role == BASKET_CONTRACTOR


def _pending(authority: str) -> Callable[[CaseRow], bool]:
    return lambda r: r.authority == authority


#: Home queue key -> which open cases it holds.
HOME_QUEUES: dict[str, Callable[[CaseRow], bool]] = {
    "ict_pending": _pending("ICT"),
    "cra_pending": _pending("CRA"),
    "ict_case_waiting": _waiting("ICT"),
    "cra_case_waiting": _waiting("CRA"),
    "case_rejected_contractor": _contractor_rejection,
    # A team role reads only its own basket, so every open case is in it.
    "case_team_basket": lambda r: True,
    # The Filing rail badge: everything in the viewer's inbox, both sides.
    "acceptance_filing": lambda r: True,
}


def queue_rows(db: Session, user: User, key: str, c: rules.Clock | None = None) -> list[CaseRow]:
    """The open cases one Home queue holds for this user (none for a role
    with no Filing scope)."""
    if scope.viewer_kind(user) is None:
        return []
    test = HOME_QUEUES[key]
    return [r for r in open_cases(db, user, c or clock(db)) if test(r)]
