"""UEP-29: Admin > Data import (drive test + acceptance from Excel).

The rules these tests hold, in the order the spec states them:

* the template lists every live pure هدف village, keys as text;
* rows match on site ID + site type + village code, never on internal ids;
* drive test values are applied once per site; villages that disagree refuse
  that site's drive test;
* an empty cell changes nothing; nothing is written before Confirm;
* a different value is a conflict, and Confirm is blocked until every conflict
  is decided; "Use file" keeps history (a new assignment / drive test / round);
* a failure during apply writes nothing; no notification is sent;
* Undo reverses the batch and keeps rows changed afterwards.

Run with:  cd backend && pytest tests/test_data_import.py -q
"""
import io
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_data_import_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON, func, select  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import Workbook, load_workbook  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

DB_FILE = "/tmp/uep_data_import_pytest.db"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ONAIR = "راه_اندازی_دائم"
TARGET = "هدف"

IDS: dict = {}


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Contractor, ProblemCategory, Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    try:
        province = db.query(Province).first()
        a = Contractor(name="Contractor A", type="drive_test", active=True)
        b = Contractor(name="Contractor B", type="drive_test", active=True)
        db.add_all([a, b])
        if not db.query(ProblemCategory).filter(ProblemCategory.active).first():
            db.add(ProblemCategory(name="Temp Power", active=True, sla_days=7))
        db.flush()
        IDS["contractor_a"], IDS["contractor_b"] = a.id, b.id
        IDS["category"] = db.query(ProblemCategory).filter(ProblemCategory.active).first().name

        def site(code, site_type, villages, *, tech="2G3G4G", dt=None, dt_sc=None, dt_date=None):
            s = db.query(Site).filter(Site.site_code == code).first()
            if s is None:
                s = Site(site_code=code, province_id=province.id if province else None)
                db.add(s)
                db.flush()
            wi = WorkItem(site_id=s.id, site_type=site_type, requested_technology=tech,
                          last_stage=ONAIR, dt_status=dt, dt_sc_contractor_id=dt_sc,
                          dt_date_gregorian=dt_date, current_stage="New")
            db.add(wi)
            db.flush()
            IDS[(code, site_type)] = wi.id
            for vcode in villages:
                v = Village(work_item_id=wi.id, village_code=vcode, village_name=f"V {vcode}",
                            target_classification=TARGET)
                db.add(v)
                db.flush()
                IDS[(code, site_type, vcode)] = v.id
            return wi

        site("S1", "New Site", ["1001", "1002"])
        site("S2", "New Site", ["2001"])
        site("S2", "Add Tech", ["2001"])
        site("S3", "New Site", ["3001", "3002"], dt="Done", dt_date=date(2026, 9, 1))
        site("S4", "New Site", ["4001"], tech=None)
        site("S5", "New Site", ["5001"], dt="Done", dt_sc=b.id, dt_date=date(2026, 9, 1))
        site("S6", "New Site", ["6001"])
        site("S7", "New Site", ["7001"])
        site("S8", "New Site", ["8001"])
        db.commit()
    finally:
        db.close()


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _admin(client) -> str:
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return r.cookies["uep_session"]


def _pm(client) -> dict:
    return login_as_role(client, _admin(client), "PM")


def _book(rows: list[dict], headers: list[str] | None = None) -> bytes:
    headers = headers or ["Site ID", "Site type", "Village code", "DT contractor",
                          "Assignment date", "DT date", "SSV submission date", "DT result",
                          "DT approved date", "Problem category", "DT comment", "ICT result",
                          "ICT letter number", "ICT letter date", "ICT rejection category",
                          "ICT comment", "CRA result", "CRA letter number", "CRA letter date",
                          "CRA rejection category", "CRA comment"]
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append(headers)
    for row in rows:
        ws.append([row.get(h) for h in headers])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload(client, h, rows, headers=None, name="fill.xlsx"):
    content = _book(rows, headers)
    return client.post("/api/v1/data-import/batches", headers=h,
                       files={"file": (name, content, XLSX)})


def _wi(code, site_type="New Site"):
    from app.models.workitem import WorkItem

    db = SessionLocal()
    wi = db.get(WorkItem, IDS[(code, site_type)])
    db.expunge_all()
    db.close()
    return wi


def _count(model, *where):
    db = SessionLocal()
    try:
        return db.scalar(select(func.count()).select_from(model).where(*where))
    finally:
        db.close()


# --------------------------------------------------------------------------
# Access
# --------------------------------------------------------------------------
def test_only_the_data_import_feature_opens_the_api(client):
    pm = _pm(client)
    coordinator = login_as_role(client, _admin(client), "Coordinator")
    assert client.get("/api/v1/data-import/batches", headers=pm).status_code == 200
    assert client.get("/api/v1/data-import/batches", headers=coordinator).status_code == 403
    assert client.get("/api/v1/data-import/template", headers=coordinator).status_code == 403
    admin = {"Authorization": f"Bearer {_admin(client)}"}
    assert client.get("/api/v1/data-import/batches", headers=admin).status_code == 403


def test_a_user_granted_the_feature_can_use_it(client):
    from app.core import access
    from app.models.access import UserFeatureOverride
    from app.models.reference import User

    viewer = login_as_role(client, _admin(client), "Viewer")
    assert client.get("/api/v1/data-import/batches", headers=viewer).status_code == 403
    db = SessionLocal()
    user = db.query(User).filter(User.username == "test_viewer").one()
    db.add(UserFeatureOverride(user_id=user.id, feature_key="data_import", level="view",
                               reason="test"))
    access.bump_version(db)
    db.commit()
    db.close()
    access.invalidate()
    assert client.get("/api/v1/data-import/batches", headers=viewer).status_code == 200
    # View is not Edit.
    assert client.get("/api/v1/data-import/template", headers=viewer).status_code == 403


# --------------------------------------------------------------------------
# Template
# --------------------------------------------------------------------------
def test_template_lists_every_village_with_text_keys(client):
    r = client.get("/api/v1/data-import/template", headers=_pm(client))
    assert r.status_code == 200
    assert "UEP_import_template_" in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["How to fill", "Data", "Lists"]
    assert wb["Lists"].sheet_state == "hidden"
    data = wb["Data"]
    headers = [c.value for c in data[1]]
    assert headers[:3] == ["Site ID", "Site type", "Village code"]
    assert data.freeze_panes == "D2"
    rows = [[c.value for c in r] for r in data.iter_rows(min_row=2) if r[0].value]
    keys = [(r[0], r[1], r[2]) for r in rows]
    assert ("S2", "Add Tech", "2001") in keys and ("S2", "New Site", "2001") in keys
    assert keys == sorted(keys)
    assert all(isinstance(k[2], str) for k in keys)
    assert len(data.data_validations.dataValidation) >= 5


# --------------------------------------------------------------------------
# Drive test
# --------------------------------------------------------------------------
DT_ROW = {"DT contractor": "Contractor A", "Assignment date": "2026-10-08",
          "DT date": "2026-10-15", "SSV submission date": "2026-10-18",
          "DT result": "Done", "DT approved date": "2026-10-20"}


def test_preview_writes_nothing_and_dt_is_counted_once_per_site(client):
    from app.models.workitem import Assignment

    h = _pm(client)
    r = _upload(client, h, [
        {"Site ID": "S1", "Site type": "New Site", "Village code": "1001", **DT_ROW},
        {"Site ID": "S1", "Site type": "New Site", "Village code": "1002", **DT_ROW},
    ])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "previewed"
    assert body["counts"]["dt"]["new"] == 1
    assert body["decisions"]["undecided"] == 0
    assert _count(Assignment, Assignment.work_item_id == IDS[("S1", "New Site")]) == 0
    assert _wi("S1").dt_status is None
    IDS["s1_batch"] = body["id"]


def test_apply_makes_the_site_dt_done_with_hc_assignment_and_drive_test(client):
    from app.models.health_check import HcTask
    from app.models.workitem import Assignment, DriveTest
    from app.services import health_check

    h = _pm(client)
    r = client.post(f"/api/v1/data-import/batches/{IDS['s1_batch']}/apply", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "applied"

    wi = _wi("S1")
    assert wi.dt_status == "Done"
    assert wi.dt_date_gregorian == date(2026, 10, 15)
    assert wi.dt_sc_contractor_id == IDS["contractor_a"]
    assert wi.current_stage == "DT Done"
    db = SessionLocal()
    try:
        a = db.execute(select(Assignment).where(Assignment.work_item_id == wi.id)).scalar_one()
        assert a.assignment_type == "official" and a.is_active and a.source == "import"
        t = db.execute(select(DriveTest).where(DriveTest.work_item_id == wi.id)).scalar_one()
        assert t.status == "Approved" and t.execution_date == date(2026, 10, 15)
        assert t.coordinator_comment.startswith("Imported · batch #")
        task = db.execute(select(HcTask).where(HcTask.work_item_id == wi.id)).scalar_one()
        assert task.overall_result == "Ready" and task.reviewed_at is not None
        health_check.assert_ready_for_dt(db, wi.id, site_label="S1")  # no bypass needed
        history = health_check.site_history(db, wi.id)
        assert any((e.get("actor") or "").startswith("Imported · batch #") for e in history)
    finally:
        db.close()


def test_villages_that_disagree_refuse_the_site_drive_test(client):
    h = _pm(client)
    r = _upload(client, h, [
        {"Site ID": "S6", "Site type": "New Site", "Village code": "6001", "DT date": "2026-10-15"},
        {"Site ID": "S7", "Site type": "New Site", "Village code": "7001", "DT date": "2026-10-15"},
    ])
    assert r.status_code == 200
    # One site, two different values: add a second village row to S6 via a twin key is not
    # possible, so disagreement is shown on a site with two villages.
    r = _upload(client, h, [
        {"Site ID": "S3", "Site type": "New Site", "Village code": "3001", "DT date": "2026-08-01"},
        {"Site ID": "S3", "Site type": "New Site", "Village code": "3002", "DT date": "2026-08-02"},
    ])
    body = r.json()
    assert body["counts"]["dt"]["errors"] == 1
    errs = client.get(f"/api/v1/data-import/batches/{body['id']}/preview?tab=errors", headers=h).json()
    assert any("have different DT date" in m for i in errs["items"] for m in i["messages"])


def test_rows_match_on_their_own_site_type(client):
    h = _pm(client)
    r = _upload(client, h, [
        {"Site ID": "S2", "Site type": "Add Tech", "Village code": "2001", "DT date": "2026-10-01"},
        {"Site ID": "S1", "Site type": "Add Tech", "Village code": "1001", "DT date": "2026-10-01"},
    ])
    body = r.json()
    changes = client.get(f"/api/v1/data-import/batches/{body['id']}/preview?tab=changes", headers=h).json()
    assert {(i["site_id"], i["site_type"]) for i in changes["items"]} == {("S2", "Add Tech")}
    errs = client.get(f"/api/v1/data-import/batches/{body['id']}/preview?tab=errors", headers=h).json()
    assert any("Found as New Site" in m for i in errs["items"] for m in i["messages"])


def test_headers_are_matched_by_name_and_unknown_columns_warn(client):
    h = _pm(client)
    headers = ["Notes", "DT date", "Village code", "Site type", "Site ID"]
    r = _upload(client, h, [
        {"Site ID": "S6", "Site type": "New Site", "Village code": "6001", "DT date": "1405/07/23",
         "Notes": "x"},
        {"Site ID": "EXAMPLE01", "Site type": "New Site", "Village code": "1"},
    ], headers=headers)
    body = r.json()
    assert body["counts"]["rows"] == 1  # the example row is skipped
    assert "Unknown column ignored: Notes" in body["counts"]["warnings"]
    changes = client.get(f"/api/v1/data-import/batches/{body['id']}/preview?tab=changes", headers=h).json()
    assert changes["items"][0]["file_value"] == "2026-10-15"  # Shamsi 1405/07/23


def test_missing_key_column_refuses_the_file(client):
    r = _upload(client, _pm(client), [{"Site ID": "S1"}], headers=["Site ID", "DT date"])
    assert r.status_code == 400 and "Site type" in r.json()["detail"]


def test_row_rules(client):
    h = _pm(client)
    future = (date.today() + timedelta(days=30)).isoformat()
    r = _upload(client, h, [
        {"Site ID": "S6", "Site type": "New Site", "Village code": "6001", "DT date": future},
        {"Site ID": "S7", "Site type": "New Site", "Village code": "7001",
         "DT date": "2026-10-15", "SSV submission date": "2026-10-01"},
        {"Site ID": "S8", "Site type": "New Site", "Village code": "8001", "DT result": "Problematic"},
        {"Site ID": "S4", "Site type": "New Site", "Village code": "4001", "DT date": "2026-10-01"},
        {"Site ID": "S2", "Site type": "New Site", "Village code": "2001", "DT contractor": "Nobody"},
        {"Site ID": "S9", "Site type": "New Site", "Village code": "9"},
        {"Site ID": "S1", "Site type": "New Site", "Village code": "1001", "ICT result": "Approved"},
        {"Site ID": "S5", "Site type": "New Site", "Village code": "5001", "ICT result": "Approved",
         "ICT letter number": "L1", "ICT letter date": "2026-10-01"},
        {"Site ID": "S5", "Site type": "New Site", "Village code": "5001", "ICT result": "Approved",
         "ICT letter number": "L1", "ICT letter date": "2026-10-01"},
    ])
    body = r.json()
    errs = client.get(f"/api/v1/data-import/batches/{body['id']}/preview?tab=errors", headers=h).json()
    text = " | ".join(m for i in errs["items"] for m in i["messages"])
    assert "in the future" in text
    assert "Dates out of order" in text
    assert "Problem category required" in text
    assert "Technology not requested" in text
    assert "not a known contractor" in text
    assert "not found in UEP" in text
    assert "letter date required" in text
    assert "Duplicate row" in text


# --------------------------------------------------------------------------
# Acceptance
# --------------------------------------------------------------------------
def test_acceptance_for_a_site_not_dt_done_is_refused(client):
    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S7", "Site type": "New Site", "Village code": "7001",
                             "ICT result": "Approved", "ICT letter number": "L-7",
                             "ICT letter date": "2026-10-20"}])
    errs = client.get(f"/api/v1/data-import/batches/{r.json()['id']}/preview?tab=errors", headers=h).json()
    assert any("Drive test not done" in m for i in errs["items"] for m in i["messages"])


def test_acceptance_only_file_touches_no_drive_test(client):
    from app.models.acceptance_case import AcceptanceCase
    from app.models.acceptance_workflow import AcceptanceSubmission
    from app.models.workitem import DriveTest, Village

    h = _pm(client)
    r = _upload(client, h, [
        {"Site ID": "S3", "Site type": "New Site", "Village code": "3001", "ICT result": "Approved",
         "ICT letter number": "ICT/123", "ICT letter date": "1405/07/28"},
        {"Site ID": "S3", "Site type": "New Site", "Village code": "3002", "CRA result": "Rejected",
         "CRA letter number": "CRA/456", "CRA letter date": "2026-10-25",
         "CRA rejection category": "CPG Power", "CRA comment": "power down"},
    ])
    body = r.json()
    assert body["counts"]["ict"]["new"] == 1 and body["counts"]["cra"]["new"] == 1
    r = client.post(f"/api/v1/data-import/batches/{body['id']}/apply", headers=h)
    assert r.status_code == 200, r.text
    db = SessionLocal()
    try:
        v1 = db.get(Village, IDS[("S3", "New Site", "3001")])
        v2 = db.get(Village, IDS[("S3", "New Site", "3002")])
        assert v1.ict_status == "Approved"
        assert v2.cra_status == "Rejected"
        sub = db.execute(select(AcceptanceSubmission).where(
            AcceptanceSubmission.village_id == v1.id)).scalar_one()
        assert sub.source == "Import" and sub.review_status == "Validated"
        assert sub.letter_number == "ICT/123" and sub.letter_date == date(2026, 10, 20)
        case = db.execute(select(AcceptanceCase).where(
            AcceptanceCase.village_id == v2.id, AcceptanceCase.authority == "CRA")).scalar_one()
        assert case.state == "rejected" and case.basket_role == "CpgPower"
        assert db.scalar(select(func.count()).select_from(DriveTest).where(
            DriveTest.work_item_id == IDS[("S3", "New Site")])) == 0
    finally:
        db.close()


def test_a_missing_letter_number_becomes_no_letter(client):
    """Agreed with the PM: a historical verdict with a date but no letter
    number is filed as NO-LETTER. An empty cell never replaces a letter UEP
    already holds."""
    from app.models.acceptance_workflow import AcceptanceSubmission

    h = _pm(client)
    r = _upload(client, h, [
        # New verdict, no letter number.
        {"Site ID": "S3", "Site type": "New Site", "Village code": "3002", "ICT result": "Approved",
         "ICT letter date": "2026-10-22"},
        # Same verdict UEP holds (ICT/123, 2026-10-20), letter number left blank.
        {"Site ID": "S3", "Site type": "New Site", "Village code": "3001", "ICT result": "Approved",
         "ICT letter date": "2026-10-20"},
    ])
    body = r.json()
    assert body["counts"]["no_letter"] == 2
    assert "2 verdicts had no letter number: NO-LETTER is used" in body["counts"]["warnings"]
    assert body["counts"]["ict"] == {"new": 1, "same": 1, "conflicts": 0, "errors": 0}
    assert client.post(f"/api/v1/data-import/batches/{body['id']}/apply", headers=h).status_code == 200

    db = SessionLocal()
    try:
        new = db.execute(select(AcceptanceSubmission).where(
            AcceptanceSubmission.village_id == IDS[("S3", "New Site", "3002")],
            AcceptanceSubmission.authority == "ICT")).scalar_one()
        assert new.letter_number == "NO-LETTER" and new.letter_date == date(2026, 10, 22)
        kept = db.execute(select(AcceptanceSubmission).where(
            AcceptanceSubmission.village_id == IDS[("S3", "New Site", "3001")],
            AcceptanceSubmission.authority == "ICT")).scalars().all()
        assert [s.letter_number for s in kept] == ["ICT/123"]
    finally:
        db.close()


# --------------------------------------------------------------------------
# Conflicts
# --------------------------------------------------------------------------
def test_a_different_value_is_a_conflict_and_blocks_confirm(client):
    from app.models.workitem import Assignment

    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S5", "Site type": "New Site", "Village code": "5001",
                             "DT contractor": "Contractor A", "Assignment date": "2026-08-20"}])
    body = r.json()
    assert body["counts"]["dt"]["conflicts"] == 1
    conflicts = client.get(f"/api/v1/data-import/batches/{body['id']}/preview?tab=conflicts",
                           headers=h).json()
    item = conflicts["items"][0]
    assert item["uep_value"] == "Contractor B" and item["file_value"] == "Contractor A"
    assert item["uep_source"] == "CPM import"

    blocked = client.post(f"/api/v1/data-import/batches/{body['id']}/apply", headers=h)
    assert blocked.status_code == 409

    d = client.post(f"/api/v1/data-import/batches/{body['id']}/decisions", headers=h,
                    json={"decision": "file", "field": "dt_contractor"})
    assert d.json()["decisions"]["undecided"] == 0
    r = client.post(f"/api/v1/data-import/batches/{body['id']}/apply", headers=h)
    assert r.status_code == 200, r.text
    assert _wi("S5").dt_sc_contractor_id == IDS["contractor_a"]
    assert _count(Assignment, Assignment.work_item_id == IDS[("S5", "New Site")], Assignment.is_active) == 1


def test_keep_uep_changes_nothing(client):
    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S5", "Site type": "New Site", "Village code": "5001",
                             "DT contractor": "Contractor B"}])
    body = r.json()
    client.post(f"/api/v1/data-import/batches/{body['id']}/decisions", headers=h,
                json={"decision": "keep", "all": True})
    r = client.post(f"/api/v1/data-import/batches/{body['id']}/apply", headers=h)
    assert r.status_code == 200
    assert _wi("S5").dt_sc_contractor_id == IDS["contractor_a"]


def test_identical_values_are_no_change(client):
    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S1", "Site type": "New Site", "Village code": "1001", **DT_ROW}])
    body = r.json()
    assert body["counts"]["dt"]["same"] == 1
    assert body["decisions"]["to_apply"] == 0


# --------------------------------------------------------------------------
# One transaction, no notifications
# --------------------------------------------------------------------------
def test_a_failure_during_apply_writes_nothing(client, monkeypatch):
    from app.models.workitem import Assignment
    from app.services.data_import import apply_acceptance

    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S8", "Site type": "New Site", "Village code": "8001", **DT_ROW}])
    batch_id = r.json()["id"]

    def boom(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr(apply_acceptance, "apply_villages", boom)
    r = client.post(f"/api/v1/data-import/batches/{batch_id}/apply", headers=h)
    assert r.status_code == 500 and "Nothing was applied" in r.json()["detail"]
    assert _count(Assignment, Assignment.work_item_id == IDS[("S8", "New Site")]) == 0
    assert _wi("S8").dt_status is None
    monkeypatch.undo()
    IDS["s8_batch"] = batch_id


def test_apply_sends_no_notifications(client):
    from app.models.acceptance import Notification

    before = _count(Notification)
    r = client.post(f"/api/v1/data-import/batches/{IDS['s8_batch']}/apply", headers=_pm(client))
    assert r.status_code == 200, r.text
    assert _count(Notification) == before


# --------------------------------------------------------------------------
# Undo
# --------------------------------------------------------------------------
def test_undo_reverses_the_batch(client):
    from app.models.health_check import HcTask
    from app.models.workitem import Assignment, DriveTest

    h = _pm(client)
    r = client.post(f"/api/v1/data-import/batches/{IDS['s8_batch']}/undo", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "undone"
    assert r.json()["result"]["kept_rows"] == 0
    wid = IDS[("S8", "New Site")]
    assert _wi("S8").dt_status is None
    assert _count(Assignment, Assignment.work_item_id == wid, Assignment.is_active) == 0
    assert _count(DriveTest, DriveTest.work_item_id == wid, DriveTest.is_active) == 0
    assert _count(HcTask, HcTask.work_item_id == wid) == 0
    assert _wi("S8").current_stage == "New"
    again = client.post(f"/api/v1/data-import/batches/{IDS['s8_batch']}/apply", headers=h)
    assert again.status_code == 409


def test_undo_keeps_rows_changed_after_the_batch(client):
    from app.models.workitem import WorkItem

    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S6", "Site type": "New Site", "Village code": "6001",
                             "DT result": "Problematic", "Problem category": IDS["category"]}])
    batch_id = r.json()["id"]
    assert client.post(f"/api/v1/data-import/batches/{batch_id}/apply", headers=h).status_code == 200
    db = SessionLocal()
    wi = db.get(WorkItem, IDS[("S6", "New Site")])
    assert wi.dt_status == "Problematic"
    wi.dt_problem_category = "Changed in UEP"
    db.commit()
    db.close()
    r = client.post(f"/api/v1/data-import/batches/{batch_id}/undo", headers=h)
    assert r.json()["result"]["kept_rows"] == 1
    assert _wi("S6").dt_problem_category == "Changed in UEP"


# --------------------------------------------------------------------------
# Files, history, expiry
# --------------------------------------------------------------------------
def test_error_file_has_an_error_column(client):
    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S9", "Site type": "New Site", "Village code": "9"}])
    batch_id = r.json()["id"]
    f = client.get(f"/api/v1/data-import/batches/{batch_id}/errors.xlsx", headers=h)
    ws = load_workbook(io.BytesIO(f.content)).active
    assert ws.cell(row=1, column=ws.max_column).value == "Error"
    assert "not found" in ws.cell(row=2, column=ws.max_column).value
    assert client.get(f"/api/v1/data-import/batches/{batch_id}/file", headers=h).status_code == 200
    assert client.get(f"/api/v1/data-import/batches/{batch_id}/changes.xlsx", headers=h).status_code == 200


def test_same_file_twice_warns(client):
    h = _pm(client)
    # The same bytes twice: a workbook rebuilt a second later carries a new
    # timestamp in its metadata, so it would be a different file.
    content = _book([{"Site ID": "S7", "Site type": "New Site", "Village code": "7001",
                      "DT date": "2026-10-02"}])

    def send():
        return client.post("/api/v1/data-import/batches", headers=h,
                           files={"file": ("fill.xlsx", content, XLSX)}).json()

    first = send()
    assert client.post(f"/api/v1/data-import/batches/{first['id']}/apply", headers=h).status_code == 200
    second = send()
    assert second["counts"]["already_imported_as"] == first["number"]


def test_a_preview_expires_after_24_hours(client):
    from app.models.data_import import ImportBatch

    h = _pm(client)
    r = _upload(client, h, [{"Site ID": "S7", "Site type": "New Site", "Village code": "7001",
                             "DT contractor": "Contractor B"}])
    batch_id = r.json()["id"]
    db = SessionLocal()
    db.get(ImportBatch, batch_id).uploaded_at = datetime.now(timezone.utc) - timedelta(hours=25)
    db.commit()
    db.close()
    r = client.post(f"/api/v1/data-import/batches/{batch_id}/apply", headers=h)
    assert r.status_code == 409 and "expired" in r.json()["detail"]
    hist = client.get("/api/v1/data-import/batches", headers=h).json()
    assert next(b for b in hist if b["id"] == batch_id)["status"] == "expired"


# --------------------------------------------------------------------------
# Performance (UEP_PERF=1): 5,000 work items / 15,000 villages
# --------------------------------------------------------------------------
@pytest.mark.skipif(os.environ.get("UEP_PERF") != "1", reason="set UEP_PERF=1 to run")
def test_performance_5k_sites_15k_villages(client):
    from sqlalchemy import insert

    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    sites = [{"site_code": f"P{i:05d}"} for i in range(5000)]
    db.execute(insert(Site), sites)
    site_ids = dict(db.execute(select(Site.site_code, Site.id).where(Site.site_code.like("P%"))).all())
    db.execute(insert(WorkItem), [
        {"site_id": site_ids[f"P{i:05d}"], "site_type": "New Site", "requested_technology": "4G",
         "last_stage": ONAIR, "current_stage": "New"} for i in range(5000)
    ])
    wi_ids = dict(db.execute(select(WorkItem.site_id, WorkItem.id).where(
        WorkItem.site_id.in_(site_ids.values()))).all())
    db.execute(insert(Village), [
        {"work_item_id": wi_ids[site_ids[f"P{i:05d}"]], "village_code": f"{i}{j}",
         "target_classification": TARGET} for i in range(5000) for j in range(3)
    ])
    db.commit()
    db.close()
    rows = [{"Site ID": f"P{i:05d}", "Site type": "New Site", "Village code": f"{i}{j}", **DT_ROW}
            for i in range(5000) for j in range(3)]
    h = _pm(client)
    start = time.monotonic()
    r = _upload(client, h, rows)
    assert r.status_code == 200, r.text
    assert time.monotonic() - start < 20
    start = time.monotonic()
    r = client.post(f"/api/v1/data-import/batches/{r.json()['id']}/apply", headers=h)
    assert r.status_code == 200, r.text
    assert time.monotonic() - start < 60
