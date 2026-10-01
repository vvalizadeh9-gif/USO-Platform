"""My Work (docs/design/my-work-api.md): scope, tabs, rounds, letters, review.

What is protected, in the order of spec §11:

* the scope rule, including a village whose drive test is done but whose site
  is not on air, and the Python/SQL twins of both scopes and of the tab rule;
* tab counts equal the rows each tab lists, from the same select;
* round numbering and carry-over from a partly rejected round;
* a failure anywhere in a letter files nothing;
* ICT and CRA, sent separately, never touch each other;
* a coordinator's or PM's save lands decided, with no pending step;
* confirm-all-on-letter, and return needing a reason;
* pasted codes and filings cannot reach another contractor's villages;
* role scoping: contractor, coordinator by province, PM, Admin, Viewer.

Run with:  cd backend && pytest tests/test_my_work.py -q
"""
import itertools
import json
import os
import sys
from pathlib import Path

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_my_work_v2_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

DB_PATH = "/tmp/uep_my_work_v2_pytest.db"
REPO = Path(__file__).resolve().parents[2]
ONAIR = "راه_اندازی_دائم"
PDF = b"%PDF-1.4\n% test letter\n"


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _login(client, username="admin", password="Admin@12345") -> str:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_TOKENS: dict = {}


def _user(client, role, username, *, contractor_id=None, province_ids=None) -> dict:
    """Auth headers for a user of ``role``; created on first use."""
    if username not in _TOKENS:
        admin = _auth(_login(client))
        roles = client.get("/api/v1/reference/roles", headers=admin).json()
        created = client.post("/api/v1/admin/users", headers=admin, json={
            "username": username, "password": "Test-Fixture-Passphrase",
            "first_name": "Test", "family_name": role,
            "role_id": next(r["id"] for r in roles if r["name"] == role),
            "contractor_id": contractor_id,
            "sees_all_provinces": province_ids is None,
            "province_ids": province_ids or [],
        })
        assert created.status_code == 201, created.text
        _TOKENS[username] = _login(client, username, "Test-Fixture-Passphrase")
    return _auth(_TOKENS[username])


def _seed(tag, *, techs="2G,4G", villages=1, on_air=True, dt="Done", contractor_id=None, province_id=None):
    """A هدف site with ``villages`` villages. Returns (contractor_id, province_id, site_id, [village ids])."""
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    if province_id is None:
        province = Province(name=f"Prov-{tag}")
        db.add(province)
        db.flush()
        province_id = province.id
    if contractor_id is None:
        contractor = Contractor(name=f"Co-{tag}", type="drive_test")
        db.add(contractor)
        db.flush()
        contractor_id = contractor.id
    site = Site(site_code=f"S-{tag}", province_id=province_id)
    db.add(site)
    db.flush()
    work_item = WorkItem(
        site_id=site.id, site_type="Target", requested_technology=techs,
        dt_status=dt, dt_sc_contractor_id=contractor_id, current_stage="DT Done",
        last_stage=ONAIR if on_air else "نصب",
    )
    db.add(work_item)
    db.flush()
    ids = []
    for n in range(villages):
        village = Village(
            work_item_id=work_item.id, village_code=f"{tag}-V{n + 1}",
            village_name=f"روستا {tag} {n + 1}", target_classification="هدف",
        )
        db.add(village)
        db.flush()
        ids.append(village.id)
    db.commit()
    out = (contractor_id, province_id, site.id, ids)
    db.close()
    return out


def _scan(client, headers) -> str:
    r = client.post("/api/v1/acceptance/scans", headers=headers,
                    files={"file": ("letter.pdf", PDF, "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["scan_id"]


def _approve(*techs):
    return [{"tech": t, "result": "approved"} for t in techs]


def _letter(client, headers, authority, items, *, number="1405/ص/100", date="1405/04/11", scan=True):
    body = {
        "authority": authority, "letter_number": number, "letter_date": date,
        "scan_id": _scan(client, headers) if scan else None, "items": items,
    }
    return client.post("/api/v1/acceptance/letters", headers=headers, json=body)


def _list(client, headers, **params):
    r = client.get("/api/v1/acceptance/my-work", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _detail(client, headers, village_id):
    r = client.get(f"/api/v1/acceptance/villages/{village_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _ids(listing) -> set[int]:
    return {row["village_id"] for row in listing["rows"]}


def _contractor(client, tag, contractor_id):
    return _user(client, "Contractor", f"mw2_co_{tag}", contractor_id=contractor_id)


# ---------------------------------------------------------------------------
# Rule twins: Python and SQL agree
# ---------------------------------------------------------------------------
def test_tab_rule_python_and_sql_agree_on_every_status_pair(client):
    from sqlalchemy import case, literal, select

    from app.services import my_work_status as S

    db = SessionLocal()
    try:
        for ict, cra in itertools.product(S.STATUSES, repeat=2):
            expected = S.tabs_of([ict, cra])
            sides = (literal(S.stored_status(ict)), literal(S.stored_status(cra)))
            for tab in S.STATUS_TABS:
                got = db.execute(select(case((S.tab_clause(tab, sides), 1), else_=0))).scalar()
                assert bool(got) == (tab in expected), (ict, cra, tab)
    finally:
        db.close()


def test_tab_precedence_rejected_then_returned_then_waiting():
    from app.services import my_work_status as S

    assert S.exclusive_tab(["returned", "rejected"]) == "new_letter"
    assert S.exclusive_tab(["waiting", "returned"]) == "returned"
    assert S.exclusive_tab(["filled", "waiting"]) == "not_filed"
    assert S.tabs_of(["filled", "waiting"]) == {"all", "your_move", "not_filed", "filled"}
    assert S.exclusive_tab(["filled", "approved"]) is None


def test_scope_python_and_sql_agree_including_dt_done_but_not_on_air(client):
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.workitem import Village, WorkItem
    from app.services import my_work_scope as scope

    _seed("TWIN-ON")
    _seed("TWIN-OFF", on_air=False)
    _seed("TWIN-NODT", dt="Problematic")

    db = SessionLocal()
    try:
        villages = db.execute(
            select(Village).options(selectinload(Village.work_item))
        ).scalars().all()
        for name in scope.SCOPES:
            python = {v.id for v in villages if scope.in_scope(name, v.work_item, v)}
            sql = set(db.execute(
                select(Village.id).join(WorkItem, Village.work_item_id == WorkItem.id)
                .where(scope.scope_clause(db, name))
            ).scalars())
            assert python == sql, name
        by_code = {v.village_code: v for v in villages}
        off = by_code["TWIN-OFF-V1"]
        assert scope.in_scope("universe", off.work_item, off)
        assert not scope.in_scope("remaining", off.work_item, off)
        no_dt = by_code["TWIN-NODT-V1"]
        assert not scope.in_scope("universe", no_dt.work_item, no_dt)
    finally:
        db.close()


def test_onair_twin_matches_is_onair_stage_on_every_stored_value(client):
    from sqlalchemy import select

    from app.models.workitem import WorkItem
    from app.services import cpm_columns as C
    from app.services.my_work_scope import onair_clause

    db = SessionLocal()
    try:
        stages = db.execute(select(WorkItem.id, WorkItem.last_stage)).all()
        sql = set(db.execute(select(WorkItem.id).where(onair_clause(db))).scalars())
        assert sql == {i for i, stage in stages if C.is_onair_stage(stage)}
    finally:
        db.close()


def test_frontend_vocabulary_matches_the_server():
    from app.services import my_work_status as S

    path = REPO / "frontend/src/pages/mywork/statusVocabulary.json"
    if not path.exists():
        pytest.skip("frontend tree not present")
    vocab = json.loads(path.read_text(encoding="utf-8"))
    assert set(vocab["statuses"]) == set(S.STATUSES)
    assert set(vocab["tabs"]) == set(S.TABS)


def test_digit_vectors_shared_with_the_frontend():
    from app.core.digits import to_latin

    path = REPO / "frontend/src/lib/digitVectors.json"
    if not path.exists():
        pytest.skip("frontend tree not present")
    for raw, latin in json.loads(path.read_text(encoding="utf-8")):
        assert to_latin(raw) == latin


# ---------------------------------------------------------------------------
# Scope and role visibility through the API
# ---------------------------------------------------------------------------
def test_remaining_hides_not_on_air_and_universe_shows_it(client):
    co, _p, _s, (on_id,) = _seed("SCOPE-ON")
    _co, _p, _s, (off_id,) = _seed("SCOPE-OFF", on_air=False, contractor_id=co)
    headers = _contractor(client, "scope", co)
    remaining = _list(client, headers, tab="your_move")
    assert on_id in _ids(remaining) and off_id not in _ids(remaining)
    universe = _list(client, headers, scope="universe", tab="all")
    assert {on_id, off_id} <= _ids(universe)
    assert [t["key"] for t in universe["tabs"]][-1] == "all"


def test_contractor_sees_only_their_own_villages(client):
    mine, _p, _s, (my_id,) = _seed("ROLE-MINE")
    _other, _p, _s, (their_id,) = _seed("ROLE-THEIRS")
    headers = _contractor(client, "role", mine)
    listing = _list(client, headers, tab="your_move")
    assert my_id in _ids(listing) and their_id not in _ids(listing)
    assert client.get(f"/api/v1/acceptance/villages/{their_id}", headers=headers).status_code == 404


def test_coordinator_sees_granted_provinces_only_and_pm_sees_all(client):
    _co, granted, _s, (in_id,) = _seed("ROLE-GRANT")
    _co, _other, _s, (out_id,) = _seed("ROLE-NOGRANT")
    coordinator = _user(client, "Coordinator", "mw2_coord_grant", province_ids=[granted])
    seen = _ids(_list(client, coordinator, tab="all", limit=500))
    assert in_id in seen and out_id not in seen
    pm = _user(client, "PM", "mw2_pm")
    assert {in_id, out_id} <= _ids(_list(client, pm, tab="all", limit=500))


def test_admin_is_refused_and_viewer_is_read_only(client):
    admin = _auth(_login(client))
    assert client.get("/api/v1/acceptance/my-work", headers=admin).status_code == 403
    viewer = _user(client, "Viewer", "mw2_viewer")
    listing = _list(client, viewer)
    assert listing["read_only"] is True
    assert all(not s["editable"] for r in listing["rows"] for s in r["sides"].values())
    assert client.post("/api/v1/acceptance/scans", headers=viewer,
                       files={"file": ("l.pdf", PDF)}).status_code == 403


# ---------------------------------------------------------------------------
# Counts equal the list
# ---------------------------------------------------------------------------
def test_every_tab_count_equals_the_rows_it_lists(client):
    co, _p, _s, ids = _seed("COUNT", villages=4)
    headers = _contractor(client, "count", co)
    pm = _user(client, "PM", "mw2_pm")
    # One filled ICT, one rejected ICT, the rest untouched.
    assert _letter(client, headers, "ICT", [{"village_id": ids[0], "claims": _approve("2G", "4G")}]).status_code == 201
    assert _letter(client, pm, "ICT", [{"village_id": ids[1], "claims": [
        {"tech": "2G", "result": "approved"},
        {"tech": "4G", "result": "rejected", "reason": "weak signal"},
    ]}]).status_code == 201

    for who in (headers, pm):
        first = _list(client, who, limit=0)
        assert first["rows"] == []
        for tab in first["tabs"]:
            listing = _list(client, who, tab=tab["key"], limit=500)
            assert len(listing["rows"]) == tab["count"] == listing["total"], tab
        authority = _list(client, who, tab=first["tab"], authority="ICT", limit=500)
        assert len(authority["rows"]) == authority["total"]

    contractor = _list(client, headers, limit=500)
    assert contractor["authority_totals"] == {"kind": "not_approved", "ICT": 4, "CRA": 4}
    assert ids[1] in _ids(_list(client, headers, tab="new_letter"))
    assert ids[0] in _ids(_list(client, headers, tab="filled"))
    staff = _list(client, pm, limit=0)
    assert staff["authority_totals"]["kind"] == "to_check"


def test_cursor_pages_through_and_rejects_a_foreign_cursor(client):
    co, _p, _s, ids = _seed("PAGE", villages=5)
    headers = _contractor(client, "page", co)
    first = _list(client, headers, tab="your_move", limit=2)
    second = _list(client, headers, tab="your_move", limit=2, cursor=first["next_cursor"])
    assert not _ids(first) & _ids(second)
    bad = client.get("/api/v1/acceptance/my-work", headers=headers,
                     params={"tab": "not_filed", "cursor": first["next_cursor"]})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "invalid_cursor"


# ---------------------------------------------------------------------------
# Letters
# ---------------------------------------------------------------------------
def test_contractor_letter_files_pending_rounds_with_one_scan(client):
    co, _p, _s, ids = _seed("FILE", villages=2)
    headers = _contractor(client, "file", co)
    r = _letter(client, headers, "ICT", [{"village_id": i, "claims": _approve("2G", "4G")} for i in ids],
                number="۱۴۰۵/ص/۱۹۲۰")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["decided"] is False and body["letter_number"] == "1405/ص/1920"
    assert {x["status"] for x in body["results"]} == {"filled"}
    side = _detail(client, headers, ids[0])["sides"]["ICT"]
    assert side["status"] == "filled" and side["history"][0]["result"] == "pending"
    assert side["history"][0]["scan"]["filename"] == "letter.pdf"
    assert side["history"][0]["letter_date_shamsi"] == "1405/04/11"


def test_a_failure_inside_a_letter_files_nothing(client):
    co, _p, _s, (good, bad) = _seed("ATOMIC", villages=2)
    _other, _p, _s, (foreign,) = _seed("ATOMIC-OTHER")
    headers = _contractor(client, "atomic", co)
    r = _letter(client, headers, "ICT", [
        {"village_id": good, "claims": _approve("2G", "4G")},
        {"village_id": bad, "claims": [{"tech": "2G", "result": "approved"},
                                       {"tech": "4G", "result": "rejected"}]},
        {"village_id": foreign, "claims": _approve("2G", "4G")},
    ])
    assert r.status_code == 400
    errors = r.json()["detail"]["errors"]
    assert {"village_id": bad, "tech": "4G", "code": "reason_missing"}.items() <= next(
        e for e in errors if e.get("village_id") == bad).items()
    assert {"village_id": foreign, "code": "not_found"} in errors
    assert _detail(client, headers, good)["sides"]["ICT"]["history"] == []


def test_letter_field_errors_are_reported_per_field(client):
    co, _p, _s, (vid,) = _seed("FIELDS")
    headers = _contractor(client, "fields", co)
    r = _letter(client, headers, "ICT", [{"village_id": vid, "claims": _approve("2G", "4G")}],
                number="  ", date="1405/13/40", scan=False)
    assert r.status_code == 400
    codes = {(e.get("field"), e["code"]) for e in r.json()["detail"]["errors"]}
    assert codes == {("letter_number", "missing"), ("letter_date", "invalid_date"), ("scan_id", "scan_missing")}


def test_a_scan_token_is_its_uploaders_alone(client):
    co, _p, _s, (vid,) = _seed("SCAN")
    headers = _contractor(client, "scan", co)
    pm = _user(client, "PM", "mw2_pm")
    body = {"authority": "ICT", "letter_number": "S-1", "letter_date": "1405/04/11",
            "scan_id": _scan(client, pm), "items": [{"village_id": vid, "claims": _approve("2G", "4G")}]}
    r = client.post("/api/v1/acceptance/letters", headers=headers, json=body)
    assert r.status_code == 400
    assert {"field": "scan_id", "code": "scan_missing"}.items() <= r.json()["detail"]["errors"][0].items()
    body["scan_id"] = _scan(client, headers)[:-3] + "AAA"
    assert client.post("/api/v1/acceptance/letters", headers=headers, json=body).status_code == 400


def test_ict_and_cra_are_sent_separately_and_never_touch_each_other(client):
    co, _p, _s, (vid,) = _seed("SIDES")
    headers = _contractor(client, "sides", co)
    assert _letter(client, headers, "ICT", [{"village_id": vid, "claims": _approve("2G", "4G")}]).status_code == 201
    sides = _detail(client, headers, vid)["sides"]
    assert sides["ICT"]["status"] == "filled"
    assert sides["CRA"]["status"] == "waiting" and sides["CRA"]["history"] == []
    assert _letter(client, headers, "CRA", [{"village_id": vid, "claims": _approve("2G", "4G")}],
                   number="CRA-9").status_code == 201
    sides = _detail(client, headers, vid)["sides"]
    assert sides["ICT"]["history"][0]["letter_number"] == "1405/ص/100"
    assert sides["CRA"]["history"][0]["letter_number"] == "CRA-9"


def test_a_staff_save_lands_decided_with_no_pending_step(client):
    from sqlalchemy import select

    from app.models.acceptance_workflow import AcceptanceSubmission

    _co, _p, _s, (ok, refused) = _seed("STAFF", villages=2)
    coordinator = _user(client, "Coordinator", "mw2_coord_all")
    r = _letter(client, coordinator, "CRA", [
        {"village_id": ok, "claims": _approve("2G", "4G")},
        {"village_id": refused, "claims": [{"tech": "2G", "result": "approved"},
                                           {"tech": "4G", "result": "rejected", "reason": "no coverage"}]},
    ])
    assert r.status_code == 201, r.text
    assert r.json()["decided"] is True
    assert {x["village_id"]: x["status"] for x in r.json()["results"]} == {ok: "approved", refused: "rejected"}

    db = SessionLocal()
    try:
        rows = db.execute(select(AcceptanceSubmission).where(
            AcceptanceSubmission.village_id.in_([ok, refused]))).scalars().all()
        assert {s.review_status for s in rows} == {"Validated"}
        assert all(s.reviewed_by == s.submitted_by and s.reviewed_at for s in rows)
    finally:
        db.close()


def test_round_numbering_and_carry_over_after_a_partial_rejection(client):
    _co, _p, _s, (vid,) = _seed("ROUNDS")
    pm = _user(client, "PM", "mw2_pm")
    assert _letter(client, pm, "ICT", [{"village_id": vid, "claims": [
        {"tech": "2G", "result": "approved"},
        {"tech": "4G", "result": "rejected", "reason": "weak signal at the village centre"},
    ]}], number="R-1").status_code == 201

    side = _detail(client, pm, vid)["sides"]["ICT"]
    assert side["status"] == "rejected" and side["next_round_no"] == 2
    assert side["to_file"] == ["4G"]
    assert side["carry_over"] == [
        {"tech": "2G", "result": "approved", "round_no": 1},
        {"tech": "4G", "result": "rejected", "round_no": 1},
    ]
    assert side["last_reason"] == {"round_no": 1, "kind": "rejected", "techs": ["4G"],
                                   "reason": "weak signal at the village centre"}

    # Claiming the carried approval again is refused; the refused tech alone is round 2.
    again = _letter(client, pm, "ICT", [{"village_id": vid, "claims": _approve("2G", "4G")}], number="R-2")
    assert again.status_code == 400 and again.json()["detail"]["errors"][0]["code"] == "tech_carried"
    second = _letter(client, pm, "ICT", [{"village_id": vid, "claims": _approve("4G")}], number="R-2")
    assert second.status_code == 201 and second.json()["results"][0]["round_no"] == 2

    side = _detail(client, pm, vid)["sides"]["ICT"]
    assert side["status"] == "approved" and side["last_reason"] is None
    assert [r["round_no"] for r in side["history"]] == [2, 1]
    assert {c["tech"]: c["round_no"] for c in side["carry_over"]} == {"2G": 1, "4G": 2}


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------
def test_confirm_all_on_a_letter_decides_every_village_in_one_go(client):
    co, _p, _s, ids = _seed("CONFIRMALL", villages=3)
    headers = _contractor(client, "confirmall", co)
    items = [{"village_id": i, "claims": _approve("2G", "4G")} for i in ids[:2]]
    items.append({"village_id": ids[2], "claims": [{"tech": "2G", "result": "approved"},
                                                   {"tech": "4G", "result": "rejected", "reason": "x"}]})
    assert _letter(client, headers, "ICT", items, number="CA-1").status_code == 201

    pm = _user(client, "PM", "mw2_pm")
    side = _detail(client, pm, ids[0])["sides"]["ICT"]
    assert side["reviewable"] and side["same_letter"] == {"letter_number": "CA-1", "count": 3}

    r = client.post("/api/v1/acceptance/letters/review", headers=pm, json={
        "authority": "ICT", "letter_number": "CA-1", "decision": "confirm"})
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 3
    assert {x["village_id"]: x["status"] for x in r.json()["results"]} == {
        ids[0]: "approved", ids[1]: "approved", ids[2]: "rejected"}
    assert _detail(client, headers, ids[2])["sides"]["ICT"]["last_reason"]["reason"] == "x"


def test_return_requires_a_reason_and_reaches_the_contractor(client):
    co, _p, _s, (vid,) = _seed("RETURN")
    headers = _contractor(client, "return", co)
    assert _letter(client, headers, "CRA", [{"village_id": vid, "claims": _approve("2G", "4G")}],
                   number="RT-1").status_code == 201
    sid = _detail(client, headers, vid)["sides"]["CRA"]["history"][0]["submission_id"]
    coordinator = _user(client, "Coordinator", "mw2_coord_all")

    r = client.post("/api/v1/acceptance/letters/review", headers=coordinator, json={
        "authority": "CRA", "submission_ids": [sid], "decision": "return"})
    assert r.status_code == 400 and r.json()["detail"]["errors"][0]["code"] == "reason_missing"

    r = client.post("/api/v1/acceptance/letters/review", headers=coordinator, json={
        "authority": "CRA", "submission_ids": [sid], "decision": "return", "reason": "wrong letter number"})
    assert r.status_code == 200 and r.json()["results"][0]["status"] == "returned"
    side = _detail(client, headers, vid)["sides"]["CRA"]
    assert side["status"] == "returned" and side["editable"] and side["next_round_no"] == 2
    assert side["last_reason"] == {"round_no": 1, "kind": "returned", "techs": [],
                                   "reason": "wrong letter number"}
    assert vid in _ids(_list(client, headers, tab="returned"))

    again = client.post("/api/v1/acceptance/letters/review", headers=coordinator, json={
        "authority": "CRA", "submission_ids": [sid], "decision": "confirm"})
    assert again.status_code == 409


def test_contractors_cannot_review(client):
    co, _p, _s, (vid,) = _seed("NOREVIEW")
    headers = _contractor(client, "noreview", co)
    r = client.post("/api/v1/acceptance/letters/review", headers=headers, json={
        "authority": "ICT", "letter_number": "X", "decision": "confirm"})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Pasted codes and suggestions
# ---------------------------------------------------------------------------
def test_pasted_codes_never_reach_another_contractors_villages(client):
    mine, _p, _s, _ids_mine = _seed("PASTE", villages=2)
    _other, _p, _s, _ids_theirs = _seed("PASTE-X")
    headers = _contractor(client, "paste", mine)
    r = client.post("/api/v1/acceptance/villages/resolve", headers=headers, json={
        "codes": ["paste-v1", " PASTE-V2 ", "PASTE-X-V1", "NOPE-1"]})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 4
    assert {m["code"] for m in body["matched"]} == {"PASTE-V1", "PASTE-V2"}
    assert set(body["unmatched"]) == {"PASTE-X-V1", "NOPE-1"}


def test_suggestions_are_same_site_villages_still_waiting_on_that_authority(client):
    co, _p, _s, ids = _seed("SUGGEST", villages=3)
    headers = _contractor(client, "suggest", co)
    assert _letter(client, headers, "ICT", [{"village_id": ids[1], "claims": _approve("2G", "4G")}]).status_code == 201
    r = client.get(f"/api/v1/acceptance/villages/{ids[0]}/suggestions", headers=headers, params={"authority": "ICT"})
    assert r.status_code == 200
    assert [v["village_id"] for v in r.json()["villages"]] == [ids[2]]
    cra = client.get(f"/api/v1/acceptance/villages/{ids[0]}/suggestions", headers=headers, params={"authority": "CRA"})
    assert {v["village_id"] for v in cra.json()["villages"]} == {ids[1], ids[2]}


def test_old_endpoints_announce_their_retirement(client):
    pm = _user(client, "PM", "mw2_pm")
    r = client.get("/api/v1/acceptance/villages", headers=pm)
    assert r.status_code == 200 and r.headers["Deprecation"] == "true"


def test_rows_carry_to_file_and_ids_fetch_rows_outside_the_tab_but_inside_scope(client):
    _co, _p, _s, (vid,) = _seed("TOFILE")
    _co2, _p2, _s2, (foreign,) = _seed("TOFILE-X")
    pm = _user(client, "PM", "mw2_pm")
    assert _letter(client, pm, "ICT", [{"village_id": vid, "claims": [
        {"tech": "2G", "result": "approved"},
        {"tech": "4G", "result": "rejected", "reason": "gap"},
    ]}], number="TF-1").status_code == 201
    row = _list(client, pm, ids=str(vid))["rows"][0]
    assert row["sides"]["ICT"]["to_file"] == ["4G"]
    assert row["sides"]["CRA"]["to_file"] == ["2G", "4G"]
    assert row["refiling_round"] == 2

    co_headers = _contractor(client, "tofile", _co)
    got = _ids(_list(client, co_headers, tab="filled", ids=f"{vid},{foreign}"))
    assert got == {vid}


@pytest.mark.parametrize("claims, decision, expected", [
    ([("2G", "Approved"), ("4G", "Approved")], "Validated", "APPROVED"),
    ([("2G", "Approved"), ("4G", "Rejected")], "Validated", "REJECTED"),
    ([("2G", "Approved"), ("4G", "Approved")], "Returned", "RETURNED"),
])
def test_the_old_review_endpoint_audits_by_outcome(client, claims, decision, expected):
    """It compared review_status to "Approved", which it never is, so every
    decision was audited as REJECTED."""
    from sqlalchemy import select

    from app.models.acceptance import AuditLog

    co, _p, _s, (vid,) = _seed(f"AUDIT-{expected}")
    headers = _contractor(client, f"audit_{expected.lower()}", co)
    filed = client.post(f"/api/v1/acceptance/villages/{vid}/submissions", headers=headers, json={
        "authority": "ICT", "letter_number": "A-1", "letter_date_shamsi": "1405/04/11",
        "technologies": [{"technology": t, "claimed_status": c, "comment": "x" if c == "Rejected" else None}
                         for t, c in claims],
    })
    assert filed.status_code == 201, filed.text
    sid = filed.json()["id"]
    pm = _user(client, "PM", "mw2_pm")
    reviewed = client.post(f"/api/v1/acceptance/submissions/{sid}/review", headers=pm,
                           json={"decision": decision, "comment": "wrong letter"})
    assert reviewed.status_code == 200, reviewed.text

    db = SessionLocal()
    try:
        actions = db.execute(select(AuditLog.action).where(
            AuditLog.entity_type == "AcceptanceSubmission", AuditLog.entity_id == sid)).scalars().all()
    finally:
        db.close()
    assert actions == ["SUBMITTED", expected]
