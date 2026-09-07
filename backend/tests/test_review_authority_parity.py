"""PM and Coordinator are peers over the health-check / drive-test lifecycle.

They were not. Drive-test assignment was PM-only; drive-test review was
Coordinator-only, so a PM could not approve a drive test at all; re-route
decisions excluded the Coordinator while trusting them to choose the category
in the first place. Each of those was spelled out at its own call site, and
each was spelled differently.

These tests assert the pairs behave the same, which is the property that
matters -- not that any particular endpoint has any particular guard.
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_parity_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.deps import (  # noqa: E402
    ADMIN,
    CONTRACTOR,
    COORDINATOR,
    PM as PM_ROLE,
)
from app.core.security import hash_password  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

PEERS = (PM_ROLE, COORDINATOR)


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_parity_pytest.db"):
        os.remove("/tmp/uep_parity_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from app.models.reference import Contractor, Role, User

    db = SessionLocal()
    try:
        if db.query(Contractor).first() is None:
            db.add(Contractor(name="Ariana Telecom", type="drive_test"))
        for role_name in (PM_ROLE, COORDINATOR, ADMIN, CONTRACTOR):
            role = db.query(Role).filter(Role.name == role_name).one()
            username = f"parity_{role_name.lower()}"
            if db.query(User).filter(User.username == username).first() is None:
                db.add(User(
                    username=username,
                    password_hash=hash_password("Owner@12345"),
                    first_name=role_name, family_name="Peer",
                    role_id=role.id, sees_all_provinces=True,
                    status=user_status.ACTIVE,
                ))
        db.commit()
    finally:
        db.close()


def _headers(client, role_name):
    r = client.post(
        "/api/v1/auth/login",
        data=login_form(client, f"parity_{role_name.lower()}", "Owner@12345"),
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# Each entry is an endpoint both peers must reach. The ids are deliberately
# absent from the database: a 404 proves the role gate let the request through
# to the business logic, while a 403 would mean it never got there. That keeps
# these tests about authority and nothing else.
LIFECYCLE_WRITES = [
    ("post", "/api/v1/work-items/assign",
     {"work_item_ids": [999999], "contractor_id": 1,
      "assignment_type": "official"}),
    ("post", "/api/v1/work-items/999999/assignment",
     {"assignment_type": "official", "contractor_id": 1}),
    ("post", "/api/v1/drive-tests/999999/coordinator-review",
     {"decision": "Approved"}),
    ("post", "/api/v1/hc/fixes/999999/reroute/decide", {"approve": True}),
    ("post", "/api/v1/hc/assignments",
     {"contractor_id": 1, "work_item_ids": [999999]}),
    ("post", "/api/v1/hc/tasks/999999/review", {"problem_categories": []}),
]


@pytest.mark.parametrize("method,url,payload", LIFECYCLE_WRITES)
def test_both_peers_reach_every_lifecycle_write(client, method, url, payload):
    seen = {}
    for role_name in PEERS:
        r = getattr(client, method)(
            url, headers=_headers(client, role_name), json=payload
        )
        assert r.status_code != 403, (
            f"{role_name} was refused {url}; PM and Coordinator are peers"
        )
        seen[role_name] = r.status_code
    assert len(set(seen.values())) == 1, (
        f"{url} answered the two peers differently: {seen}"
    )


@pytest.mark.parametrize("method,url,payload", LIFECYCLE_WRITES)
def test_admin_still_cannot_perform_lifecycle_writes(client, method, url, payload):
    """Widening to the Coordinator must not also widen to Admin.

    Admin administers the platform and does not do workflow writes. That
    separation predates this change and is the reason the interface must not
    offer Admin these controls either.
    """
    r = getattr(client, method)(
        url, headers=_headers(client, ADMIN), json=payload
    )
    assert r.status_code == 403, r.text


def test_contractor_cannot_decide_anything(client):
    for method, url, payload in LIFECYCLE_WRITES:
        r = getattr(client, method)(
            url, headers=_headers(client, CONTRACTOR), json=payload
        )
        assert r.status_code == 403, f"{url} let a contractor through: {r.text}"


def test_returned_drive_test_goes_back_to_the_contractor():
    """A returned drive test must not park in the reviewer's own queue.

    ``Returned`` used to derive stage ``DT Submitted``, so the site stayed in
    the review queue while the contractor's submission form -- gated on stage
    ``Assigned`` -- never reappeared. Nothing could move it either way.
    """
    from types import SimpleNamespace

    from app.services.workflow import (
        STAGE_ASSIGNED,
        STAGE_DT_SUBMITTED,
        derive_stage,
    )

    def work_item(dt_status):
        return SimpleNamespace(
            drive_tests=[SimpleNamespace(id=1, is_active=True, status=dt_status)],
            assignments=[SimpleNamespace(id=1, is_active=True, returned_at=None)],
            hc_tasks=[], health_checks=[],
        )

    assert derive_stage(work_item("Submitted")) == STAGE_DT_SUBMITTED
    assert derive_stage(work_item("Returned")) == STAGE_ASSIGNED
    assert derive_stage(work_item("Rejected")) == STAGE_ASSIGNED
