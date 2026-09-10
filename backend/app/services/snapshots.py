"""Monthly snapshot service.

Stores a per-Shamsi-month snapshot of the Drive Test KPIs so the dashboard
can show month-over-month deltas, and — since this change — enough of the
movement *through* each month that it can be reconstructed afterwards.

WHEN THIS RUNS. On demand, from the login endpoint, not from a scheduler.
Nothing in this platform runs on a clock. That is the fact the whole design
below is shaped around, and it has two consequences worth stating plainly:

* A month's "closing" balance is the last reading taken while that month was
  still open, not a reading taken at midnight on its last day. How close to
  the boundary it was is recorded in ``closing_captured_at`` rather than left
  for a reader to assume.
* A period nobody signs in during is never captured at all. The next period
  captured says so: its ``opening_source`` is ``observed`` rather than
  ``chained``, because there was no closing balance to carry forward.

WHAT IT WRITES. The original ``total_*`` balances are written once, when the
period's row is created, and are never rewritten — every delta chip on the
dashboard is computed from them, so refreshing them would silently change
what those chips mean. The movement columns are refreshed: while a month is
open they are brought up to date at most every
:data:`MOVEMENT_REFRESH_INTERVAL`, and the month is closed off at the first
sign-in of the following month, which is the earliest moment a final reading
can be taken.

HOW THE FLOWS ARE ARRIVED AT. See :func:`reconcile` — one of the four is
measured outright, one is measured from dated evidence and reconciled, and
one is derived. Which is which matters when reading the numbers, so it is
written down there rather than left implicit.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance import (
    OPENING_CHAINED,
    OPENING_OBSERVED,
    MonthlySnapshot,
    SnapshotContractorCompletion,
)
from app.models.reference import Province
from app.services.drive_test_analytics import DriveTestAnalytics

#: How stale an *open* month's provisional movement figures may get.
#:
#: This interval does not affect any closed month's accuracy. A month's real
#: closing balance is taken at the first sign-in of the following month, which
#: is the earliest a final reading can exist and is unconditional — so what
#: this controls is only how current the figures for a month still in progress
#: are, and against that sits the cost of taking them.
#:
#: That cost is not small: a capture re-reads every visible work item once for
#: the country and once for each of the thirty-one provinces, and it runs on
#: the login path, because nothing in this platform runs on a clock. Doing it
#: on every sign-in would put that on every user all day for a figure nothing
#: displays yet. A day is what a nightly job would give, which is what this is
#: standing in for.
MOVEMENT_REFRESH_INTERVAL = timedelta(days=1)

#: The balances captured at both ends of a month, in the order they are read.
_BALANCE_KEYS = ("onair", "dt_done", "remaining", "ongoing", "problematic")


def ensure_current_month_snapshot(db: Session) -> None:
    """Create or refresh this Shamsi month's global + per-province snapshots.

    Safe to call on every login. It takes one live reading of the KPIs and
    uses it for up to three things at once, which is what keeps the figures
    consistent with each other:

    * the closing balance of the month that has just ended, if this is the
      first sign-in of a new month;
    * the opening balance of this month, which is that same reading — so a
      month's opening and the previous month's closing are one observation
      rather than two that can disagree;
    * this month's closing balance so far, refreshed as the month goes on.

    Returns early — before computing anything — once this month's figures are
    fresh enough, which is the overwhelmingly common case.
    """
    year, month = jalali.current_shamsi_period()
    current = _rows_for_period(db, year, month)
    if current and not _refresh_due(current):
        return

    now = datetime.now(timezone.utc)
    first_capture = not current
    prev_year, prev_month = jalali.previous_period(year, month)
    previous = _rows_for_period(db, prev_year, prev_month) if first_capture else {}

    for province_id, scope in _scopes(db):
        analytics = DriveTestAnalytics(db, scope)
        kpis = analytics.compute_kpis()
        balances = _balances(kpis)

        # Close off last month with this reading before opening this one on
        # it. Only at the first capture of a new month: after that, last
        # month is finished and must not be touched again.
        if first_capture:
            closing_row = previous.get(province_id)
            if closing_row is not None:
                _write_movement(db, analytics, closing_row, balances, now)

        row = current.get(province_id)
        if row is None:
            row = _snapshot_row(year, month, province_id, kpis)
            db.add(row)
            db.flush()  # need row.id for the contractor completions below
            _set_opening(row, _carried_opening(previous.get(province_id)), balances, now)
        elif row.opening_onair is None:
            # A row written before movement capture existed, still inside its
            # own month. Its ``total_*`` columns are a real reading taken at
            # the start of that month, so they are its opening balance — the
            # one case where an opening is recovered rather than carried.
            _recover_opening(row)

        _write_movement(db, analytics, row, balances, now)

    db.commit()


def reconcile(opening: dict, closing: dict, measured: dict) -> dict:
    """Turn two balances and what was measured between them into flows.

    The property this exists to guarantee, for each of the three ledgers::

        opening + inflows - outflows = closing

    Three of the four flows are honest in different ways, and reading them
    without knowing which is which would be a mistake:

    ``flow_dt_completed`` is **measured**. It is the count of drive tests
    dated into the month by the platform's one dating rule, unchanged and
    asked through the same code the dashboard asks. It owes nothing to the
    balances and can be checked against them.

    ``flow_newly_problematic`` / ``flow_problematic_resolved`` are **measured
    and then reconciled**. The transitions the platform dates — an in-app
    health check validated, a drive test approved — are counted directly. The
    ones it does not date cannot be: a CPM import overwrites ``dt_status`` in
    bulk and records nothing about when any individual site changed. Whatever
    net movement the balances show beyond the dated transitions is therefore
    attributed to whichever side its sign requires. That keeps the ledger
    exact and keeps the split directionally right, but it means a large
    unreconciled remainder shows up as flags or resolutions that no dated
    event supports. Dating those transitions at import time would fix it, and
    is a change to the import, not to this.

    ``flow_new_onair`` is **derived** — the movement in the remaining ledger
    that completed drive tests do not explain. It is a net figure: it cannot
    tell ten arrivals and three departures from seven arrivals. Sites do not
    ordinarily leave on-air, so in practice it reads as arrivals.
    """
    dt_completed = measured["dt_completed"]

    # Remaining: on-air arrives, completed drive tests leave.
    new_onair = closing["remaining"] - opening["remaining"] + dt_completed

    # Problematic: dated transitions first, then the undated remainder.
    net_problematic = closing["problematic"] - opening["problematic"]
    unexplained = net_problematic - (measured["flagged"] - measured["resolved"])
    flagged = measured["flagged"] + max(unexplained, 0)
    resolved = measured["resolved"] + max(-unexplained, 0)

    # Ongoing: everything above, in the directions ongoing sees them. The
    # adjustment is whatever is left, which is zero unless a site is DT-Done
    # and Problematic at once — see MonthlySnapshot.flow_ongoing_adjustment.
    adjustment = (
        closing["ongoing"]
        - opening["ongoing"]
        - new_onair
        - resolved
        + flagged
        + dt_completed
    )

    return {
        "flow_new_onair": new_onair,
        "flow_dt_completed": dt_completed,
        "flow_newly_problematic": flagged,
        "flow_problematic_resolved": resolved,
        "flow_ongoing_adjustment": adjustment,
    }


def get_month_over_month(db: Session, province_id: int | None) -> dict:
    """Return the previous period's snapshot totals for delta computation.

    Returns an empty dict when there is no prior snapshot (first month),
    so the caller renders a neutral delta.

    Reads only the original ``total_*`` columns. The movement columns are
    deliberately not surfaced here: nothing displays them yet, and the delta
    chips on the dashboard must keep computing from exactly what they always
    computed from.
    """
    year, month = jalali.current_shamsi_period()
    prev_year, prev_month = jalali.previous_period(year, month)
    row = db.execute(
        select(MonthlySnapshot).where(
            MonthlySnapshot.shamsi_year == prev_year,
            MonthlySnapshot.shamsi_month == prev_month,
            MonthlySnapshot.province_id.is_(province_id)
            if province_id is None
            else MonthlySnapshot.province_id == province_id,
        )
    ).scalar_one_or_none()
    if row is None:
        return {}
    return {
        "total_onair": row.total_onair,
        "total_dt_done": row.total_dt_done,
        "total_remaining": row.total_remaining,
        "total_ongoing": row.total_ongoing,
        "total_problematic": row.total_problematic,
        "current_month_dt_done": row.current_month_dt_done,
    }


# ---------------------------------------------------------------------------
# Capture internals
# ---------------------------------------------------------------------------
def _rows_for_period(
    db: Session, year: int, month: int
) -> dict[int | None, MonthlySnapshot]:
    """Every snapshot row for one period, keyed by province (None = global)."""
    rows = db.execute(
        select(MonthlySnapshot).where(
            MonthlySnapshot.shamsi_year == year,
            MonthlySnapshot.shamsi_month == month,
        )
    ).scalars()
    return {row.province_id: row for row in rows}


def _refresh_due(rows: dict[int | None, MonthlySnapshot]) -> bool:
    """Whether an already-captured open month is stale enough to re-read.

    A row that has never carried movement figures is always due, so the first
    login after this change starts capturing straight away rather than
    waiting out an interval against a timestamp that was never written.
    """
    cutoff = datetime.now(timezone.utc) - MOVEMENT_REFRESH_INTERVAL
    for row in rows.values():
        captured = _as_aware(row.closing_captured_at)
        if captured is None or captured < cutoff:
            return True
    return False


def _as_aware(dt: datetime | None) -> datetime | None:
    """Coerce a possibly-naive datetime to UTC-aware.

    PostgreSQL hands these back tz-aware; SQLite, which the test suite runs
    on, does not. Comparing the two raises, and the caller here is reached
    from the login path, so the failure would be a platform nobody can sign
    in to. Same helper, same reason, as ``services/health_check._as_aware``.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _scopes(db: Session):
    """The global scope, then one per province — what a snapshot is taken of."""
    yield None, _SystemScope()
    for prov in db.query(Province).all():
        yield prov.id, _SingleProvinceScope(prov.id)


def _balances(kpis: dict) -> dict:
    return {key: kpis[f"total_{key}"] for key in _BALANCE_KEYS}


def _balances_from_totals(row: MonthlySnapshot) -> dict:
    return {key: getattr(row, f"total_{key}") for key in _BALANCE_KEYS}


def _carried_opening(previous: MonthlySnapshot | None) -> dict | None:
    """The previous period's closing balance, if there is one to carry.

    Falls back to that row's ``total_*`` for a period captured before closing
    balances were recorded — it is the reading that row does have, so a month
    following one of those still opens on a real observation.
    """
    if previous is None:
        return None
    if previous.closing_onair is not None:
        return {key: getattr(previous, f"closing_{key}") for key in _BALANCE_KEYS}
    return _balances_from_totals(previous)


def _set_opening(
    row: MonthlySnapshot,
    carried: dict | None,
    observed: dict,
    at: datetime,
) -> None:
    """Fix a row's opening balance and record where and when it came from.

    ``at`` is when the balance being written was actually read — which is not
    always now. An opening recovered from a row's own ``total_*`` was read
    when that row was created, and saying otherwise would make the figure look
    fresher than it is.
    """
    opening = carried if carried is not None else observed
    for key in _BALANCE_KEYS:
        setattr(row, f"opening_{key}", opening[key])
    row.opening_source = OPENING_CHAINED if carried is not None else OPENING_OBSERVED
    row.opening_captured_at = at


def _recover_opening(row: MonthlySnapshot) -> None:
    """Take a pre-movement row's opening balance from the totals it does have.

    Those totals were read when the row was created, which for a snapshot is
    the first sign-in of its own month — so they are that month's opening, and
    ``created_at`` is honestly when they were read. This is the only place an
    opening comes from anywhere but the previous period's closing, and it
    exists so a month captured before this change still reconciles instead of
    being written off.
    """
    _set_opening(row, None, _balances_from_totals(row), row.created_at)


def _write_movement(
    db: Session,
    analytics: DriveTestAnalytics,
    row: MonthlySnapshot,
    closing: dict,
    now: datetime,
) -> None:
    """Set one row's closing balance, its flows, and its contractor split."""
    if row.opening_onair is None:
        # Nothing to reconcile against. Happens when a pre-existing row for
        # last month is being closed off: it has a reading of its own start,
        # which is its opening.
        _recover_opening(row)

    year, month = row.shamsi_year, row.shamsi_month
    flagged, resolved = analytics.month_problematic_transitions(year, month)
    by_contractor = analytics.month_dt_completed_by_contractor(year, month)
    measured = {
        "dt_completed": sum(by_contractor.values()),
        "flagged": flagged,
        "resolved": resolved,
    }

    opening = {key: getattr(row, f"opening_{key}") for key in _BALANCE_KEYS}
    for key in _BALANCE_KEYS:
        setattr(row, f"closing_{key}", closing[key])
    for field, value in reconcile(opening, closing, measured).items():
        setattr(row, field, value)
    row.closing_captured_at = now

    _replace_contractor_completions(db, row, by_contractor)


def _replace_contractor_completions(
    db: Session, row: MonthlySnapshot, by_contractor: dict[int | None, int]
) -> None:
    """Rewrite this snapshot's per-contractor split from scratch.

    Deleted and re-inserted rather than merged, because the set of
    contractors with work in a month can shrink as well as grow — a site
    reassigned away from a company leaves that company with a count that
    must become absent, not stale.
    """
    db.query(SnapshotContractorCompletion).filter(
        SnapshotContractorCompletion.snapshot_id == row.id
    ).delete(synchronize_session=False)
    for contractor_id, completed in by_contractor.items():
        db.add(
            SnapshotContractorCompletion(
                snapshot_id=row.id,
                contractor_id=contractor_id,
                dt_completed=completed,
            )
        )


def _snapshot_row(
    year: int, month: int, province_id: int | None, kpis: dict
) -> MonthlySnapshot:
    return MonthlySnapshot(
        shamsi_year=year,
        shamsi_month=month,
        province_id=province_id,
        total_onair=kpis["total_onair"],
        total_dt_done=kpis["total_dt_done"],
        total_remaining=kpis["total_remaining"],
        total_ongoing=kpis["total_ongoing"],
        total_problematic=kpis["total_problematic"],
        current_month_dt_done=kpis.get("current_month_dt_done", 0),
    )


class _SystemScope:
    """A pseudo-user that sees all provinces (for global snapshot/analytics)."""

    sees_all_provinces = True
    contractor_id = None

    class role:  # noqa: N801 - mimic ORM attribute access
        name = "Admin"
        # Snapshots are system-wide, never scoped to one category owner's
        # queue. Mirrors Role.is_category_owner so visibility rules that read
        # the flag work against this stub too.
        is_category_owner = False


class _SingleProvinceScope:
    """A pseudo-user scoped to exactly one province (for per-province KPIs)."""

    sees_all_provinces = False
    contractor_id = None

    class role:  # noqa: N801
        name = "PM"
        is_category_owner = False

    def __init__(self, province_id: int) -> None:
        self._province_id = province_id

    @property
    def provinces(self):
        class _P:
            def __init__(self, pid: int) -> None:
                self.id = pid

        return [_P(self._province_id)]
