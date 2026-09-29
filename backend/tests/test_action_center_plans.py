"""Action Center items for monthly plans (PIP).

The rules being checked:

* PM: "Plan awaiting approval" for a Submitted plan and "Revision awaiting
  approval" for a RevisionRequested one; each goes away once decided.
* Contractor: "Plan returned", with the PM's comment, until they resubmit or
  the window closes (the covered month ends; for a revision, day 15); and
  "Plan not submitted" once the running month's deadline (day 3) has passed
  with no plan filed for a stream.
* Each item reaches only its role and, for a contractor, only its own
  company. Admin gets none of these (the Admin/PM separation); a Coordinator
  gets none either.
* Every item links to /monthly-plan for its month; the PM's opens the drawer.

The clock is ``jalali.tehran_today``; the running month is 1407/5.

Run with:  cd backend && pytest tests/test_action_center_plans.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_ac_plans_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

URL = "/api/v1/action-center/summary"
RUNNING = (1407, 5)
PLANNING = (1407, 6)


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_ac_plans_pytest.db"):
        os.remove("/tmp/uep_ac_plans_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _on_day(monkeypatch, day, period=RUNNING):
    today = jalali.from_shamsi_date(*period, day)
    monkeypatch.setattr(jalali, "tehran_today", lambda: today)


@pytest.fixture(scope="module")
def world(client):
    from app.models.monthly_plan import ContractorMonthlyPlan
    from app.models.reference import Contractor

    admin_h = _login(client)
    token = admin_h["Authorization"].split()[1]
    db = SessionLocal()
    a = Contractor(name="Alpha AC", type="drive_test", active=True)
    b = Contractor(name="Beta AC", type="drive_test", active=True)
    db.add_all([a, b])
    db.flush()

    def _plan(c, stream, period, version, status, count, current=True, comment=None):
        p = ContractorMonthlyPlan(
            contractor_id=c.id, stream=stream, shamsi_year=period[0], shamsi_month=period[1],
            version=version, is_current=current, committed_count=count, status=status,
            return_comment=comment,
        )
        db.add(p)
        db.flush()
        return p.id

    ids = {
        # Waiting on the PM.
        "a_dt_planning": _plan(a, "DT", PLANNING, 1, "Submitted", 40),
        "b_dt_revision": _plan(b, "DT", RUNNING, 2, "RevisionRequested", 30),
        # Already decided: never an item.
        "a_dt_running": _plan(a, "DT", RUNNING, 1, "Approved", 38),
        # Alpha's Acceptance revision was returned in the running month.
        "a_acc_running": _plan(a, "ACCEPTANCE", RUNNING, 2, "RevisionReturned", 12, comment="Keep 15, permits are fine."),
        # Beta's Acceptance for next month was returned.
        "b_acc_planning": _plan(b, "ACCEPTANCE", PLANNING, 1, "Returned", 9, comment="Too low."),
        # A returned plan for a month long gone: its window has closed.
        "a_dt_old": _plan(a, "DT", (1407, 2), 1, "Returned", 5, comment="Old news."),
    }
    _plan(b, "DT", RUNNING, 1, "Approved", 35, current=False)
    db.commit()
    a_id, b_id = a.id, b.id
    db.close()

    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Contractor")
    actors = {
        "admin": admin_h,
        "pm": login_as_role(client, token, "PM"),
        "coordinator": login_as_role(client, token, "Coordinator"),
    }
    for key, cid in (("alpha", a_id), ("beta", b_id)):
        password = "Test-Fixture-Passphrase"
        r = client.post("/api/v1/admin/users", headers=admin_h, json={
            "username": f"ac_{key}", "password": password, "first_name": "AC",
            "family_name": key, "role_id": role_id, "sees_all_provinces": True,
            "province_ids": [], "contractor_id": cid,
        })
        assert r.status_code == 201, r.text
        actors[key] = _login(client, f"ac_{key}", password)
    return {"actors": actors, "ids": ids, "a": a_id, "b": b_id}


def _summary(client, world, who):
    r = client.get(URL, headers=world["actors"][who])
    assert r.status_code == 200, r.text
    data = r.json()
    plan_items = [i for i in data["items"] if i["category"] == "plan"]
    counters = {c["key"]: c for c in data["counters"]}
    return plan_items, counters


def _ids(items):
    return {i["id"] for i in items}


# ---------------------------------------------------------------------------
# PM
# ---------------------------------------------------------------------------
def test_pm_sees_plans_and_revisions_waiting(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    items, counters = _summary(client, world, "pm")
    ids = world["ids"]
    assert _ids(items) == {f"pip-approve:{ids['a_dt_planning']}", f"pip-revision:{ids['b_dt_revision']}"}
    approve = next(i for i in items if i["id"].startswith("pip-approve"))
    assert approve["label"] == f"Alpha AC, DT, {jalali.month_name(PLANNING[1])} {PLANNING[0]}"
    assert approve["subtitle"] == "Plan awaiting approval: 40"
    assert approve["url"] == (
        f"/monthly-plan?year={PLANNING[0]}&month={PLANNING[1]}&stream=DT&contractor={world['a']}"
    )
    revision = next(i for i in items if i["id"].startswith("pip-revision"))
    assert revision["subtitle"] == "Revision awaiting approval: 30"
    assert counters["plans_to_approve"]["count"] == 1
    assert counters["revisions_to_approve"]["count"] == 1
    assert counters["plans_to_approve"]["url"] == "/monthly-plan"


def test_a_decided_plan_leaves_the_pm_list(client, world, monkeypatch):
    from app.models.monthly_plan import ContractorMonthlyPlan

    _on_day(monkeypatch, 10)
    db = SessionLocal()
    plan = db.get(ContractorMonthlyPlan, world["ids"]["a_dt_planning"])
    plan.status = "Approved"
    db.commit()
    try:
        items, counters = _summary(client, world, "pm")
        assert not any(i["id"].startswith("pip-approve") for i in items)
        assert "plans_to_approve" not in counters
    finally:
        plan.status = "Submitted"
        db.commit()
        db.close()


@pytest.mark.parametrize("who", ["admin", "coordinator"])
def test_admin_and_coordinator_get_no_plan_items(client, world, monkeypatch, who):
    _on_day(monkeypatch, 10)
    items, counters = _summary(client, world, who)
    assert items == []
    assert not any(k.startswith(("plans_", "revisions_")) for k in counters)


# ---------------------------------------------------------------------------
# Contractor
# ---------------------------------------------------------------------------
def test_contractor_sees_its_own_returned_plan_with_the_comment(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    items, counters = _summary(client, world, "alpha")
    returned = [i for i in items if i["id"].startswith("pip-returned")]
    # The running month's returned revision; not the long-gone month, and
    # never Beta's.
    assert _ids(returned) == {f"pip-returned:{world['ids']['a_acc_running']}"}
    assert returned[0]["subtitle"] == "Revision returned: Keep 15, permits are fine."
    assert returned[0]["url"] == f"/monthly-plan?year={RUNNING[0]}&month={RUNNING[1]}"
    assert counters["plans_returned"]["count"] == 1
    assert "plans_to_approve" not in counters


def test_a_returned_revision_clears_when_the_window_closes(client, world, monkeypatch):
    _on_day(monkeypatch, 16)
    items, _ = _summary(client, world, "alpha")
    assert not any(i["id"].startswith("pip-returned") for i in items)


def test_other_contractor_sees_only_its_own(client, world, monkeypatch):
    _on_day(monkeypatch, 10)
    items, _ = _summary(client, world, "beta")
    returned = {i["id"] for i in items if i["id"].startswith("pip-returned")}
    assert returned == {f"pip-returned:{world['ids']['b_acc_planning']}"}
    text = " ".join(f"{i['label']} {i['subtitle']}" for i in items)
    assert "Alpha" not in text and "Keep 15" not in text


def test_not_submitted_after_the_deadline_per_stream(client, world, monkeypatch):
    _on_day(monkeypatch, 4)
    items, counters = _summary(client, world, "alpha")
    missing = [i for i in items if i["id"].startswith("pip-missing")]
    month = f"{jalali.month_name(RUNNING[1])} {RUNNING[0]}"
    # Alpha filed DT for the running month (approved) and Acceptance (a
    # returned revision is still a plan); only the ICT and CRA plans, which
    # nobody in this fixture files, are missing.
    assert [i["label"] for i in missing] == [f"ICT PIP, {month}", f"CRA PIP, {month}"]

    beta, beta_counters = _summary(client, world, "beta")
    missing = [i for i in beta if i["id"].startswith("pip-missing")]
    # Beta filed DT (a pending revision) but no Acceptance plan this month.
    assert [i["label"] for i in missing] == [
        f"Acceptance PIP, {month}", f"ICT PIP, {month}", f"CRA PIP, {month}",
    ]
    assert beta_counters["plans_missing"]["count"] == 3


def test_not_submitted_waits_for_the_deadline(client, world, monkeypatch):
    _on_day(monkeypatch, 3)
    items, _ = _summary(client, world, "beta")
    assert not any(i["id"].startswith("pip-missing") for i in items)


def test_filing_clears_not_submitted(client, world, monkeypatch):
    from app.models.monthly_plan import ContractorMonthlyPlan

    _on_day(monkeypatch, 4)
    db = SessionLocal()
    filed = [
        ContractorMonthlyPlan(
            contractor_id=world["b"], stream=stream, shamsi_year=RUNNING[0],
            shamsi_month=RUNNING[1], version=1, is_current=True, committed_count=4,
            status="Submitted",
        )
        for stream in ("ACCEPTANCE", "ICT", "CRA")
    ]
    db.add_all(filed)
    db.commit()
    try:
        items, _ = _summary(client, world, "beta")
        assert not any(i["id"].startswith("pip-missing") for i in items)
    finally:
        for plan in filed:
            db.delete(plan)
        db.commit()
        db.close()
