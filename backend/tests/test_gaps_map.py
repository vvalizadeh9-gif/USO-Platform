"""Lifecycle Gaps coverage map: the numbers, and who may see them.

The map is ICT approval by province and CRA approval by CRA region. What has to
hold: all 31 provinces and all 9 regions come back for a PM, the figures are
the hand-worked ones, a region is the sum of its provinces, the rows add up to
the total, and a non-PM's map is their own villages only.

The dataset below is small and every expected figure is worked out by hand in
``_seed``, so an assertion never agrees with whatever the code happened to
produce. It deliberately contains the cases that make the sums hard:

* a site whose CPM province cell matched none of the 31 (no province, so no
  regional manager, coordinator or CRA region either),
* a work item with no DT SC contractor,
* a province whose drive tests are not done, so it has reached nothing,
* villages CRA-approved with no ICT approval.

The overview (the Gaps tab) has its own file, ``test_gaps_overview.py``.

Run with:  cd backend && pytest tests/test_gaps_map.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_gaps_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.services import gaps  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

DB_FILE = "/tmp/uep_gaps_pytest.db"

TEHRAN = "تهران"
MAZANDARAN = "مازندران"
ARDABIL = "اردبیل"
ZANJAN = "زنجان"

ALPHA = "DT-Alpha"
BETA = "DT-Beta"

ON_AIR = "راه_اندازی_دائم"

# Who owns what, from app/core/province_directory.py, which seeds
# province_mapping on startup:
#
#   Tehran      North       Amir     Allahyar
#   Mazandaran  North       Amir     Nobakht
#   Ardabil     Azar        Hossein  Pirayesh
#   Zanjan      North West  Amir     Pirayesh

# ----- The country figures the seed produces, worked out by hand -----------
#
#   villages       10 + 8 + 6 + 5 + 3 + 4 + 2 = 38
#   ICT reached    10 + 8 + 6 + 0 + 3 + 4 + 2 = 33   (drive test done)
#   ICT stopped     4 + 0 + 4 + 0 + 3 + 0 + 2 = 13   (done, not ICT approved)
#   CRA reached     6 + 8 + 2 + 0 + 0 + 4 + 0 = 20   (ICT approved)
#   CRA stopped     2 + 5 + 0 + 0 + 0 + 4 + 0 = 11   (ICT approved, not CRA)
COUNTRY_VILLAGES = 38
COUNTRY_ICT_REACHED = 33
COUNTRY_ICT_STOPPED = 13
COUNTRY_CRA_REACHED = 20
COUNTRY_CRA_STOPPED = 11

@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        _seed()
        yield c


def _villages(db, work_item_id, count, *, ict_approved=0, cra_approved=0):
    """``count`` target villages on one work item.

    The first ``ict_approved`` are ICT-approved and the first ``cra_approved``
    are CRA-approved, so CRA approval is a subset of ICT approval unless a test
    asks for otherwise.
    """
    from app.models.workitem import Village

    for index in range(count):
        db.add(
            Village(
                work_item_id=work_item_id,
                village_code=f"WI{work_item_id}-V{index}",
                target_classification="هدف",
                ict_status="Approved" if index < ict_approved else "NotFiled",
                cra_status="Approved" if index < cra_approved else "NotFiled",
            )
        )
    db.flush()


def _seed() -> None:
    """Seven work items, one per situation the map has to place somewhere."""
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, WorkItem

    db = SessionLocal()
    try:
        provinces = {
            name: db.query(Province).filter(Province.name == name).one()
            for name in (TEHRAN, MAZANDARAN, ARDABIL, ZANJAN)
        }
        alpha = Contractor(name=ALPHA, type="drive_test")
        beta = Contractor(name=BETA, type="drive_test")
        db.add_all([alpha, beta])
        db.flush()

        def site(code, province_name):
            row = Site(
                site_code=code,
                province_id=provinces[province_name].id if province_name else None,
            )
            db.add(row)
            db.flush()
            return row

        def work_item(site_row, contractor, *, dt_done: bool, site_type="A"):
            row = WorkItem(
                site_id=site_row.id,
                site_type=site_type,
                requested_technology="2G",
                last_stage=ON_AIR,
                dt_status="Done" if dt_done else "Ongoing",
                dt_sc_contractor_id=contractor.id if contractor else None,
                current_stage="New",
            )
            db.add(row)
            db.flush()
            return row

        tehran_site = site("S-TEH", TEHRAN)
        mazandaran_site = site("S-MAZ", MAZANDARAN)

        # 1. Tehran / Alpha. 10 DT-done villages, 6 ICT approved, 4 CRA.
        #    ICT stopped 4, CRA stopped 2.
        wi = work_item(tehran_site, alpha, dt_done=True)
        _villages(db, wi.id, 10, ict_approved=6, cra_approved=4)

        # 2. Mazandaran / Beta. 8 DT-done, all ICT approved, 3 CRA approved.
        #    ICT stopped 0, CRA stopped 5.
        wi = work_item(mazandaran_site, beta, dt_done=True)
        _villages(db, wi.id, 8, ict_approved=8, cra_approved=3)

        # 3. Ardabil / Alpha. 6 DT-done, 2 ICT approved and both CRA approved.
        wi = work_item(site("S-ARD", ARDABIL), alpha, dt_done=True)
        _villages(db, wi.id, 6, ict_approved=2, cra_approved=2)

        # 4. Zanjan / Beta. On air, drive test not done: reached nothing. The
        #    empty-state row -- it must be shown, reading zero and no rate.
        wi = work_item(site("S-ZAN", ZANJAN), beta, dt_done=False)
        _villages(db, wi.id, 5)

        # 5. A site whose CPM province cell matched none of the 31: no
        #    province, so no manager, coordinator or region owns it either.
        wi = work_item(site("S-UNK", None), alpha, dt_done=True)
        _villages(db, wi.id, 3)

        # 6. Tehran again, second site type, with no DT SC contractor at all.
        wi = work_item(tehran_site, None, dt_done=True, site_type="B")
        _villages(db, wi.id, 4, ict_approved=4)

        # 7. Mazandaran, second site type: two villages CRA-approved with no
        #    ICT approval. The two authorities are parallel; on the map these
        #    count as ICT stopped and have not reached the CRA stretch.
        wi = work_item(mazandaran_site, beta, dt_done=True, site_type="B")
        _villages(db, wi.id, 2, ict_approved=0, cra_approved=2)

        db.commit()
    finally:
        db.close()


# ----- Sign-in helpers ----------------------------------------------------


def _admin(client) -> dict:
    response = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _token(client, role: str) -> dict:
    return login_as_role(client, _admin(client)["Authorization"].split()[1], role)


@pytest.fixture(scope="module")
def actors(client):
    """One signed-in account per role, linked the way the KPI page needs."""
    admin_h = _admin(client)
    pm = _token(client, "PM")
    rm = _token(client, "RegionalManager")
    coordinator = _token(client, "Coordinator")

    users = client.get("/api/v1/admin/users", headers=admin_h).json()
    by_username = {u["username"]: u for u in users}
    for username, name in (
        ("test_regionalmanager", "Pirayesh"),
        ("test_coordinator", "Hossein"),
    ):
        response = client.put(
            f"/api/v1/kpi/mapping/links/{by_username[username]['id']}",
            headers=pm,
            json={"kpi_person_name": name},
        )
        assert response.status_code == 200, response.text

    return {
        "admin": admin_h,
        "pm": pm,
        "rm": rm,
        "coordinator": coordinator,
        "contractor": _contractor_account(client, admin_h),
    }


def _contractor_account(client, admin_h) -> dict:
    """A contractor account pointed at DT-Alpha."""
    from app.models.reference import Contractor

    db = SessionLocal()
    contractor_id = db.query(Contractor).filter(Contractor.name == ALPHA).one().id
    db.close()

    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Contractor")
    password = "Gap-Road-Contractor-Passw0rd"
    existing = client.get("/api/v1/admin/users", headers=admin_h).json()
    if not any(u["username"] == "gap_contractor" for u in existing):
        created = client.post(
            "/api/v1/admin/users",
            headers=admin_h,
            json={
                "username": "gap_contractor",
                "password": password,
                "first_name": "Gap",
                "family_name": "Contractor",
                "role_id": role_id,
                "contractor_id": contractor_id,
                "sees_all_provinces": False,
                "province_ids": [],
            },
        )
        assert created.status_code == 201, created.text
    response = client.post(
        "/api/v1/auth/login", data=login_form(client, "gap_contractor", password)
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ----- Every lens is a partition -----------------------------------------


def test_every_lens_partitions_a_grid_with_no_owners_in_it():
    """The same property, asserted on the fold itself.

    The endpoint test above runs against seeded data where every province has
    a current ``province_mapping`` row, because startup seeds all 31. This one
    takes the three cases where a cell has no owner at all -- no province, no
    contractor, and a province with no mapping row -- and checks that each
    lens still places every village exactly once.
    """
    grid = {
        (TEHRAN, ALPHA): gaps.Cell(villages=10, ict_stopped=4),
        (ARDABIL, None): gaps.Cell(villages=6, ict_stopped=6),
        (None, BETA): gaps.Cell(villages=3, ict_stopped=1),
        (None, None): gaps.Cell(villages=2, ict_stopped=2),
    }
    # Ardabil is deliberately absent: a province with no current mapping row.
    mapping = {
        TEHRAN: {
            gaps.kpi.LENS_RM: "Allahyar",
            gaps.kpi.LENS_COORDINATOR: "Amir",
            gaps.kpi.LENS_REGION: "North",
        }
    }
    total = sum(cell.ict_stopped for cell in grid.values())

    for lens in gaps.LENSES:
        folded = gaps._fold(
            grid,
            lambda province, contractor, lens=lens: gaps._owner(
                lens, province, contractor, mapping
            ),
        )
        assert sum(cell.ict_stopped for cell in folded.values()) == total, lens
        assert sum(cell.villages for cell in folded.values()) == 21, lens


def test_a_province_with_no_mapping_row_becomes_its_own_row():
    """The ``unmapped`` case, on the function that decides it.

    Every province is given a mapping row at startup, so this is the state a
    reassignment could leave behind rather than one the seed can reach.
    """
    assert gaps._owner("rm", ARDABIL, None, {}) == (gaps.UNMAPPED_LABEL, gaps.UNMAPPED)
    assert gaps._owner("province", ARDABIL, None, {}) == ("Ardabil", gaps.OWNED)


# ----- The coverage map ----------------------------------------------------
#
# Every province by its CPM province, every CRA region by the mapping.

from app.core.province_directory import PROVINCE_DIRECTORY  # noqa: E402


def _map(client, headers):
    response = client.get("/api/v1/gaps/map", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _named(rows, name):
    return next(row for row in rows if row["name"] == name)


def test_pm_gets_every_province_and_every_region(client, actors):
    """All 31 provinces and all 9 regions, keyed by the Persian name the map
    asset is keyed by -- including the 27 with no villages in the seed, which
    read zero rather than disappearing from the map."""
    payload = _map(client, actors["pm"])
    owned = [row for row in payload["provinces"] if row["attribution"] == gaps.OWNED]
    assert {row["key"] for row in owned} == {row.fa for row in PROVINCE_DIRECTORY}
    assert len(owned) == 31

    regions = [row for row in payload["regions"] if row["attribution"] == gaps.OWNED]
    assert {row["name"] for row in regions} == {r.cra_region for r in PROVINCE_DIRECTORY}
    assert len(regions) == 9
    assert sum(len(row["provinces"]) for row in regions) == 31

    qom = _named(payload["provinces"], "Qom")
    assert qom["ict"] == {"stopped": 0, "reached": 0, "rate": None, "low_sample": True}


def test_each_province_carries_its_mapping_region(client, actors):
    region_of = {row.fa: row.cra_region for row in PROVINCE_DIRECTORY}
    for row in _map(client, actors["pm"])["provinces"]:
        if row["key"] is not None:
            assert row["region"] == region_of[row["key"]], row["name"]


# Worked out by hand from _seed: (ICT stopped, ICT reached, CRA stopped,
# CRA reached) per province.
#   Tehran      WI1 10 DT done, 6 ICT, 4 CRA + WI6 4 DT done, 4 ICT, 0 CRA
#   Mazandaran  WI2 8 DT done, 8 ICT, 3 CRA  + WI7 2 DT done, 0 ICT, 2 CRA
#   Ardabil     WI3 6 DT done, 2 ICT, 2 CRA
#   Zanjan      WI4 drive test not done
#   Unknown     WI5 3 DT done, nothing approved
MAP_BY_PROVINCE = {
    "Tehran": (4, 14, 6, 10),
    "Mazandaran": (2, 10, 5, 8),
    "Ardabil": (4, 6, 0, 2),
    "Zanjan": (0, 0, 0, 0),
    "Unknown province": (3, 3, 0, 0),
}


def test_the_province_figures_are_the_hand_worked_ones(client, actors):
    rows = _map(client, actors["pm"])["provinces"]
    for name, expected in MAP_BY_PROVINCE.items():
        row = _named(rows, name)
        got = (
            row["ict"]["stopped"],
            row["ict"]["reached"],
            row["cra"]["stopped"],
            row["cra"]["reached"],
        )
        assert got == expected, name


def test_a_region_is_the_sum_of_its_provinces(client, actors):
    payload = _map(client, actors["pm"])
    by_key = {row["key"]: row for row in payload["provinces"]}
    # The real nine. The "Unknown province" row has no provinces by definition.
    for region in (r for r in payload["regions"] if r["attribution"] == gaps.OWNED):
        for stretch in ("ict", "cra"):
            for counter in ("stopped", "reached"):
                members = sum(by_key[fa][stretch][counter] for fa in region["provinces"])
                assert members == region[stretch][counter], (region["name"], stretch)


def test_the_total_is_the_country_and_the_rows_add_up_to_it(client, actors):
    payload = _map(client, actors["pm"])
    assert payload["total"]["villages"] == COUNTRY_VILLAGES
    assert payload["total"]["ict"]["reached"] == COUNTRY_ICT_REACHED
    assert payload["total"]["ict"]["stopped"] == COUNTRY_ICT_STOPPED
    assert payload["total"]["cra"]["reached"] == COUNTRY_CRA_REACHED
    for rows in (payload["provinces"], payload["regions"]):
        assert sum(r["ict"]["stopped"] for r in rows) == COUNTRY_ICT_STOPPED
        assert sum(r["cra"]["stopped"] for r in rows) == COUNTRY_CRA_STOPPED


def test_villages_with_no_province_are_a_row_not_a_shape(client, actors):
    """They have no province to colour, so their row has no key -- the page
    lists it under the table instead of dropping three villages."""
    unknown = _named(_map(client, actors["pm"])["provinces"], "Unknown province")
    assert unknown["key"] is None
    assert unknown["attribution"] == gaps.UNKNOWN_PROVINCE
    assert unknown["ict"]["stopped"] == 3


def test_low_sample_is_the_kpi_pages_threshold(client, actors):
    payload = _map(client, actors["pm"])
    assert payload["low_sample_threshold"] == gaps.kpi.LOW_SAMPLE_DT_DONE == 10
    # Tehran reached 14 on ICT, Ardabil 6.
    assert _named(payload["provinces"], "Tehran")["ict"]["low_sample"] is False
    assert _named(payload["provinces"], "Ardabil")["ict"]["low_sample"] is True


@pytest.mark.parametrize(
    "actor,provinces,regions",
    [
        # Hossein coordinates Ardabil only.
        ("coordinator", {"Ardabil"}, {"Azar"}),
        # Pirayesh manages Ardabil and Zanjan.
        ("rm", {"Ardabil", "Zanjan"}, {"Azar", "North West"}),
        # DT-Alpha works Tehran, Ardabil and the site with no province.
        (
            "contractor",
            {"Tehran", "Ardabil", "Unknown province"},
            {"North", "Azar", "Unknown province"},
        ),
    ],
)
def test_a_non_pm_sees_only_their_own(client, actors, actor, provinces, regions):
    payload = _map(client, actors[actor])
    assert payload["scoped"] is True
    assert {row["name"] for row in payload["provinces"]} == provinces
    assert {row["name"] for row in payload["regions"]} == regions


def test_a_contractors_figures_are_their_work_items_only(client, actors):
    """Tehran has DT-Alpha's work item (10 villages, 4 ICT stopped) and one
    with no contractor (4 villages). DT-Alpha's Tehran is the first alone."""
    tehran = _named(_map(client, actors["contractor"])["provinces"], "Tehran")
    assert (tehran["ict"]["stopped"], tehran["ict"]["reached"]) == (4, 10)


def test_admin_is_refused_the_map(client, actors):
    response = client.get("/api/v1/gaps/map", headers=actors["admin"])
    assert response.status_code == 403


def test_the_map_asset_has_every_province_and_region_and_nothing_else():
    """``iranMap.json`` is built once by ``scripts/build-iran-map.py`` and
    committed. It must be keyed by exactly the 31 Persian names the API sends,
    carry each province's directory region, and hold exactly the nine regions.
    A mismatch means the asset and province_directory.py have drifted, and a
    province would silently draw with no figures."""
    import json
    from pathlib import Path

    asset = json.loads(
        (
            Path(__file__).resolve().parents[2]
            / "frontend/src/pages/reports/iranMap.json"
        ).read_text(encoding="utf-8")
    )
    assert {fa: p["region"] for fa, p in asset["provinces"].items()} == {
        row.fa: row.cra_region for row in PROVINCE_DIRECTORY
    }
    assert set(asset["regions"]) == {row.cra_region for row in PROVINCE_DIRECTORY}
    assert len(asset["provinces"]) == 31 and len(asset["regions"]) == 9
    for shape in [*asset["provinces"].values(), *asset["regions"].values()]:
        assert shape["path"].startswith("M") and len(shape["label"]) == 2


# ----- The detail panel ---------------------------------------------------
#
# Each province and region carries the Gaps tab's figures (approved, pending,
# remained over the drive-tested base) and, under each lens, the owners
# behind them. All are folds of the overview's grid, so they must add up.

_COUNTERS = ("approved", "base", "pending", "remained")


def _sum_rows(rows, stretch, counter):
    return sum(row[stretch][counter] for row in rows)


def test_every_owner_list_adds_up_to_its_province(client, actors):
    payload = _map(client, actors["pm"])
    problems = []
    for province in payload["provinces"]:
        detail = province["detail"]
        assert set(detail["owners"]) == set(gaps.PROVINCE_DETAIL_LENSES)
        for lens, rows in detail["owners"].items():
            for stretch in ("ict", "cra"):
                for counter in _COUNTERS:
                    if _sum_rows(rows, stretch, counter) != detail[stretch][counter]:
                        problems.append(f"{province['name']}/{lens}/{stretch}/{counter}")
    assert not problems, "\n".join(problems)


def test_every_owner_list_adds_up_to_its_region(client, actors):
    payload = _map(client, actors["pm"])
    problems = []
    for region in payload["regions"]:
        detail = region["detail"]
        assert set(detail["owners"]) == set(gaps.REGION_DETAIL_LENSES)
        for lens, rows in detail["owners"].items():
            for stretch in ("ict", "cra"):
                for counter in _COUNTERS:
                    if _sum_rows(rows, stretch, counter) != detail[stretch][counter]:
                        problems.append(f"{region['name']}/{lens}/{stretch}/{counter}")
    assert not problems, "\n".join(problems)


def test_a_region_detail_is_the_sum_of_its_provinces(client, actors):
    payload = _map(client, actors["pm"])
    by_key = {p["key"]: p for p in payload["provinces"]}
    for region in payload["regions"]:
        if region["attribution"] != gaps.OWNED:
            continue
        for stretch in ("ict", "cra"):
            for counter in _COUNTERS:
                members = sum(by_key[k]["detail"][stretch][counter] for k in region["provinces"])
                assert members == region["detail"][stretch][counter], (region["name"], stretch, counter)


def test_the_details_add_up_to_the_overview(client, actors):
    """The map's panels and the Gaps tab count the same villages."""
    payload = _map(client, actors["pm"])
    overview = client.get("/api/v1/gaps/overview", headers=actors["pm"]).json()
    pending_ict = sum(r["detail"]["ict"]["pending"] for r in payload["regions"])
    assert pending_ict == overview["gaps"]["pending_ict"]["count"]
    cra_remained = sum(r["detail"]["cra"]["remained"] for r in payload["regions"])
    assert cra_remained == overview["gaps"]["cra_remained"]["count"]


def test_a_shape_names_its_regional_managers(client, actors):
    payload = _map(client, actors["pm"])
    tehran = next(p for p in payload["provinces"] if p["key"] == TEHRAN)
    assert tehran["managers"] == ["Allahyar"]
    north = next(r for r in payload["regions"] if r["name"] == "North")
    assert "Allahyar" in north["managers"] and "Nobakht" in north["managers"]


def test_a_region_lists_its_provinces_by_their_persian_key(client, actors):
    payload = _map(client, actors["pm"])
    north = next(r for r in payload["regions"] if r["name"] == "North")
    keys = {row["key"] for row in north["detail"]["owners"]["province"]}
    assert TEHRAN in keys and MAZANDARAN in keys
