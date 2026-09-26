"""Tests for the Acceptance scorecard: PIP against Delivered per contractor.

The rules being checked:

* Delivered is villages fully accepted in the month, which is the month the
  *second* authority cleared the village -- ICT in one month and CRA in the
  next counts in the later month.
* Villages are not de-duplicated: two villages on one site count as two.
* Only pure هدف villages count, as on the Acceptance Dashboard.
* PIP is the approved Acceptance PIP in force (the highest approved
  version), and ``None`` -- never 0 -- where there is none.
* A contractor account sees only its own row and its own villages.
* The month's totals are the sum of its rows.
* The Acceptance Dashboard trend still counts the same months (its own tests,
  in test_acceptance_plan.py, cover it in full; one cross-check here).

Run with:  cd backend && pytest tests/test_acceptance_scorecard.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_acc_scorecard_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

P1 = (1404, 3)
P2 = (1404, 4)


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_acc_scorecard_pytest.db"):
        os.remove("/tmp/uep_acc_scorecard_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def world(client):
    """Two contractors' villages, and a contractor login for the first."""
    from app.models.acceptance import Acceptance
    from app.models.monthly_plan import ContractorMonthlyPlan
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

    admin_h = _login(client)
    db = SessionLocal()
    a = Contractor(name="Acc Alpha", type="drive_test", active=True)
    b = Contractor(name="Acc Beta", type="drive_test", active=True)
    db.add_all([a, b])
    db.flush()
    province = Province(name="ScoreProv")
    db.add(province)
    db.flush()

    d1 = jalali.from_shamsi_date(*P1, 10)
    d2 = jalali.from_shamsi_date(*P2, 10)

    def _site(code, contractor, villages):
        site = Site(site_code=code, province_id=province.id)
        db.add(site)
        db.flush()
        wi = WorkItem(
            site_id=site.id, site_type="A", dt_status="Done",
            requested_technology="2G", current_stage="New",
            dt_sc_contractor_id=contractor.id,
        )
        db.add(wi)
        db.flush()
        for vcode, target, ict, cra in villages:
            v = Village(work_item_id=wi.id, village_code=vcode, target_classification=target)
            v.acceptances = [
                Acceptance(
                    technology="2G",
                    ict_status="Approved" if ict else None, ict_date=ict,
                    cra_status="Approved" if cra else None, cra_date=cra,
                )
            ]
            db.add(v)

    # Alpha: one site with two villages both fully accepted in P1 (count as
    # two), one village ICT in P1 / CRA in P2 (counts in P2), one non-هدف
    # village accepted in P1 (excluded), one only ICT-approved (not counted).
    _site("SC-A1", a, [
        ("A1", "هدف", d1, d1),
        ("A2", "هدف", d1, d1),
    ])
    _site("SC-A2", a, [
        ("A3", "هدف", d1, d2),
        ("A4", "غیر هدف", d1, d1),
        ("A5", "هدف", d1, None),
    ])
    # Beta: one village fully accepted in P1.
    _site("SC-B1", b, [("B1", "هدف", d1, d1)])

    # PIPs: Alpha approved 5, revised and approved 4 (4 is in force); Beta
    # has none in P1.
    for version, count in ((1, 5), (2, 4)):
        db.add(ContractorMonthlyPlan(
            contractor_id=a.id, stream="ACCEPTANCE", shamsi_year=P1[0],
            shamsi_month=P1[1], version=version, is_current=version == 2,
            committed_count=count, status="Approved",
        ))
    # A DT plan must not be read as an Acceptance PIP.
    db.add(ContractorMonthlyPlan(
        contractor_id=b.id, stream="DT", shamsi_year=P1[0], shamsi_month=P1[1],
        version=1, is_current=True, committed_count=99, status="Approved",
    ))
    db.commit()
    ids = {"a": a.id, "b": b.id}
    db.close()

    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Contractor")
    password = "Test-Fixture-Passphrase"
    r = client.post("/api/v1/admin/users", headers=admin_h, json={
        "username": "acc_alpha", "password": password, "first_name": "Acc",
        "family_name": "Alpha", "role_id": role_id, "sees_all_provinces": True,
        "province_ids": [], "contractor_id": ids["a"],
    })
    assert r.status_code == 201, r.text
    return ids


def _card(user_name, contractor_id=None):
    from app.models.reference import User
    from app.services.acceptance_plan import acceptance_scorecard

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(username=user_name).one()
        return acceptance_scorecard(db, user, [P1, P2])
    finally:
        db.close()


def _row(month, contractor_id):
    return next(r for r in month["rows"] if r["contractor_id"] == contractor_id)


def test_delivered_counts_the_month_the_second_authority_cleared(world):
    card = _card("admin")
    p1, p2 = card["months"]
    # A1 + A2 in P1 (two villages, one site); A3 in P2 (CRA came later).
    assert _row(p1, world["a"])["delivered"] == 2
    assert _row(p2, world["a"])["delivered"] == 1


def test_non_target_and_half_approved_villages_do_not_count(world):
    card = _card("admin")
    # A4 is غیر هدف and A5 has no CRA verdict: neither is in the 2 above.
    assert _row(card["months"][0], world["a"])["delivered"] == 2


def test_pip_is_the_approved_acceptance_pip_in_force(world):
    p1 = _card("admin")["months"][0]
    assert _row(p1, world["a"])["pip"] == 4
    # Beta's only plan is DT: no Acceptance PIP, so None, not 0 and not 99.
    assert _row(p1, world["b"])["pip"] is None
    assert _row(p1, world["a"])["achievement_percent"] == 50.0
    assert _row(p1, world["a"])["assignment"] is None


def test_totals_are_the_sum_of_the_rows(world):
    for month in _card("admin")["months"]:
        assert month["delivered"] == sum(r["delivered"] for r in month["rows"])
        assert month["pip"] == sum(r["pip"] or 0 for r in month["rows"])
        assert month["assignment"] is None
    p1 = _card("admin")["months"][0]
    assert p1["delivered"] == 3        # A1, A2, B1
    assert p1["achievement_percent"] == 75.0


def test_a_contractor_sees_only_its_own_row(world):
    card = _card("acc_alpha")
    assert card["is_contractor"] is True
    for month in card["months"]:
        assert {r["contractor_id"] for r in month["rows"]} == {world["a"]}
    assert card["months"][0]["delivered"] == 2   # Beta's B1 is not in it


def test_the_dashboard_trend_counts_the_same_villages(client, world):
    """monthly_approval_trend is unchanged by the shared helper: its fully
    accepted count for P1 and P2 matches the scorecard's totals."""
    from app.models.reference import User
    from app.services.acceptance_plan import monthly_approval_trend

    db = SessionLocal()
    try:
        admin = db.query(User).filter_by(username="admin").one()
        months = {
            (m["shamsi_year"], m["shamsi_month"]): m
            for m in monthly_approval_trend(
                db, admin, province_ids=None, contractor_id=None, months=36
            )
        }
    finally:
        db.close()
    card = _card("admin")
    for month, period in zip(card["months"], (P1, P2), strict=True):
        assert months[period]["fully_accepted_new"] == month["delivered"]
