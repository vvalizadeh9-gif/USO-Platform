"""Tests for the contractor monthly plan (PIP).

The rules being checked are the ones that would be expensive to get wrong:

* One plan per contractor per month, whichever of that company's accounts
  opens it.
* An approved plan is immutable, and revising it appends a version rather
  than editing the one that was decided.
* Exactly one current version survives a revision — the guarantee that is
  deliberately in the service layer rather than in a partial unique index,
  and which therefore has nothing but this test holding it up.
* A contractor cannot see, submit for, or decide another contractor's plan.
* PM decides. Admin does not — the separation of duties in ARCHITECTURE.md.
  If that assertion ever "fails", the permission is right and the test is
  wrong.

Run with:  cd backend && pytest tests/test_monthly_plan.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_monthly_plan_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PIP = "/api/v1/pip"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_monthly_plan_pytest.db"):
        os.remove("/tmp/uep_monthly_plan_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _role_id(client, headers, name):
    roles = client.get("/api/v1/reference/roles", headers=headers).json()
    return next(r["id"] for r in roles if r["name"] == name)


def _make_contractor(name):
    from app.models.reference import Contractor

    db = SessionLocal()
    contractor = Contractor(name=name, type="drive_test", active=True)
    db.add(contractor)
    db.commit()
    contractor_id = contractor.id
    db.close()
    return contractor_id


def _make_user(client, admin_h, username, role_name, contractor_id=None):
    password = "Test-Fixture-Passphrase"
    body = {
        "username": username,
        "password": password,
        "first_name": "Test",
        "family_name": username,
        "role_id": _role_id(client, admin_h, role_name),
        "sees_all_provinces": True,
        "province_ids": [],
    }
    if contractor_id is not None:
        body["contractor_id"] = contractor_id
    r = client.post("/api/v1/admin/users", headers=admin_h, json=body)
    assert r.status_code == 201, r.text
    return _login(client, username, password)


@pytest.fixture(scope="module")
def actors(client):
    """One PM, one Coordinator, an Admin, and two separate contractor companies.

    Company A gets two accounts on purpose: the "one plan per contractor, not
    per user" rule is only testable with a colleague to collide with.
    """
    admin_h = _login(client)
    company_a = _make_contractor("Company A")
    company_b = _make_contractor("Company B")
    return {
        "admin": admin_h,
        "pm": _make_user(client, admin_h, "pip_pm", "PM"),
        "coordinator": _make_user(client, admin_h, "pip_coord", "Coordinator"),
        "a1": _make_user(client, admin_h, "pip_a1", "Contractor", company_a),
        "a2": _make_user(client, admin_h, "pip_a2", "Contractor", company_a),
        "b1": _make_user(client, admin_h, "pip_b1", "Contractor", company_b),
        "company_a": company_a,
        "company_b": company_b,
    }


# ---------------------------------------------------------------------------
# Periods
#
# Each test claims a month of its own. Sharing one would make the tests
# order-dependent, and a plan is keyed by (contractor, month) precisely so
# that two writes to the same month collide.
# ---------------------------------------------------------------------------
_CURRENT_YEAR, _CURRENT_MONTH = jalali.current_shamsi_period()


def _shift(year, month, by):
    index = (year * 12 + (month - 1)) + by
    return index // 12, index % 12 + 1


def _future(n):
    """A Shamsi month whose day-3 deadline has not arrived yet."""
    return _shift(_CURRENT_YEAR, _CURRENT_MONTH, n)


def _past(n):
    """A Shamsi month whose day-3 deadline is comfortably behind us."""
    return _shift(_CURRENT_YEAR, _CURRENT_MONTH, -n)


def _current(client, headers, year, month):
    r = client.get(f"{PIP}/my", headers=headers, params={"year": year, "month": month})
    assert r.status_code == 200, r.text
    return r.json()


def _save(client, headers, year, month, count, submit):
    return client.post(
        f"{PIP}/my",
        headers=headers,
        json={
            "year": year,
            "month": month,
            "committed_count": count,
            "submit": submit,
        },
    )


def _rows_for(contractor_id, year, month):
    """Every version stored for one contractor's month, oldest first."""
    from app.models.monthly_plan import ContractorMonthlyPlan

    db = SessionLocal()
    rows = (
        db.query(ContractorMonthlyPlan)
        .filter(
            ContractorMonthlyPlan.contractor_id == contractor_id,
            ContractorMonthlyPlan.shamsi_year == year,
            ContractorMonthlyPlan.shamsi_month == month,
        )
        .order_by(ContractorMonthlyPlan.version)
        .all()
    )
    out = [
        {
            "id": r.id,
            "version": r.version,
            "is_current": r.is_current,
            "status": r.status,
            "committed_count": r.committed_count,
            "decided_by": r.decided_by,
            "is_default": r.is_default,
        }
        for r in rows
    ]
    db.close()
    return out


# ---------------------------------------------------------------------------
# 1. Submit and approve
# ---------------------------------------------------------------------------
def test_contractor_submits_and_pm_approves(client, actors):
    year, month = _future(1)

    empty = _current(client, actors["a1"], year, month)
    assert empty["plan"] is None, "a month nobody has filed is not an error"
    assert empty["shamsi_month_name"] == jalali.month_name(month)

    submitted = _save(client, actors["a1"], year, month, 42, True)
    assert submitted.status_code == 200, submitted.text
    plan = submitted.json()
    assert plan["status"] == "Submitted"
    assert plan["committed_count"] == 42
    assert plan["version"] == 1
    assert plan["is_current"] is True
    assert plan["is_default"] is False, "nothing sets is_default yet"
    assert plan["submitted_at"] is not None

    approved = client.post(f"{PIP}/{plan['id']}/approve", headers=actors["pm"])
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "Approved"
    assert body["decided_at"] is not None

    me = client.get("/api/v1/auth/me", headers=actors["pm"]).json()
    assert body["decided_by"] == me["id"], "the PM who decided is recorded"


def test_approving_a_plan_that_is_not_submitted_is_refused(client, actors):
    """A draft nobody has handed in is not the PM's to approve."""
    year, month = _future(2)
    draft = _save(client, actors["a1"], year, month, 5, False)
    assert draft.status_code == 200, draft.text
    assert draft.json()["status"] == "Draft"

    refused = client.post(f"{PIP}/{draft.json()['id']}/approve", headers=actors["pm"])
    assert refused.status_code == 400, refused.text


# ---------------------------------------------------------------------------
# 2 and 3. Return, and resubmit at the same version
# ---------------------------------------------------------------------------
def test_return_then_resubmit_cycles_the_same_version(client, actors):
    year, month = _future(3)
    plan_id = _save(client, actors["a1"], year, month, 10, True).json()["id"]

    returned = client.post(
        f"{PIP}/{plan_id}/return",
        headers=actors["pm"],
        json={"comment": "Too low against your open assignments."},
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["status"] == "Returned"
    assert returned.json()["return_comment"].startswith("Too low")

    # The SC sees the comment on their own screen, changes the number, and
    # hands it back in. Same version: being returned is part of one round.
    seen = _current(client, actors["a1"], year, month)
    assert seen["plan"]["return_comment"].startswith("Too low")

    resubmitted = _save(client, actors["a1"], year, month, 25, True)
    assert resubmitted.status_code == 200, resubmitted.text
    assert resubmitted.json()["status"] == "Submitted"
    assert resubmitted.json()["committed_count"] == 25
    assert resubmitted.json()["version"] == 1, "a resubmission is not a new version"
    assert resubmitted.json()["id"] == plan_id
    assert resubmitted.json()["decided_by"] is None, "the return decision is spent"

    assert len(_rows_for(actors["company_a"], year, month)) == 1


def test_returning_without_a_comment_is_refused(client, actors):
    year, month = _future(4)
    plan_id = _save(client, actors["a1"], year, month, 7, True).json()["id"]

    for comment in ("", "   "):
        refused = client.post(
            f"{PIP}/{plan_id}/return",
            headers=actors["pm"],
            json={"comment": comment},
        )
        assert refused.status_code in (400, 422), refused.text

    still = _rows_for(actors["company_a"], year, month)
    assert still[0]["status"] == "Submitted", "a refused return changes nothing"


# ---------------------------------------------------------------------------
# 4 and 5. Revision appends a version, and leaves exactly one current
# ---------------------------------------------------------------------------
def test_revising_an_approved_plan_appends_a_version(client, actors):
    year, month = _future(5)
    first_id = _save(client, actors["a1"], year, month, 30, True).json()["id"]
    client.post(f"{PIP}/{first_id}/approve", headers=actors["pm"])

    blocked = _save(client, actors["a1"], year, month, 31, False)
    assert blocked.status_code == 400, "an approved plan is not edited in place"

    revised = client.post(
        f"{PIP}/my/revise",
        headers=actors["a1"],
        json={"year": year, "month": month, "committed_count": 55},
    )
    assert revised.status_code == 200, revised.text
    second = revised.json()
    assert second["version"] == 2
    assert second["is_current"] is True
    assert second["status"] == "Draft"
    assert second["committed_count"] == 55
    assert second["id"] != first_id

    rows = _rows_for(actors["company_a"], year, month)
    assert len(rows) == 2, "the approved version is kept, not replaced"

    version_one = next(r for r in rows if r["version"] == 1)
    assert version_one["id"] == first_id
    assert version_one["status"] == "Approved", "version 1 is untouched"
    assert version_one["committed_count"] == 30
    assert version_one["is_current"] is False

    # 5. Exactly one current row. This is the rule that is enforced in the
    # service instead of by a partial unique index, so this assertion is the
    # only thing checking it.
    assert [r["is_current"] for r in rows].count(True) == 1


def test_revising_a_plan_that_is_not_approved_is_refused(client, actors):
    year, month = _future(6)
    _save(client, actors["a1"], year, month, 3, False)

    refused = client.post(
        f"{PIP}/my/revise",
        headers=actors["a1"],
        json={"year": year, "month": month, "committed_count": 9},
    )
    assert refused.status_code == 400, refused.text
    assert len(_rows_for(actors["company_a"], year, month)) == 1


# ---------------------------------------------------------------------------
# 6. One plan per contractor, not per user
# ---------------------------------------------------------------------------
def test_a_colleague_edits_the_same_plan_rather_than_starting_a_second(client, actors):
    year, month = _future(7)

    first = _save(client, actors["a1"], year, month, 12, False)
    assert first.status_code == 200, first.text

    # The colleague opens the month and finds their co-worker's draft, not a
    # blank form.
    seen = _current(client, actors["a2"], year, month)
    assert seen["plan"]["committed_count"] == 12

    second = _save(client, actors["a2"], year, month, 18, True)
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["version"] == 1

    rows = _rows_for(actors["company_a"], year, month)
    assert len(rows) == 1, "one plan per contractor per month, whoever files it"
    assert rows[0]["committed_count"] == 18


# ---------------------------------------------------------------------------
# 7. A contractor never reaches another contractor's plan
# ---------------------------------------------------------------------------
def test_a_contractor_cannot_reach_another_contractors_plan(client, actors):
    year, month = _future(8)
    b_plan_id = _save(client, actors["b1"], year, month, 99, True).json()["id"]

    # Reading. A's own view of the same month is A's, and empty.
    a_view = _current(client, actors["a1"], year, month)
    assert a_view["plan"] is None
    assert a_view["previous_month_committed"] is None

    # Deciding. Both endpoints are closed to a contractor by role, so B's plan
    # id is not a way in.
    assert client.post(
        f"{PIP}/{b_plan_id}/approve", headers=actors["a1"]
    ).status_code == 403
    assert client.post(
        f"{PIP}/{b_plan_id}/return",
        headers=actors["a1"],
        json={"comment": "no"},
    ).status_code == 403

    # Nor their own: approving is not something a contractor does at all.
    a_plan_id = _save(client, actors["a1"], year, month, 4, True).json()["id"]
    assert client.post(
        f"{PIP}/{a_plan_id}/approve", headers=actors["a1"]
    ).status_code == 403

    # The queue is every company's numbers, and is closed to all of them.
    assert client.get(
        f"{PIP}/queue", headers=actors["a1"], params={"year": year, "month": month}
    ).status_code == 403

    # Writing. Nothing on the contractor side names a contractor, so a plan
    # filed by A lands on A whatever else is in the body.
    assert _rows_for(actors["company_b"], year, month)[0]["committed_count"] == 99
    assert _rows_for(actors["company_a"], year, month)[0]["committed_count"] == 4

    # And A's own history never mentions B.
    history = client.get(
        f"{PIP}/my/history", headers=actors["a1"], params={"months": 12}
    )
    assert history.status_code == 200, history.text
    assert all(row["committed_count"] != 99 for row in history.json())


def test_an_account_with_no_contractor_cannot_use_the_contractor_side(client, actors):
    """A PM has no contractor, so ``/my`` has no plan it could mean."""
    year, month = _future(1)
    for headers in (actors["pm"], actors["admin"], actors["coordinator"]):
        assert client.get(
            f"{PIP}/my", headers=headers, params={"year": year, "month": month}
        ).status_code == 403
        assert _save(client, headers, year, month, 1, False).status_code == 403


# ---------------------------------------------------------------------------
# 8 and 9. Who decides
# ---------------------------------------------------------------------------
def test_admin_cannot_approve_or_return(client, actors):
    """Deciding a target is operational, and Admin is a systems role.

    See the Admin/PM separation of duties in ARCHITECTURE.md. If this ever
    starts failing because an Admin token got a 200, the permission changed
    and it is the permission that is wrong.
    """
    year, month = _future(9)
    plan_id = _save(client, actors["a1"], year, month, 8, True).json()["id"]

    assert client.post(
        f"{PIP}/{plan_id}/approve", headers=actors["admin"]
    ).status_code == 403
    assert client.post(
        f"{PIP}/{plan_id}/return",
        headers=actors["admin"],
        json={"comment": "not yours to send back"},
    ).status_code == 403

    assert _rows_for(actors["company_a"], year, month)[0]["status"] == "Submitted"


def test_coordinator_reads_the_queue_but_does_not_decide(client, actors):
    year, month = _future(10)
    plan_id = _save(client, actors["a1"], year, month, 21, True).json()["id"]

    queue = client.get(
        f"{PIP}/queue", headers=actors["coordinator"], params={"year": year, "month": month}
    )
    assert queue.status_code == 200, queue.text
    rows = queue.json()["rows"]

    # One row per contractor, filed or not — the companies that have not
    # submitted are the point of this screen.
    by_id = {row["contractor_id"]: row for row in rows}
    assert by_id[actors["company_a"]]["committed_count"] == 21
    assert by_id[actors["company_a"]]["status"] == "Submitted"
    assert actors["company_b"] in by_id, "a contractor that did not file still appears"
    assert by_id[actors["company_b"]]["committed_count"] is None
    assert by_id[actors["company_b"]]["status"] is None

    assert client.post(
        f"{PIP}/{plan_id}/approve", headers=actors["coordinator"]
    ).status_code == 403
    assert client.post(
        f"{PIP}/{plan_id}/return",
        headers=actors["coordinator"],
        json={"comment": "no"},
    ).status_code == 403

    # Admin may read the queue; it is deciding that is closed to them.
    assert client.get(
        f"{PIP}/queue", headers=actors["admin"], params={"year": year, "month": month}
    ).status_code == 200


# ---------------------------------------------------------------------------
# 10. The deadline is a record, not a gate
# ---------------------------------------------------------------------------
def test_submitting_after_the_deadline_succeeds_and_is_recorded_as_late(client, actors):
    year, month = _past(2)

    context = _current(client, actors["a1"], year, month)
    assert context["deadline_passed"] is True
    assert context["deadline_shamsi"].endswith("/03"), "the deadline is day 3"

    late = _save(client, actors["a1"], year, month, 15, True)
    assert late.status_code == 200, "a late plan is accepted, not refused"
    assert late.json()["is_late"] is True

    # And the PM sees which ones arrived late.
    queue = client.get(
        f"{PIP}/queue", headers=actors["pm"], params={"year": year, "month": month}
    ).json()
    row = next(r for r in queue["rows"] if r["contractor_id"] == actors["company_a"])
    assert row["is_late"] is True
    assert queue["deadline_passed"] is True


def test_submitting_before_the_deadline_is_not_late(client, actors):
    year, month = _future(11)
    context = _current(client, actors["a1"], year, month)
    assert context["deadline_passed"] is False

    on_time = _save(client, actors["a1"], year, month, 15, True)
    assert on_time.status_code == 200, on_time.text
    assert on_time.json()["is_late"] is False


# ---------------------------------------------------------------------------
# 11. Bounds
# ---------------------------------------------------------------------------
def test_a_negative_committed_count_is_refused(client, actors):
    year, month = _future(12)

    refused = _save(client, actors["a1"], year, month, -1, True)
    assert refused.status_code in (400, 422), refused.text
    assert _rows_for(actors["company_a"], year, month) == [], "nothing was written"

    # A draft with -1 is refused too: the bound is on the number, not on the
    # act of submitting.
    assert _save(client, actors["a1"], year, month, -1, False).status_code in (400, 422)

    # Zero is a real commitment — a contractor with nothing planned this month
    # says so, and that is different from not filing.
    zero = _save(client, actors["a1"], year, month, 0, True)
    assert zero.status_code == 200, zero.text
    assert zero.json()["committed_count"] == 0


def test_other_bounds_are_enforced(client, actors):
    from app.services.monthly_plan import MAX_COMMITTED_COUNT, MAX_RETURN_COMMENT

    year, month = _future(13)

    too_big = _save(client, actors["a1"], year, month, MAX_COMMITTED_COUNT + 1, True)
    assert too_big.status_code in (400, 422)

    for bad_month in (0, 13, -1):
        assert client.get(
            f"{PIP}/my", headers=actors["a1"], params={"year": year, "month": bad_month}
        ).status_code in (400, 422)
    for bad_year in (1200, 2026, 99999):
        assert _save(client, actors["a1"], bad_year, 5, 1, False).status_code in (
            400,
            422,
        )

    plan_id = _save(client, actors["a1"], year, month, 6, True).json()["id"]
    long_comment = client.post(
        f"{PIP}/{plan_id}/return",
        headers=actors["pm"],
        json={"comment": "x" * (MAX_RETURN_COMMENT + 1)},
    )
    assert long_comment.status_code in (400, 422)


def test_submitting_without_a_count_is_refused_but_a_draft_may_be_empty(client, actors):
    year, month = _future(14)

    draft = client.post(
        f"{PIP}/my",
        headers=actors["a1"],
        json={"year": year, "month": month, "submit": False},
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["committed_count"] is None
    assert draft.json()["status"] == "Draft"

    refused = client.post(
        f"{PIP}/my",
        headers=actors["a1"],
        json={"year": year, "month": month, "submit": True},
    )
    assert refused.status_code == 400, refused.text
    assert _rows_for(actors["company_a"], year, month)[0]["status"] == "Draft"


def test_a_submitted_plan_cannot_be_edited_behind_the_pms_back(client, actors):
    year, month = _future(15)
    _save(client, actors["a1"], year, month, 20, True)

    changed = _save(client, actors["a1"], year, month, 2, False)
    assert changed.status_code == 400, changed.text
    assert _rows_for(actors["company_a"], year, month)[0]["committed_count"] == 20


# ---------------------------------------------------------------------------
# Context and history
# ---------------------------------------------------------------------------
def test_the_form_carries_last_months_approved_figure(client, actors):
    """Only an approved figure counts as last month's commitment."""
    this_year, this_month = _future(20)
    last_year, last_month = _shift(this_year, this_month, -1)

    submitted = _save(client, actors["b1"], last_year, last_month, 33, True)
    assert submitted.status_code == 200, submitted.text

    awaiting = _current(client, actors["b1"], this_year, this_month)
    assert awaiting["previous_month_committed"] is None, (
        "a number the PM has not decided is a proposal, not a commitment"
    )

    client.post(f"{PIP}/{submitted.json()['id']}/approve", headers=actors["pm"])
    decided = _current(client, actors["b1"], this_year, this_month)
    assert decided["previous_month_committed"] == 33

    queue = client.get(
        f"{PIP}/queue",
        headers=actors["pm"],
        params={"year": this_year, "month": this_month},
    ).json()
    row = next(r for r in queue["rows"] if r["contractor_id"] == actors["company_b"])
    assert row["previous_month_committed"] == 33


def test_history_returns_every_month_asked_for_newest_first(client, actors):
    year, month = _past(1)
    plan_id = _save(client, actors["b1"], year, month, 44, True).json()["id"]

    history = client.get(
        f"{PIP}/my/history", headers=actors["b1"], params={"months": 6}
    )
    assert history.status_code == 200, history.text
    rows = history.json()
    assert len(rows) == 6, "a month with no plan is still a month"
    assert (rows[0]["shamsi_year"], rows[0]["shamsi_month"]) == jalali.current_shamsi_period()

    row = next(
        r for r in rows if (r["shamsi_year"], r["shamsi_month"]) == (year, month)
    )
    assert row["status"] == "Submitted"
    assert row["committed_count"] is None, "only an approved figure is a commitment"

    client.post(f"{PIP}/{plan_id}/approve", headers=actors["pm"])
    rows = client.get(
        f"{PIP}/my/history", headers=actors["b1"], params={"months": 6}
    ).json()
    row = next(
        r for r in rows if (r["shamsi_year"], r["shamsi_month"]) == (year, month)
    )
    assert row["committed_count"] == 44
    assert row["status"] == "Approved"


def test_the_form_reports_open_assignments(client, actors):
    """The count comes back, and it is this contractor's own.

    Building any real assignment here would mean importing a CPM workbook to
    get a work item, which several other modules already cover. What is
    checked is that the field is present, is an integer, and is not somebody
    else's — the count itself is produced by ``visible_work_item_ids``, the
    platform's one scoping function, which has its own tests.
    """
    year, month = _future(21)
    context = _current(client, actors["a1"], year, month)
    assert isinstance(context["open_assignments"], int)
    assert context["open_assignments"] == 0


def test_every_decision_is_written_to_the_audit_log(client, actors):
    year, month = _future(22)
    plan_id = _save(client, actors["a1"], year, month, 17, True).json()["id"]
    client.post(
        f"{PIP}/{plan_id}/return",
        headers=actors["pm"],
        json={"comment": "please justify"},
    )
    _save(client, actors["a1"], year, month, 19, True)
    client.post(f"{PIP}/{plan_id}/approve", headers=actors["pm"])

    logs = client.get(
        "/api/v1/admin/audit-logs", headers=actors["admin"], params={"limit": 200}
    )
    assert logs.status_code == 200, logs.text
    entries = [
        e
        for e in logs.json()["items"]
        if e["module"] == "PIP" and e["entity_id"] == plan_id
    ]
    actions = {e["action"] for e in entries}
    assert {"SUBMITTED", "RETURNED", "APPROVED"} <= actions

    approval = next(e for e in entries if e["action"] == "APPROVED")
    assert approval["entity_type"] == "ContractorMonthlyPlan"
    assert approval["old_value"]["status"] == "Submitted"
    assert approval["new_value"]["status"] == "Approved"
    assert approval["new_value"]["committed_count"] == 19
