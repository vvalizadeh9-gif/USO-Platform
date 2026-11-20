"""Acceptance cases (UEP-22): Filing's inbox, saves, history, Baskets, roles.

What is protected, by the brief's sections:

* **Rules** (§4.2, §5.6): days in basket, the stale-comment rule, the age
  buckets, the backfill mapping, and the waiting start (Submissions sent_at,
  else the app's DT approval, else the first import -- never CPM's DT date).
* **States** (§4.2): three only; waiting is the contractor's basket; a
  rejection lands in its category's basket; Fixed returns it and resets the
  clock; approved leaves the inbox.
* **Validation link** (§5.3): a contractor's filing waits for the
  coordinator, who confirms or changes the category.
* **Roles** (§4.4) on every endpoint, and **one count** across inbox, Home
  and Baskets (§5.7).

Run with:  cd backend && pytest tests/test_acceptance_cases.py -q
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_acceptance_cases_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

DB_PATH = "/tmp/uep_acceptance_cases_pytest.db"
API = "/api/v1/acceptance"
INSIGHTS = "/api/v1/insights/acceptance-baskets"
ONAIR = "راه_اندازی_دائم"
PDF = b"%PDF-1.4\n% test letter\n"
PASSWORD = "Test-Fixture-Passphrase"

#: label -> village id
V: dict[str, int] = {}
IDS: dict[str, int] = {}


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
def _seed() -> None:
    """Two provinces, two contractors, and the villages each case stands for.

    * ``a1``, ``a2``  P1, contractor A, waiting (a2 CPM-dated 2015: legacy)
    * ``rej``         P1, contractor A, ICT already Rejected: Needs category
    * ``ok``          P1, contractor A, ICT already Approved
    * ``sent``        P1, contractor A, sent to ICT HQ 30 days ago
    * ``app``         P1, contractor A, drive test approved in the app 10 days ago
    * ``b1``          P2, contractor B, waiting
    * ``offair``      not on air: no case
    """
    from app.models.reference import Contractor, Province
    from app.models.submission import SubmissionItem
    from app.models.workitem import DriveTest, Site, Village, WorkItem

    db = SessionLocal()
    try:
        p1, p2 = Province(name="CaseProv1"), Province(name="CaseProv2")
        ca, cb = Contractor(name="Contractor A", type="drive_test"), Contractor(name="Contractor B", type="drive_test")
        db.add_all([p1, p2, ca, cb])
        db.flush()
        IDS.update(p1=p1.id, p2=p2.id, ca=ca.id, cb=cb.id)
        now = datetime.now(timezone.utc)

        def village(label, province, contractor, *, ict="NotFiled", stage=ONAIR,
                    first_seen=None):
            site = Site(site_code=f"CS-{label}", province_id=province.id)
            db.add(site)
            db.flush()
            wi = WorkItem(site_id=site.id, site_type="Target", requested_technology="2G",
                          dt_status="Done", dt_sc_contractor_id=contractor.id,
                          dt_date_gregorian=date(2015, 1, 1), current_stage="DT Done",
                          last_stage=stage)
            db.add(wi)
            db.flush()
            v = Village(work_item_id=wi.id, village_code=f"C-{label}", village_name=f"روستا {label}",
                        target_classification="هدف", ict_status=ict, first_seen_at=first_seen)
            db.add(v)
            db.flush()
            V[label] = v.id
            IDS[f"wi_{label}"] = wi.id
            return wi

        village("a1", p1, ca)
        village("a2", p1, ca, first_seen=now - timedelta(days=20))
        village("rej", p1, ca, ict="Rejected")
        village("ok", p1, ca, ict="Approved")
        village("sent", p1, ca)
        db.add(SubmissionItem(village_id=V["sent"], reason="outside", source="mojri",
                              sent_at=(now - timedelta(days=30)).date()))
        app_wi = village("app", p1, ca)
        db.add(DriveTest(work_item_id=app_wi.id, status="Approved", is_active=True,
                         coordinator_reviewed_at=now - timedelta(days=10)))
        village("b1", p2, cb)
        village("offair", p1, ca, stage="نصب")
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
def _login(client, username, password=PASSWORD) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


def _user(client, admin, username, role, *, provinces=None, contractor_id=None) -> dict:
    roles = client.get("/api/v1/reference/roles", headers=admin).json()
    r = client.post("/api/v1/admin/users", headers=admin, json={
        "username": username, "password": PASSWORD, "first_name": username.title(),
        "family_name": role, "role_id": next(x["id"] for x in roles if x["name"] == role),
        "contractor_id": contractor_id, "sees_all_provinces": provinces is None,
        "province_ids": provinces or [],
    })
    assert r.status_code == 201, r.text
    return _login(client, username)


@pytest.fixture(scope="module")
def who(client):
    admin = _login(client, "admin", "Admin@12345")
    return {
        "admin": admin,
        "pm": _user(client, admin, "casepm", "PM"),
        "coord": _user(client, admin, "casecoord", "Coordinator", provinces=[IDS["p1"]]),
        "co_a": _user(client, admin, "caseco_a", "Contractor", contractor_id=IDS["ca"]),
        "co_b": _user(client, admin, "caseco_b", "Contractor", contractor_id=IDS["cb"]),
        "power": _user(client, admin, "casepower", "CpgPower"),
        "pso": _user(client, admin, "casepso", "CpgPso"),
        "viewer": _user(client, admin, "caseviewer", "Viewer"),
        "rm": _user(client, admin, "caserm", "RegionalManager", provinces=[IDS["p1"]]),
    }


def _inbox(client, h, authority="ICT", **params) -> dict:
    r = client.get(f"{API}/inbox", headers=h, params={"authority": authority, **params})
    assert r.status_code == 200, r.text
    return r.json()


def _rows(payload) -> dict[int, dict]:
    return {row["village_id"]: row for g in payload["groups"] for row in g["rows"]}


def _save(client, h, ids, choice, comment="Followed up", **extra):
    return client.post(f"{API}/cases/update", headers=h, json={
        "village_ids": ids, "authority": extra.pop("authority", "ICT"), "choice": choice,
        "comment": comment, **extra,
    })


def _scan(client, h) -> str:
    r = client.post(f"{API}/scans", headers=h, files={"file": ("letter.pdf", PDF)})
    assert r.status_code == 201, r.text
    return r.json()["scan_id"]


def _letter(client, h) -> dict:
    return {"letter_no": "9870", "letter_date": "1405/08/21", "scan_ids": [_scan(client, h)]}


# ---------------------------------------------------------------------------
# Rules (no database)
# ---------------------------------------------------------------------------
def test_age_buckets_follow_days_in_basket():
    from app.services.acceptance_cases.rules import bucket_of

    assert [bucket_of(d) for d in (0, 90, 91, 182, 183, 365, 366, 4341)] == [
        "u3", "u3", "m3_6", "m3_6", "m6_12", "m6_12", "o1y", "o1y"]


def test_stale_comment_rule():
    from app.services.acceptance_cases.rules import Clock, is_stale

    today = date(2026, 11, 20)
    clock = Clock(today, sla_days=14, fresh_days=7)
    fresh = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
    old = datetime(2026, 11, 1, 9, tzinfo=timezone.utc)
    assert is_stale("waiting", None, clock)
    assert not is_stale("waiting", fresh, clock)
    assert is_stale("rejected", old, clock)
    assert not is_stale("approved", None, clock)


def test_backfill_mapping_and_waiting_start():
    from app.services.acceptance_cases import sync

    assert [sync.state_for_status(s) for s in ("Approved", "Rejected", "Returned", "Pending", "NotFiled", None)] == [
        "approved", "rejected", "waiting", "waiting", "waiting", "waiting"]
    facts = sync.Facts(dt={}, sent={1: date(2026, 10, 1)}, first_import=date(2026, 9, 30))
    dt = sync.DtApproval(date(2026, 10, 10), None)
    assert sync.waiting_start(1, dt, date(2026, 9, 30), facts) == date(2026, 10, 1)
    assert sync.waiting_start(2, dt, date(2026, 9, 30), facts) == date(2026, 10, 10)
    assert sync.waiting_start(2, None, date(2026, 9, 30), facts) == date(2026, 9, 30)
    # Legacy: first_seen_at, else the first import, never CPM's DT date.
    assert sync.legacy_date(None, None, facts, date(2026, 11, 20)) == date(2026, 9, 30)


def test_required_fields_per_choice():
    from app.services.acceptance_cases.update import UpdateRequest, field_errors

    def fields(**kw):
        req = UpdateRequest(village_ids=(1,), authority="ICT", **kw)
        return {e["field"] for e in field_errors(req)}

    assert fields(choice="waiting", comment=" ") == {"comment"}
    assert fields(choice="waiting", comment="ok") == set()
    assert fields(choice="approved", comment="ok") == {"letter_no", "letter_date"}
    assert fields(choice="rejected", comment="ok", letter_no="1", letter_date="1405/08/01") == {"category"}


# ---------------------------------------------------------------------------
# The universe, backfill and dates
# ---------------------------------------------------------------------------
def test_pm_inbox_holds_the_open_universe_cases(client, who):
    rows = _rows(_inbox(client, who["pm"]))
    assert set(rows) == {V["a1"], V["a2"], V["rej"], V["sent"], V["app"], V["b1"]}
    assert V["ok"] not in rows and V["offair"] not in rows
    assert rows[V["rej"]]["state"] == "rejected" and rows[V["rej"]]["basket_key"] == "needs_category"
    assert rows[V["a1"]]["basket_owner"] == "Contractor A"


def test_waiting_starts_at_sent_then_dt_approval_never_the_cpm_date(client, who):
    rows = _rows(_inbox(client, who["pm"]))
    assert rows[V["sent"]]["days_in_basket"] == 30
    assert rows[V["app"]]["days_in_basket"] == 10
    assert rows[V["a2"]]["days_in_basket"] == 20      # legacy: first seen
    assert all(r["days_in_basket"] < 100 for r in rows.values())   # no "4,341 d"


def test_every_open_case_without_a_comment_is_flagged(client, who):
    payload = _inbox(client, who["pm"])
    assert payload["counts"]["no_comment"] == payload["counts"]["all"] == 6


def test_history_shows_imported_and_submitted_steps(client, who):
    r = client.get(f"{API}/cases/{V['sent']}/history", headers=who["pm"], params={"authority": "ICT"})
    assert r.status_code == 200, r.text
    steps = r.json()["steps"]
    assert [s["kind"] for s in steps] == ["dt", "submitted", "now"]
    assert steps[0]["title"] == "Imported from CPM"
    assert steps[-1]["delta_days"] == 30


# ---------------------------------------------------------------------------
# Saves
# ---------------------------------------------------------------------------
def test_comment_is_required(client, who):
    r = _save(client, who["co_a"], [V["a1"]], "waiting", comment="")
    assert r.status_code == 400
    assert {"field": "comment", "code": "missing"} in r.json()["detail"]["errors"]


def test_contractor_comment_drops_the_no_comment_count(client, who):
    before = _inbox(client, who["co_a"])["counts"]["no_comment"]
    r = _save(client, who["co_a"], [V["a1"]], "waiting", comment="Followed up with ICT")
    assert r.status_code == 200, r.text
    after = _inbox(client, who["co_a"])["counts"]["no_comment"]
    assert after == before - 1
    box = client.get(f"{API}/cases/{V['a1']}", headers=who["co_a"], params={"authority": "ICT"}).json()["boxes"][0]
    assert box["comment"]["text"] == "Followed up with ICT" and not box["comment"]["stale"]


def test_a_retried_save_is_applied_once(client, who):
    body = dict(request_id="retry-1")
    assert _save(client, who["co_a"], [V["a2"]], "waiting", **body).json()["replayed"] is False
    assert _save(client, who["co_a"], [V["a2"]], "waiting", **body).json()["replayed"] is True
    steps = client.get(f"{API}/cases/{V['a2']}/history", headers=who["pm"], params={"authority": "ICT"}).json()["steps"]
    assert sum(1 for s in steps if s["kind"] == "comment") == 1


def test_coordinator_rejects_with_cpg_power_and_it_lands_in_that_basket(client, who):
    r = _save(client, who["coord"], [V["a2"]], "rejected", comment="Temporary power",
              category="cpg_power", **_letter(client, who["coord"]))
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == [V["a2"]]
    power = _rows(_inbox(client, who["power"]))
    assert set(power) == {V["a2"]} and power[V["a2"]]["basket_key"] == "team:CpgPower"
    assert V["a2"] not in _rows(_inbox(client, who["co_a"]))
    assert _rows(_inbox(client, who["pso"])) == {}


def test_team_cannot_record_a_verdict(client, who):
    r = _save(client, who["power"], [V["a2"]], "approved", **_letter(client, who["pm"]))
    assert r.status_code == 403


def test_team_marks_fixed_and_the_case_returns_to_the_contractor(client, who):
    r = _save(client, who["power"], [V["a2"]], "waiting", comment="Grid connected")
    assert r.status_code == 200, r.text
    assert _rows(_inbox(client, who["power"])) == {}
    row = _rows(_inbox(client, who["co_a"]))[V["a2"]]
    assert row["state"] == "waiting" and row["days_in_basket"] == 0
    steps = client.get(f"{API}/cases/{V['a2']}/history", headers=who["pm"], params={"authority": "ICT"}).json()["steps"]
    kinds = [s["kind"] for s in steps]
    assert kinds[-3:] == ["rejected", "fixed", "now"]
    rejected = next(s for s in steps if s["kind"] == "rejected")
    assert rejected["note"] == "Temporary power" and rejected["letter"]["no"] == "9870"


def test_approve_leaves_the_inbox(client, who):
    r = _save(client, who["pm"], [V["app"]], "approved", comment="ICT letter received",
              **_letter(client, who["pm"]))
    assert r.status_code == 200, r.text
    assert V["app"] not in _rows(_inbox(client, who["pm"]))
    boxes = client.get(f"{API}/cases/{V['app']}", headers=who["pm"], params={"authority": "ICT"}).json()["boxes"]
    assert boxes[0]["state"] == "approved" and boxes[1]["authority"] == "CRA"


def test_multi_village_save_is_all_or_nothing(client, who):
    r = _save(client, who["coord"], [V["a1"], V["b1"]], "waiting", comment="Batch note")
    assert r.status_code == 404            # b1 is outside the coordinator's provinces
    steps = client.get(f"{API}/cases/{V['a1']}/history", headers=who["pm"], params={"authority": "ICT"}).json()["steps"]
    assert not any(s.get("note") == "Batch note" for s in steps)
    r = _save(client, who["pm"], [V["a1"], V["b1"]], "waiting", comment="Batch note")
    assert r.status_code == 200 and sorted(r.json()["applied"]) == sorted([V["a1"], V["b1"]])


def test_contractor_filing_waits_for_validation_and_the_coordinator_sets_the_category(client, who):
    from app.models.acceptance_workflow import AcceptanceSubmission

    r = _save(client, who["co_a"], [V["sent"]], "rejected", comment="Report page missing",
              category="contractor", **_letter(client, who["co_a"]))
    assert r.status_code == 200, r.text
    assert r.json()["in_validation"] == [V["sent"]]
    row = _rows(_inbox(client, who["pm"]))[V["sent"]]
    assert row["state"] == "waiting" and row["in_validation"]

    db = SessionLocal()
    try:
        sub = db.query(AcceptanceSubmission).filter_by(village_id=V["sent"], review_status="Pending").one()
        sid, version = sub.id, sub.version
    finally:
        db.close()
    r = client.post(f"{API}/letters/review", headers=who["coord"], json={
        "authority": "ICT", "decision": "confirm",
        "items": [{"submission_id": sid, "version": version, "category": "cpg_pso"}],
    })
    assert r.status_code == 200, r.text
    assert set(_rows(_inbox(client, who["pso"]))) == {V["sent"]}
    assert V["sent"] not in _rows(_inbox(client, who["co_a"]))


def test_only_pm_and_coordinators_change_a_basket(client, who):
    case_id = _rows(_inbox(client, who["pm"]))[V["rej"]]["case_id"]
    cats = {c["code"]: c["id"] for c in client.get(f"{API}/categories", headers=who["pm"]).json()}
    body = {"category_id": cats["parked"], "reason": "Land issue"}
    assert client.post(f"{API}/cases/{case_id}/basket", headers=who["co_a"], json=body).status_code in (403, 404)
    r = client.post(f"{API}/cases/{case_id}/basket", headers=who["coord"], json=body)
    assert r.status_code == 200, r.text
    assert _rows(_inbox(client, who["pm"]))[V["rej"]]["basket_key"] == "parked"
    steps = client.get(f"{API}/cases/{V['rej']}/history", headers=who["pm"], params={"authority": "ICT"}).json()["steps"]
    changed = next(s for s in steps if s["kind"] == "basket_changed")
    assert changed["note"] == "Land issue" and changed["actor"]


# ---------------------------------------------------------------------------
# Roles and one count
# ---------------------------------------------------------------------------
def test_roles_on_every_endpoint(client, who):
    for name in ("rm", "admin"):
        assert client.get(f"{API}/inbox", headers=who[name], params={"authority": "ICT"}).status_code == 403
    assert client.get(INSIGHTS, headers=who["viewer"]).status_code == 200
    assert client.get(INSIGHTS, headers=who["coord"]).status_code == 200
    for name in ("co_a", "power", "rm"):
        assert client.get(INSIGHTS, headers=who[name]).status_code == 403
    assert _save(client, who["viewer"], [V["a1"]], "waiting").status_code == 403
    coord = _rows(_inbox(client, who["coord"]))
    assert V["b1"] not in coord and V["a1"] in coord
    assert set(_rows(_inbox(client, who["co_b"]))) == {V["b1"]}


def _home(client, h) -> dict:
    r = client.get("/api/v1/home/summary", headers=h)
    assert r.status_code == 200, r.text
    return {t["queue_key"]: t for g in r.json()["groups"] for t in g["tickets"]}


def test_counts_agree_across_inbox_home_and_baskets(client, who):
    ict, cra = _inbox(client, who["pm"], "ICT"), _inbox(client, who["pm"], "CRA")
    home = _home(client, who["pm"])
    assert home["ict_pending"]["count"] == ict["counts"]["all"]
    assert home["cra_pending"]["count"] == cra["counts"]["all"]
    assert home["ict_pending"]["acceptance"]["no_comment"] == ict["counts"]["no_comment"]
    grid = client.get(INSIGHTS, headers=who["pm"]).json()
    assert grid["open"] == ict["counts"]["all"] + cra["counts"]["all"]
    assert grid["no_comment"] == ict["counts"]["no_comment"] + cra["counts"]["no_comment"]
    total = next(c for c in grid["columns"] if c["key"] == "total")["total"]
    assert total == sum(r["cells"]["total"] for r in grid["rows"]) == grid["open"]

    co = _home(client, who["co_a"])
    mine = _inbox(client, who["co_a"], "ICT")
    assert co["ict_case_waiting"]["count"] == mine["counts"]["waiting"]


def test_basket_cell_lists_its_villages(client, who):
    grid = client.get(INSIGHTS, headers=who["pm"], params={"authority": "ict"}).json()
    row = next(r for r in grid["rows"] if r["key"] == f"contractor:{IDS['ca']}")
    r = client.get(f"{INSIGHTS}/cell", headers=who["pm"],
                   params={"basket": row["key"], "bucket": "total", "authority": "ict"})
    assert r.status_code == 200, r.text
    cell = r.json()
    assert cell["count"] == row["cells"]["total"] and cell["label"] == "Contractor A"
    assert all(i["authority"] == "ICT" for i in cell["items"])


def test_explorer_side_carries_the_case(client, who):
    r = client.get(f"/api/v1/explorer/sites/{IDS['wi_a1']}", headers=who["pm"])
    assert r.status_code == 200, r.text
    village = r.json()["villages"][0]
    assert village["ict"]["case"]["state"] == "waiting"
    assert village["ict"]["case"]["basket"] == "Contractor A"
