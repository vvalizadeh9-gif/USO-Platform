"""The header search: what it finds, and what it must never reveal.

Search is a second way into the same data the lists show, so it is held to the
same rule: a person finds what they could already open, and nothing else. Most
of these tests are written from that side -- a coordinator or a contractor
typing a name that belongs to someone else's province or someone else's site.

Run with:  cd backend && pytest tests/test_global_search.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_global_search_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Search-Test-Passw0rd"
SEARCH = "/api/v1/search"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_global_search_pytest.db"):
        os.remove("/tmp/uep_global_search_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _admin(client) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {r.cookies['uep_session']}"}


def _site(db, code: str, province, *, contractor=None, stage="HC In Progress", village=None):
    """A site with one work item, optionally held by a contractor and with a village."""
    from app.models.workitem import Site, Village, WorkItem

    site = Site(site_code=code, province_id=province.id, county="Shahrestan")
    db.add(site)
    db.flush()
    item = WorkItem(
        site_id=site.id,
        site_type="New",
        current_stage=stage,
        dt_sc_contractor_id=contractor.id if contractor else None,
    )
    db.add(item)
    db.flush()
    if village:
        db.add(Village(work_item_id=item.id, village_name=village, village_code=f"V-{code}"))
    return item


@pytest.fixture(scope="module")
def world(client):
    """Two provinces, two contractors, and sites to tell them apart by."""
    from app.models.reference import Contractor, Province

    admin_h = _admin(client)
    db = SessionLocal()
    try:
        north, south = Province(name="Gilan"), Province(name="Hormozgan")
        acme, rival = Contractor(name="Acme Telecom", type="drive_test", active=True), Contractor(
            name="Rival Networks", type="drive_test", active=True
        )
        db.add_all([north, south, acme, rival])
        db.flush()
        ids = {
            "north": north.id,
            "south": south.id,
            "acme": acme.id,
            "rival": rival.id,
            "north_site": _site(db, "RS1405N", north, contractor=acme, village="Deh-e Bala").id,
            "south_site": _site(db, "RS1405S", south, contractor=rival, village="Deh-e Pain").id,
            "underscore": _site(db, "XA_B", north).id,
            "lookalike": _site(db, "XAZB", north).id,
        }
        for i in range(7):
            _site(db, f"BULK{i:02d}", north)
        db.commit()
    finally:
        db.close()

    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = lambda name: next(r["id"] for r in roles if r["name"] == name)  # noqa: E731

    def make(username, role, **kwargs):
        r = client.post(
            "/api/v1/admin/users",
            headers=admin_h,
            json={
                "username": username,
                "password": PASSWORD,
                "first_name": "Test",
                "family_name": username,
                "role_id": role_id(role),
                "contractor_id": kwargs.get("contractor_id"),
                "sees_all_provinces": kwargs.get("sees_all", False),
                "province_ids": kwargs.get("province_ids", []),
            },
        )
        assert r.status_code == 201, r.text
        login = client.post("/api/v1/auth/login", data=login_form(client, username, PASSWORD))
        assert login.status_code == 200, login.text
        return {"Authorization": f"Bearer {login.cookies['uep_session']}"}

    return {
        **ids,
        "admin": admin_h,
        "north_coordinator": make("north_coord", "Coordinator", province_ids=[ids["north"]]),
        "acme_user": make("acme_user", "Contractor", contractor_id=ids["acme"]),
    }


def _find(client, headers, q):
    response = client.get(SEARCH, params={"q": q}, headers=headers)
    assert response.status_code == 200, response.text
    return {g["key"]: g for g in response.json()["groups"]}


def _titles(group):
    return [item["title"] for item in group["items"]]


# ---------------------------------------------------------------------------
# What it finds
# ---------------------------------------------------------------------------


def test_it_needs_a_signed_in_user(client):
    assert client.get(SEARCH, params={"q": "RS1405"}).status_code == 401


@pytest.mark.parametrize("q", ["", " ", "R", "  R "])
def test_a_query_under_two_characters_finds_nothing_rather_than_everything(client, world, q):
    assert _find(client, world["admin"], q) == {}


def test_a_site_is_found_by_part_of_its_code_and_opens_its_page(client, world):
    sites = _find(client, world["admin"], "rs1405")["sites"]

    assert sorted(_titles(sites)) == ["RS1405N", "RS1405S"]
    first = next(i for i in sites["items"] if i["title"] == "RS1405N")
    assert first["route"] == f"/work-items/{world['north_site']}"
    assert "Gilan" in first["subtitle"]


def test_a_site_is_found_by_its_province(client, world):
    assert "RS1405S" in _titles(_find(client, world["admin"], "hormoz")["sites"])


def test_persian_digits_find_the_same_site_as_latin_ones(client, world):
    assert "RS1405N" in _titles(_find(client, world["admin"], "RS۱۴۰۵")["sites"])


def test_a_village_is_found_by_name_and_opens_its_site(client, world):
    villages = _find(client, world["admin"], "deh-e bala")["villages"]

    assert _titles(villages) == ["Deh-e Bala"]
    assert villages["items"][0]["route"] == f"/work-items/{world['north_site']}"


def test_a_contractor_is_found_by_name_and_opens_their_sites(client, world):
    contractors = _find(client, world["admin"], "acme")["contractors"]

    assert _titles(contractors) == ["Acme Telecom"]
    route = contractors["items"][0]["route"]
    assert route.startswith(f"/work-items?contractor_id={world['acme']}")


def test_a_group_returns_its_best_few_and_the_true_total(client, world):
    sites = _find(client, world["admin"], "BULK")["sites"]

    assert len(sites["items"]) == 5
    assert sites["total"] == 7


def test_wildcards_in_the_query_are_taken_literally(client, world):
    # `_` is "any one character" to LIKE. Taken literally it finds XA_B only,
    # not its lookalike XAZB; and `%%` finds nothing, not everything.
    assert _titles(_find(client, world["admin"], "XA_B")["sites"]) == ["XA_B"]
    assert _find(client, world["admin"], "%%") == {}


# ---------------------------------------------------------------------------
# What it must never reveal
# ---------------------------------------------------------------------------


def test_a_coordinator_does_not_find_another_provinces_sites(client, world):
    found = _find(client, world["north_coordinator"], "RS1405")

    assert _titles(found["sites"]) == ["RS1405N"]
    assert found["sites"]["total"] == 1
    # Nor its villages, nor a province name that only matches theirs elsewhere.
    assert "villages" not in _find(client, world["north_coordinator"], "deh-e pain")
    assert "sites" not in _find(client, world["north_coordinator"], "hormoz")


def test_a_contractor_finds_only_their_own_sites(client, world):
    found = _find(client, world["acme_user"], "RS1405")

    assert _titles(found["sites"]) == ["RS1405N"]
    assert "villages" not in _find(client, world["acme_user"], "deh-e pain")


def test_a_contractor_is_not_offered_the_contractor_list_or_the_people_list(client, world):
    assert "contractors" not in _find(client, world["acme_user"], "rival")
    assert "people" not in _find(client, world["acme_user"], "acme_user")


def test_only_an_administrator_can_search_people(client, world):
    assert "people" not in _find(client, world["north_coordinator"], "acme_user")

    people = _find(client, world["admin"], "acme_user")["people"]
    assert _titles(people) == ["Test acme_user"]
    assert people["items"][0]["route"] == "/admin?tab=users&q=acme_user"


# ---------------------------------------------------------------------------
# The contractor filter the contractor results open
# ---------------------------------------------------------------------------


def test_the_stage_counts_follow_the_contractor_filter_like_the_list_does(client, world):
    params = {"contractor_id": world["acme"]}
    counts = client.get("/api/v1/work-items/counts", params=params, headers=world["admin"]).json()
    rows = client.get("/api/v1/work-items", params={**params, "limit": 500}, headers=world["admin"]).json()

    assert counts["All"] == len(rows) == 1
    assert [r["site_code"] for r in rows] == ["RS1405N"]
