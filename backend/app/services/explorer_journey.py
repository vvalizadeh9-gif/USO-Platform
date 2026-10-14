"""The Explorer record page's journey, read from plain facts.

Pure functions: nothing here touches the database. ``services/explorer.py``
loads the facts and hands them over, so every rule on the page -- which step is
current, how many days sit between two steps, what a village's ICT or CRA side
reads as -- is testable without a session.

The step order is the process's, not a guess at it: a site goes on air, the
health check pool takes every on-air site whose drive test is not Done
(``health_check.get_basket``), the drive test is assigned and done, and only
then can its villages be accepted (``acceptance_universe.in_dt_done_universe``).

Day counts never go negative and are never invented. A step without a date
(CPM imports before Mehr 1405 carry none) has no date, and every count that
needs it is ``None``.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from datetime import date

from app.services import my_work_status as S

STEP_ON_AIR = "on_air"
STEP_HEALTH_CHECK = "health_check"
STEP_ASSIGNED = "assigned"
STEP_DT_DONE = "dt_done"
STEP_ACCEPTANCE = "acceptance"
STEP_ORDER = (STEP_ON_AIR, STEP_HEALTH_CHECK, STEP_ASSIGNED, STEP_DT_DONE, STEP_ACCEPTANCE)

STATE_DONE = "done"
STATE_IN_PROGRESS = "in_progress"
STATE_UPCOMING = "upcoming"

# A village side, in the page's three words. The phase says which of the
# code's five states (``my_work_status``) it is, so the line under the word can
# be exact without a fourth colour.
SIDE_APPROVED = "approved"
SIDE_PENDING = "pending"
SIDE_REJECTED = "rejected"

PHASE_DECIDED = "decided"
PHASE_REJECTED = "rejected"
PHASE_NOT_FILED = "not_filed"
PHASE_WITH_AUTHORITY = "with_authority"
PHASE_WITH_COORDINATOR = "with_coordinator"
PHASE_RETURNED = "returned"


def days_between(start: date | None, end: date | None) -> int | None:
    """Whole days from ``start`` to ``end``; None when either is missing or
    the interval runs backwards (bad data is not negative aging)."""
    if start is None or end is None:
        return None
    days = (end - start).days
    return days if days >= 0 else None


# --------------------------------------------------------------------------
# Steps
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class StepFact:
    key: str
    done: bool
    date: date | None


def _done_flags(facts: list[StepFact]) -> list[bool]:
    """A step is done when it, or any step after it, is done.

    A site whose drive test CPM seeded as Done never had an in-app assignment,
    but it was assigned: the later step proves the earlier one.
    """
    flags: list[bool] = []
    later = False
    for fact in reversed(facts):
        later = later or fact.done
        flags.append(later)
    return list(reversed(flags))


def build_steps(facts: list[StepFact], today: date) -> list[dict]:
    """The step path: state, date and the gap from the previous step.

    ``gap_days`` is the pill between a step and the one before it. On the
    current step it runs to today (``so_far``).
    """
    flags = _done_flags(facts)
    current = next((i for i, done in enumerate(flags) if not done), None)
    steps: list[dict] = []
    for i, fact in enumerate(facts):
        state = (
            STATE_DONE if flags[i]
            else STATE_IN_PROGRESS if i == current
            else STATE_UPCOMING
        )
        when = fact.date if state == STATE_DONE else None
        steps.append({
            "key": fact.key,
            "state": state,
            "date": when,
            "gap_days": _gap(steps[-1] if steps else None, state, when, today),
        })
    return steps


def _gap(previous: dict | None, state: str, when: date | None, today: date) -> int | None:
    if previous is None or previous["state"] != STATE_DONE:
        return None
    if state == STATE_DONE:
        return days_between(previous["date"], when)
    if state == STATE_IN_PROGRESS:
        return days_between(previous["date"], today)
    return None


def site_status(steps: list[dict]) -> dict:
    """The one badge: the current step in progress, or acceptance done."""
    current = next((s for s in steps if s["state"] == STATE_IN_PROGRESS), None)
    if current is None:
        return {"step": STEP_ACCEPTANCE, "state": STATE_DONE}
    return {"step": current["key"], "state": STATE_IN_PROGRESS}


# --------------------------------------------------------------------------
# Aging
# --------------------------------------------------------------------------
def total_days(steps: list[dict], today: date) -> int | None:
    """From the first dated step to today, or to acceptance when it is done."""
    first = next((s["date"] for s in steps if s["date"] is not None), None)
    last = steps[-1]
    if last["state"] == STATE_DONE:
        return days_between(first, last["date"])
    return days_between(first, today)


def current_step_days(steps: list[dict]) -> int | None:
    current = next((s for s in steps if s["state"] == STATE_IN_PROGRESS), None)
    return current["gap_days"] if current is not None else None


def longest_step(steps: list[dict]) -> dict | None:
    """The largest gap between two consecutive dated, finished steps."""
    best: dict | None = None
    for previous, step in pairwise(steps):
        days = step["gap_days"] if step["state"] == STATE_DONE else None
        if days is not None and (best is None or days > best["days"]):
            best = {"from": previous["key"], "to": step["key"], "days": days}
    return best


def oldest_pending(villages: list[dict]) -> dict | None:
    """The longest-waiting pending ICT or CRA side, and how many villages
    that authority still has pending. None when nothing is pending."""
    best: tuple[int, str] | None = None
    pending = {"ICT": 0, "CRA": 0}
    for village in villages:
        for authority in ("ICT", "CRA"):
            side = village[authority.lower()]
            if side["status"] != SIDE_PENDING:
                continue
            pending[authority] += 1
            if side["days"] is not None and (best is None or side["days"] > best[0]):
                best = (side["days"], authority)
    if best is None:
        return None
    days, authority = best
    return {"authority": authority, "days": days, "villages": pending[authority]}


def aging(steps: list[dict], villages: list[dict], today: date) -> dict:
    return {
        "total_days": total_days(steps, today),
        "current_step_days": current_step_days(steps),
        "longest_step": longest_step(steps),
        "oldest_pending": oldest_pending(villages),
    }


# --------------------------------------------------------------------------
# One village, one authority
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class RoundFact:
    """One submission (round), as plain dates. ``review_status`` is the
    model's word: Pending | Validated | Returned | Withdrawn."""

    round_no: int
    review_status: str
    submitted_on: date | None
    reviewed_on: date | None


@dataclass(frozen=True)
class RequestFact:
    """One request letter sent to the authority."""

    sent_on: date
    letter_date: date | None


@dataclass(frozen=True)
class SideFacts:
    stored_status: str            # villages.ict_status / cra_status (the cache)
    approved_on: date | None      # acceptance_workflow.authority_verdict_date
    rejected_on: date | None      # latest decision date of a rejected technology
    rounds: tuple[RoundFact, ...]  # this side's rounds, any order
    requests: tuple[RequestFact, ...]
    dt_date: date | None          # My Work's fallback clock


def _side(status: str, phase: str, *, filed_date=None, decided_date=None,
          days=None, round_no=None) -> dict:
    return {
        "status": status,
        "phase": phase,
        "filed_date": filed_date,
        "decided_date": decided_date,
        "days": days,
        "round": round_no,
        "filed": phase != PHASE_NOT_FILED,
        "refiled": (
            phase in (PHASE_WITH_AUTHORITY, PHASE_WITH_COORDINATOR)
            and (round_no or 0) >= 2
        ),
    }


def _live_rounds(facts: SideFacts) -> list[RoundFact]:
    return sorted(
        (r for r in facts.rounds if r.review_status != "Withdrawn"),
        key=lambda r: r.round_no,
    )


def _open_request(facts: SideFacts, rounds: list[RoundFact]) -> RequestFact | None:
    """The newest request no submission has answered since
    (``acceptance_requests``: a request is open until a submission is
    recorded for the same side at or after it)."""
    if not facts.requests:
        return None
    newest = max(facts.requests, key=lambda r: r.sent_on)
    answered = any(
        r.submitted_on is not None and r.submitted_on >= newest.sent_on for r in rounds
    )
    return None if answered else newest


def _request_before(facts: SideFacts, decided: date | None) -> RequestFact | None:
    """The newest request sent on or before the decision."""
    if decided is None:
        return None
    sent = [r for r in facts.requests if r.sent_on <= decided]
    return max(sent, key=lambda r: r.sent_on) if sent else None


def _filed_on(request: RequestFact) -> date:
    return request.letter_date or request.sent_on


def side_status(facts: SideFacts, today: date) -> dict:
    """One village's ICT or CRA side, in the page's words.

    The state is My Work's (``my_work_status.display_status`` over the cached
    column). Only one thing is read on top of it: an unanswered request letter,
    which moves a not-filed or rejected side to "with the authority".
    """
    display = S.display_status(facts.stored_status)
    rounds = _live_rounds(facts)
    latest_round = rounds[-1].round_no if rounds else None

    if display == S.APPROVED:
        request = _request_before(facts, facts.approved_on)
        filed = _filed_on(request) if request else None
        return _side(SIDE_APPROVED, PHASE_DECIDED, filed_date=filed,
                     decided_date=facts.approved_on,
                     days=days_between(filed, facts.approved_on),
                     round_no=latest_round)
    if display == S.FILLED:
        pending = next((r for r in reversed(rounds) if r.review_status == "Pending"), None)
        filed = pending.submitted_on if pending else None
        return _side(SIDE_PENDING, PHASE_WITH_COORDINATOR, filed_date=filed,
                     days=days_between(filed, today),
                     round_no=pending.round_no if pending else latest_round)
    if display == S.RETURNED:
        returned = next((r for r in reversed(rounds) if r.review_status == "Returned"), None)
        since = returned.reviewed_on if returned else None
        return _side(SIDE_PENDING, PHASE_RETURNED, decided_date=since,
                     days=days_between(since, today), round_no=latest_round)

    request = _open_request(facts, rounds)
    if request is not None:
        return _side(SIDE_PENDING, PHASE_WITH_AUTHORITY, filed_date=_filed_on(request),
                     days=days_between(request.sent_on, today),
                     round_no=(latest_round or 0) + 1)
    if display == S.REJECTED:
        return _side(SIDE_REJECTED, PHASE_REJECTED, decided_date=facts.rejected_on,
                     days=days_between(facts.rejected_on, today),
                     round_no=latest_round)
    return _side(SIDE_PENDING, PHASE_NOT_FILED,
                 days=days_between(_last_activity(rounds) or facts.dt_date, today),
                 round_no=latest_round)


def _last_activity(rounds: list[RoundFact]) -> date | None:
    """My Work's clock: the latest review or submission on this side."""
    moments = [r.reviewed_on or r.submitted_on for r in rounds]
    moments = [m for m in moments if m is not None]
    return max(moments) if moments else None


def is_fully_approved(village: dict) -> bool:
    return village["ict"]["status"] == SIDE_APPROVED and village["cra"]["status"] == SIDE_APPROVED


def counts(villages: list[dict]) -> dict:
    """Approved / pending / rejected per authority: the sum of the sides."""
    out = {}
    for authority in ("ict", "cra"):
        tally = {SIDE_APPROVED: 0, SIDE_PENDING: 0, SIDE_REJECTED: 0}
        for village in villages:
            tally[village[authority]["status"]] += 1
        out[authority] = tally
    return out


def acceptance_done_on(villages: list[dict]) -> date | None:
    """When the last village became fully approved; None if any date is missing."""
    dates = []
    for village in villages:
        for authority in ("ict", "cra"):
            decided = village[authority]["decided_date"]
            if decided is None:
                return None
            dates.append(decided)
    return max(dates) if dates else None
