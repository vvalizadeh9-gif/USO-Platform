"""Admin > Province assignments (UEP-17): one coordinator per CRA region.

Covers the overview, an Update writing all three coordinator stores at once,
409 on a stale expected owner, the 422s, Revert, the four screens following
the new owner straight after an Update, the retired per-province endpoints,
role checks and, last (it downgrades the schema), the migration's consistency
check.

Run with:  cd backend && pytest tests/test_province_assignments.py -q
"""
import os
import sys

import pytest

DB_PATH = "/tmp/uep_province_assignments_pytest.db"
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON, select, text  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

API = "/api/v1/admin/province-assignments"
ACCEPTANCE = "/api/v1/acceptance"
ONAIR = "راه_اندازی_دائم"
PDF = b"%PDF-1.4\n% test letter\n"
ISFAHAN = "اصفهان"

#: The fixed region -> provinces link (UEP-17 §4).
REGIONS = {
    "Azar": 3, "Central": 5, "North": 4, "North East": 4, "North West": 3,
    "South": 3, "South East": 3, "South West": 3, "West": 3,
}
#: The seed's coordinators, in the order their accounts are created.
COORDINATORS = ("Hossein", "Amir", "Zohreh", "Farid")


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
def _login(client, username="admin", password="Admin@12345") -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


_USERS: dict = {}


def _user(client, role, username, *, first="Test", family=None, contractor_id=None,
          province_ids=None) -> tuple[int, dict]:
    """Create (once) and sign in a user. Returns ``(user_id, headers)``."""
    if username not in _USERS:
        admin = _login(client)
        roles = client.get("/api/v1/reference/roles", headers=admin).json()
        created = client.post("/api/v1/admin/users", headers=admin, json={
            "username": username, "password": "Test-Fixture-Passphrase",
            "first_name": first, "family_name": family or role,
            "role_id": next(r["id"] for r in roles if r["name"] == role),
            "contractor_id": contractor_id,
            "sees_all_provinces": province_ids is None,
            "province_ids": province_ids or [],
        })
        assert created.status_code == 201, created.text
        _USERS[username] = created.json()["id"]
    return _USERS[username], _login(client, username, "Test-Fixture-Passphrase")


def _province_ids(*names) -> list[int]:
    from app.models.reference import Province

    db = SessionLocal()
    try:
        return [db.execute(select(Province.id).where(Province.name == n)).scalar_one() for n in names]
    finally:
        db.close()


def _region_provinces(region) -> list[str]:
    db = SessionLocal()
    try:
        return list(db.execute(text(
            "SELECT province_fa FROM province_mapping "
            "WHERE effective_to IS NULL AND cra_region = :r"), {"r": region}).scalars())
    finally:
        db.close()


def _grants(user_id) -> set[int]:
    db = SessionLocal()
    try:
        return set(db.execute(text(
            "SELECT province_id FROM user_province_access WHERE user_id = :u"), {"u": user_id}).scalars())
    finally:
        db.close()


def _stores(region) -> tuple[set, set]:
    """The region's coordinator in both stores: ({user ids}, {mapping names})."""
    db = SessionLocal()
    try:
        ids = set(db.execute(text(
            "SELECT p.coordinator_user_id FROM provinces p JOIN province_mapping m "
            "ON m.province_fa = p.name AND m.effective_to IS NULL WHERE m.cra_region = :r"),
            {"r": region}).scalars())
        names = set(db.execute(text(
            "SELECT pso_coordinator FROM province_mapping "
            "WHERE effective_to IS NULL AND cra_region = :r"), {"r": region}).scalars())
        return ids, names
    finally:
        db.close()


def _owners_and_regions() -> list[tuple]:
    """Everything UEP-17 must not touch: province, region and regional manager."""
    db = SessionLocal()
    try:
        return sorted(db.execute(text(
            "SELECT m.province_fa, m.cra_region, m.regional_manager, p.regional_manager_user_id "
            "FROM province_mapping m JOIN provinces p ON p.name = m.province_fa "
            "WHERE m.effective_to IS NULL")).all())
    finally:
        db.close()


def _overview(client, headers) -> dict:
    r = client.get(API, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _owner(overview, region) -> int | None:
    return next(r["coordinator_user_id"] for r in overview["regions"] if r["name"] == region)


def _put(client, headers, *changes):
    return client.put(API, headers=headers, json={"changes": [
        {"cra_region": region, "coordinator_user_id": new, "expected_coordinator_user_id": expected}
        for region, new, expected in changes
    ]})


@pytest.fixture(scope="module")
def people(client):
    """The four seed coordinators, each linked to their mapping name and granted
    their own regions' provinces, as Users & roles leaves them today; a PM."""
    _pm_id, pm = _user(client, "PM", "pa_pm", first="Vahid")
    ids = {}
    for name in COORDINATORS:
        owned = [fa for region in REGIONS for fa in _region_provinces(region)
                 if _coordinator_in_seed(fa) == name]
        uid, _ = _user(client, "Coordinator", f"pa_{name.lower()}", first=name,
                       family="Coordinator", province_ids=_province_ids(*owned))
        linked = client.put(f"/api/v1/kpi/mapping/links/{uid}", headers=pm,
                            json={"kpi_person_name": name})
        assert linked.status_code == 200, linked.text
        ids[name] = uid
    return {"pm": pm, **ids}


def _coordinator_in_seed(province_fa) -> str:
    from app.core.province_directory import PROVINCE_DIRECTORY

    return next(r.pso_coordinator for r in PROVINCE_DIRECTORY if r.fa == province_fa)


def _header(client, user_id) -> dict:
    username = next(k for k, v in _USERS.items() if v == user_id)
    return _login(client, username, "Test-Fixture-Passphrase")


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------
def test_overview_lists_nine_regions_and_one_column_per_coordinator(client, people):
    body = _overview(client, people["pm"])
    assert {r["name"]: len(r["provinces"]) for r in body["regions"]} == REGIONS
    assert body["total_provinces"] == 31
    central = next(r for r in body["regions"] if r["name"] == "Central")
    assert {p["en"] for p in central["provinces"]} == {
        "Chaharmahal & Bakhtiari", "Isfahan", "Markazi", "Qom", "Yazd"}

    columns = {c["name"]: c for c in body["coordinators"]}
    assert list(columns) == list(COORDINATORS), "columns follow account creation order"
    assert [c["colour_index"] for c in body["coordinators"]] == [0, 1, 2, 3]
    assert (columns["Hossein"]["regions"], columns["Hossein"]["provinces"]) == (3, 11)
    assert _owner(body, "Central") == people["Hossein"]
    assert columns["Hossein"]["initials"] == "HC"


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------
def test_update_writes_every_store_for_every_province_of_the_region(client, people):
    untouched = _owners_and_regions()
    central = set(_province_ids(*_region_provinces("Central")))
    r = _put(client, people["pm"], ("Central", people["Zohreh"], people["Hossein"]))
    assert r.status_code == 200, r.text
    assert r.json()["change_id"]
    assert _owner(r.json(), "Central") == people["Zohreh"]

    assert _stores("Central") == ({people["Zohreh"]}, {"Zohreh"})
    assert central <= _grants(people["Zohreh"])
    assert not central & _grants(people["Hossein"])
    assert _owners_and_regions() == untouched, "regional managers and regions must not move"

    from app.models.acceptance import AuditLog

    db = SessionLocal()
    try:
        audit = db.execute(select(AuditLog).where(
            AuditLog.entity_type == "CraRegionCoordinator").order_by(AuditLog.id.desc())).scalars().first()
        assert audit.module == "Admin"
        assert audit.new_value["coordinators"] == {"Central": people["Zohreh"]}
    finally:
        db.close()

    # Put it back for the tests that follow.
    assert _put(client, people["pm"], ("Central", people["Hossein"], people["Zohreh"])).status_code == 200


def test_update_is_atomic(client, people):
    r = _put(client, people["pm"],
             ("Central", people["Zohreh"], people["Hossein"]),
             ("Atlantis", people["Zohreh"], None))
    assert r.status_code == 422
    assert _stores("Central") == ({people["Hossein"]}, {"Hossein"})


def test_a_stale_expected_owner_is_409_and_changes_nothing(client, people):
    west = _stores("West")
    r = _put(client, people["pm"],
             ("West", people["Amir"], people["Hossein"]),
             ("North", people["Farid"], people["Zohreh"]))  # North is Amir's
    assert r.status_code == 409
    assert r.json()["detail"]["stale"] == {"North": people["Amir"]}
    assert _stores("West") == west


@pytest.mark.parametrize("case", ["not_coordinator", "unknown_region", "unlinked", "repeated"])
def test_invalid_changes_are_422(client, people, case):
    pm_id = _USERS["pa_pm"]
    if case == "not_coordinator":
        r = _put(client, people["pm"], ("West", pm_id, people["Hossein"]))
        assert "not an active Coordinator" in r.json()["detail"]
    elif case == "unknown_region":
        r = _put(client, people["pm"], ("Atlantis", people["Amir"], None))
        assert "Unknown CRA region" in r.json()["detail"]
    elif case == "unlinked":
        uid, _ = _user(client, "Coordinator", "pa_unlinked", first="Sara", province_ids=[])
        r = _put(client, people["pm"], ("West", uid, people["Hossein"]))
        assert "Link it on the KPI mapping page first" in r.json()["detail"]
        columns = {c["user_id"]: c for c in _overview(client, people["pm"])["coordinators"]}
        assert columns[uid]["linked"] is False
    else:
        r = _put(client, people["pm"],
                 ("West", people["Amir"], people["Hossein"]),
                 ("West", people["Farid"], people["Hossein"]))
    assert r.status_code == 422, r.text


def test_a_new_coordinator_can_be_linked_before_owning_a_region(client, people):
    uid, _ = _user(client, "Coordinator", "pa_new", first="Neda", province_ids=[])
    r = client.put(f"/api/v1/kpi/mapping/links/{uid}", headers=people["pm"],
                   json={"kpi_person_name": "Neda"})
    assert r.status_code == 200, r.text
    r = _put(client, people["pm"], ("South", uid, people["Zohreh"]))
    assert r.status_code == 200, r.text
    assert _stores("South") == ({uid}, {"Neda"})
    assert _put(client, people["pm"], ("South", people["Zohreh"], uid)).status_code == 200


# ---------------------------------------------------------------------------
# Revert and history
# ---------------------------------------------------------------------------
def test_revert_restores_the_previous_owners_as_a_new_change(client, people):
    r = _put(client, people["pm"],
             ("Azar", people["Farid"], people["Hossein"]),
             ("West", people["Amir"], people["Hossein"]))
    change_id = r.json()["change_id"]

    reverted = client.post(f"{API}/revert/{change_id}", headers=people["pm"])
    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["change_id"] != change_id
    assert _stores("Azar") == ({people["Hossein"]}, {"Hossein"})
    assert _stores("West") == ({people["Hossein"]}, {"Hossein"})

    history = client.get(f"{API}/history", headers=people["pm"]).json()
    assert history[0]["change_id"] == reverted.json()["change_id"]
    assert history[0]["by"] == "Vahid"
    assert {(c["cra_region"], c["provinces"], c["old"], c["new"]) for c in history[0]["changes"]} == {
        ("Azar", 3, "Farid", "Hossein"), ("West", 3, "Amir", "Hossein")}
    assert history[1]["change_id"] == change_id
    assert reverted.json()["last_change"]["by"] == "Vahid"

    assert client.post(f"{API}/revert/00000000-0000-0000-0000-000000000000",
                       headers=people["pm"]).status_code == 404


# ---------------------------------------------------------------------------
# Every screen follows the new owner, with no restart
# ---------------------------------------------------------------------------
def _filed_central_village(client) -> str:
    """A contractor's ICT letter on a village in Isfahan (Central)."""
    from app.models.reference import Contractor
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    contractor = Contractor(name="PA-Contractor", type="drive_test")
    db.add(contractor)
    db.flush()
    site = Site(site_code="PA-ISF-1", province_id=_province_ids(ISFAHAN)[0])
    db.add(site)
    db.flush()
    work_item = WorkItem(
        site_id=site.id, site_type="Target", requested_technology="2G,4G",
        dt_status="Done", dt_sc_contractor_id=contractor.id, current_stage="DT Done",
        last_stage=ONAIR,
    )
    db.add(work_item)
    db.flush()
    village = Village(work_item_id=work_item.id, village_code="PA-V1", village_name="روستا",
                      target_classification="هدف")
    db.add(village)
    db.commit()
    village_id, contractor_id = village.id, contractor.id
    db.close()

    _cid, headers = _user(client, "Contractor", "pa_contractor", contractor_id=contractor_id)
    scan = client.post(f"{ACCEPTANCE}/scans", headers=headers, files={"file": ("l.pdf", PDF)})
    assert scan.status_code == 201, scan.text
    letter = client.post(f"{ACCEPTANCE}/letters", headers=headers, json={
        "authority": "ICT", "letter_number": "PA-1", "letter_date": "1405/07/22",
        "scan_ids": [scan.json()["scan_id"]],
        "items": [{"village_id": village_id, "claims": [
            {"tech": "2G", "result": "approved"}, {"tech": "4G", "result": "approved"}]}],
    })
    assert letter.status_code == 201, letter.text
    return "PA-1"


def _sees(client, user_id, letter) -> dict:
    headers = _header(client, user_id)
    validation = client.get(f"{ACCEPTANCE}/my-work/validation", headers=headers,
                            params={"authority": "ICT"})
    assert validation.status_code == 200, validation.text
    home = client.get("/api/v1/me/home", headers=headers).json()
    tickets = {t["queue_key"]: t["count"] for g in home["groups"] for t in g["tickets"]}
    tickets.update({t["queue_key"]: t["count"] for t in home.get("rail_tickets", [])})

    from app.models.reference import User
    from app.services import gaps, kpi

    db = SessionLocal()
    try:
        scope = kpi.resolve_scope(db, db.get(User, user_id), None, None)
        mapping = gaps._mapping(db)
    finally:
        db.close()
    return {
        "validation": letter in {g["key"] for g in validation.json()["groups"]},
        "home": tickets.get("ict_to_validate", 0) > 0,
        "kpi": ISFAHAN in scope.province_names_fa,
        "gaps": mapping[ISFAHAN][kpi.LENS_COORDINATOR],
    }


def test_home_validation_gaps_and_kpi_follow_the_new_owner(client, people):
    letter = _filed_central_village(client)
    hossein, zohreh = people["Hossein"], people["Zohreh"]

    before = _sees(client, hossein, letter)
    assert before["validation"] and before["home"] and before["kpi"]
    assert before["gaps"] == "Hossein"
    assert not _sees(client, zohreh, letter)["validation"]

    assert _put(client, people["pm"], ("Central", zohreh, hossein)).status_code == 200

    now_z, now_h = _sees(client, zohreh, letter), _sees(client, hossein, letter)
    assert now_z["validation"] and now_z["home"] and now_z["kpi"]
    assert now_z["gaps"] == "Zohreh"
    assert not (now_h["validation"] or now_h["home"] or now_h["kpi"])

    assert _put(client, people["pm"], ("Central", hossein, zohreh)).status_code == 200


# ---------------------------------------------------------------------------
# No coordinator per province, anywhere
# ---------------------------------------------------------------------------
def test_the_old_per_province_endpoint_refuses_a_coordinator(client, people):
    admin = _login(client)
    isfahan = _province_ids(ISFAHAN)[0]
    rm_id, _ = _user(client, "RegionalManager", "pa_rm", province_ids=[isfahan])
    refused = client.put(f"/api/v1/admin/provinces/{isfahan}/assignment", headers=admin,
                         json={"coordinator_user_id": people["Zohreh"], "regional_manager_user_id": None})
    assert refused.status_code == 422
    assert refused.json()["detail"] == "Coordinators are assigned per CRA region in Province assignments"

    kept = client.put(f"/api/v1/admin/provinces/{isfahan}/assignment", headers=admin,
                      json={"coordinator_user_id": people["Hossein"], "regional_manager_user_id": rm_id})
    assert kept.status_code == 200, kept.text
    assert kept.json()["regional_manager_user_id"] == rm_id
    assert kept.json()["coordinator_user_id"] == people["Hossein"]


def test_the_kpi_mapping_endpoints_refuse_a_different_coordinator(client, people):
    from app.models.kpi import ProvinceMapping

    db = SessionLocal()
    row = db.execute(select(ProvinceMapping).where(
        ProvinceMapping.province_fa == ISFAHAN, ProvinceMapping.effective_to.is_(None))).scalar_one()
    row_id, manager = row.id, row.regional_manager
    db.close()

    body = {"cra_region": "Central", "pso_coordinator": "Zohreh", "regional_manager": manager}
    for method, url in (("put", f"/api/v1/kpi/mapping/{row_id}"),
                        ("post", f"/api/v1/kpi/mapping/{row_id}/reassign")):
        r = getattr(client, method)(url, headers=people["pm"], json=body)
        assert r.status_code == 422, r.text
        assert r.json()["detail"] == "Coordinators are assigned per CRA region in Province assignments"

    same = client.put(f"/api/v1/kpi/mapping/{row_id}", headers=people["pm"],
                      json={**body, "pso_coordinator": "hossein", "regional_manager": "Someone Else"})
    assert same.status_code == 200, same.text
    assert same.json()["regional_manager"] == "Someone Else"
    assert same.json()["pso_coordinator"] == "Hossein", "the region's spelling is kept"
    client.put(f"/api/v1/kpi/mapping/{row_id}", headers=people["pm"],
               json={**body, "pso_coordinator": "Hossein"})


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
def test_pm_and_admin_write_viewer_reads_others_are_refused(client, people):
    admin = _login(client)
    _vid, viewer = _user(client, "Viewer", "pa_viewer")
    _rid, rm = _user(client, "RegionalManager", "pa_rm")
    _cid, contractor = _user(client, "Contractor", "pa_contractor")
    coordinator = _header(client, people["Amir"])

    assert _put(client, admin, ("North", people["Farid"], people["Amir"])).status_code == 200
    assert _put(client, people["pm"], ("North", people["Amir"], people["Farid"])).status_code == 200

    assert client.get(API, headers=viewer).status_code == 200
    assert client.get(f"{API}/history", headers=viewer).status_code == 200
    assert _put(client, viewer, ("North", people["Farid"], people["Amir"])).status_code == 403
    for headers in (coordinator, rm, contractor):
        assert client.get(API, headers=headers).status_code == 403
        assert client.get(f"{API}/history", headers=headers).status_code == 403


# ---------------------------------------------------------------------------
# Migration (last: it downgrades the schema)
# ---------------------------------------------------------------------------
def test_migration_makes_a_split_region_consistent_and_reports_it(client, people, capsys):
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic.ini"))
    command.downgrade(cfg, "a3c9e6f1d274-1")

    # Split North: the mapping names Amir for three provinces and Farid for
    # one, provinces.coordinator_user_id names Farid for two. Amir holds 3+2=5
    # votes, Farid 1+2=3, so Amir wins. South East is a 1-1 tie per province
    # (mapping Farid, provinces Zohreh): province_mapping wins.
    north = _region_provinces("North")
    south_east = _region_provinces("South East")
    db = SessionLocal()
    db.execute(text("UPDATE province_mapping SET pso_coordinator = 'Farid' "
                    "WHERE province_fa = :p AND effective_to IS NULL"), {"p": north[0]})
    for fa in north[:2]:
        db.execute(text("UPDATE provinces SET coordinator_user_id = :u WHERE name = :p"),
                   {"u": people["Farid"], "p": fa})
    for fa in south_east:
        db.execute(text("UPDATE provinces SET coordinator_user_id = :u WHERE name = :p"),
                   {"u": people["Zohreh"], "p": fa})
    db.commit()
    db.close()
    capsys.readouterr()

    command.upgrade(cfg, "head")
    out = capsys.readouterr().out

    assert _stores("North") == ({people["Amir"]}, {"Amir"})
    assert _stores("South East") == ({people["Farid"]}, {"Farid"})
    assert "UEP-17 province assignments: consistency check" in out
    assert "North / " in out and "'Farid' -> 'Amir'" in out
    assert "South East / " in out and f"{people['Zohreh']} -> {people['Farid']}" in out

    db = SessionLocal()
    try:
        system = db.execute(text(
            "SELECT cra_region, new_coordinator_user_id FROM province_assignment_history "
            "WHERE changed_by IS NULL")).all()
    finally:
        db.close()
    assert dict(system)["North"] == people["Amir"]
    assert len(system) == 9
    assert _overview(client, people["pm"])["last_change"]["by"] == "System"
