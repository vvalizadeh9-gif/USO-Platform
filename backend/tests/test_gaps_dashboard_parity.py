"""Lifecycle Gaps and the Acceptance dashboard count the same villages.

Two screens answering "how many drive-tested villages are still waiting on
ICT / CRA?" must never disagree. They once did -- 760 vs 758 CRA pending --
because Lifecycle Gaps also required the site to be on air, and site E2953
had its drive test done while CPM still said ``Site Survey``. Cards 1-2 now
count over ``acceptance_universe.dt_done_universe``, the SQL twin of the rule
the dashboard applies in Python; this module holds the two screens equal for
every role that sees both, with their own scoping applied:

    gaps.totals.eligible     == dashboard.kpis.total_dt_done_villages
    gaps.pending_ict.count   == dashboard.kpis.total_ict_remained
    gaps.pending_cra.count   == dashboard.kpis.total_cra_remained
    gaps.totals.ict_approved == dashboard.kpis.total_ict_approval
    gaps.totals.cra_approved == dashboard.kpis.total_cra_approval

The seed (every village هدف, requested technology 2G, and each village's
cached ICT/CRA status matching its acceptance row, as the workflow keeps it):

    site     province    stage         DT       villages (ICT, CRA)
    S-TEH    Tehran      on air        Done     AA  AP  PA  RR  NN  AR
                                                + one not هدف, one soft-deleted
    E2953    Ardabil     Site Survey   Done     AP  AP  AA  AA   (the real case)
    S-MAZ    Mazandaran  on air        Done     RA  PP
    S-UNK    (none)      on air        Done     PR
    S-ONG    Tehran      on air        Ongoing  AA   (Mojri card only)

    PM (country)   eligible 13 · ICT approved 7 · CRA approved 5
                   ICT remained 6 · CRA remained 8 (3 of them Rejected)

Run with:  cd backend && pytest tests/test_gaps_dashboard_parity.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_gaps_parity_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.services import acceptance_universe, gaps  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

DB_FILE = "/tmp/uep_gaps_parity_pytest.db"

TEHRAN = "تهران"
MAZANDARAN = "مازندران"
ARDABIL = "اردبیل"

ALPHA = "DT-Alpha"
BETA = "DT-Beta"

PERM_ONAIR = "راه_اندازی_دائم"
SITE_SURVEY = "Site Survey"

A, P, R, N = "Approved", "Pending", "Rejected", "NotFiled"

#: E2953's four villages, by their real codes. Two are CRA pending: the two
#: the old on-air rule dropped from Lifecycle Gaps' CRA figure.
E2953_CRA_PENDING = ("93508", "94890")
E2953_CRA_APPROVED = ("380841", "808609")

PM_EXPECTED = {
    "total_dt_done_villages": 13,
    "total_ict_approval": 7,
    "total_ict_remained": 6,
    "total_cra_approval": 5,
    "total_cra_remained": 8,
    "total_cra_rejected": 3,
}


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _seed() -> None:
    from datetime import datetime, timezone

    from app.models.acceptance import Acceptance
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    try:
        province_id = {
            name: db.query(Province).filter(Province.name == name).one().id
            for name in (TEHRAN, MAZANDARAN, ARDABIL)
        }
        alpha = Contractor(name=ALPHA, type="drive_test")
        beta = Contractor(name=BETA, type="drive_test")
        db.add_all([alpha, beta])
        db.flush()

        def work_item(code, province, contractor, *, stage=PERM_ONAIR, dt="Done"):
            site = Site(
                site_code=code,
                province_id=province_id[province] if province else None,
            )
            db.add(site)
            db.flush()
            row = WorkItem(
                site_id=site.id,
                site_type="A",
                requested_technology="2G",
                last_stage=stage,
                dt_status=dt,
                dt_sc_contractor_id=contractor.id,
                current_stage="New",
            )
            db.add(row)
            db.flush()
            return row

        def village(wi, code, ict, cra, *, target="هدف", deleted=False):
            row = Village(
                work_item_id=wi.id,
                village_code=code,
                target_classification=target,
                ict_status=ict,
                cra_status=cra,
                deleted_at=datetime.now(timezone.utc) if deleted else None,
            )
            db.add(row)
            db.flush()
            # The dashboard reads the verdict from the acceptance rows, Gaps
            # the cached status on the village: seeded to agree, as the
            # workflow keeps them. NotFiled has no row (verdict Pending).
            if ict != N or cra != N:
                db.add(Acceptance(
                    village_id=row.id,
                    technology="2G",
                    ict_status=P if ict == N else ict,
                    cra_status=P if cra == N else cra,
                ))

        teh = work_item("S-TEH", TEHRAN, alpha)
        for i, (ict, cra) in enumerate(
            [(A, A), (A, P), (P, A), (R, R), (N, N), (A, R)]
        ):
            village(teh, f"T-{i}", ict, cra)
        village(teh, "T-SIDE", P, P, target="هدف جانبی")
        village(teh, "T-DEL", P, P, deleted=True)

        # The real case: drive test done, CPM stage never moved past survey.
        e2953 = work_item("E2953", ARDABIL, beta, stage=SITE_SURVEY)
        for code in E2953_CRA_PENDING:
            village(e2953, code, A, P)
        for code in E2953_CRA_APPROVED:
            village(e2953, code, A, A)

        maz = work_item("S-MAZ", MAZANDARAN, beta)
        village(maz, "M-0", R, A)
        village(maz, "M-1", P, P)

        village(work_item("S-UNK", None, alpha), "U-0", P, R)
        village(work_item("S-ONG", TEHRAN, alpha, dt="Ongoing"), "O-0", A, A)

        db.commit()
    finally:
        db.close()


# ----- Accounts -----------------------------------------------------------


def _admin(client) -> dict:
    response = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _scoped_account(client, admin_h, pm_h, role: str, kpi_name: str) -> dict:
    """A staff account granted exactly the provinces ``kpi_name`` owns in the
    province directory -- the dashboard's scope -- and linked to that KPI
    person -- the Gaps scope. Both screens then scope to the same villages,
    each by its own rule."""
    from app.core.province_directory import PROVINCE_DIRECTORY
    from app.models.reference import Province

    field = "regional_manager" if role == "RegionalManager" else "pso_coordinator"
    owned = [p.fa for p in PROVINCE_DIRECTORY if getattr(p, field) == kpi_name]
    db = SessionLocal()
    try:
        province_ids = [
            row.id for row in db.query(Province).filter(Province.name.in_(owned))
        ]
    finally:
        db.close()
    assert province_ids, kpi_name

    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    username = f"parity_{role.lower()}"
    password = "Parity-Scoped-Passw0rd-41"
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": username,
            "password": password,
            "first_name": "Parity",
            "family_name": role,
            "role_id": next(r["id"] for r in roles if r["name"] == role),
            "sees_all_provinces": False,
            "province_ids": province_ids,
        },
    )
    assert created.status_code == 201, created.text
    linked = client.put(
        f"/api/v1/kpi/mapping/links/{created.json()['id']}",
        headers=pm_h,
        json={"kpi_person_name": kpi_name},
    )
    assert linked.status_code == 200, linked.text
    response = client.post(
        "/api/v1/auth/login", data=login_form(client, username, password)
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture(scope="module")
def actors(client):
    admin_h = _admin(client)
    pm = login_as_role(client, admin_h["Authorization"].split()[1], "PM")
    return {
        "pm": pm,
        # Allahyar: Tehran among the seeded provinces.
        "rm": _scoped_account(client, admin_h, pm, "RegionalManager", "Allahyar"),
        # Amir: Tehran and Mazandaran among the seeded provinces.
        "coordinator": _scoped_account(client, admin_h, pm, "Coordinator", "Amir"),
    }


def _get(client, headers, url) -> dict:
    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _both(client, headers) -> tuple[dict, dict]:
    """(Gaps overview, dashboard KPIs) as this account sees them."""
    return (
        _get(client, headers, "/api/v1/gaps/overview"),
        _get(client, headers, "/api/v1/acceptance/overview")["kpis"],
    )


# ----- The two screens agree ----------------------------------------------


@pytest.mark.parametrize("actor", ["pm", "rm", "coordinator"])
def test_gaps_and_the_dashboard_count_the_same(client, actors, actor):
    overview, kpis = _both(client, actors[actor])
    assert kpis["total_dt_done_villages"] > 0, "the scope should hold villages"
    assert {
        "eligible": overview["totals"]["eligible"],
        "pending_ict": overview["gaps"]["pending_ict"]["count"],
        "pending_cra": overview["gaps"]["pending_cra"]["count"],
        "ict_approved": overview["totals"]["ict_approved"],
        "cra_approved": overview["totals"]["cra_approved"],
    } == {
        "eligible": kpis["total_dt_done_villages"],
        "pending_ict": kpis["total_ict_remained"],
        "pending_cra": kpis["total_cra_remained"],
        "ict_approved": kpis["total_ict_approval"],
        "cra_approved": kpis["total_cra_approval"],
    }


def test_the_figures_are_the_hand_worked_ones(client, actors):
    """Parity alone would pass if both screens were wrong the same way."""
    overview, kpis = _both(client, actors["pm"])
    assert {key: kpis[key] for key in PM_EXPECTED} == PM_EXPECTED
    assert overview["gaps"]["pending_cra"]["base"] == PM_EXPECTED["total_dt_done_villages"]


def test_scoped_accounts_see_only_their_provinces(client, actors):
    # Allahyar: S-TEH's 6. Amir: S-TEH's 6 + S-MAZ's 2.
    assert _both(client, actors["rm"])[1]["total_dt_done_villages"] == 6
    assert _both(client, actors["coordinator"])[1]["total_dt_done_villages"] == 8


# ----- The E2953 case and Rejected ----------------------------------------


def _codes(counter: str) -> set[str]:
    from sqlalchemy import select

    from app.models.workitem import Village

    db = SessionLocal()
    try:
        stmt = gaps._universe(db, select(Village.village_code)).where(
            gaps._counter_conditions(db)[counter]
        )
        return set(db.execute(stmt).scalars().all())
    finally:
        db.close()


def test_a_drive_tested_site_not_on_air_is_counted(client, actors):
    """E2953: drive test done, CPM stage still Site Survey. Its CRA-pending
    villages are in Gaps' pending CRA, as they are on the dashboard."""
    pending_cra = _codes("pending_cra")
    assert set(E2953_CRA_PENDING) <= pending_cra
    assert set(E2953_CRA_APPROVED) <= _codes("cra_approved")
    assert set(E2953_CRA_PENDING + E2953_CRA_APPROVED) <= _codes("eligible")


def test_rejected_is_not_approved_on_both_screens(client, actors):
    """T-3 (Rejected / Rejected), T-5 (CRA Rejected) and U-0 (CRA Rejected)
    are CRA remained on the dashboard and CRA pending in Gaps."""
    _, kpis = _both(client, actors["pm"])
    assert kpis["total_cra_remained"] == kpis["total_cra_rejected"] + kpis["total_cra_pending"]
    assert kpis["total_cra_rejected"] == 3
    assert {"T-3", "T-5", "U-0"} <= _codes("pending_cra")
    assert {"T-3", "M-0"} <= _codes("pending_ict")


def test_drive_test_not_done_is_on_neither_screen(client, actors):
    # O-0 is approved (so it is in the Mojri card) but its drive test is not
    # done, so it is in no card 1-2 figure.
    assert "O-0" not in _codes("eligible")
    assert "O-0" in _codes("ict_approved_all")


# ----- The SQL condition and its Python twin ------------------------------


def test_the_sql_universe_selects_what_the_python_rule_selects(client, actors):
    """``dt_done_universe`` (Gaps, SQL) and ``in_dt_done_universe`` (the
    dashboard, Python) are one rule twice: they must pick the same villages."""
    from sqlalchemy import select

    from app.models.reference import User
    from app.models.workitem import Village, WorkItem

    db = SessionLocal()
    try:
        pm = db.query(User).filter(User.username == "test_pm").one()
        in_python = {
            village.id
            for wi in acceptance_universe.load(db, pm)
            for village in wi.villages
            if acceptance_universe.in_dt_done_universe(wi, village)
        }
        in_sql = set(
            db.execute(
                select(Village.id)
                .join(WorkItem, Village.work_item_id == WorkItem.id)
                .where(acceptance_universe.dt_done_universe(db))
            ).scalars().all()
        )
    finally:
        db.close()
    assert in_python == in_sql
    assert len(in_sql) == PM_EXPECTED["total_dt_done_villages"]
