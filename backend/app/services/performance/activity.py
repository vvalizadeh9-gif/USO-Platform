"""Activity in UEP, and the three response times, read from the submissions.

There is no separate event table: ``acceptance_submissions`` already is the
append-only log. A reviewed round is never changed, and a re-filing is a new
row (``round_no`` + 1). Every event the brief names is a reading of it:

=========  ==================================================================
filed      a round that was not withdrawn: ``submitted_at`` by ``submitted_by``
validated  ``reviewed_at`` by ``reviewed_by``, Validated or Returned, where the
           reviewer is not the filer (a self-decided round took no review)
rejected   a validated round claiming ``Rejected`` for any technology: a
           refusal by the authority. A coordinator's Returned is not one.
refiled    the next round for the same village and authority after a
           rejection, under a different letter number
=========  ==================================================================

Response times are medians, in days:

1. **Filing to validation**, credited to the reviewer.
2. **DT done to first filing**, credited to whoever filed the first round for
   that village and authority.
3. **Rejection to re-filing**, credited to whoever filed the new round.

Only people who act in UEP have activity: contractors (through the accounts
linked to their company), coordinators (through ``kpi_person_name``) and PM.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable
from itertools import pairwise
from dataclasses import dataclass
from datetime import date, datetime, timezone
from statistics import median

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core.deps import CONTRACTOR, COORDINATOR, PM
from app.models.acceptance_workflow import (
    CLAIM_REJECTED,
    REVIEW_RETURNED,
    REVIEW_VALIDATED,
    REVIEW_WITHDRAWN,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.reference import Contractor, Role, User
from app.models.workitem import Village, WorkItem
from app.services import kpi
from app.services.performance import definitions as D
from app.services.performance.periods import Window, tehran_day

#: The lenses whose owners act in UEP, and the role whose accounts act for them.
ACTOR_ROLE = {
    kpi.LENS_CONTRACTOR: CONTRACTOR,
    kpi.LENS_COORDINATOR: COORDINATOR,
    kpi.LENS_COUNTRY: PM,
}

#: What Compare's Speed ranks each kind on.
SPEED_MEASURE = {
    kpi.LENS_CONTRACTOR: D.FIRST_FILING,
    kpi.LENS_COORDINATOR: D.VALIDATION,
}

_SECONDS_PER_DAY = 86_400


@dataclass(frozen=True, slots=True)
class Act:
    """One filing or one validation."""

    kind: str  # "filed" | "validated"
    user_id: int
    day: date


@dataclass(frozen=True, slots=True)
class Timed:
    """One response time: who it is credited to, when it ended, how long."""

    measure: str
    user_id: int
    day: date
    days: float


@dataclass(frozen=True)
class Actor:
    """An account, and which owner it acts for under each actor lens."""

    user_id: int
    role: str
    owner: str | None  # contractor name, coordinator name, or None for PM


@dataclass
class Activity:
    acts: list[Act]
    timed: list[Timed]
    actors: dict[int, Actor]

    def owner_of(self, lens: str) -> Callable[[int], str | None]:
        """``user_id -> owner name`` under an actor lens; None when the
        account does not act for anybody under it."""
        role = ACTOR_ROLE[lens]

        def name(user_id: int) -> str | None:
            actor = self.actors.get(user_id)
            if actor is None or actor.role != role:
                return None
            return kpi.COUNTRY_KEY if lens == kpi.LENS_COUNTRY else actor.owner

        return name

    def users_for(self, lens: str, key: str) -> set[int]:
        owner = self.owner_of(lens)
        wanted = key.casefold()
        return {
            uid for uid in self.actors if (name := owner(uid)) and name.casefold() == wanted
        }

    def count(self, kind: str, users: set[int], window: Window) -> int:
        return sum(1 for a in self.acts if a.kind == kind and a.user_id in users
                   and a.day in window)

    def durations(
        self, measure: str, users: set[int] | None, window: Window | None = None
    ) -> list[float]:
        return [
            t.days for t in self.timed
            if t.measure == measure
            and (users is None or t.user_id in users)
            and (window is None or t.day in window)
        ]


def median_days(values: Iterable[float]) -> float | None:
    """The median, to one decimal; None with nothing to take it of."""
    values = list(values)
    if not values:
        return None
    return round(median(values), 1)


def load(db: Session) -> Activity:
    rounds = _rounds(db)
    return Activity(acts=list(_acts(rounds)), timed=list(_timed(rounds)), actors=_actors(db))


# ----- Loading --------------------------------------------------------------


def _actors(db: Session) -> dict[int, Actor]:
    rows = db.execute(
        select(User.id, Role.name, User.kpi_person_name, Contractor.name)
        .join(Role, User.role_id == Role.id)
        .outerjoin(Contractor, User.contractor_id == Contractor.id)
        .where(Role.name.in_(tuple(ACTOR_ROLE.values())))
    ).all()
    out = {}
    for uid, role, person, contractor in rows:
        owner = contractor if role == CONTRACTOR else person if role == COORDINATOR else None
        out[uid] = Actor(uid, role, owner)
    return out


@dataclass(frozen=True, slots=True)
class _Round:
    id: int
    village_id: int
    authority: str
    round_no: int
    letter: str
    status: str
    submitted_by: int | None
    submitted_at: datetime
    reviewed_by: int | None
    reviewed_at: datetime | None
    rejected: bool
    dt_day: date | None


def _rounds(db: Session) -> list[_Round]:
    rejected = exists().where(
        AcceptanceSubmissionTech.submission_id == AcceptanceSubmission.id,
        AcceptanceSubmissionTech.claimed_status == CLAIM_REJECTED,
    )
    rows = db.execute(
        select(
            AcceptanceSubmission.id,
            AcceptanceSubmission.village_id,
            AcceptanceSubmission.authority,
            AcceptanceSubmission.round_no,
            AcceptanceSubmission.letter_number,
            AcceptanceSubmission.review_status,
            AcceptanceSubmission.submitted_by,
            AcceptanceSubmission.submitted_at,
            AcceptanceSubmission.reviewed_by,
            AcceptanceSubmission.reviewed_at,
            rejected,
            WorkItem.dt_date_gregorian,
        )
        .join(Village, AcceptanceSubmission.village_id == Village.id)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .order_by(AcceptanceSubmission.round_no, AcceptanceSubmission.id)
    ).all()
    return [
        _Round(r[0], r[1], r[2], r[3], (r[4] or "").strip(), r[5], r[6], r[7],
               r[8], r[9], bool(r[10]), r[11])
        for r in rows
    ]


def _acts(rounds: list[_Round]):
    for r in rounds:
        if r.status != REVIEW_WITHDRAWN and r.submitted_by is not None:
            yield Act("filed", r.submitted_by, tehran_day(r.submitted_at))
        if _reviewed_by_another(r):
            yield Act("validated", r.reviewed_by, tehran_day(r.reviewed_at))


def _reviewed_by_another(r: _Round) -> bool:
    return (
        r.status in (REVIEW_VALIDATED, REVIEW_RETURNED)
        and r.reviewed_at is not None
        and r.reviewed_by is not None
        and r.reviewed_by != r.submitted_by
    )


def _days(later: datetime, earlier: datetime) -> float:
    return (_aware(later) - _aware(earlier)).total_seconds() / _SECONDS_PER_DAY


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _timed(rounds: list[_Round]):
    chains: dict[tuple[int, str], list[_Round]] = defaultdict(list)
    for r in rounds:
        if _reviewed_by_another(r):
            yield Timed(D.VALIDATION, r.reviewed_by, tehran_day(r.reviewed_at),
                        _days(r.reviewed_at, r.submitted_at))
        if r.status != REVIEW_WITHDRAWN:
            chains[(r.village_id, r.authority)].append(r)

    for rounds in chains.values():
        first = rounds[0]
        filed_day = tehran_day(first.submitted_at)
        if first.submitted_by is not None and first.dt_day is not None and filed_day >= first.dt_day:
            yield Timed(D.FIRST_FILING, first.submitted_by, filed_day,
                        float((filed_day - first.dt_day).days))
        for earlier, later in pairwise(rounds):
            if (
                earlier.status == REVIEW_VALIDATED
                and earlier.rejected
                and earlier.reviewed_at is not None
                and later.submitted_by is not None
                and later.letter != earlier.letter
            ):
                yield Timed(D.REFILING, later.submitted_by, tehran_day(later.submitted_at),
                            _days(later.submitted_at, earlier.reviewed_at))
