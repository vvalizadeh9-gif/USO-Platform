"""The header's global search: what it finds, and what it must not.

Run with:  cd backend && pytest tests/test_search.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_search_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema  # noqa: E402

SEARCH = "/api/v1/search"


@pytest.fixture(scope="module")
def world():
    if os.path.exists("/tmp/uep_search_pytest.db"):
        os.remove("/tmp/uep_search_pytest.db")
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    from app.core import user_status
    from app.core.database import SessionLocal
    from app.core.deps import ADMIN, CONTRACTOR, COORDINATOR
    from app.core.security import create_access_token
    from app.main import app
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, Village, WorkItem
    from app.services.cpm_columns import CANONICAL_PROVINCE_BY_NORM, normalize_persian

    db = SessionLocal()
    provinces = [
        p for p in db.query(Province).order_by(Province.id).all()
        if normalize_persian(p.name) in CANONICAL_PROVINCE_BY_NORM
    ]
    home, away = provinces[0], provinces[1]
    roles = {r.name: r for r in db.query(Role).all()}
    company = Contractor(name="Searchable Towers Co", type="drive_test")
    db.add(company)
    db.flush()

    def site(code, province, village, contractor_id=None):
        s = Site(site_code=code, province_id=province.id)
        db.add(s)
        db.flush()
        wi = WorkItem(site_id=s.id, site_type="Greenfield", dt_sc_contractor_id=contractor_id)
        db.add(wi)
        db.flush()
        db.add(Village(work_item_id=wi.id, village_name=village, village_code=f"V-{code}"))
        return wi

    site("SRCH-HOME-1", home, "Alpha village")
    site("SRCH-AWAY-1", away, "Alpha hamlet", contractor_id=company.id)

    def user(username, role, **kw):
        u = User(
            username=username, password_hash="x", first_name=username, family_name="Finder",
            role_id=roles[role].id, status=user_status.ACTIVE, **kw,
        )
        db.add(u)
        db.flush()
        return u

    coord = user("s_coord", COORDINATOR, sees_all_provinces=False)
    coord.provinces = [home]
    sc = user("s_sc", CONTRACTOR, sees_all_provinces=False, contractor_id=company.id)
    admin = db.query(User).filter(User.role_id == roles[ADMIN].id).first()
    db.commit()

    def headers(u):
        return {"Authorization": f"Bearer {create_access_token(u.id, {'ver': u.token_version})}"}

    out = {
        "client": TestClient(app),
        "coord": headers(coord),
        "sc": headers(sc),
        "admin": headers(admin),
        "home": home.name,
        "away": away.name,
    }
    db.close()
    return out


def _search(world, who, q):
    response = world["client"].get(SEARCH, params={"q": q}, headers=world[who])
    assert response.status_code == 200, response.text
    return response.json()


def test_finds_sites_and_villages_inside_the_callers_scope(world):
    body = _search(world, "coord", "srch")

    assert [s["site_code"] for s in body["sites"]] == ["SRCH-HOME-1"]

    villages = _search(world, "coord", "alpha")["villages"]
    assert [v["village_name"] for v in villages] == ["Alpha village"]
    assert villages[0]["site_code"] == "SRCH-HOME-1"


def test_a_contractor_finds_only_its_own_sites(world):
    body = _search(world, "sc", "srch")

    assert [s["site_code"] for s in body["sites"]] == ["SRCH-AWAY-1"]
    assert body["provinces"] == []
    assert body["people"] == []


def test_provinces_are_limited_to_the_grant(world):
    assert [p["name"] for p in _search(world, "coord", world["home"])["provinces"]] == [world["home"]]
    assert _search(world, "coord", world["away"])["provinces"] == []


def test_contractors_are_found_by_staff(world):
    assert [c["name"] for c in _search(world, "coord", "searchable")["contractors"]] == ["Searchable Towers Co"]


def test_only_the_admin_searches_people(world):
    assert [p["username"] for p in _search(world, "admin", "s_coord")["people"]] == ["s_coord"]
    assert _search(world, "coord", "s_coord")["people"] == []


def test_wildcards_are_matched_literally(world):
    body = _search(world, "admin", "%%")

    assert body["sites"] == [] and body["villages"] == []


def test_a_one_character_query_is_refused(world):
    response = world["client"].get(SEARCH, params={"q": "a"}, headers=world["coord"])

    assert response.status_code == 422


def test_search_needs_a_session(world):
    assert world["client"].get(SEARCH, params={"q": "srch"}).status_code == 401
