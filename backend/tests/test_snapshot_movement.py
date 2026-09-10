"""Month-over-month movement captured on the drive-test snapshot.

The snapshot has always stored balances. A balance answers "remaining is down
144" and refuses every follow-up question: 250 completions against 106
arrivals and 186 against 42 produce the same number, and "+47 problematic" is
either forty-seven flagged with none resolved or sixty flagged against
thirteen resolved. Nothing reconstructs that afterwards.

What is worth testing here is not the arithmetic — most of it is addition —
but the four things this capture gets wrong easily:

* **That the ledgers close.** ``opening + inflows - outflows = closing``, for
  remaining, ongoing and problematic. It is the only property that makes the
  stored figures checkable against anything, and it has to hold for numbers
  that came out of a real capture, not just for numbers fed to the arithmetic
  by hand. Both are checked.
* **A month in which nothing happened.** A quiet month must produce a valid
  row of zeroes. A capture that divides, subtracts or indexes its way into an
  exception here takes the login path down with it, because that is where it
  runs.
* **Rows written before any of this existed.** They carry NULL in every new
  column, and both the dashboard's delta chips and the next month's capture
  have to keep working over them.
* **That the per-contractor split adds up.** It is what makes "completed by
  contractor, this month against last" answerable, and it is worthless if the
  parts do not sum to the month's total — which they will not, if
  unattributable work is quietly dropped the way the charts drop it.

Run with:  cd backend && pytest tests/test_snapshot_movement.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_snapshot_movement_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

#: The on-air stage value the DT KPIs recognise. Anything else is invisible to
#: this whole dashboard, which is what makes it the right value to seed with.
ONAIR = "راه_اندازی_دائم"

#: The month the movement happens in, and the one whose first sign-in closes
#: it off. Fixed rather than derived from today so the test asserts the same
#: numbers in every month of the year.
MONTH = (1404, 6)
NEXT_MONTH = (1404, 7)


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_snapshot_movement_pytest.db"):
        os.remove("/tmp/uep_snapshot_movement_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _pin_period(monkeypatch, period):
    """Make every caller agree on which Shamsi month "now" is.

    Patched on ``app.core.jalali`` itself rather than on the modules that call
    it, because both the capture and the analytics it drives read the period
    through that one function — patching either importer alone would leave the
    two disagreeing about what month it is, which is the one thing this test
    must not do.
    """
    monkeypatch.setattr(jalali, "current_shamsi_period", lambda: period)


def _day_in(period, day=10):
    """A Gregorian date inside the given Shamsi month."""
    return jalali.from_shamsi_date(period[0], period[1], day)


def _moment_in(period, day=10):
    return datetime.combine(
        _day_in(period, day), datetime.min.time(), tzinfo=timezone.utc
    )


def _capture(db):
    from app.services.snapshots import ensure_current_month_snapshot

    ensure_current_month_snapshot(db)


def _global_row(db, period):
    from app.models.acceptance import MonthlySnapshot

    return (
        db.query(MonthlySnapshot)
        .filter(
            MonthlySnapshot.shamsi_year == period[0],
            MonthlySnapshot.shamsi_month == period[1],
            MonthlySnapshot.province_id.is_(None),
        )
        .one()
    )


def _assert_ledgers_close(row):
    """The property the whole capture exists to guarantee.

    Stated once, here, and applied to every row any test in this module
    produces — a reconciliation that only holds for the fixture somebody
    happened to write is not a reconciliation.
    """
    assert row.opening_remaining + row.flow_new_onair - row.flow_dt_completed == (
        row.closing_remaining
    ), "remaining ledger does not close"

    assert (
        row.opening_problematic
        + row.flow_newly_problematic
        - row.flow_problematic_resolved
        == row.closing_problematic
    ), "problematic ledger does not close"

    assert (
        row.opening_ongoing
        + row.flow_new_onair
        + row.flow_problematic_resolved
        - row.flow_newly_problematic
        - row.flow_dt_completed
        + row.flow_ongoing_adjustment
        == row.closing_ongoing
    ), "ongoing ledger does not close"


def _new_site(db, code):
    from app.models.workitem import Site

    site = Site(site_code=code, province_id=_province_id(db))
    db.add(site)
    db.flush()
    return site.id


def _province_id(db):
    from app.models.reference import Province

    return db.query(Province).order_by(Province.id).first().id


def _onair_item(db, site_id, site_type, **kwargs):
    from app.models.workitem import WorkItem

    item = WorkItem(
        site_id=site_id,
        site_type=site_type,
        last_stage=ONAIR,
        current_stage="New",
        **kwargs,
    )
    db.add(item)
    db.flush()
    return item


def _contractor(db, name):
    from app.models.reference import Contractor

    contractor = Contractor(name=name, type="drive_test", active=True)
    db.add(contractor)
    db.flush()
    return contractor.id


# ---------------------------------------------------------------------------
# 1. The ledgers close — over a real month with real movement
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def captured_month(client):
    """Run a month's worth of activity past the capture and hand back the row.

    Module-scoped because it is a sequence, not a state: the month is opened,
    the work happens, and the following month's first sign-in closes it. Split
    across tests it would stop being that.

    The starting drive tests are dated into an *earlier* month on purpose. A
    completion dated into this month counts as a flow through it whenever it
    was recorded, so seeding one already-done site dated into the month under
    test would show up as movement that never happened.
    """
    db = SessionLocal()
    site = _new_site(db, "MOVE-1")

    alfa = _contractor(db, "Movement Alfa")
    beta = _contractor(db, "Movement Beta")

    # Opening position: 9 on-air — 6 ongoing, 2 done (in an earlier month),
    # 1 problematic. Remaining 7.
    ongoing = [_onair_item(db, site, f"Ongoing{n}") for n in range(6)]
    for n in range(2):
        _onair_item(
            db,
            site,
            f"DoneEarlier{n}",
            dt_status="Done",
            dt_date_gregorian=_day_in((1404, 3)),
        )
    _onair_item(db, site, "Problematic0", dt_status="Problematic")
    db.commit()

    with pytest.MonkeyPatch.context() as mp:
        _pin_period(mp, MONTH)
        _capture(db)

        # --- the month happens -------------------------------------------
        # Three sites come on-air.
        for n in range(3):
            _onair_item(db, site, f"Arrived{n}")

        # Three drive tests are completed and dated into this month: one for
        # each of two contractors, and one nobody can be attributed to.
        for item, contractor_id in zip(
            ongoing[:3], [alfa, beta, None], strict=True
        ):
            item.dt_status = "Done"
            item.dt_date_gregorian = _day_in(MONTH, 12)
            item.dt_sc_contractor_id = contractor_id

        # One site is flagged problematic, with a dated health check behind it
        # so the transition is evidence rather than an inference.
        _flag_problematic(db, ongoing[3])
        db.commit()

        # The first sign-in of the following month is what closes this one.
        _pin_period(mp, NEXT_MONTH)
        _capture(db)

    row = _global_row(db, MONTH)
    db.refresh(row)
    yield db, row
    db.close()


def _flag_problematic(db, item):
    from app.models.workitem import HealthCheck

    item.current_stage = "Problematic"
    db.add(
        HealthCheck(
            work_item_id=item.id,
            status="Problematic",
            checked_at=_moment_in(MONTH, 15),
        )
    )


def test_opening_plus_inflows_minus_outflows_equals_closing(captured_month):
    """The reconciliation, on figures that came out of an actual capture."""
    _, row = captured_month
    _assert_ledgers_close(row)


def test_the_flows_say_what_actually_happened(captured_month):
    """The point of the exercise: the movement, not the net change.

    Remaining did not move at all this month — three arrivals against three
    completions. A dashboard reading the balance alone would report a month in
    which nothing happened.
    """
    _, row = captured_month

    assert row.opening_remaining == 7
    assert row.closing_remaining == 7  # net zero...
    assert row.flow_new_onair == 3  # ...over six things happening
    assert row.flow_dt_completed == 3

    assert row.flow_newly_problematic == 1
    assert row.flow_problematic_resolved == 0

    # Nothing anomalous: no site was DT-Done and Problematic at once.
    assert row.flow_ongoing_adjustment == 0


def test_the_month_opens_where_the_previous_one_closed(captured_month):
    """A month's opening is the prior month's closing, not a second reading."""
    from app.models.acceptance import OPENING_CHAINED, OPENING_OBSERVED

    db, row = captured_month
    following = _global_row(db, NEXT_MONTH)

    assert row.opening_source == OPENING_OBSERVED  # nothing to carry from
    assert following.opening_source == OPENING_CHAINED
    for field in ("onair", "dt_done", "remaining", "ongoing", "problematic"):
        assert getattr(following, f"opening_{field}") == getattr(
            row, f"closing_{field}"
        ), f"{field} disagrees across the month boundary"


def test_both_ends_record_when_they_were_read(captured_month):
    """Nothing here runs on a clock, so the reading times are part of the data."""
    _, row = captured_month
    assert row.opening_captured_at is not None
    assert row.closing_captured_at is not None
    assert row.closing_captured_at >= row.opening_captured_at


# ---------------------------------------------------------------------------
# 2. Per-contractor completions sum to the month's total
# ---------------------------------------------------------------------------
def test_per_contractor_completions_sum_to_the_month_total(captured_month):
    """Including the work no contractor can be attributed to.

    The charts drop unattributed work, deliberately — an unassigned site is
    not a contractor workload data point. A ledger cannot: dropped rows are
    exactly how a breakdown stops adding up to its total, and one of the three
    completions in this fixture has no contractor precisely to catch that.
    """
    from app.models.acceptance import SnapshotContractorCompletion

    db, row = captured_month
    rows = (
        db.query(SnapshotContractorCompletion)
        .filter(SnapshotContractorCompletion.snapshot_id == row.id)
        .all()
    )

    assert sum(r.dt_completed for r in rows) == row.flow_dt_completed
    assert sorted(r.dt_completed for r in rows) == [1, 1, 1]
    assert any(r.contractor_id is None for r in rows), (
        "unattributable completions were dropped, so the split cannot add up"
    )


# ---------------------------------------------------------------------------
# 3. A month in which nothing happened
# ---------------------------------------------------------------------------
def test_a_quiet_month_produces_a_valid_snapshot(client, monkeypatch):
    """No work items, no activity, no exception — and a row that reconciles.

    This runs on the login path. A capture that raises on an empty month does
    not produce a missing snapshot, it produces a platform nobody can sign in
    to.
    """
    quiet = (1402, 4)
    following = (1402, 5)

    db = SessionLocal()
    try:
        _pin_period(monkeypatch, quiet)
        _capture(db)
        _pin_period(monkeypatch, following)
        _capture(db)

        row = _global_row(db, quiet)
        db.refresh(row)

        _assert_ledgers_close(row)
        assert row.flow_new_onair == 0
        assert row.flow_dt_completed == 0
        assert row.flow_newly_problematic == 0
        assert row.flow_problematic_resolved == 0
        assert row.opening_remaining == row.closing_remaining
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 4. Rows written before any of this existed
# ---------------------------------------------------------------------------
def test_a_pre_movement_row_still_drives_the_dashboard_deltas(client, monkeypatch):
    """The delta chips read the six original columns and nothing else.

    A row captured before movement existed carries NULL in every new column.
    That must be invisible to the dashboard, which is the whole reason the new
    columns are additive rather than a rewrite of the old ones.
    """
    from app.models.acceptance import MonthlySnapshot
    from app.services.snapshots import get_month_over_month

    period = (1401, 8)
    previous = jalali.previous_period(*period)

    db = SessionLocal()
    try:
        # Written exactly as the code before this change wrote it.
        legacy = MonthlySnapshot(
            shamsi_year=previous[0],
            shamsi_month=previous[1],
            province_id=None,
            total_onair=1200,
            total_dt_done=800,
            total_remaining=400,
            total_ongoing=350,
            total_problematic=50,
            current_month_dt_done=90,
        )
        db.add(legacy)
        db.commit()

        assert legacy.opening_onair is None
        assert legacy.closing_captured_at is None

        _pin_period(monkeypatch, period)
        assert get_month_over_month(db, None) == {
            "total_onair": 1200,
            "total_dt_done": 800,
            "total_remaining": 400,
            "total_ongoing": 350,
            "total_problematic": 50,
            "current_month_dt_done": 90,
        }
    finally:
        db.close()

    headers = _login(client)
    body = client.get("/api/v1/drive-test/overview", headers=headers).json()
    assert body["kpis"]["total_onair"]["delta"] is not None


def test_the_month_before_this_change_is_closed_off_on_its_own_totals(
    client, monkeypatch
):
    """A legacy row is finished, not backfilled, and the next month chains to it.

    The first sign-in of the following month is the earliest a closing balance
    can be taken, and it is taken for the legacy row too. Its ``total_*`` are a
    real reading of where the project stood when that month opened, so they
    become its opening; the live reading becomes its closing. Two genuine
    observations, no reconstruction — and nothing older than the immediately
    preceding month is touched at all.
    """
    from app.models.acceptance import (
        OPENING_CHAINED,
        OPENING_OBSERVED,
        MonthlySnapshot,
    )

    period = (1400, 2)
    following = (1400, 3)
    totals = {
        "total_onair": 500,
        "total_dt_done": 200,
        "total_remaining": 300,
        "total_ongoing": 280,
        "total_problematic": 20,
        "current_month_dt_done": 15,
    }

    db = SessionLocal()
    try:
        db.add(
            MonthlySnapshot(
                shamsi_year=period[0],
                shamsi_month=period[1],
                province_id=None,
                **totals,
            )
        )
        db.commit()

        _pin_period(monkeypatch, following)
        _capture(db)

        legacy = _global_row(db, period)
        row = _global_row(db, following)
        db.refresh(legacy)
        db.refresh(row)

        # The original balances are exactly as they were written.
        for field, value in totals.items():
            assert getattr(legacy, field) == value

        # Its opening is recovered from them; its closing is the live reading.
        assert legacy.opening_source == OPENING_OBSERVED
        assert legacy.opening_remaining == 300
        assert legacy.opening_problematic == 20
        _assert_ledgers_close(legacy)

        # And the following month opens exactly where that closed.
        assert row.opening_source == OPENING_CHAINED
        assert row.opening_remaining == legacy.closing_remaining
        assert row.opening_problematic == legacy.closing_problematic
        _assert_ledgers_close(row)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 5. The original balances are never rewritten
# ---------------------------------------------------------------------------
def test_refreshing_an_open_month_leaves_the_original_totals_alone(
    client, monkeypatch
):
    """Movement figures are refreshed through the month; the deltas' inputs are not.

    Every delta chip on the dashboard is computed from ``total_*``. Refreshing
    those as the month goes on would silently redefine what each chip means,
    from "against where last month started" to "against wherever last month
    had got to when somebody last signed in".
    """
    from app.services.snapshots import MOVEMENT_REFRESH_INTERVAL

    period = (1403, 9)

    db = SessionLocal()
    try:
        _pin_period(monkeypatch, period)
        _capture(db)

        row = _global_row(db, period)
        before = (row.total_onair, row.total_remaining, row.total_problematic)
        first_closing_at = row.closing_captured_at

        # Move the last reading well outside the refresh interval, then add
        # work and capture again — still inside the same month. Expressed
        # against the constant so raising it cannot quietly stop this test
        # from exercising a refresh at all.
        row.closing_captured_at = (
            row.closing_captured_at - MOVEMENT_REFRESH_INTERVAL * 2
        )
        site = _new_site(db, "REFRESH-1")
        _onair_item(db, site, "ArrivedMidMonth")
        db.commit()

        _capture(db)
        db.refresh(row)

        assert (row.total_onair, row.total_remaining, row.total_problematic) == before
        assert row.closing_onair == before[0] + 1  # the movement figures did move
        assert row.flow_new_onair == 1
        assert row.closing_captured_at > first_closing_at
        _assert_ledgers_close(row)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 6. The reconciliation itself, independent of any fixture
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "opening,closing,measured",
    [
        # Nothing moved.
        (
            {"onair": 0, "dt_done": 0, "remaining": 0, "ongoing": 0, "problematic": 0},
            {"onair": 0, "dt_done": 0, "remaining": 0, "ongoing": 0, "problematic": 0},
            {"dt_completed": 0, "flagged": 0, "resolved": 0},
        ),
        # Arrivals and completions, no problematic movement.
        (
            {"onair": 90, "dt_done": 30, "remaining": 60, "ongoing": 55, "problematic": 5},
            {"onair": 100, "dt_done": 45, "remaining": 55, "ongoing": 50, "problematic": 5},
            {"dt_completed": 15, "flagged": 0, "resolved": 0},
        ),
        # Churn hidden under a small net: 12 flagged against 7 resolved.
        (
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 50, "problematic": 10},
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 45, "problematic": 15},
            {"dt_completed": 0, "flagged": 12, "resolved": 7},
        ),
        # Movement the platform never dated — a CPM import's bulk status
        # change. The remainder has to land on the side its sign requires.
        (
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 50, "problematic": 10},
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 42, "problematic": 18},
            {"dt_completed": 0, "flagged": 0, "resolved": 0},
        ),
        # The same, in the other direction: sites resolved in bulk.
        (
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 40, "problematic": 20},
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 55, "problematic": 5},
            {"dt_completed": 0, "flagged": 0, "resolved": 0},
        ),
        # A site DT-Done and Problematic at once, so ongoing moves without any
        # flow having happened. The adjustment is what keeps the ledger exact.
        (
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 50, "problematic": 10},
            {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 49, "problematic": 11},
            {"dt_completed": 0, "flagged": 1, "resolved": 0},
        ),
    ],
)
def test_reconcile_always_closes_all_three_ledgers(opening, closing, measured):
    """Whatever it is handed, the arithmetic it produces must reconcile."""
    from app.services.snapshots import reconcile

    flows = reconcile(opening, closing, measured)

    assert (
        opening["remaining"] + flows["flow_new_onair"] - flows["flow_dt_completed"]
        == closing["remaining"]
    )
    assert (
        opening["problematic"]
        + flows["flow_newly_problematic"]
        - flows["flow_problematic_resolved"]
        == closing["problematic"]
    )
    assert (
        opening["ongoing"]
        + flows["flow_new_onair"]
        + flows["flow_problematic_resolved"]
        - flows["flow_newly_problematic"]
        - flows["flow_dt_completed"]
        + flows["flow_ongoing_adjustment"]
        == closing["ongoing"]
    )

    # Never negative: a flow is a count of things that happened.
    assert flows["flow_newly_problematic"] >= 0
    assert flows["flow_problematic_resolved"] >= 0


def test_reconcile_keeps_the_dated_transitions_it_was_given():
    """Undated movement is added to the measured split, never substituted for it."""
    from app.services.snapshots import reconcile

    opening = {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 50, "problematic": 10}
    closing = {"onair": 100, "dt_done": 40, "remaining": 60, "ongoing": 47, "problematic": 13}

    flows = reconcile(opening, closing, {"dt_completed": 0, "flagged": 9, "resolved": 6})

    # The nine dated flags and six dated resolutions survive intact; the net
    # of three the balances demand is already satisfied by them, so nothing is
    # attributed on top.
    assert flows["flow_newly_problematic"] == 9
    assert flows["flow_problematic_resolved"] == 6
