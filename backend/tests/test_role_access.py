"""UEP role access: the central permission map, and every endpoint that reads it.

What is asserted, by the brief's sections:

* **The map** (§4): one assertion per role x area, from ``core/access.py``;
  and the frontend's copy of the matrix is byte-for-byte the backend's.
* **Mojri** (§1): the Lifecycle Gaps Mojri figures and exports are PM's,
  Coordinator's and Viewer's. Everyone else who may open Lifecycle Gaps gets
  the page without them (the figures are absent, not zero) and a 403 on the
  Mojri exports; the Mojri column leaves their workbooks.
* **Regional manager** (§2, §7): Roles Performance, Lifecycle Gaps and
  Explorer, all inside their provinces -- list, record (403 outside), header
  search and the region summary. Insights dashboards, the acceptance
  workspace and the monthly plan are 403.
* **The five problem-category owners** (§3): no Insights (403), Explorer and
  search over every site, read-only -- every Explorer write is a 403.
* **No change** for PM, Coordinator, Viewer, Contractor and Admin on the
  dashboards.

Run with:  cd backend && pytest tests/test_role_access.py -q
"""
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_role_access_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

from app.core import access  # noqa: E402
from app.core.access import Area  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

API = "/api/v1"
FIVE = ("NwgPlanning", "ManagedService", "HuaweiCleanup", "CpgPower", "CpgRolloutPM")
CORE = ("PM", "Coordinator", "Viewer", "Contractor")
MOJRI_GAPS = {"ict_missing_in_mojri", "cra_missing_in_mojri"}
ON_AIR = "راه_اندازی_دائم"
HADAF = "هدف"


# --------------------------------------------------------------------------
# 1. The map: one assertion per role x area
# --------------------------------------------------------------------------
_YES = {
    Area.ROLES_PERFORMANCE: {*CORE, "RegionalManager"},
    Area.LIFECYCLE_GAPS: {*CORE, "RegionalManager"},
    Area.MOJRI_SECTION: {"PM", "Coordinator", "Viewer"},
    Area.INSIGHTS_DASHBOARDS: {*CORE, "Admin"},
    Area.EXPLORER: {*CORE, "RegionalManager", *FIVE, "Admin"},
    Area.EXPLORER_ALL_SITES: set(FIVE),
    Area.ACCEPTANCE_WORKSPACE: set(CORE),
    Area.MONTHLY_PLAN_QUEUE: {"PM", "Coordinator", "Viewer", "Admin"},
    Area.INTERNAL_PIP: {"PM", "Coordinator", "Viewer"},
}
_ROLES = ("Admin", *CORE, "RegionalManager", *FIVE)


@pytest.mark.parametrize(
    "role, area", [(role, area) for area in Area for role in _ROLES]
)
def test_the_map_answers_the_matrix(role, area):
    assert access.allows(role, area) is (role in _YES[area])


def test_every_area_is_in_the_matrix_and_nothing_else():
    assert set(_YES) == set(Area)
    assert set(access._matrix()["areas"]) == {a.value for a in Area}


def test_landings():
    assert access.landing_for("RegionalManager") == "region"
    for role in FIVE:
        assert access.landing_for(role) == "work"
    for role in (*CORE, "Admin"):
        assert access.landing_for(role) == "standard"


def test_the_frontend_reads_the_same_matrix():
    """The two apps build from separate Docker contexts, so the matrix is in
    two files. They must never differ."""
    frontend = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "accessMatrix.json"
    )
    if not frontend.exists():
        pytest.skip("frontend not checked out next to backend")
    assert json.loads(frontend.read_text(encoding="utf-8")) == json.loads(
        access.MATRIX_PATH.read_text(encoding="utf-8")
    )


# --------------------------------------------------------------------------
# 2. The world: two provinces, a site in each, one account per role
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def world():
    path = "/tmp/uep_role_access_pytest.db"
    if os.path.exists(path):
        os.remove(path)
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    from app.core import user_status
    from app.core.database import SessionLocal
    from app.core.security import create_access_token
    from app.main import app
    from app.models.kpi import ProvinceMapping
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, Village, WorkItem

    db = SessionLocal()
    roles = {r.name: r for r in db.query(Role).all()}
    mapping = {
        m.province_fa: m
        for m in db.query(ProvinceMapping).filter(ProvinceMapping.effective_to.is_(None))
    }
    provinces = [p for p in db.query(Province).order_by(Province.id) if p.name in mapping]
    home = provinces[0]
    rm_name = mapping[home.name].regional_manager
    # A province run by a different regional manager: outside the RM's scope.
    away = next(p for p in provinces if mapping[p.name].regional_manager != rm_name)
    rm_provinces = [p for p in provinces if mapping[p.name].regional_manager == rm_name]

    dt_co = Contractor(name="Access Drive Co", type="drive_test")
    db.add(dt_co)
    db.flush()

    def site(code, province):
        s = Site(site_code=code, province_id=province.id)
        db.add(s)
        db.flush()
        wi = WorkItem(
            site_id=s.id, site_type="Greenfield", last_stage=ON_AIR, dt_status="Done",
            requested_technology="3G", dt_sc_contractor_id=dt_co.id, current_stage="DT Done",
        )
        db.add(wi)
        db.flush()
        db.add(Village(
            work_item_id=wi.id, village_code=f"V-{code}", village_name=f"Village {code}",
            target_classification=HADAF, ict_status="Approved", cra_status="Pending",
        ))
        return wi

    inside = site("RA100", home)
    outside = site("RA900", away)

    def user(username, role, **kw):
        u = User(
            username=username, password_hash="x", first_name=username, family_name="T",
            role_id=roles[role].id, status=user_status.ACTIVE, **kw,
        )
        db.add(u)
        db.flush()
        return u

    accounts = {
        "Admin": user("ra_admin", "Admin", sees_all_provinces=True),
        "PM": user("ra_pm", "PM", sees_all_provinces=True),
        "Viewer": user("ra_viewer", "Viewer", sees_all_provinces=True),
        "Coordinator": user(
            "ra_coord", "Coordinator", sees_all_provinces=False,
            kpi_person_name=mapping[home.name].pso_coordinator,
        ),
        "Contractor": user(
            "ra_sc", "Contractor", sees_all_provinces=False, contractor_id=dt_co.id
        ),
        "RegionalManager": user(
            "ra_rm", "RegionalManager", sees_all_provinces=False, kpi_person_name=rm_name
        ),
        **{role: user(f"ra_{role.lower()}", role, sees_all_provinces=False) for role in FIVE},
    }
    accounts["Coordinator"].provinces = [home]
    accounts["RegionalManager"].provinces = rm_provinces
    db.commit()

    def headers(u):
        token = create_access_token(u.id, {"ver": u.token_version})
        return {"Authorization": f"Bearer {token}"}

    out = {
        "client": TestClient(app),
        "h": {role: headers(u) for role, u in accounts.items()},
        "inside": inside.id,
        "outside": outside.id,
        "rm_province_count": len(rm_provinces),
    }
    db.close()
    return out


def _get(world, role, path, **params):
    return world["client"].get(f"{API}{path}", headers=world["h"][role], params=params)


# --------------------------------------------------------------------------
# 3. Mojri: PM, Coordinator, Viewer only
# --------------------------------------------------------------------------
@pytest.mark.parametrize("role", ["PM", "Coordinator", "Viewer"])
def test_mojri_figures_are_sent_to_pm_coordinator_viewer(world, role):
    r = _get(world, role, "/gaps/overview")
    assert r.status_code == 200, r.text
    body = r.json()
    assert MOJRI_GAPS <= set(body["gaps"])
    assert MOJRI_GAPS <= set(body["rows"])
    assert "last_mojri_import" in body
    assert {"ict_approved_all", "cra_approved_all"} <= set(body["totals"])


@pytest.mark.parametrize("role", ["Contractor", "RegionalManager"])
def test_mojri_figures_are_absent_for_everyone_else(world, role):
    r = _get(world, role, "/gaps/overview")
    assert r.status_code == 200, r.text
    body = r.json()
    assert not MOJRI_GAPS & set(body["gaps"])
    assert not MOJRI_GAPS & set(body["rows"])
    assert "last_mojri_import" not in body
    assert not {"ict_approved_all", "cra_approved_all"} & set(body["totals"])
    assert {"pending_ict", "pending_cra", "ict_remained", "cra_remained"} == set(body["gaps"])


_MOJRI_EXPORTS = ["ict_missing_in_mojri", "cra_missing_in_mojri", "ict_approved_all", "cra_approved_all"]


@pytest.mark.parametrize("gap", _MOJRI_EXPORTS)
@pytest.mark.parametrize("role", ["PM", "Coordinator", "Viewer"])
def test_mojri_exports_200_for_pm_coordinator_viewer(world, role, gap):
    assert _get(world, role, "/gaps/villages.xlsx", gap=gap).status_code == 200


@pytest.mark.parametrize("gap", _MOJRI_EXPORTS)
@pytest.mark.parametrize("role", ["Contractor", "RegionalManager", *FIVE, "Admin"])
def test_mojri_exports_403_for_all_others(world, role, gap):
    assert _get(world, role, "/gaps/villages.xlsx", gap=gap).status_code == 403


def _headers_of(response) -> list[str]:
    ws = load_workbook(BytesIO(response.content))["Villages"]
    return [cell.value for cell in next(ws.iter_rows(max_row=1))]


def test_the_mojri_column_leaves_a_non_mojri_workbook(world):
    pm = _get(world, "PM", "/gaps/villages.xlsx", gap="pending_cra")
    rm = _get(world, "RegionalManager", "/gaps/villages.xlsx", gap="pending_cra")
    assert pm.status_code == rm.status_code == 200
    assert "Mojri status" in _headers_of(pm)
    assert "Mojri status" not in _headers_of(rm)
    assert len(_headers_of(rm)) == len(_headers_of(pm)) - 1


def test_the_mojri_upload_is_still_pm_only(world):
    for role in ("Coordinator", "Viewer", "RegionalManager", *FIVE):
        r = world["client"].post(
            f"{API}/mojri/import/preview", headers=world["h"][role],
            files={"file": ("m.xlsx", b"x", "application/octet-stream")},
        )
        assert r.status_code == 403, role


# --------------------------------------------------------------------------
# 4. Regional manager: three areas, inside their provinces
# --------------------------------------------------------------------------
def _site_ids(world, role) -> set[int]:
    r = _get(world, role, "/explorer/sites", limit=100)
    assert r.status_code == 200, r.text
    return {row["id"] for row in r.json()["items"]}


def test_rm_explorer_list_is_their_provinces(world):
    ids = _site_ids(world, "RegionalManager")
    assert world["inside"] in ids
    assert world["outside"] not in ids


def test_rm_explorer_record_outside_their_provinces_is_403(world):
    assert _get(world, "RegionalManager", f"/explorer/sites/{world['inside']}").status_code == 200
    assert _get(world, "RegionalManager", f"/explorer/sites/{world['outside']}").status_code == 403
    assert _get(world, "RegionalManager", f"/explorer/sites/{world['outside']}/villages").status_code == 403
    assert _get(world, "RegionalManager", "/explorer/sites/999999").status_code == 404


def test_rm_header_search_is_their_provinces(world):
    body = _get(world, "RegionalManager", "/search", q="RA").json()
    codes = {s["site_code"] for s in body["sites"]}
    assert "RA100" in codes
    assert "RA900" not in codes
    villages = {v["site_code"] for v in body["villages"]}
    assert "RA900" not in villages


def test_rm_region_summary_is_the_area_tab_for_their_region(world):
    r = _get(world, "RegionalManager", "/kpi/area")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"]["lens"] == "rm"
    assert body["scope"]["selectable"] is False
    assert body["scope"]["provinces"] == world["rm_province_count"]
    for key in ("onair", "dt", "ict", "cra"):
        assert "count" in body["totals"][key]


def test_rm_may_not_widen_roles_performance(world):
    assert _get(world, "RegionalManager", "/kpi/area", lens="country").status_code == 403


@pytest.mark.parametrize(
    "path",
    [
        "/drive-test/overview", "/drive-test/sites", "/drive-test/export",
        "/acceptance/overview", "/acceptance/progress", "/acceptance/sites",
        "/acceptance/my-work", "/pip/overview",
    ],
)
def test_rm_is_refused_everything_else(world, path):
    assert _get(world, "RegionalManager", path).status_code == 403


# --------------------------------------------------------------------------
# 5. The five roles: no Insights, Explorer over every site, read only
# --------------------------------------------------------------------------
_INSIGHTS = [
    "/kpi/area", "/kpi/month", "/kpi/lenses", "/gaps/overview", "/gaps/map",
    "/drive-test/overview", "/drive-test/trend", "/drive-test/sites",
    "/acceptance/overview", "/acceptance/progress",
]


@pytest.mark.parametrize("path", _INSIGHTS)
@pytest.mark.parametrize("role", FIVE)
def test_five_roles_get_no_insights(world, role, path):
    assert _get(world, role, path).status_code == 403


@pytest.mark.parametrize("role", FIVE)
def test_five_roles_read_every_site(world, role):
    ids = _site_ids(world, role)
    assert {world["inside"], world["outside"]} <= ids
    for wi in (world["inside"], world["outside"]):
        assert _get(world, role, f"/explorer/sites/{wi}").status_code == 200
    codes = {s["site_code"] for s in _get(world, role, "/search", q="RA").json()["sites"]}
    assert {"RA100", "RA900"} <= codes


@pytest.mark.parametrize("role", FIVE)
def test_five_roles_cannot_write_from_explorer(world, role):
    client, h, wi = world["client"], world["h"][role], world["inside"]
    writes = [
        (f"{API}/work-items/{wi}/assignment", {"assignment_type": "official", "contractor_id": 1}),
        (f"{API}/work-items/{wi}/drive-test", {"execution_date": "2026-10-01"}),
        (f"{API}/work-items/{wi}/return-to-coordinator", {"reason": "x"}),
        (f"{API}/drive-tests/1/coordinator-review", {"decision": "Approved", "comment": None}),
    ]
    for url, body in writes:
        assert client.post(url, headers=h, json=body).status_code == 403, url
    assert _get(world, role, "/acceptance/my-work").status_code == 403


# --------------------------------------------------------------------------
# 6. No change for everyone else
# --------------------------------------------------------------------------
@pytest.mark.parametrize("role", [*CORE, "Admin"])
def test_dashboards_unchanged_for_core_roles_and_admin(world, role):
    for path in ("/drive-test/overview", "/acceptance/overview"):
        assert _get(world, role, path).status_code == 200, (role, path)


@pytest.mark.parametrize("role", ["PM", "Viewer"])
def test_pm_and_viewer_explorer_is_every_site(world, role):
    assert {world["inside"], world["outside"]} <= _site_ids(world, role)


def test_coordinator_and_contractor_explorer_keeps_its_scope(world):
    assert world["outside"] not in _site_ids(world, "Coordinator")
    # The contractor is the drive-test subcontractor on both sites.
    assert {world["inside"], world["outside"]} <= _site_ids(world, "Contractor")
