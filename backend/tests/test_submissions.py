"""Submissions to ICT (UEP-21): Ready, batches, Mojri follow-up, roles, counts.

The rules these tests hold, by the brief's sections:

* **Ready** (§3.3): live pure هدف + drive test done + no active item; one
  reason each, in order resend > became_target > new_dt > missed. A drive test
  still Submitted is not done.
* **Lock** (§5.1): one active item per village; cancelling a draft releases.
* **Late** (§3.4) is measured against the Mojri file's date, never today; a
  stale file pauses the count; only ``in_tracker`` confirms (needs_look not).
* **Mojri commit** (§5.7) confirms sent items and records "sent outside UEP".
* **CPM hook** (§5.6): a brand-new هدف village on a DT-done site reopens the
  drive test; a village once اقماری does not, and is Ready as Became هدف.
* **Roles** (§3.5) and **one count** across Home, summary and rail (§5.8).

Run with:  cd backend && pytest tests/test_submissions.py -q
"""
import io
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_submissions_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import Workbook, load_workbook  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

DB_FILE = "/tmp/uep_submissions_pytest.db"
API = "/api/v1/submissions"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
HADAF = "هدف"
TEHRAN, FARS = "تهران", "فارس"
PDF = b"%PDF-1.4\n%test letter\n"

#: label -> village id; label -> work item id
V: dict[str, int] = {}
W: dict[str, int] = {}


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


# ----- Seed ------------------------------------------------------------------


def _seed() -> None:
    """Sites and the case each stands for.

    * ``seeded``   DT Done from the first CPM import, two villages: missed
    * ``inapp``    DT approved in the app, two villages: new_dt (whole site)
    * ``submitted`` a drive test still Submitted: not DT done, not Ready
    * ``sighted``  one village whose key was once اقماری: became_target
    * ``fars``     DT Done in Fars: outside a Tehran coordinator's scope
    * ``notdt``    no drive test at all
    """
    from app.models.reference import Province
    from app.models.submission import CpmVillageSighting
    from app.models.workitem import DriveTest, Site, Village, WorkItem

    db = SessionLocal()
    try:
        provinces = {p.name: p.id for p in db.query(Province).all()}

        def site(label, *, province=TEHRAN, dt="Done", villages=1, dt_date=date(2026, 9, 1)):
            s = Site(site_code=f"S-{label}", province_id=provinces[province], county="site-county")
            db.add(s)
            db.flush()
            wi = WorkItem(site_id=s.id, site_type="New Site", requested_technology="2G",
                          deployed_technology="2G", dt_status=dt, dt_date_gregorian=dt_date,
                          current_stage="New")
            db.add(wi)
            db.flush()
            W[label] = wi.id
            for n in range(villages):
                v = Village(work_item_id=wi.id, village_code=f"{label}-{n}",
                            village_name=f"آبادی {label} {n}", target_classification=HADAF,
                            county=f"county-{label}" if n == 0 else None)
                db.add(v)
                db.flush()
                V[f"{label}{n}"] = v.id
            return wi

        site("seeded", villages=2)
        inapp = site("inapp", villages=2, dt="Done")
        db.add(DriveTest(work_item_id=inapp.id, status="Approved", is_active=True))
        sub = site("submitted", dt=None)
        db.add(DriveTest(work_item_id=sub.id, status="Submitted", is_active=True))
        site("sighted")
        db.add(CpmVillageSighting(site_code="s-sighted", site_type="new site",
                                  village_code="sighted-0", classification="اقماری",
                                  first_seen_at=datetime.now(timezone.utc)))
        site("fars", province=FARS)
        site("notdt", dt=None)
        db.commit()
    finally:
        db.close()


def _login(client, username, password="Test-Role-Passw0rd"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


def _user(client, admin, username, role, provinces=None):
    roles = client.get("/api/v1/reference/roles", headers=admin).json()
    from app.models.reference import Province

    db = SessionLocal()
    try:
        ids = [p.id for p in db.query(Province).filter(Province.name.in_(provinces or [])).all()]
    finally:
        db.close()
    r = client.post("/api/v1/admin/users", headers=admin, json={
        "username": username, "password": "Test-Role-Passw0rd",
        "first_name": username.title(), "family_name": role,
        "role_id": next(x["id"] for x in roles if x["name"] == role),
        "sees_all_provinces": provinces is None, "province_ids": ids,
    })
    assert r.status_code == 201, r.text
    return _login(client, username), r.json()["id"]


@pytest.fixture(scope="module")
def who(client):
    admin = _login(client, "admin", "Admin@12345")
    pm, _ = _user(client, admin, "pmuser", "PM")
    owner, owner_id = _user(client, admin, "amir", "Coordinator")
    other, _ = _user(client, admin, "tehranco", "Coordinator", provinces=[TEHRAN])
    viewer, _ = _user(client, admin, "viewer1", "Viewer")
    rm, _ = _user(client, admin, "rm1", "RegionalManager", provinces=[TEHRAN])
    assert client.put(f"{API}/owner", headers=pm, json={"user_id": owner_id}).status_code == 200
    return {"admin": admin, "pm": pm, "owner": owner, "other": other, "viewer": viewer, "rm": rm}


def _ready(client, h, **params):
    r = client.get(f"{API}/ready", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _reasons(payload):
    return {v["id"]: v["reason"] for s in payload["sites"] for v in s["villages"]}


# ----- Ready and reasons -----------------------------------------------------


def test_ready_holds_exactly_the_drive_tested_villages_with_their_reasons(client, who):
    reasons = _reasons(_ready(client, who["pm"]))
    assert reasons == {
        V["seeded0"]: "missed", V["seeded1"]: "missed",
        V["inapp0"]: "new_dt", V["inapp1"]: "new_dt",
        V["sighted0"]: "became_target",
        V["fars0"]: "missed",
    }
    assert V["submitted0"] not in reasons and V["notdt0"] not in reasons


def test_a_new_dt_site_lists_every_village_of_the_site(client, who):
    site = next(s for s in _ready(client, who["pm"])["sites"] if s["work_item_id"] == W["inapp"])
    assert (site["villages_ready"], site["villages_total"]) == (2, 2)


def test_reason_filter_and_counts(client, who):
    payload = _ready(client, who["pm"], reason="new_dt")
    assert {v["id"] for s in payload["sites"] for v in s["villages"]} == {V["inapp0"], V["inapp1"]}
    assert payload["counts"] == {"all": 6, "new_dt": 2, "missed": 3, "became_target": 1, "resend": 0}


def test_a_coordinator_who_is_not_the_owner_sees_only_their_provinces(client, who):
    reasons = _reasons(_ready(client, who["other"]))
    assert V["fars0"] not in reasons and V["seeded0"] in reasons
    assert client.post(f"{API}/batches", headers=who["other"],
                       json={"village_ids": [V["seeded0"]]}).status_code == 403


# ----- Roles -----------------------------------------------------------------


@pytest.mark.parametrize("role", ["rm", "admin"])
def test_roles_without_the_area_get_403(client, who, role):
    for path in ("/summary", "/ready", "/batches", "/follow-up"):
        assert client.get(f"{API}{path}", headers=who[role]).status_code == 403, path


def test_viewer_reads_but_cannot_act(client, who):
    assert client.get(f"{API}/summary", headers=who["viewer"]).status_code == 200
    assert client.post(f"{API}/batches", headers=who["viewer"],
                       json={"village_ids": [V["seeded0"]]}).status_code == 403


def test_only_the_pm_changes_the_owner(client, who):
    assert client.put(f"{API}/owner", headers=who["owner"], json={"user_id": 1}).status_code == 403
    rows = client.get(f"{API}/owner/candidates", headers=who["pm"]).json()["rows"]
    amir = next(r for r in rows if r["name"].startswith("Amir"))
    assert amir["is_owner"] is True and isinstance(amir["regions"], list)
    assert all(r["name"] != "Pmuser PM" for r in rows), "only coordinators"


# ----- Draft, lock, cancel, send ---------------------------------------------


def test_draft_locks_villages_and_cancel_releases_them(client, who):
    r = client.post(f"{API}/batches", headers=who["owner"], json={"village_ids": [V["fars0"]]})
    assert r.status_code == 201, r.text
    number = r.json()["number"]
    assert number == 1
    # Locked: not Ready, and a second draft is refused.
    assert V["fars0"] not in _reasons(_ready(client, who["pm"]))
    again = client.post(f"{API}/batches", headers=who["pm"], json={"village_ids": [V["fars0"]]})
    assert again.status_code == 409
    assert client.post(f"{API}/batches/{number}/cancel", headers=who["owner"]).status_code == 200
    assert V["fars0"] in _reasons(_ready(client, who["pm"]))


def test_next_number_skips_cancelled_and_send_records_the_letter(client, who):
    r = client.post(f"{API}/batches", headers=who["owner"],
                    json={"village_ids": [V["seeded0"], V["seeded1"]]})
    number = r.json()["number"]
    assert number == 1, "a cancelled draft's number is reused"
    sent_on = date.today() - timedelta(days=40)
    send = client.post(
        f"{API}/batches/{number}/send", headers=who["owner"],
        data={"mtn_letter_no": "MTN/123", "mtn_letter_date": sent_on.isoformat()},
        files={"file": ("letter.pdf", PDF, "application/pdf")},
    )
    assert send.status_code == 200, send.text
    again = client.post(f"{API}/batches/{number}/send", headers=who["owner"],
                        data={"mtn_letter_no": "X", "mtn_letter_date": sent_on.isoformat()})
    assert again.json()["status"] == "already_sent"
    detail = client.get(f"{API}/batches/{number}", headers=who["pm"]).json()
    assert detail["letters"]["mtn"]["no"] == "MTN/123"
    assert detail["letters"]["mtn"]["file_id"]
    assert detail["letters"]["ict"]["no"] is None

    # The MTN letter is served from the database store (UEP-20), unchanged.
    got = client.get(f"{API}/files/{detail['letters']['mtn']['file_id']}", headers=who["pm"])
    assert got.status_code == 200
    assert got.content == PDF
    assert got.headers["content-type"].startswith("application/pdf")
    assert got.headers["x-content-type-options"] == "nosniff"
    assert got.headers["content-disposition"] == 'attachment; filename="letter.pdf"'


def test_a_letter_whose_stored_file_is_gone_is_a_404(client, who):
    from app.models.stored_file import StoredFile
    from app.models.submission import SubmissionLetterFile

    db = SessionLocal()
    try:
        row = db.query(SubmissionLetterFile).first()
        file_id, sha = row.id, row.sha256
        stored = db.get(StoredFile, sha)
        kept = (stored.extension, stored.size_bytes, bytes(stored.content))
        db.delete(stored)
        db.commit()
    finally:
        db.close()
    try:
        got = client.get(f"{API}/files/{file_id}", headers=who["pm"])
        assert got.status_code == 404
        assert got.json()["detail"] == "The stored file is missing"
    finally:
        db = SessionLocal()
        db.add(StoredFile(sha256=sha, extension=kept[0], size_bytes=kept[1], content=kept[2]))
        db.commit()
        db.close()


def test_optional_letter_and_excel(client, who):
    r = client.post(f"{API}/batches/1/letters/ict", headers=who["owner"],
                    data={"no": "ICT/9", "date": date.today().isoformat()})
    assert r.status_code == 200, r.text
    xl = client.get(f"{API}/batches/1/excel", headers=who["viewer"])
    assert xl.status_code == 200
    assert "MTN_Irancell_Drive_Test_1.xlsx" in xl.headers["content-disposition"]
    sheet = load_workbook(io.BytesIO(xl.content)).active
    from app.services.submissions.excel import HEADERS

    assert sheet.title == "#1"
    assert tuple(c.value for c in sheet[1]) == HEADERS
    rows = list(sheet.iter_rows(min_row=2, values_only=True))
    assert [r[1] for r in rows] == ["seeded-0", "seeded-1"]
    # The village's own county wins; the site's is the fallback.
    assert [r[3] for r in rows] == ["county-seeded", "site-county"]
    assert rows[0][15] == HADAF and rows[0][16] == "S-seeded" and rows[0][17] is None


# ----- Mojri: late, stale, confirm, outside ----------------------------------


def _mojri_run(file_date):
    from app.models.mojri import MojriImportRun

    db = SessionLocal()
    try:
        db.add(MojriImportRun(filename="m.xlsx", file_date=file_date))
        db.commit()
    finally:
        db.close()


def test_late_is_measured_against_the_mojri_file_date_not_today(client, who):
    # Sent 40 days ago. A Mojri file dated 20 days ago: sent+30 is after it.
    _mojri_run(date.today() - timedelta(days=20))
    payload = client.get(f"{API}/follow-up", headers=who["pm"]).json()
    assert payload["late"] == 0
    summary = client.get(f"{API}/summary", headers=who["pm"]).json()
    assert summary["mojri"]["stale"] is False
    # A newer file: now 30 days have passed on Mojri's own calendar.
    _mojri_run(date.today() - timedelta(days=5))
    payload = client.get(f"{API}/follow-up", headers=who["pm"]).json()
    assert payload["late"] == 2


def test_stale_file_flag():
    from app.services.submissions.follow_up import MojriClock

    today = date(2026, 11, 20)
    assert MojriClock(today - timedelta(days=31), 30, today).stale is True
    assert MojriClock(today - timedelta(days=30), 30, today).stale is False
    assert MojriClock(None, 30, today).stale is True


def test_mark_raised_then_send_again_puts_the_village_back_as_resend(client, who):
    rows = client.get(f"{API}/follow-up", headers=who["pm"]).json()["rows"]
    item = next(r for r in rows if r["village_id"] == V["seeded1"])
    r = client.post(f"{API}/follow-up/raise", headers=who["owner"],
                    json={"item_ids": [item["item_id"]], "note": "called ICT"})
    assert r.status_code == 200
    raised = client.get(f"{API}/follow-up", headers=who["pm"]).json()
    assert raised["raised"] == 1
    r = client.post(f"{API}/follow-up/resend", headers=who["owner"], json={"item_ids": [item["item_id"]]})
    assert r.status_code == 200
    assert _reasons(_ready(client, who["pm"]))[V["seeded1"]] == "resend"


def test_mojri_commit_confirms_sent_items_and_records_outside_uep(client, who):
    from app.models.submission import SubmissionItem
    from app.services import mojri_tracker

    def filled(keys):
        wb = Workbook()
        ws = wb.active
        ws.append(list(mojri_tracker.TEMPLATE_COLUMNS))
        for site_code, code in keys:
            row = [site_code, "New Site", code, ""] + ["2G", "", ""] + ["", "", ""]
            ws.append(row)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    # seeded-0 was sent (batch 1); sighted-0 never went through UEP.
    content = filled([("S-seeded", "seeded-0"), ("S-sighted", "sighted-0")])
    files = {"file": ("m.xlsx", content, XLSX)}
    preview = client.post("/api/v1/mojri/import/preview", headers=who["pm"], files=files).json()
    assert preview["submissions"] == {"follow_ups_closed": 1, "outside_uep": 1}
    file_day = date.today() - timedelta(days=1)
    r = client.post("/api/v1/mojri/import/commit", headers=who["pm"], files=files,
                    data={"digest": preview["digest"], "file_date": file_day.isoformat()})
    assert r.status_code == 200, r.text
    db = SessionLocal()
    try:
        sent = db.query(SubmissionItem).filter(
            SubmissionItem.village_id == V["seeded0"], SubmissionItem.superseded_at.is_(None)).one()
        assert sent.mojri_confirmed_at == file_day
        outside = db.query(SubmissionItem).filter(SubmissionItem.village_id == V["sighted0"]).one()
        assert (outside.batch_id, outside.reason, outside.source, outside.sent_at) == (
            None, "outside", "mojri", file_day)
    finally:
        db.close()
    late = client.get(f"{API}/follow-up", headers=who["pm"]).json()
    assert all(r["village_id"] != V["seeded0"] for r in late["rows"])
    assert V["sighted0"] not in _reasons(_ready(client, who["pm"]))


def test_needs_look_does_not_count_as_in_mojri():
    from app.services.submissions.follow_up import in_mojri

    assert "in_tracker" in str(in_mojri().compile(compile_kwargs={"literal_binds": True}))
    assert "needs_look" not in str(in_mojri().compile(compile_kwargs={"literal_binds": True}))


# ----- Counts are one number everywhere --------------------------------------


def test_home_summary_and_rail_agree(client, who):
    summary = client.get(f"{API}/summary", headers=who["owner"]).json()
    home = client.get("/api/v1/me/home", headers=who["owner"]).json()
    tickets = {t["queue_key"]: t for g in home["groups"] for t in g["tickets"]}
    assert tickets["submit_to_ict"]["count"] == summary["ready"]["villages"]
    late = summary["follow_up"]["late"]
    assert tickets.get("ict_mojri_follow_up", {"count": 0})["count"] == late
    assert tickets["submit_to_ict"]["submission"]["next_number"] == summary["cycle"]["next_number"]
    # A coordinator who is not the owner has no such rows.
    other = client.get("/api/v1/me/home", headers=who["other"]).json()
    keys = {t["queue_key"] for g in other["groups"] for t in g["tickets"]}
    assert "submit_to_ict" not in keys


# ----- Past batch import -----------------------------------------------------


def _past_file(rows):
    from app.services.submissions.excel import HEADERS

    wb = Workbook()
    ws = wb.active
    ws.title = "#7"
    ws.append(list(HEADERS))
    for site_code, code, flag in rows:
        values = [None] * len(HEADERS)
        values[1], values[11], values[15], values[16] = code, "New Site", flag, site_code
        ws.append(values)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_past_import_preview_commit_and_idempotency(client, who):
    content = _past_file([
        ("S-inapp", "inapp-0", HADAF),
        ("S-nowhere", "999", HADAF),
        ("S-inapp", "inapp-1", "اقماری"),
    ])
    files = {"file": ("MTN_Irancell_Drive_Test_7-Final.xlsx", content, XLSX)}
    preview = client.post(f"{API}/import/preview", headers=who["owner"], files=files).json()
    assert (preview["number"], preview["matched"], preview["unmatched"], preview["skipped"]) == (7, 1, 1, 1)
    form = {"digest": preview["digest"], "mtn_letter_date": "2026-05-01"}
    first = client.post(f"{API}/import/commit", headers=who["owner"], files=files, data=form)
    assert first.status_code == 200, first.text and first.json()["created"] is True
    again = client.post(f"{API}/import/commit", headers=who["owner"], files=files, data=form)
    assert again.json() == {"number": 7, "created": False}
    assert V["inapp0"] not in _reasons(_ready(client, who["pm"]))


def test_keys_match_codes_written_as_numbers():
    from app.services.mojri_tracker import match_key

    assert match_key("S-1", "New Site", 229164.0) == match_key(" s-1 ", "new  site", "229164")


# ----- CPM hook ---------------------------------------------------------------


def _change_request(work_item_id, code):
    from app.models.acceptance import CpmChangeRequest, CpmImportBatch

    db = SessionLocal()
    try:
        batch = CpmImportBatch(filename="cpm.xlsx")
        db.add(batch)
        db.flush()
        cr = CpmChangeRequest(
            import_batch_id=batch.id, work_item_id=work_item_id, site_code="x",
            change_type="village_qty",
            status="Pending", field_name="village_qty",
            payload_json=json.dumps({"added": [{"village_code": code, "village_name": "n",
                                               "target_classification": HADAF}], "removed": []}),
        )
        db.add(cr)
        db.commit()
        return cr.id
    finally:
        db.close()


def test_a_brand_new_village_on_a_dt_done_site_reopens_the_drive_test(client):
    from app.models.acceptance import CpmChangeRequest
    from app.models.workitem import WorkItem
    from app.services.cpm_apply import apply_change_request

    cr_id = _change_request(W["fars"], "brand-new")
    db = SessionLocal()
    try:
        apply_change_request(db, db.get(CpmChangeRequest, cr_id))
        db.commit()
        assert db.get(WorkItem, W["fars"]).dt_status is None
    finally:
        db.close()


def test_a_village_once_eghmari_does_not_reopen_and_is_ready_as_became_target(client, who):
    from app.models.acceptance import CpmChangeRequest
    from app.models.submission import CpmVillageSighting
    from app.models.workitem import Village, WorkItem
    from app.services.cpm_apply import apply_change_request

    db = SessionLocal()
    try:
        db.add(CpmVillageSighting(site_code="s-notdt", site_type="new site",
                                  village_code="moved", first_seen_at=datetime.now(timezone.utc)))
        db.get(WorkItem, W["notdt"]).dt_status = "Done"
        db.commit()
    finally:
        db.close()
    cr_id = _change_request(W["notdt"], "moved")
    db = SessionLocal()
    try:
        apply_change_request(db, db.get(CpmChangeRequest, cr_id))
        db.commit()
        assert db.get(WorkItem, W["notdt"]).dt_status == "Done"
        moved = db.query(Village).filter(Village.village_code == "moved").one().id
    finally:
        db.close()
    assert _reasons(_ready(client, who["pm"]))[moved] == "became_target"


# ----- SLA defaults -------------------------------------------------------------


def test_sla_steps_and_defaults():
    from app.services import sla_policy

    assert sla_policy.STEPS_BY_KEY["submit_cycle"].default == 14
    assert sla_policy.STEPS_BY_KEY["mojri_follow_up"].default == 30
    assert sla_policy.STEPS_BY_KEY["mojri_follow_up"].area == "drive_test"


def test_letter_dates_are_read_as_iso_or_shamsi():
    from app.core.jalali import parse_day

    assert parse_day("2026-11-19") == date(2026, 11, 19)
    assert parse_day("1405/08/28") == parse_day("۱۴۰۵/۰۸/۲۸") == date(2026, 11, 19)
    assert parse_day("") is None
    with pytest.raises(ValueError):
        parse_day("1405/13/40")
