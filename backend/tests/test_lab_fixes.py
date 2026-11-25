"""UEP-24: the bugs the 3-month lab found, one block per fix.

Each block checks the happy path, the refused path and, where it applies, the
role scope. F5 and F10 need the acceptance-case universe and live in
``test_acceptance_cases.py``. Sites are seeded directly so this runs anywhere.
"""
import importlib.util
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

DB_FILE = "/tmp/uep_lab_fixes_pytest.db"
os.environ["DATABASE_URL"] = f"sqlite:///{DB_FILE}"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON, select, text  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali, user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Lab-Fixes-Passw0rd"
LINK = "https://reports.example/dt"
PDF = b"%PDF-1.4\n%lab\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
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


def _user(db, username, role_name, *, contractor_id=None, provinces=None, sees_all=True):
    from app.models.reference import Role, User

    role = db.query(Role).filter(Role.name == role_name).one()
    user = User(
        username=username, password_hash=hash_password(PASSWORD),
        first_name=username.title(), family_name="Lab", role_id=role.id,
        contractor_id=contractor_id, sees_all_provinces=sees_all,
        status=user_status.ACTIVE,
    )
    if provinces:
        user.provinces = provinces
    db.add(user)
    db.flush()
    IDS[username] = user.id
    return user


def _site(db, code, *, province, dt_status=None, launch=None):
    from app.models.workitem import Site, WorkItem

    site = Site(site_code=code, province_id=province.id)
    db.add(site)
    db.flush()
    wi = WorkItem(site_id=site.id, site_type="Greenfield", requested_technology="2G",
                  last_stage=C.STAGE_PERM_ONAIR, dt_status=dt_status,
                  launch_date_gregorian=launch)
    db.add(wi)
    db.flush()
    IDS[code] = wi.id
    return wi


def _seed():
    from app.models.reference import Contractor, Province
    from app.models.workitem import Assignment

    db = SessionLocal()
    try:
        provinces = db.query(Province).order_by(Province.id).limit(2).all()
        IDS["provinces"] = [p.id for p in provinces]
        co = Contractor(name="Lab Telecom", type="drive_test")
        db.add(co)
        db.flush()
        IDS["contractor"] = co.id
        _user(db, "lab_pm", "PM")
        _user(db, "lab_sc", "Contractor", contractor_id=co.id)
        _user(db, "lab_coord_other", "Coordinator", provinces=[provinces[1]], sees_all=False)
        for n in range(8):
            _site(db, f"LAB{n:04d}", province=provinces[0])
        # LAB0001 is in drive test: an active DT assignment.
        db.add(Assignment(work_item_id=IDS["LAB0001"], assignment_type="official",
                          contractor_id=co.id, assigned_at=datetime.now(timezone.utc),
                          is_active=True))
        # LAB0002 / LAB0003: assigned for drive tests (F2/F3), on air in 2025.
        for code in ("LAB0002", "LAB0003"):
            db.add(Assignment(work_item_id=IDS[code], assignment_type="official",
                              contractor_id=co.id, assigned_at=datetime.now(timezone.utc),
                              is_active=True))
        from app.models.workitem import WorkItem

        db.get(WorkItem, IDS["LAB0003"]).launch_date_gregorian = date(2025, 6, 1)
        db.commit()
    finally:
        db.close()


def _login(client, username):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, PASSWORD))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


def _admin(client):
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


# --------------------------------------------------------------------------
# F1 -- health check only for New or re-check sites
# --------------------------------------------------------------------------
def test_f1_a_site_in_drive_test_is_not_assignable_and_is_refused(client):
    pm = _login(client, "lab_pm")
    basket = {b["work_item_id"]: b for b in client.get("/api/v1/hc/basket", headers=pm).json()}
    assert basket[IDS["LAB0001"]]["assignable"] is False
    assert basket[IDS["LAB0004"]]["assignable"] is True

    r = client.post("/api/v1/hc/assignments", headers=pm, json={
        "contractor_id": IDS["contractor"], "work_item_ids": [IDS["LAB0004"], IDS["LAB0001"]],
    })
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "These sites can't get a health check now: LAB0001 (in drive test)."

    counts = client.get("/api/v1/hc/queues/counts", headers=pm).json()
    assert counts["pool_assignable"] == sum(1 for b in basket.values() if b["assignable"])


def test_f1_a_new_site_is_assigned_and_then_refused_while_in_check(client):
    pm = _login(client, "lab_pm")
    body = {"contractor_id": IDS["contractor"], "work_item_ids": [IDS["LAB0004"]]}
    assert client.post("/api/v1/hc/assignments", headers=pm, json=body).status_code == 201
    again = client.post("/api/v1/hc/assignments", headers=pm, json=body)
    assert again.status_code == 409
    assert "LAB0004 (already in an open health check)" in again.json()["detail"]


def test_f1_block_reasons_name_each_state():
    from app.services import health_check as hc

    db = SessionLocal()
    try:
        reasons = hc.hc_block_reasons(db, [IDS["LAB0001"], IDS["LAB0005"]])
        assert reasons == {IDS["LAB0001"]: "in drive test"}
    finally:
        db.close()


# --------------------------------------------------------------------------
# F2 / F3 -- one complete, sensibly dated drive test at a time
# --------------------------------------------------------------------------
def _dt(client, headers, code, **body):
    return client.post(f"/api/v1/work-items/{IDS[code]}/drive-test", headers=headers, json=body)


def test_f3_incomplete_or_badly_dated_submissions_are_422(client):
    pm = _login(client, "lab_pm")
    tomorrow = (jalali.tehran_today() + timedelta(days=2)).isoformat()
    cases = [
        ({"report_link": LINK}, "Add the date"),
        ({"execution_date": tomorrow, "report_link": LINK}, "can't be in the future"),
        ({"execution_date": "2025-05-01", "report_link": LINK}, "on-air date"),
        ({"execution_date": "2025-07-01"}, "Attach the report file or add a report link"),
    ]
    for body, words in cases:
        r = _dt(client, pm, "LAB0003", **body)
        assert r.status_code == 422, (body, r.text)
        assert words in r.json()["detail"]


def test_f3_a_file_submission_carries_its_report(client):
    sc = _login(client, "lab_sc")
    r = client.post(
        f"/api/v1/work-items/{IDS['LAB0003']}/drive-test/upload", headers=sc,
        data={"execution_date": "2025-07-01"},
        files=[("files", ("report.pdf", PDF, "application/pdf"))],
    )
    assert r.status_code == 200, r.text
    from app.models.workitem import DriveTest

    db = SessionLocal()
    try:
        dt = db.get(DriveTest, r.json()["drive_test_id"])
        assert len(dt.evidence) == 1 and dt.status == "Submitted"
    finally:
        db.close()


def test_f2_a_second_submission_is_409_and_a_returned_one_may_be_resent(client):
    pm = _login(client, "lab_pm")
    first = _dt(client, pm, "LAB0002", execution_date="2026-01-10", report_link=LINK)
    assert first.status_code == 200, first.text
    second = _dt(client, pm, "LAB0002", execution_date="2026-01-10", report_link=LINK)
    assert second.status_code == 409
    assert second.json()["detail"] == "A drive test for this site is already waiting for review."

    back = client.post(f"/api/v1/drive-tests/{first.json()['drive_test_id']}/coordinator-review",
                       headers=pm, json={"decision": "Returned", "comment": "Redo route 3"})
    assert back.status_code == 200, back.text
    again = _dt(client, pm, "LAB0002", execution_date="2026-01-12", report_link=LINK)
    assert again.status_code == 200, again.text


def test_f2_the_unique_index_refuses_a_second_submitted_row():
    from sqlalchemy.exc import IntegrityError

    from app.models.workitem import DriveTest

    db = SessionLocal()
    try:
        db.add(DriveTest(work_item_id=IDS["LAB0003"], status="Submitted", is_active=False))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
    finally:
        db.close()


def test_f2_contractor_cannot_submit_for_another_companys_site(client):
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        other = Contractor(name="Other Co", type="drive_test")
        db.add(other)
        db.flush()
        _user(db, "lab_sc_other", "Contractor", contractor_id=other.id)
        db.commit()
    finally:
        db.close()
    r = _dt(client, _login(client, "lab_sc_other"), "LAB0002",
            execution_date="2026-01-10", report_link=LINK)
    # Out of scope reads as absent, as everywhere else.
    assert r.status_code == 404


# --------------------------------------------------------------------------
# F4 -- letter dates between the DT date and today
# --------------------------------------------------------------------------
def test_f4_letter_dates_outside_the_window_are_refused():
    from app.models.workitem import Village, WorkItem
    from app.services.acceptance_letters import letter_date_error

    village = Village(work_item=WorkItem(dt_date_gregorian=jalali.from_shamsi_date(1405, 7, 12)))
    today = jalali.tehran_today()
    expected = "Letter date must be between the DT date (1405/07/12) and today."
    assert letter_date_error(village, today + timedelta(days=1)) == expected
    assert letter_date_error(village, jalali.from_shamsi_date(1405, 7, 11)) == expected
    assert letter_date_error(village, jalali.from_shamsi_date(1405, 7, 12)) is None
    assert letter_date_error(village, today) is None

    undated = Village(work_item=WorkItem(), first_seen_at=datetime(2026, 10, 1, tzinfo=timezone.utc))
    assert "import date" in letter_date_error(undated, date(2026, 9, 1))


# --------------------------------------------------------------------------
# F6 -- plans for this month or next only
# --------------------------------------------------------------------------
def test_f6_a_plan_for_another_month_is_422(client):
    sc = _login(client, "lab_sc")
    year, month = jalali.current_shamsi_period()
    r = client.post("/api/v1/pip/my", headers=sc, json={"year": 1399, "month": 1, "submit": False})
    assert r.status_code == 422
    assert r.json()["detail"] == "Plans can be sent for this month or next month only."
    ny, nm = jalali.next_period(year, month)
    for y, m in ((year, month), (ny, nm)):
        ok = client.post("/api/v1/pip/my", headers=sc, json={"year": y, "month": m, "submit": False})
        assert ok.status_code == 200, ok.text


# --------------------------------------------------------------------------
# F7 / F8 -- Ongoing on assignment, DT Done on import
# --------------------------------------------------------------------------
def _dt_status(code):
    from app.models.workitem import WorkItem

    db = SessionLocal()
    try:
        wi = db.get(WorkItem, IDS[code])
        return wi.dt_status, wi.current_stage
    finally:
        db.close()


def test_f7_assigning_sets_ongoing_and_undo_puts_it_back(client):
    from app.models.health_check import HcAssignment, HcTask

    db = SessionLocal()
    try:  # LAB0006 passed a reviewed health check: ready for a drive test.
        a = HcAssignment(code="HC-LAB-6", contractor_id=IDS["contractor"],
                         assigned_at=datetime.now(timezone.utc), status="Closed")
        db.add(a)
        db.flush()
        now = datetime.now(timezone.utc)
        db.add(HcTask(hc_assignment_id=a.id, work_item_id=IDS["LAB0006"], round_no=1,
                      overall_result="Ready", completed_at=now, reviewed_at=now))
        db.commit()
    finally:
        db.close()
    pm = _login(client, "lab_pm")
    r = client.post("/api/v1/work-items/assign", headers=pm, json={
        "work_item_ids": [IDS["LAB0006"]], "contractor_id": IDS["contractor"],
        "assignment_type": "official",
    })
    assert r.status_code == 200, r.text
    assert _dt_status("LAB0006")[0] == "Ongoing"
    assert client.post(f"/api/v1/work-items/assign/{r.json()['batch_id']}/undo",
                       headers=pm).status_code == 200
    assert _dt_status("LAB0006")[0] is None


def _seed_service():
    from app.services.cpm_import import CpmImportService

    return CpmImportService.__new__(CpmImportService)


def _raw(dt_status):
    raw = [None] * 80
    raw[C.COL_HISTORY["dt_status"]] = dt_status
    return raw


def test_f7_a_cpm_value_never_overrides_an_in_app_status():
    from app.models.workitem import WorkItem

    for kept in ("Ongoing", "Done"):
        wi = WorkItem(dt_status=kept, current_stage="Assigned")
        _seed_service()._apply_dt_seed(wi, _raw("Problematic"))
        assert wi.dt_status == kept


def test_f8_an_imported_done_site_is_dt_done_not_new():
    from app.models.workitem import WorkItem
    from app.services.workflow import derive_stage

    wi = WorkItem(dt_status=None)
    _seed_service()._apply_dt_seed(wi, _raw("Done"))
    assert (wi.dt_status, wi.current_stage) == ("Done", "DT Done")
    assert derive_stage(WorkItem(dt_status="Done", drive_tests=[], assignments=[],
                                 hc_tasks=[], health_checks=[])) == "DT Done"


def _migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "d2a7f4c9e815_lab_fixes.py"
    spec = importlib.util.spec_from_file_location("lab_fixes_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_f8_and_f2_data_fixes_are_idempotent():
    m = _migration()
    db = SessionLocal()
    try:
        db.execute(text("UPDATE work_items SET dt_status='Done', current_stage='New' WHERE id=:i"),
                   {"i": IDS["LAB0007"]})
        # An archived duplicate left Submitted by the old code: staged with the
        # index off, as on a database from before this release.
        db.execute(text("DROP INDEX uq_drive_tests_one_submitted"))
        db.execute(text("UPDATE drive_tests SET status='Submitted' WHERE work_item_id=:i "
                        "AND status='Returned'"), {"i": IDS["LAB0002"]})
        db.commit()
        conn = db.connection()
        assert m.fix_dt_done_stages(conn) >= 1
        assert m.supersede_duplicate_drive_tests(conn) == 1
        assert m.fix_dt_done_stages(conn) == 0
        assert m.supersede_duplicate_drive_tests(conn) == 0
        db.execute(text("CREATE UNIQUE INDEX uq_drive_tests_one_submitted ON drive_tests "
                        "(work_item_id) WHERE status = 'Submitted'"))
        db.commit()
        statuses = db.execute(text("SELECT status FROM drive_tests WHERE work_item_id=:i ORDER BY id"),
                              {"i": IDS["LAB0002"]}).scalars().all()
        assert statuses == ["Superseded", "Submitted"]
    finally:
        db.close()


# --------------------------------------------------------------------------
# F9 -- the PM sees work stuck with others (time-shifted 75 days)
# --------------------------------------------------------------------------
def test_f9_new_rows_and_late_counts_after_75_days(client):
    from app.models.mojri import MojriImportRun
    from app.models.workitem import Assignment
    from app.services import home
    from app.models.reference import User

    db = SessionLocal()
    try:
        old = datetime.now(timezone.utc) - timedelta(days=75)
        db.execute(text("UPDATE assignments SET assigned_at=:t WHERE work_item_id=:i"),
                   {"t": old, "i": IDS["LAB0001"]})
        db.add(MojriImportRun(filename="mojri.xlsx", file_date=jalali.tehran_today() - timedelta(days=40)))
        db.commit()
        pm = db.get(User, IDS["lab_pm"])
        body = home.build(db, pm)
        tickets = {t["queue_key"]: t for g in body["groups"] for t in g["tickets"]}
        assert {"dt_with_contractors", "mojri_tracker"} <= set(tickets)
        assert tickets["dt_with_contractors"]["late"] >= 1
        assert tickets["mojri_tracker"]["mojri"]["age_days"] == 40
        assert tickets["mojri_tracker"]["mojri"]["stale"] is True
        assert tickets["mojri_tracker"]["late"] == 1

        # A coordinator of another region sees none of these sites.
        other = db.get(User, IDS["lab_coord_other"])
        theirs = {t["queue_key"]: t for g in home.build(db, other)["groups"] for t in g["tickets"]}
        assert "dt_with_contractors" not in theirs
        assert db.query(Assignment).count() >= 1
    finally:
        db.close()


def test_f9_the_digest_carries_the_new_late_counts():
    from app.models.reference import User
    from app.services import action_digest
    from app.services.mailer import Mailer

    class Box(Mailer):
        def __init__(self):
            self.sent = []

        def send(self, message):
            self.sent.append(message)

    db = SessionLocal()
    try:
        pm = db.get(User, IDS["lab_pm"])
        pm.email, pm.email_digest_enabled = "lab_pm@example.test", True
        db.commit()
        box = Box()
        action_digest.run(db, box, send=True)
        mine = [m for m in box.sent if m.to == "lab_pm@example.test"]
        assert mine and "DT with contractors" not in mine[0].text  # labels are verbs
        assert "Chase drive tests with contractors" in mine[0].text
        assert "Refresh the Mojri tracker" in mine[0].text
    finally:
        db.close()


# --------------------------------------------------------------------------
# F11 / F12 -- no dead accounts, and a regional manager linked on creation
# --------------------------------------------------------------------------
def _role_id(client, admin, name):
    return next(r["id"] for r in client.get("/api/v1/reference/roles", headers=admin).json()
                if r["name"] == name)


def _create(client, admin, username, role, **extra):
    return client.post("/api/v1/admin/users", headers=admin, json={
        "username": username, "password": PASSWORD, "first_name": username.title(),
        "family_name": "Lab", "role_id": _role_id(client, admin, role),
        "sees_all_provinces": False, "province_ids": [], **extra,
    })


def test_f11_a_regional_manager_needs_provinces_and_is_linked(client):
    admin = _admin(client)
    r = _create(client, admin, "lab_rm_none", "RegionalManager")
    assert r.status_code == 422
    assert r.json()["detail"] == "Choose the provinces this regional manager covers."

    r = _create(client, admin, "lab_rm", "RegionalManager", province_ids=IDS["provinces"][:1])
    assert r.status_code == 201, r.text
    assert r.json()["kpi_linked"] is True
    from app.models.kpi import ProvinceMapping
    from app.models.reference import Province

    db = SessionLocal()
    try:
        name = db.get(Province, IDS["provinces"][0]).name
        row = db.execute(select(ProvinceMapping).where(
            ProvinceMapping.province_fa == name, ProvinceMapping.effective_to.is_(None))).scalar_one()
        # The province already named one regional manager: the account is
        # linked to that person, and the mapping keeps the name.
        from app.models.reference import User

        linked = db.execute(select(User.kpi_person_name).where(User.username == "lab_rm")).scalar_one()
        assert linked and row.regional_manager == linked
    finally:
        db.close()
    me = client.get("/api/v1/auth/me", headers=_login(client, "lab_rm")).json()
    assert me["kpi_linked"] is True
    assert client.get("/api/v1/kpi/area", headers=_login(client, "lab_rm")).status_code == 200


def test_f12_no_contractor_without_company_and_no_coordinator_without_area(client):
    admin = _admin(client)
    r = _create(client, admin, "lab_sc_none", "Contractor")
    assert r.status_code == 422 and "contractor company" in r.json()["detail"]
    r = _create(client, admin, "lab_coord_none", "Coordinator")
    assert r.status_code == 422 and "CRA region or province" in r.json()["detail"]
    ok = _create(client, admin, "lab_coord_ok", "Coordinator", province_ids=IDS["provinces"][:1])
    assert ok.status_code == 201, ok.text


def test_f12_suspending_the_ict_submission_owner_clears_it(client):
    from app.models.submission import SubmissionSettings

    db = SessionLocal()
    try:
        row = db.get(SubmissionSettings, 1) or SubmissionSettings(id=1)
        row.owner_user_id = IDS["lab_coord_other"]
        db.merge(row)
        db.commit()
    finally:
        db.close()
    admin = _admin(client)
    r = client.post(f"/api/v1/admin/users/{IDS['lab_coord_other']}/status", headers=admin,
                    json={"status": "Suspended", "reason": "Left the team"})
    assert r.status_code == 200, r.text
    db = SessionLocal()
    try:
        assert db.get(SubmissionSettings, 1).owner_user_id is None
    finally:
        db.close()


# --------------------------------------------------------------------------
# F13 -- the contractor's category is kept, and bulk review works
# --------------------------------------------------------------------------
def test_f13_reason_category_is_stored_and_bulk_review_sends_to_remediation(client):
    pm = _login(client, "lab_pm")
    r = client.post("/api/v1/hc/assignments", headers=pm, json={
        "contractor_id": IDS["contractor"], "work_item_ids": [IDS["LAB0005"]]})
    assert r.status_code == 201, r.text
    task_id = r.json()["tasks"][0]["id"]
    r = client.post(f"/api/v1/hc/tasks/{task_id}/result", headers=pm, json={"technology_results": [
        {"technology": "2G", "result": "NotNormal", "reason_category": "Temp Power",
         "comment": "No power at night"}]})
    assert r.status_code == 200, r.text
    from app.models.health_check import HcTask, HcTaskTechnology

    db = SessionLocal()
    try:
        tech = db.execute(select(HcTaskTechnology).where(HcTaskTechnology.hc_task_id == task_id)).scalar_one()
        assert tech.reason_category == "Temp Power"
        assignment_id = db.get(HcTask, task_id).hc_assignment_id
    finally:
        db.close()
    rows = client.get(f"/api/v1/hc/batches/{assignment_id}", headers=pm).json()["site_rows"]
    assert rows[0]["reason_categories"] == ["Temp Power"]

    assert client.post("/api/v1/hc/results/review-bulk", headers=pm,
                       json={"task_ids": [task_id], "problem_categories": []}).status_code == 400
    r = client.post("/api/v1/hc/results/review-bulk", headers=pm,
                    json={"task_ids": [task_id], "problem_categories": ["Temp Power"]})
    assert r.status_code == 200, r.text
    again = client.post("/api/v1/hc/results/review-bulk", headers=pm,
                        json={"task_ids": [task_id], "problem_categories": ["Temp Power"]})
    assert again.status_code == 409


# --------------------------------------------------------------------------
# F14 -- authority casing
# --------------------------------------------------------------------------
@pytest.mark.parametrize("raw", ["ict", "ICT", " Ict "])
def test_f14_authority_is_case_insensitive(raw):
    from app.schemas.my_work import LetterReviewIn

    assert LetterReviewIn(authority=raw, decision="confirm", submission_ids=[1]).authority == "ICT"
