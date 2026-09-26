"""The Acceptance dashboard's on-air figure, split by launch.

Covers: the دائم / موقت split and what falls in neither (a design-stage or
blank last stage, a space-for-underscore variant), that the split never
touches the DT-Done universe every other figure counts, and that a Regional
Manager only counts the provinces Admin granted them.

A database of its own, so the villages seeded here cannot move any figure the
older acceptance tests assert on.

Run with:  cd backend && pytest tests/test_acceptance_onair.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_acc_onair_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PERM = "راه_اندازی_دائم"
TEMP = "راه_اندازی_موقت"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_acc_onair_pytest.db"):
        os.remove("/tmp/uep_acc_onair_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def provinces(client):
    """Two provinces, one village per work item, every stage a CPM row takes.

    ProvA: 2 permanent (one drive-tested), 1 temporary, 1 written with a
           space instead of an underscore, 1 design-stage, 1 blank, and one
           permanent village that is اقماری (outside the universe).
    ProvB: 1 permanent, 1 temporary.
    """
    from app.models.reference import Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    pa = Province(name="ProvA")
    pb = Province(name="ProvB")
    db.add_all([pa, pb])
    db.flush()
    sa = Site(site_code="SA", province_id=pa.id)
    sb = Site(site_code="SB", province_id=pb.id)
    db.add_all([sa, sb])
    db.flush()

    def village(site, n, stage, *, dt=None, flag="هدف"):
        wi = WorkItem(site_id=site.id, site_type=f"T{n}", dt_status=dt,
                      last_stage=stage, requested_technology="2G",
                      current_stage="New")
        db.add(wi)
        db.flush()
        db.add(Village(work_item_id=wi.id, village_code=f"V{n}",
                       target_classification=flag))

    village(sa, 1, PERM, dt="Done")
    village(sa, 2, PERM)
    village(sa, 3, TEMP)
    village(sa, 4, "راه اندازی دائم")   # space variant: still permanent
    village(sa, 5, "طراحی")             # design stage: not on air
    village(sa, 6, None)                 # blank: not on air
    village(sa, 7, PERM, flag="اقماری")  # not هدف: outside everything
    village(sb, 8, PERM)
    village(sb, 9, TEMP)
    db.commit()
    ids = {"a": pa.id, "b": pb.id}
    db.close()
    return ids


def _admin(client) -> dict:
    response = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _overview(client, headers) -> dict:
    response = client.get("/api/v1/acceptance/overview", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["kpis"]


def test_onair_splits_into_permanent_and_temporary(client, provinces):
    kpis = _overview(client, _admin(client))

    # V1, V2, V4, V8 permanent; V3, V9 temporary. V5 (طراحی) and V6 (blank)
    # are هدف but not on air, and V7 is not هدف at all.
    assert kpis["total_onair_permanent"] == 4
    assert kpis["total_onair_temporary"] == 2
    assert kpis["total_onair_villages"] == 6
    assert (
        kpis["total_onair_permanent"] + kpis["total_onair_temporary"]
        == kpis["total_onair_villages"]
    )


def test_split_leaves_the_dt_done_universe_alone(client, provinces):
    """The new figure sits beside the acceptance universe; it does not narrow
    or widen it. Only V1 has a finished drive test."""
    kpis = _overview(client, _admin(client))
    assert kpis["total_dt_done_villages"] == 1


def test_regional_manager_counts_only_their_provinces(client, provinces):
    admin_h = _admin(client)
    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "RegionalManager")
    password = "Test-Role-Passw0rd"
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": "rm_prov_b",
            "password": password,
            "first_name": "Test", "family_name": "RM",
            "role_id": role_id,
            "sees_all_provinces": False,
            "province_ids": [provinces["b"]],
        },
    )
    assert created.status_code == 201, created.text
    login = client.post(
        "/api/v1/auth/login", data=login_form(client, "rm_prov_b", password)
    )
    assert login.status_code == 200, login.text
    rm_h = {"Authorization": f"Bearer {login.json()['access_token']}"}

    kpis = _overview(client, rm_h)
    # ProvB only: V8 permanent, V9 temporary.
    assert kpis["total_onair_villages"] == 2
    assert kpis["total_onair_permanent"] == 1
    assert kpis["total_onair_temporary"] == 1
    assert kpis["total_dt_done_villages"] == 0
