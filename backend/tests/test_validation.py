"""ICT and CRA validation (UEP-16 §8): the read side, the review, the evidence.

What is protected:

* the page's counts are the Home queue's numbers, per authority and role,
  and the Filing number is the Home rail ticket's;
* scope: a coordinator sees their provinces, the PM everything, the rest 403;
* grouping by letter and by site, with the other authority counted apart;
* ``missing_techs`` and ``has_rejection``;
* partial review by items: a missing reason is 422, a stale version is 409
  naming who decided, and a filing without evidence needs the outside tick;
* duplicate letter numbers, email parsing, the zip, and an audit row for
  every view and download.

Run with:  cd backend && pytest tests/test_validation.py -q
"""
import io
import os
import sys
import zipfile

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_validation_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

DB_PATH = "/tmp/uep_validation_pytest.db"
API = "/api/v1/acceptance"
ONAIR = "راه_اندازی_دائم"
PDF = b"%PDF-1.4\n% test letter\n"
EML = (
    b"From: ICT Office <ict@example.org>\r\n"
    b"To: Contractor <co@example.org>\r\n"
    b"Cc: PM <pm@example.org>\r\n"
    b"Date: Tue, 14 Oct 2026 10:00:00 +0330\r\n"
    b"Subject: Acceptance 1405/3290\r\n"
    b"MIME-Version: 1.0\r\n"
    b'Content-Type: multipart/mixed; boundary="B"\r\n\r\n'
    b"--B\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
    b"<html><head><script>alert(1)</script></head><body><p>Approved for "
    b'<a href="http://evil.example/">3G</a></p><img src="http://evil.example/x.png"></body></html>\r\n'
    b"--B\r\nContent-Type: application/pdf\r\n"
    b'Content-Disposition: attachment; filename="letter.pdf"\r\n'
    b"Content-Transfer-Encoding: base64\r\n\r\n"
    b"JVBERi0xLjQKJSB0ZXN0Cg==\r\n"
    b"--B--\r\n"
)


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers (the shapes of test_my_work.py)
# ---------------------------------------------------------------------------
def _login(client, username="admin", password="Admin@12345") -> str:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return r.cookies["uep_session"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_TOKENS: dict = {}


def _user(client, role, username, *, contractor_id=None, province_ids=None) -> dict:
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


def _seed(tag, *, techs="2G,4G", villages=1, contractor_id=None, province_id=None):
    """A هدف, on-air, DT-done site. Returns (contractor_id, province_id, site_id, [village ids])."""
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    if province_id is None:
        province = Province(name=f"VProv-{tag}")
        db.add(province)
        db.flush()
        province_id = province.id
    if contractor_id is None:
        contractor = Contractor(name=f"VCo-{tag}", type="drive_test")
        db.add(contractor)
        db.flush()
        contractor_id = contractor.id
    site = Site(site_code=f"VS-{tag}", province_id=province_id)
    db.add(site)
    db.flush()
    work_item = WorkItem(
        site_id=site.id, site_type="Target", requested_technology=techs,
        dt_status="Done", dt_sc_contractor_id=contractor_id, current_stage="DT Done",
        last_stage=ONAIR,
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


def _scan(client, headers, name="letter.pdf", content=PDF) -> str:
    r = client.post(f"{API}/scans", headers=headers, files={"file": (name, content)})
    assert r.status_code == 201, r.text
    return r.json()["scan_id"]


def _approve(*techs):
    return [{"tech": t, "result": "approved"} for t in techs]


def _letter(client, headers, authority, items, *, number, scans=None):
    body = {
        "authority": authority, "letter_number": number, "letter_date": "1405/07/22",
        "scan_ids": scans or [_scan(client, headers)], "items": items,
    }
    r = client.post(f"{API}/letters", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _validation(client, headers, authority, **params):
    r = client.get(f"{API}/my-work/validation", headers=headers,
                   params={"authority": authority, **params})
    assert r.status_code == 200, r.text
    return r.json()


def _group(client, headers, authority, group, key):
    r = client.get(f"{API}/my-work/validation/{group}/{key}", headers=headers,
                   params={"authority": authority})
    assert r.status_code == 200, r.text
    return r.json()


def _home_counts(client, headers) -> dict:
    r = client.get("/api/v1/me/home", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    counts = {t["queue_key"]: t for g in body["groups"] for t in g["tickets"]}
    counts.update({t["queue_key"]: t for t in body.get("rail_tickets", [])})
    return counts


def _audits(action):
    from sqlalchemy import select

    from app.models.acceptance import AuditLog

    db = SessionLocal()
    try:
        return list(db.execute(
            select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)
        ).scalars())
    finally:
        db.close()


# ---------------------------------------------------------------------------
# One shared scene: a contractor's ICT letter on two sites, CRA on one
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def scene(client):
    co, prov, site_a, a_ids = _seed("A", villages=3)
    _co, _p, site_b, b_ids = _seed("B", villages=1, contractor_id=co, province_id=prov)
    contractor = _user(client, "Contractor", "val_co", contractor_id=co)
    items = [{"village_id": i, "claims": _approve("2G", "4G")} for i in a_ids[:2]]
    # Rejected 4G on one village; 4G missing (not filed) on another.
    items.append({"village_id": a_ids[2], "claims": [
        {"tech": "2G", "result": "approved"}, {"tech": "4G", "result": "rejected", "reason": "weak"}]})
    items.append({"village_id": b_ids[0], "claims": _approve("2G", "4G")})
    ict = _letter(client, contractor, "ICT", items, number="1405/3290",
                  scans=[_scan(client, contractor), _scan(client, contractor, "mail.eml", EML)])
    # Filing names every requested technology, so a missing one only comes
    # from older rows; make one by dropping village B's 4G claim.
    from sqlalchemy import delete

    from app.models.acceptance_workflow import AcceptanceSubmissionTech
    b_sub = next(r["submission_id"] for r in ict["results"] if r["village_id"] == b_ids[0])
    db = SessionLocal()
    db.execute(delete(AcceptanceSubmissionTech).where(
        AcceptanceSubmissionTech.submission_id == b_sub, AcceptanceSubmissionTech.technology == "4G"))
    db.commit()
    db.close()
    cra = _letter(client, contractor, "CRA", [{"village_id": a_ids[0], "claims": _approve("2G", "4G")}],
                  number="CRA-77")
    return {"co": co, "prov": prov, "site_a": site_a, "site_b": site_b, "a": a_ids, "b": b_ids,
            "contractor": contractor, "ict": ict, "cra": cra}


# ---------------------------------------------------------------------------
# Counts equal Home
# ---------------------------------------------------------------------------
def test_counts_equal_the_home_queues_per_authority_and_role(client, scene):
    pm = _user(client, "PM", "val_pm")
    coordinator = _user(client, "Coordinator", "val_coord", province_ids=[scene["prov"]])
    for who in (pm, coordinator):
        home = _home_counts(client, who)
        for authority in ("ICT", "CRA"):
            page = _validation(client, who, authority)
            ticket = home.get(f"{authority.lower()}_to_validate")
            assert ticket is not None, (authority, "PM and coordinator both see the Home row")
            assert page["counts"]["waiting"] == ticket["count"]
            assert page["counts"]["late"] == ticket["late"]
            assert ticket["url"] == f"/validation/{authority.lower()}"
    ict = _validation(client, coordinator, "ICT")
    assert ict["counts"]["waiting"] >= 4 and ict["sla_days"] == 2


def test_the_filing_number_is_the_home_rail_ticket(client, scene):
    for who in (scene["contractor"], _user(client, "PM", "val_pm")):
        listing = client.get(f"{API}/my-work", headers=who, params={"limit": 0}).json()
        assert listing["filing_total"] == _home_counts(client, who)["acceptance_filing"]["count"]
        keys = [t["key"] for t in listing["tabs"]]
        assert "filled" not in keys and "all" not in keys


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------
def test_scope_coordinator_regions_pm_all_others_refused(client, scene):
    _co, other_prov, _s, (outside,) = _seed("OUT")
    outsider = _user(client, "Contractor", "val_co_out", contractor_id=_co)
    _letter(client, outsider, "ICT", [{"village_id": outside, "claims": _approve("2G", "4G")}], number="OUT-1")

    coordinator = _user(client, "Coordinator", "val_coord", province_ids=[scene["prov"]])
    pm = _user(client, "PM", "val_pm")
    mine = {g["key"] for g in _validation(client, coordinator, "ICT")["groups"]}
    every = {g["key"] for g in _validation(client, pm, "ICT")["groups"]}
    assert "OUT-1" not in mine and {"OUT-1", "1405/3290"} <= every

    for headers in (scene["contractor"], _user(client, "Viewer", "val_viewer")):
        assert client.get(f"{API}/my-work/validation", headers=headers,
                          params={"authority": "ICT"}).status_code == 403
    assert client.get(f"{API}/my-work/validation", headers=coordinator,
                      params={"authority": "ICT", "province_id": other_prov}).status_code == 403
    assert _validation(client, pm, "ICT", province_id=other_prov)["counts"]["filtered"] == 1

    # Evidence follows the filing's scope: outside it is the same 404.
    evidence = _group(client, pm, "ICT", "letter", "OUT-1")["letters"][0]["evidence"][0]["id"]
    assert client.get(f"{API}/my-work/evidence/{evidence}", headers=coordinator).status_code == 404


# ---------------------------------------------------------------------------
# Grouping, missing and rejected
# ---------------------------------------------------------------------------
def test_grouping_by_letter_and_by_site_keeps_the_authorities_apart(client, scene):
    pm = _user(client, "PM", "val_pm")
    by_letter = _validation(client, pm, "ICT", group="letter")
    letter = next(g for g in by_letter["groups"] if g["key"] == "1405/3290")
    assert letter["villages"] == 4 and letter["rejected"] == 1 and letter["letters"] == 1
    assert letter["letter_date_shamsi"] == "1405/07/22"
    assert all(g["key"] != "CRA-77" for g in by_letter["groups"])

    by_site = _validation(client, pm, "ICT", group="site")
    site_a = next(g for g in by_site["groups"] if g["key"] == str(scene["site_a"]))
    assert site_a["villages"] == 3 and site_a["other_waiting"] == 1
    assert by_site["counts"]["site"] == len(by_site["groups"]) or by_site["next_cursor"]

    detail = _group(client, pm, "ICT", "site", str(scene["site_a"]))
    assert {f["authority"] for f in detail["filings"]} == {"ICT"}
    assert {f["authority"] for f in detail["other"]["filings"]} == {"CRA"}
    assert {(letter["authority"], letter["letter_number"]) for letter in detail["letters"]} == {
        ("ICT", "1405/3290"), ("CRA", "CRA-77")}


def test_missing_techs_and_rejections_are_computed_and_listed_first(client, scene):
    pm = _user(client, "PM", "val_pm")
    filings = _group(client, pm, "ICT", "letter", "1405/3290")["filings"]
    by_village = {f["village_id"]: f for f in filings}
    rejected = by_village[scene["a"][2]]
    assert rejected["has_rejection"] and rejected["missing_techs"] == []
    partial = by_village[scene["b"][0]]
    assert partial["missing_techs"] == ["4G"] and not partial["has_rejection"]
    assert partial["requested_techs"] == ["2G", "4G"]
    assert {filings[0]["village_id"], filings[1]["village_id"]} == {scene["a"][2], scene["b"][0]}


def test_a_letter_carries_every_file_once(client, scene):
    pm = _user(client, "PM", "val_pm")
    letter = _group(client, pm, "ICT", "letter", "1405/3290")["letters"][0]
    assert sorted(e["kind"] for e in letter["evidence"]) == ["email", "pdf"]
    assert letter["villages"] == 4 and letter["without_evidence"] == 0


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------
def test_partial_review_reasons_and_concurrency(client):
    co, prov, _s, ids = _seed("REV", villages=3)
    contractor = _user(client, "Contractor", "val_co_rev", contractor_id=co)
    _letter(client, contractor, "CRA",
            [{"village_id": i, "claims": _approve("2G", "4G")} for i in ids], number="REV-1")
    pm = _user(client, "PM", "val_pm")
    coordinator = _user(client, "Coordinator", "val_coord_rev", province_ids=[prov])
    filings = {f["village_id"]: f for f in _group(client, pm, "CRA", "letter", "REV-1")["filings"]}
    item = lambda vid, **kw: {"submission_id": filings[vid]["submission_id"],  # noqa: E731
                              "version": filings[vid]["version"], **kw}

    # Return needs a reason on every item.
    r = client.post(f"{API}/letters/review", headers=pm, json={
        "authority": "CRA", "decision": "return", "items": [item(ids[0]), item(ids[1], reason="own")]})
    assert r.status_code == 422, r.text
    assert [e["submission_id"] for e in r.json()["detail"]["errors"]] == [filings[ids[0]]["submission_id"]]

    # Confirm one, return another with its own reason (shared covers none).
    r = client.post(f"{API}/letters/review", headers=coordinator, json={
        "authority": "CRA", "decision": "confirm", "items": [item(ids[0])]})
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/letters/review", headers=pm, json={
        "authority": "CRA", "decision": "return", "shared_reason": "illegible",
        "items": [item(ids[1], reason="wrong village")]})
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/v1/acceptance/villages/{ids[1]}", headers=contractor).json()
    assert detail["sides"]["CRA"]["status"] == "returned"
    assert detail["sides"]["CRA"]["last_reason"]["reason"] == "wrong village"

    # A stale version is a 409 naming who decided; nothing else is decided.
    r = client.post(f"{API}/letters/review", headers=pm, json={
        "authority": "CRA", "decision": "confirm", "items": [item(ids[0]), item(ids[2])]})
    assert r.status_code == 409, r.text
    (stale,) = r.json()["detail"]["errors"]
    assert stale["code"] == "stale" and stale["submission_id"] == filings[ids[0]]["submission_id"]
    assert stale["decided_by"] and stale["decided_at"]
    remaining = _group(client, pm, "CRA", "letter", "REV-1")["filings"]
    assert [f["village_id"] for f in remaining] == [ids[2]]

    returned = _audits("RETURNED")[-1].new_value
    assert returned["reasons"] == {str(filings[ids[1]]["submission_id"]): "wrong village"} or \
        returned["reasons"] == {filings[ids[1]]["submission_id"]: "wrong village"}


def test_no_evidence_needs_the_outside_tick(client):
    from sqlalchemy import delete

    from app.models.acceptance_workflow import AcceptanceEvidence

    co, _prov, _s, (vid,) = _seed("NOEV")
    contractor = _user(client, "Contractor", "val_co_noev", contractor_id=co)
    sid = _letter(client, contractor, "ICT", [{"village_id": vid, "claims": _approve("2G", "4G")}],
                  number="NOEV-1")["results"][0]["submission_id"]
    db = SessionLocal()
    db.execute(delete(AcceptanceEvidence).where(AcceptanceEvidence.submission_id == sid))
    db.commit()
    db.close()
    pm = _user(client, "PM", "val_pm")
    letter = _group(client, pm, "ICT", "letter", "NOEV-1")["letters"][0]
    assert letter["evidence"] == [] and letter["without_evidence"] == 1

    body = {"authority": "ICT", "decision": "confirm", "items": [{"submission_id": sid, "version": 0}]}
    r = client.post(f"{API}/letters/review", headers=pm, json=body)
    assert r.status_code == 422 and r.json()["detail"]["errors"][0]["code"] == "evidence_unchecked"
    r = client.post(f"{API}/letters/review", headers=pm, json={**body, "evidence_checked_outside": True})
    assert r.status_code == 200, r.text
    assert _audits("REVIEWED")[-1].new_value["evidence_checked_outside"] is True


def test_duplicate_letter_number_is_flagged(client):
    co1, prov, _s, (v1,) = _seed("DUP1")
    co2, _p, _s, (v2,) = _seed("DUP2", province_id=prov)
    one = _user(client, "Contractor", "val_co_dup1", contractor_id=co1)
    two = _user(client, "Contractor", "val_co_dup2", contractor_id=co2)
    _letter(client, one, "ICT", [{"village_id": v1, "claims": _approve("2G", "4G")}], number="DUP-9")
    _letter(client, two, "ICT", [{"village_id": v2, "claims": _approve("2G", "4G")}], number="DUP-9")
    pm = _user(client, "PM", "val_pm")
    detail = _group(client, pm, "ICT", "site", str(_s))
    assert detail["letters"][0]["duplicate_use"] == {"villages": 1, "contractors": 1}


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------
def test_email_is_parsed_to_plain_text_with_its_attachments(client, scene):
    pm = _user(client, "PM", "val_pm")
    files = _group(client, pm, "ICT", "letter", "1405/3290")["letters"][0]["evidence"]
    mail = next(e for e in files if e["kind"] == "email")
    r = client.get(f"{API}/my-work/evidence/{mail['id']}/email", headers=pm)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subject"] == "Acceptance 1405/3290" and body["cc"].startswith("PM")
    assert "Approved for" in body["text_body"] and "3G" in body["text_body"]
    for unsafe in ("<", "script", "alert", "evil.example"):
        assert unsafe not in body["text_body"]
    (attachment,) = body["attachments"]
    assert attachment["filename"] == "letter.pdf" and attachment["kind"] == "pdf"
    r = client.get(f"{API}/my-work/evidence/{mail['id']}/email/attachments/0", headers=pm)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_eml_and_msg_uploads_are_checked_by_their_bytes(client, scene):
    contractor = scene["contractor"]
    assert client.post(f"{API}/scans", headers=contractor,
                       files={"file": ("x.eml", b"<html><script></script></html>")}).status_code == 400
    assert client.post(f"{API}/scans", headers=contractor,
                       files={"file": ("x.msg", b"not an ole file at all")}).status_code == 400
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600
    assert client.post(f"{API}/scans", headers=contractor,
                       files={"file": ("x.msg", ole)}).status_code == 201


def test_html_only_email_is_converted_to_text():
    from app.services import email_evidence

    parsed = email_evidence.parse_eml(
        b"From: a@b\r\nSubject: s\r\nContent-Type: text/html\r\n\r\n"
        b"<div>One<br>Two</div><style>p{}</style><script>x()</script>"
    )
    assert parsed.text_body == "One\n\nTwo" or parsed.text_body.split() == ["One", "Two"]


def test_msg_is_parsed_when_extract_msg_is_installed():
    pytest.importorskip("extract_msg")
    from app.services import email_evidence

    with pytest.raises(email_evidence.EmailError):
        email_evidence.parse_msg(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600)


def test_view_download_and_zip_are_audited(client, scene):
    pm = _user(client, "PM", "val_pm")
    files = _group(client, pm, "ICT", "letter", "1405/3290")["letters"][0]["evidence"]
    pdf = next(e for e in files if e["kind"] == "pdf")
    viewed, downloaded = len(_audits("EVIDENCE_VIEWED")), len(_audits("EVIDENCE_DOWNLOADED"))

    r = client.get(f"{API}/my-work/evidence/{pdf['id']}", headers=pm)
    assert r.status_code == 200 and r.headers["content-disposition"].startswith("inline")
    r = client.get(f"{API}/my-work/evidence/{pdf['id']}/download", headers=pm)
    assert r.headers["content-disposition"].startswith("attachment")
    r = client.get(f"{API}/my-work/letters/evidence.zip", headers=pm,
                   params={"authority": "ICT", "letter_number": "1405/3290"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert "ICT-1405-3290.zip" in r.headers["content-disposition"]
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert sorted(names) == ["letter.pdf", "mail.eml"]

    assert len(_audits("EVIDENCE_VIEWED")) == viewed + 1
    assert len(_audits("EVIDENCE_DOWNLOADED")) == downloaded + 2
