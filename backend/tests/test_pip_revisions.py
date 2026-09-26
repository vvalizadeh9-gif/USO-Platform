"""Tests for PIP streams and the revision-request workflow.

The rules being checked:

* A contractor asks for a new number on an approved plan, with a reason; an
  ``OTHER`` reason needs a comment. The request is a new version, and the
  approved version stays in force -- on the plan screens and on the DT
  dashboard -- until the PM approves the request.
* Revisions close at the end of day 15 of the running Shamsi month, on the
  Tehran clock. After that the approved PIP is final.
* PM approves or returns; returning needs a comment. Admin and Coordinator
  cannot decide, and another contractor cannot reach the plan at all.
* Nothing is overwritten: every version survives, and the history endpoint
  returns them in order with who did what and when.
* DT and Acceptance are separate plans that never share a version sequence
  or leak into each other's figures.

The clock is patched through ``jalali.tehran_today``: every test picks its
own "running month" far in the future, so tests cannot collide on a month and
the result does not depend on the date the suite runs.

Run with:  cd backend && pytest tests/test_pip_revisions.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_pip_revisions_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PIP = "/api/v1/pip"

#: Far enough ahead that no other test file, and no real date, reaches it.
YEAR = 1450


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_pip_revisions_pytest.db"):
        os.remove("/tmp/uep_pip_revisions_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Actors
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
    admin_h = _login(client)
    company_a = _make_contractor("Revision Co A")
    company_b = _make_contractor("Revision Co B")
    return {
        "admin": admin_h,
        "pm": _make_user(client, admin_h, "rev_pm", "PM"),
        "coordinator": _make_user(client, admin_h, "rev_coord", "Coordinator"),
        "a": _make_user(client, admin_h, "rev_a", "Contractor", company_a),
        "b": _make_user(client, admin_h, "rev_b", "Contractor", company_b),
        "company_a": company_a,
        "company_b": company_b,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _on_day(monkeypatch, month, day, year=YEAR):
    """Set the Tehran clock to ``day`` of the given Shamsi month."""
    today = jalali.from_shamsi_date(year, month, day)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)


def _approved_plan(client, actors, month, count, stream="DT", who="a"):
    r = client.post(
        f"{PIP}/my",
        headers=actors[who],
        json={
            "year": YEAR,
            "month": month,
            "stream": stream,
            "committed_count": count,
            "submit": True,
        },
    )
    assert r.status_code == 200, r.text
    r = client.post(f"{PIP}/{r.json()['id']}/approve", headers=actors["pm"])
    assert r.status_code == 200, r.text
    return r.json()


def _request(client, headers, month, count, *, stream="DT", reason="SITES_BLOCKED",
             comment=None, year=YEAR):
    body = {
        "year": year,
        "month": month,
        "stream": stream,
        "committed_count": count,
        "reason": reason,
    }
    if comment is not None:
        body["comment"] = comment
    return client.post(f"{PIP}/my/revision-request", headers=headers, json=body)


def _versions(client, headers, month, stream="DT", contractor_id=None):
    params = {"year": YEAR, "month": month, "stream": stream}
    if contractor_id is not None:
        params["contractor_id"] = contractor_id
    r = client.get(f"{PIP}/revisions", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()["revisions"]


def _same_moment(a, b):
    """Two ISO timestamps for the same instant. SQLite drops the offset on the
    way back out, so one side may be naive; everything is written in UTC."""
    from datetime import datetime

    def naive(text):
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)

    return naive(a) == naive(b)


def _in_force(month, contractor_id, stream="DT"):
    from app.services import monthly_plan as plans

    db = SessionLocal()
    try:
        return plans.approved_pip_in_force(db, YEAR, month, stream).get(contractor_id)
    finally:
        db.close()


def _dt_dashboard_pip(month, contractor_id):
    """What the DT dashboard's scorecard holds this contractor to."""
    from app.models.reference import User
    from app.services.drive_test_analytics import DriveTestAnalytics

    db = SessionLocal()
    try:
        pm = db.query(User).filter(User.username == "rev_pm").one()
        return DriveTestAnalytics(db, pm)._approved_pip(YEAR, month).get(contractor_id)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Revision request
# ---------------------------------------------------------------------------
def test_revision_request_happy_path(client, actors, monkeypatch):
    month = 1
    _on_day(monkeypatch, month, 10)
    approved = _approved_plan(client, actors, month, 40)

    r = _request(client, actors["a"], month, 30, reason="PERMITS")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "RevisionRequested"
    assert body["version"] == 2
    assert body["is_current"] is True
    assert body["committed_count"] == 30
    assert body["stream"] == "DT"
    assert body["revision_reason"] == "PERMITS"
    assert body["submitted_at"] is not None

    versions = _versions(client, actors["a"], month)
    assert [v["version"] for v in versions] == [1, 2]
    first = versions[0]
    assert first["status"] == "Approved", "the approved version is not touched"
    assert first["committed_count"] == 40
    assert _same_moment(first["decided_at"], approved["decided_at"])


def test_the_approved_number_stays_in_force_while_a_revision_is_pending(
    client, actors, monkeypatch
):
    month = 2
    _on_day(monkeypatch, month, 5)
    _approved_plan(client, actors, month, 40)
    assert _request(client, actors["a"], month, 60).status_code == 200

    # The plan service, the DT dashboard and the contractor's own form all
    # still hold the contractor to 40.
    assert _in_force(month, actors["company_a"]) == 40
    assert _dt_dashboard_pip(month, actors["company_a"]) == 40

    form = client.get(
        f"{PIP}/my", headers=actors["a"], params={"year": YEAR, "month": month}
    ).json()["planning"]
    assert form["status"] == "RevisionRequested"
    assert form["committed_count"] == 60, "the number asked for"
    assert form["in_force_count"] == 40, "the number that stands"
    assert form["in_force_version"] == 1

    queue = client.get(
        f"{PIP}/queue", headers=actors["pm"], params={"year": YEAR, "month": month}
    ).json()
    row = next(r for r in queue["rows"] if r["contractor_id"] == actors["company_a"])
    assert row["status"] == "RevisionRequested"
    assert row["committed_count"] == 60
    assert row["in_force_count"] == 40
    assert row["revision_reason"] == "SITES_BLOCKED"

    history = _versions(client, actors["pm"], month, contractor_id=actors["company_a"])
    assert [v["in_force"] for v in history] == [True, False]


def test_a_second_request_while_one_is_pending_is_refused(client, actors, monkeypatch):
    month = 3
    _on_day(monkeypatch, month, 5)
    _approved_plan(client, actors, month, 40)
    assert _request(client, actors["a"], month, 50).status_code == 200

    again = _request(client, actors["a"], month, 55)
    assert again.status_code == 400, again.text
    assert "already" in again.json()["detail"]

    edit = client.post(
        f"{PIP}/my",
        headers=actors["a"],
        json={"year": YEAR, "month": month, "committed_count": 70, "submit": True},
    )
    assert edit.status_code == 400, "a pending revision is not edited through /my"
    assert len(_versions(client, actors["a"], month)) == 2


def test_request_on_day_15_is_accepted(client, actors, monkeypatch):
    month = 4
    _on_day(monkeypatch, month, 1)
    _approved_plan(client, actors, month, 40)
    _on_day(monkeypatch, month, 15)
    assert _request(client, actors["a"], month, 45).status_code == 200


def test_request_after_day_15_is_refused(client, actors, monkeypatch):
    month = 5
    _on_day(monkeypatch, month, 1)
    _approved_plan(client, actors, month, 40)

    _on_day(monkeypatch, month, 16)
    r = _request(client, actors["a"], month, 45)
    assert r.status_code == 400, r.text
    assert "day 15" in r.json()["detail"]
    assert len(_versions(client, actors["a"], month)) == 1, "nothing was written"

    form = client.get(
        f"{PIP}/my", headers=actors["a"], params={"year": YEAR, "month": month}
    ).json()["planning"]
    assert form["revision_open"] is False


def test_request_for_a_month_that_is_not_running_is_refused(client, actors, monkeypatch):
    month = 6
    _on_day(monkeypatch, month, 1)
    _approved_plan(client, actors, month, 40)

    # Day 3 of the following month: the month being revised has closed.
    _on_day(monkeypatch, month + 1, 3)
    assert _request(client, actors["a"], month, 45).status_code == 400


def test_request_on_a_plan_that_is_not_approved_is_refused(client, actors, monkeypatch):
    month = 7
    _on_day(monkeypatch, month, 5)

    # Nothing filed at all.
    assert _request(client, actors["a"], month, 10).status_code == 400

    # A draft.
    client.post(
        f"{PIP}/my",
        headers=actors["a"],
        json={"year": YEAR, "month": month, "committed_count": 10},
    )
    assert _request(client, actors["a"], month, 12).status_code == 400

    # Submitted, awaiting the PM.
    client.post(
        f"{PIP}/my",
        headers=actors["a"],
        json={"year": YEAR, "month": month, "committed_count": 10, "submit": True},
    )
    assert _request(client, actors["a"], month, 12).status_code == 400

    assert [v["status"] for v in _versions(client, actors["a"], month)] == ["Submitted"]


def test_the_reason_is_required_and_other_needs_a_comment(client, actors, monkeypatch):
    month = 8
    _on_day(monkeypatch, month, 5)
    _approved_plan(client, actors, month, 40)

    body = {"year": YEAR, "month": month, "stream": "DT", "committed_count": 45}
    no_reason = client.post(f"{PIP}/my/revision-request", headers=actors["a"], json=body)
    assert no_reason.status_code == 422

    bad_reason = _request(client, actors["a"], month, 45, reason="BECAUSE")
    assert bad_reason.status_code == 422

    for blank in (None, "", "   "):
        other = _request(client, actors["a"], month, 45, reason="OTHER", comment=blank)
        assert other.status_code == 400, (blank, other.text)

    ok = _request(client, actors["a"], month, 45, reason="OTHER", comment="Tower collapsed")
    assert ok.status_code == 200, ok.text
    assert ok.json()["revision_comment"] == "Tower collapsed"


@pytest.mark.parametrize("value", [-1, 10_001, 12.5, 12.0, "12", True])
def test_the_requested_number_must_be_a_sensible_whole_number(
    client, actors, monkeypatch, value
):
    month = 9
    _on_day(monkeypatch, month, 5)
    if not _versions(client, actors["a"], month):
        _approved_plan(client, actors, month, 40)

    r = client.post(
        f"{PIP}/my/revision-request",
        headers=actors["a"],
        json={
            "year": YEAR,
            "month": month,
            "stream": "DT",
            "committed_count": value,
            "reason": "PERMITS",
        },
    )
    assert r.status_code == 422, (value, r.text)


# ---------------------------------------------------------------------------
# PM decides
# ---------------------------------------------------------------------------
def test_pm_approves_a_revision_and_it_goes_into_force(client, actors, monkeypatch):
    month = 10
    _on_day(monkeypatch, month, 5)
    first = _approved_plan(client, actors, month, 40)
    request = _request(client, actors["a"], month, 25).json()

    r = client.post(f"{PIP}/{request['id']}/approve", headers=actors["pm"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Approved"

    assert _in_force(month, actors["company_a"]) == 25
    assert _dt_dashboard_pip(month, actors["company_a"]) == 25

    versions = _versions(client, actors["a"], month)
    assert [(v["version"], v["status"], v["committed_count"]) for v in versions] == [
        (1, "Approved", 40),
        (2, "Approved", 25),
    ]
    assert [v["in_force"] for v in versions] == [False, True]
    assert _same_moment(versions[0]["decided_at"], first["decided_at"]), "v1 is not edited"


def test_pm_returns_a_revision_and_the_old_number_stays(client, actors, monkeypatch):
    month = 11
    _on_day(monkeypatch, month, 5)
    _approved_plan(client, actors, month, 40)
    request = _request(client, actors["a"], month, 20).json()

    r = client.post(
        f"{PIP}/{request['id']}/return",
        headers=actors["pm"],
        json={"comment": "Permits are not the blocker; keep 40."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "RevisionReturned"
    assert r.json()["return_comment"].startswith("Permits")
    assert _in_force(month, actors["company_a"]) == 40

    # A returned request is final; the contractor may ask again as a new
    # version while the window is open.
    again = _request(client, actors["a"], month, 30)
    assert again.status_code == 200, again.text
    assert again.json()["version"] == 3

    statuses = [v["status"] for v in _versions(client, actors["a"], month)]
    assert statuses == ["Approved", "RevisionReturned", "RevisionRequested"]


def test_returning_a_revision_without_a_comment_is_refused(client, actors, monkeypatch):
    month = 12
    _on_day(monkeypatch, month, 5)
    _approved_plan(client, actors, month, 40)
    request = _request(client, actors["a"], month, 20).json()

    for comment in ("", "   "):
        r = client.post(
            f"{PIP}/{request['id']}/return",
            headers=actors["pm"],
            json={"comment": comment},
        )
        assert r.status_code in (400, 422), r.text
    missing = client.post(f"{PIP}/{request['id']}/return", headers=actors["pm"], json={})
    assert missing.status_code == 422

    assert _versions(client, actors["a"], month)[-1]["status"] == "RevisionRequested"


def test_a_pending_revision_cannot_be_approved_after_day_15(client, actors, monkeypatch):
    month = 1
    year = YEAR + 1
    today = jalali.from_shamsi_date(year, month, 10)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)
    r = client.post(
        f"{PIP}/my",
        headers=actors["a"],
        json={"year": year, "month": month, "committed_count": 40, "submit": True},
    )
    client.post(f"{PIP}/{r.json()['id']}/approve", headers=actors["pm"])
    request = _request(client, actors["a"], month, 30, year=year).json()

    late = jalali.from_shamsi_date(year, month, 16)
    monkeypatch.setattr(jalali, "tehran_today", lambda: late)
    refused = client.post(f"{PIP}/{request['id']}/approve", headers=actors["pm"])
    assert refused.status_code == 400, refused.text

    returned = client.post(
        f"{PIP}/{request['id']}/return",
        headers=actors["pm"],
        json={"comment": "Window closed."},
    )
    assert returned.status_code == 200, "a late request can still be cleared"


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("who", ["admin", "coordinator", "a", "b"])
def test_only_the_pm_decides_a_revision(client, actors, monkeypatch, who):
    month = 2
    year = YEAR + 1
    today = jalali.from_shamsi_date(year, month, 5)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)
    existing = _versions_for(client, actors, year, month)
    if not existing:
        r = client.post(
            f"{PIP}/my",
            headers=actors["a"],
            json={"year": year, "month": month, "committed_count": 40, "submit": True},
        )
        client.post(f"{PIP}/{r.json()['id']}/approve", headers=actors["pm"])
        request_id = _request(client, actors["a"], month, 30, year=year).json()["id"]
    else:
        request_id = existing[-1]["id"]

    approve = client.post(f"{PIP}/{request_id}/approve", headers=actors[who])
    assert approve.status_code == 403, approve.text
    ret = client.post(
        f"{PIP}/{request_id}/return", headers=actors[who], json={"comment": "No."}
    )
    assert ret.status_code == 403, ret.text

    status = _versions_for(client, actors, year, month)[-1]["status"]
    assert status == "RevisionRequested", "a refused decision changes nothing"


def _versions_for(client, actors, year, month):
    """Company A's rows for a month, with ids, straight from the table."""
    from app.models.monthly_plan import ContractorMonthlyPlan

    db = SessionLocal()
    try:
        rows = (
            db.query(ContractorMonthlyPlan)
            .filter(
                ContractorMonthlyPlan.contractor_id == actors["company_a"],
                ContractorMonthlyPlan.shamsi_year == year,
                ContractorMonthlyPlan.shamsi_month == month,
            )
            .order_by(ContractorMonthlyPlan.version)
            .all()
        )
        return [{"id": r.id, "status": r.status} for r in rows]
    finally:
        db.close()


@pytest.mark.parametrize("who", ["pm", "admin", "coordinator"])
def test_staff_cannot_request_a_revision(client, actors, monkeypatch, who):
    _on_day(monkeypatch, 1, 5)
    r = _request(client, actors[who], 1, 10)
    assert r.status_code == 403, r.text


def test_another_contractor_cannot_revise_or_read_a_plan(client, actors, monkeypatch):
    month = 3
    year = YEAR + 1
    today = jalali.from_shamsi_date(year, month, 5)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)
    r = client.post(
        f"{PIP}/my",
        headers=actors["a"],
        json={"year": year, "month": month, "committed_count": 40, "submit": True},
    )
    client.post(f"{PIP}/{r.json()['id']}/approve", headers=actors["pm"])

    # B's request is scoped to B's own company, which has no plan: refused,
    # and nothing is written to A's plan.
    refused = _request(client, actors["b"], month, 5, year=year)
    assert refused.status_code == 400, refused.text
    assert [v["status"] for v in _versions_for(client, actors, year, month)] == ["Approved"]

    # B asking for A's history gets B's own (empty) history back.
    seen = client.get(
        f"{PIP}/revisions",
        headers=actors["b"],
        params={"year": year, "month": month, "contractor_id": actors["company_a"]},
    ).json()
    assert seen["contractor_id"] == actors["company_b"]
    assert seen["revisions"] == []


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
def test_version_history_is_in_order_with_who_and_when(client, actors, monkeypatch):
    month = 4
    year = YEAR + 1
    today = jalali.from_shamsi_date(year, month, 5)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)

    r = client.post(
        f"{PIP}/my",
        headers=actors["a"],
        json={"year": year, "month": month, "committed_count": 40, "submit": True},
    )
    client.post(f"{PIP}/{r.json()['id']}/approve", headers=actors["pm"])
    r2 = _request(client, actors["a"], month, 30, year=year).json()
    client.post(f"{PIP}/{r2['id']}/return", headers=actors["pm"], json={"comment": "No."})
    r3 = _request(client, actors["a"], month, 35, reason="OTHER", comment="Road washed out",
                  year=year).json()
    client.post(f"{PIP}/{r3['id']}/approve", headers=actors["pm"])

    body = client.get(
        f"{PIP}/revisions",
        headers=actors["pm"],
        params={"year": year, "month": month, "contractor_id": actors["company_a"]},
    ).json()
    assert body["stream"] == "DT"
    versions = body["revisions"]
    assert [v["version"] for v in versions] == [1, 2, 3]
    assert [v["status"] for v in versions] == ["Approved", "RevisionReturned", "Approved"]
    assert [v["committed_count"] for v in versions] == [40, 30, 35]
    assert [v["in_force"] for v in versions] == [False, False, True]
    assert [v["is_current"] for v in versions] == [False, False, True]
    for v in versions:
        assert v["submitted_by"] == "Test rev_a"
        assert v["submitted_at"] is not None
        assert v["decided_by"] == "Test rev_pm"
        assert v["decided_at"] is not None
    assert versions[1]["return_comment"] == "No."
    assert versions[2]["revision_reason"] == "OTHER"
    assert versions[2]["revision_comment"] == "Road washed out"


# ---------------------------------------------------------------------------
# Streams
# ---------------------------------------------------------------------------
def test_dt_and_acceptance_are_separate_plans(client, actors, monkeypatch):
    month = 5
    year = YEAR + 1
    today = jalali.from_shamsi_date(year, month, 5)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)

    for stream, count in (("DT", 40), ("ACCEPTANCE", 12)):
        r = client.post(
            f"{PIP}/my",
            headers=actors["a"],
            json={
                "year": year,
                "month": month,
                "stream": stream,
                "committed_count": count,
                "submit": True,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["version"] == 1, "each stream has its own version sequence"
        assert r.json()["stream"] == stream
        client.post(f"{PIP}/{r.json()['id']}/approve", headers=actors["pm"])

    # Revising one stream leaves the other alone.
    r = _request(client, actors["a"], month, 10, stream="ACCEPTANCE", year=year)
    assert r.status_code == 200, r.text

    from app.services import monthly_plan as plans

    db = SessionLocal()
    try:
        dt = plans.approved_pip_in_force(db, year, month, "DT")
        acc = plans.approved_pip_in_force(db, year, month, "ACCEPTANCE")
    finally:
        db.close()
    assert dt[actors["company_a"]] == 40
    assert acc[actors["company_a"]] == 12

    # The DT dashboard never counts an Acceptance plan.
    from app.models.reference import User
    from app.services.drive_test_analytics import DriveTestAnalytics

    db = SessionLocal()
    try:
        pm = db.query(User).filter(User.username == "rev_pm").one()
        assert DriveTestAnalytics(db, pm)._approved_pip(year, month) == dt
    finally:
        db.close()

    dt_form = client.get(
        f"{PIP}/my", headers=actors["a"], params={"year": year, "month": month}
    ).json()["planning"]
    acc_form = client.get(
        f"{PIP}/my",
        headers=actors["a"],
        params={"year": year, "month": month, "stream": "ACCEPTANCE"},
    ).json()["planning"]
    assert (dt_form["stream"], dt_form["status"]) == ("DT", "Approved")
    assert (acc_form["stream"], acc_form["status"]) == ("ACCEPTANCE", "RevisionRequested")
    assert acc_form["in_force_count"] == 12


def test_an_unknown_stream_is_refused(client, actors):
    r = client.post(
        f"{PIP}/my",
        headers=actors["a"],
        json={"year": YEAR, "month": 1, "stream": "HC", "committed_count": 1},
    )
    assert r.status_code == 422
    r = client.get(
        f"{PIP}/my", headers=actors["a"], params={"year": YEAR, "month": 1, "stream": "HC"}
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# The window itself
# ---------------------------------------------------------------------------
def test_revision_window_boundaries():
    from app.services.monthly_plan import revision_window_open

    def on(y, m, d):
        return jalali.from_shamsi_date(y, m, d)

    assert revision_window_open(1405, 7, on(1405, 7, 1))
    assert revision_window_open(1405, 7, on(1405, 7, 15))
    assert not revision_window_open(1405, 7, on(1405, 7, 16))
    assert not revision_window_open(1405, 7, on(1405, 6, 31)), "not started"
    assert not revision_window_open(1405, 7, on(1405, 8, 1)), "closed"


def test_tehran_today_follows_the_tehran_clock(monkeypatch):
    """23:00 UTC on a day is already the next day in Tehran (UTC+03:30)."""
    from datetime import date, datetime, timezone

    class FrozenUTC(datetime):
        @classmethod
        def now(cls, tz=None):
            moment = datetime(2026, 10, 7, 23, 0, tzinfo=timezone.utc)
            return moment.astimezone(tz) if tz else moment

    monkeypatch.setattr(jalali, "datetime", FrozenUTC)
    assert jalali.tehran_today() == date(2026, 10, 8)
