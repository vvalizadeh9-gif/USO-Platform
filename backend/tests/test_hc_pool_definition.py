"""What the Health Check pool counts, stated as the definition it is.

    The pool is every on-air site whose drive test is not Done.

That is a programme quantity — how many live sites still owe a health check —
and the figure on the screen is labelled as one. It used to be something
narrower wearing that label. Four separate conditions removed sites from it,
each defensible on its own and none of them visible in the number:

* a CPM drive-test status of ``Ongoing``,
* a check already open on the site,
* a failed check a PM had not triaged yet,
* any fix still open.

A Coordinator reading "112 in the pool" was therefore being told how many
sites they could assign that minute, not how many on-air sites still owed a
health check. Those conditions have not been deleted — they are what a site's
``hc_state`` says, and what ``assignable`` is derived from — but they no
longer decide whether a row exists.

Seeded directly rather than through a CPM import so this runs everywhere.

Run with:  cd backend && pytest tests/test_hc_pool_definition.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_hcpool_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import PM as PM_ROLE  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

#: site_type -> (last_stage, dt_status). site_type is the tag each assertion
#: names a site by; every site shares one Site row, as elsewhere in the suite.
SEED = {
    "blank": (C.STAGE_PERM_ONAIR, None),
    "ongoing": (C.STAGE_PERM_ONAIR, "Ongoing"),
    "ongoing-lowercase": (C.STAGE_PERM_ONAIR, "ongoing"),
    "problematic": (C.STAGE_TEMP_ONAIR, "Problematic"),
    "done": (C.STAGE_PERM_ONAIR, "Done"),
    "done-lowercase": (C.STAGE_PERM_ONAIR, " done "),
    "offair": ("طراحی", None),
}

#: What the pool must hold, given SEED. On-air and not Done.
IN_POOL = {"blank", "ongoing", "ongoing-lowercase", "problematic"}


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_hcpool_pytest.db"):
        os.remove("/tmp/uep_hcpool_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        if db.query(Contractor).first() is None:
            db.add(Contractor(name="Pool Telecom", type="health_check"))
        province = db.query(Province).order_by(Province.id).first()
        role = db.query(Role).filter(Role.name == PM_ROLE).one()
        db.add(User(
            username="poolpm",
            password_hash=hash_password("Owner@12345"),
            first_name=PM_ROLE, family_name="User",
            role_id=role.id, sees_all_provinces=True,
            status=user_status.ACTIVE,
        ))

        site = Site(site_code="POOL-0001", province_id=province.id)
        db.add(site)
        db.flush()
        for tag, (last_stage, dt_status) in SEED.items():
            db.add(WorkItem(
                site_id=site.id,
                site_type=tag,
                requested_technology="2G,4G",
                last_stage=last_stage,
                dt_status=dt_status,
            ))
        db.commit()
    finally:
        db.close()


def _h(client):
    r = client.post(
        "/api/v1/auth/login", data=login_form(client, "poolpm", "Owner@12345")
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _pool(client):
    return client.get("/api/v1/hc/basket", headers=_h(client)).json()


def test_the_pool_is_every_on_air_site_whose_drive_test_is_not_done(client):
    assert {b["site_type"] for b in _pool(client)} == IN_POOL


def test_an_ongoing_drive_test_no_longer_removes_a_site(client):
    """The single biggest cause of the figure reading low.

    Every site the last CPM import marked ``Ongoing`` was dropped, on the
    reading that a site already with a drive-test contractor was somebody
    else's problem. It is still an on-air site that owes a health check.
    """
    assert "ongoing" in {b["site_type"] for b in _pool(client)}


def test_the_dt_status_is_read_through_the_same_normaliser_as_everywhere_else(client):
    """``done`` and ``Done`` are one status, and so are ``ongoing`` and
    ``Ongoing``. The import canonicalises what it writes, but seeded and
    hand-edited rows do not go through it."""
    tags = {b["site_type"] for b in _pool(client)}
    assert "done-lowercase" not in tags
    assert "ongoing-lowercase" in tags


def test_every_row_says_where_it_is_and_whether_it_can_be_assigned(client):
    """The states are on the row now rather than deciding the row exists."""
    for row in _pool(client):
        assert row["hc_state"] == "New"
        assert row["assignable"] is True


def test_the_count_and_the_list_are_the_same_number(client):
    """A badge that disagrees with the list behind it is worse than none."""
    counts = client.get(
        "/api/v1/hc/queues/counts", headers=_h(client)
    ).json()

    assert counts["pool"] == len(_pool(client)) == len(IN_POOL)
    assert counts["pool_assignable"] == counts["pool"]


def test_a_site_in_an_open_check_stays_counted_but_is_not_assignable(client):
    """The one state the server refuses, so the one that blocks selection."""
    from app.models.reference import Contractor

    h = _h(client)
    pool = _pool(client)
    target = next(b for b in pool if b["site_type"] == "blank")

    db = SessionLocal()
    contractor_id = db.query(Contractor).first().id
    db.close()

    r = client.post(
        "/api/v1/hc/assignments",
        headers=h,
        json={
            "contractor_id": contractor_id,
            "work_item_ids": [target["work_item_id"]],
        },
    )
    assert r.status_code == 201, r.text

    after = _pool(client)
    row = next(b for b in after if b["work_item_id"] == target["work_item_id"])
    assert len(after) == len(pool), "the quantity does not move on assignment"
    assert row["hc_state"] == "In health check"
    assert row["assignable"] is False

    counts = client.get("/api/v1/hc/queues/counts", headers=h).json()
    assert counts["pool"] == len(IN_POOL)
    assert counts["pool_assignable"] == len(IN_POOL) - 1
