"""UEP-27: To do, Waiting on others, and the lists behind Home's numbers.

* every queue says who acts next, and To do / Waiting add up from it;
* an undated item is No date, never late, and the four parts add up;
* "Due in 1 week" is a 7-day window;
* a queue's list sorts, filters, searches and groups -- inside the user's own
  scope -- and its export is the same list, audited, formula-safe and refused
  without the Export feature;
* the done and PIP lists answer for the right week and the right roles.

These are the rules on their own, with no database. The endpoints are tested
in ``test_home.py``, on its seeded programme (one fixture instance: a second
module re-running it would delete the SQLite file under an open engine).
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import pytest
from openpyxl import load_workbook

os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/uep_home_drilldown_pytest.db")

from app.services import home_export, home_items  # noqa: E402
from app.services.action_queues import details, done, sla  # noqa: E402
from app.services.action_queues.board import summarize  # noqa: E402
from app.services.action_queues.registry import QUEUES, QUEUES_BY_KEY  # noqa: E402
from app.services.action_queues.types import HOLDERS, PendingItem, SlaKind  # noqa: E402
from app.services.home import work_totals  # noqa: E402

NOW = datetime(2026, 11, 26, 9, 0, tzinfo=timezone.utc)
WEEK = timedelta(days=7)


# --------------------------------------------------------------------------
# Who acts next
# --------------------------------------------------------------------------
def test_every_queue_says_who_acts_next_and_what_its_items_are():
    for queue in QUEUES:
        assert queue.holder in HOLDERS, queue.key
        assert queue.entity in details.ANCHORS, queue.key


#: UEP-27 §5.1, as the spec lists it.
SPEC_HOLDERS = {
    "self": ["hc_assign", "hc_review", "hc_reroutes", "dt_assign", "dt_review", "submit_to_ict",
             "ict_to_validate", "cra_to_validate", "ict_to_file", "cra_to_file", "plans_approve",
             "cpm_changes", "hc_submit", "dt_todo", "dt_redo", "cra_returned", "plan_submit"],
    "others": ["ict_pending", "cra_pending", "acceptance_team_baskets",
               "ict_case_waiting", "cra_case_waiting"],
    "reminder": ["mojri_tracker"],
}


@pytest.mark.parametrize(("holder", "keys"), SPEC_HOLDERS.items())
def test_the_holders_are_the_specs(holder, keys):
    assert {k: QUEUES_BY_KEY[k].holder for k in keys} == {k: holder for k in keys}


def _ticket(key, holder, count, late=0, due=0, no_date=0):
    return {"queue_key": key, "holder": holder, "count": count, "late": late,
            "due_soon": due, "no_date": no_date, "on_time": count - late - due - no_date}


def test_todo_is_self_waiting_is_others_and_a_reminder_is_neither():
    totals = work_totals([
        _ticket("dt_assign", "self", 10, late=3, due=2, no_date=1),
        _ticket("hc_review", "self", 4, late=1),
        _ticket("ict_pending", "others", 20, late=5, no_date=8),
        _ticket("mojri_tracker", "reminder", 1, late=1),
    ])
    assert totals["todo"] == 14
    assert totals["todo_late"] == 4
    assert (totals["todo_late"] + totals["todo_due_soon"] + totals["todo_on_time"]
            + totals["todo_no_date"]) == totals["todo"]
    assert (totals["waiting"], totals["waiting_late"], totals["waiting_no_date"]) == (20, 5, 8)


# --------------------------------------------------------------------------
# No date, and the 7-day window
# --------------------------------------------------------------------------
def test_an_undated_item_is_no_date_never_late():
    undated = PendingItem("x", None)
    for kind in SlaKind:
        assert sla.home_status(undated, kind, 14, NOW, WEEK) == sla.NO_DATE
    # The board's rule is unchanged: measured from the tracking epoch, late.
    assert sla.is_overdue(undated, SlaKind.CONFIGURED, 14, NOW)


def test_the_four_parts_add_up_to_the_count():
    queue = QUEUES_BY_KEY["dt_assign"]
    items = [
        PendingItem(1, None),                          # no date
        PendingItem(2, NOW - timedelta(days=30)),      # late
        PendingItem(3, NOW - timedelta(days=10)),      # due in 4 days
        PendingItem(4, NOW - timedelta(days=1)),       # on time
    ]
    s = summarize(queue, items, 14, NOW, due_soon_window=WEEK)
    assert (s.late, s.due_soon, s.on_time, s.no_date) == (1, 1, 1, 1)
    assert s.late + s.due_soon + s.on_time + s.no_date == s.count
    assert s.overdue == 2, "the digest's overdue still counts the undated item"


def test_due_in_1_week_is_a_7_day_window():
    assert sla.due_soon_window() == timedelta(days=7)
    six_days = PendingItem("x", None, due_at=NOW + timedelta(days=6))
    eight_days = PendingItem("x", None, due_at=NOW + timedelta(days=8))
    window = sla.due_soon_window()
    assert sla.home_status(six_days, SlaKind.DEADLINE, 14, NOW, window) == sla.DUE_SOON
    assert sla.home_status(eight_days, SlaKind.DEADLINE, 14, NOW, window) == sla.ON_TIME
    # Under the old 3-day window the six-day item was on time.
    assert sla.item_status(six_days, SlaKind.DEADLINE, 14, NOW, timedelta(days=3)) == sla.ON_TIME


@pytest.mark.parametrize(("day", "saturday"), [
    (date(2026, 11, 28), date(2026, 11, 28)),   # a Saturday is its own week's start
    (date(2026, 11, 27), date(2026, 11, 21)),   # Friday ends the week
    (date(2026, 11, 26), date(2026, 11, 21)),
])
def test_a_week_starts_on_saturday(day, saturday):
    assert done.week_start(day) == saturday


# --------------------------------------------------------------------------
# Sorting, filtering, searching and grouping (pure)
# --------------------------------------------------------------------------
def _row(label, status, age, province=None, contractor=None, due=None):
    return {"id": label, "label": label, "site_id": label, "village_name": None,
            "province": province, "cra_region": None, "holder_name": contractor,
            "contractor": contractor, "status": status, "age_days": age, "sla_days": 14,
            "due_at": due, "url": "/x"}


ROWS = [
    _row("ON-1", "on_time", 2, "Fars", "Arya"),
    _row("ND-1", "no_date", None, "Fars", None),
    _row("LATE-YOUNG", "late", 16, "Tehran", "Arya"),
    _row("DUE-1", "due_soon", 10, "Tehran", "Pars"),
    _row("LATE-OLD", "late", 40, "Fars", "Pars"),
]


def test_late_come_first_oldest_first_then_due_on_time_and_no_date():
    picked = home_items.select_rows(ROWS, home_items.Selection())
    assert [r["label"] for r in picked.rows] == ["LATE-OLD", "LATE-YOUNG", "DUE-1", "ON-1", "ND-1"]
    assert picked.counts_by_status == {"late": 2, "due_soon": 1, "on_time": 1, "no_date": 1}


def test_a_status_filter_narrows_the_rows_not_the_chips():
    picked = home_items.select_rows(ROWS, home_items.Selection(status="late"))
    assert [r["label"] for r in picked.rows] == ["LATE-OLD", "LATE-YOUNG"]
    assert picked.counts_by_status["on_time"] == 1


def test_search_matches_any_column_and_narrows_the_chips():
    picked = home_items.select_rows(ROWS, home_items.Selection(q="pars"))
    assert {r["label"] for r in picked.rows} == {"DUE-1", "LATE-OLD"}
    assert picked.counts_by_status == {"late": 1, "due_soon": 1, "on_time": 0, "no_date": 0}


def test_grouping_puts_the_largest_group_first_with_its_late_count():
    picked = home_items.select_rows(ROWS, home_items.Selection(group="contractor"))
    assert picked.groups == [
        {"key": "Arya", "count": 2, "late": 1},
        {"key": "Pars", "count": 2, "late": 1},
        {"key": "No contractor", "count": 1, "late": 0},
    ]
    assert [r["label"] for r in picked.rows] == ["LATE-YOUNG", "ON-1", "LATE-OLD", "DUE-1", "ND-1"]


# --------------------------------------------------------------------------
# Export cells
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text", ["=HYPERLINK(\"http://x\")", "+1", "-2+3", "@SUM(A1)", "\tcmd"])
def test_formula_cells_are_escaped(text):
    row = {**_row("V-1", "late", 20), "village_name": text, "holder_name": text}
    file = home_export.build(
        [home_export.Sheet("List", home_export.ITEM_COLUMNS, [home_export.item_cells(row)])],
        home_export.About("t", "", "tester"),
    )
    ws = load_workbook(file).worksheets[0]
    header = [c.value for c in ws[1]]
    cell = ws.cell(row=2, column=header.index("Village name") + 1)
    assert cell.value == "'" + text
    assert cell.data_type == "s"
