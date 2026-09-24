"""Gap & Performance road view: the numbers, and who may see them.

The most important test in this file is
:func:`test_every_lens_sums_back_to_the_country_total`. A design preview of this
page put a country figure of 2,570 next to an owner list adding up to 445,
because two of the five lenses were built from a different query than the rest.
That is the bug this endpoint is shaped to make impossible, so the parity check
runs for every lens against every stretch and, when it fails, says which lens,
which stretch, and by how much -- a bare ``assert a == b`` here would tell
whoever broke it almost nothing.

The dataset below is small and every expected figure is worked out by hand in
``_seed``, so an assertion never agrees with whatever the code happened to
produce. It deliberately contains the four cases that make the sums hard:

* a site whose CPM province cell matched none of the 31 (no province, so no
  regional manager, coordinator or CRA region either),
* a work item with no DT SC contractor,
* a province whose drive tests are not done, so it has reached nothing,
* villages CRA-approved with no ICT approval, which the road's ordering says
  should not exist and which nothing in the platform prevents.

Run with:  cd backend && pytest tests/test_gaps_road.py -q
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

# The same 13 villages, regrouped. Each of these lists must add to
# COUNTRY_ICT_STOPPED -- that is the property the page claims.
ICT_STOPPED_BY_LENS = {
    "province": {
        "Tehran": 4,
        "Mazandaran": 2,
        "Ardabil": 4,
        "Zanjan": 0,
        "Unknown province": 3,
    },
    "contractor": {ALPHA: 11, BETA: 2, "Unassigned": 0},
    "rm": {"Allahyar": 4, "Nobakht": 2, "Pirayesh": 4, "Unknown province": 3},
    "coordinator": {"Amir": 6, "Hossein": 4, "Unknown province": 3},
    "region": {
        "North": 6,
        "Azar": 4,
        "North West": 0,
        "Unknown province": 3,
    },
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


def _villages(db, work_item_id, count, *, ict_approved=0, cra_approved=0):
    """``count`` target villages on one work item.

    The first ``ict_approved`` are ICT-approved and the first ``cra_approved``
    are CRA-approved, so CRA approval is a subset of ICT approval unless a test
    asks for otherwise -- which is the ordering the road assumes.
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
    """Seven work items, one per situation the road has to place somewhere."""
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
        #    ICT stopped 0, CRA stopped 5 -- the biggest single gap on the CRA
        #    stretch, which is what makes the Pareto order worth checking.
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
        #    ICT approval. The road says ICT precedes CRA; the platform does
        #    not enforce it, because the two authorities are parallel.
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


def _road(client, headers, **params):
    response = client.get("/api/v1/gaps/road", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _stretch(payload, key):
    return next(s for s in payload["stretches"] if s["key"] == key)


# ----- The test this endpoint exists to pass ------------------------------


def test_every_lens_sums_back_to_the_country_total(client, actors):
    """Every lens must be a partition of the same villages.

    Five lenses, four stretches, two counters. Any regrouping that loses a
    village, counts one twice, or is built from a second query shows up here.
    The failure message names the lens, the stretch, the counter and the size
    of the discrepancy, because "13 != 10" on its own sends whoever broke it
    looking in the wrong place.
    """
    for lens in gaps.LENSES:
        payload = _road(client, actors["pm"], lens=lens)
        for stretch in payload["stretches"]:
            for counter in ("stopped", "reached"):
                owners = sum(owner[counter] for owner in stretch["owners"])
                country = stretch["country"][counter]
                assert owners == country, (
                    f"lens {lens!r}, stretch {stretch['key']!r}: the owner rows "
                    f"{counter} sum to {owners} but the country total says "
                    f"{country} -- a difference of {country - owners}. Every "
                    f"lens must be a regrouping of the same villages, so this "
                    f"means the owner rows and the country figure no longer "
                    f"come from one query."
                )


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


# ----- The figures themselves --------------------------------------------


def test_the_country_figures_are_the_hand_worked_ones(client, actors):
    payload = _road(client, actors["pm"], lens="province")
    assert payload["country_villages"] == COUNTRY_VILLAGES

    ict = _stretch(payload, "ict")["country"]
    assert ict["reached"] == COUNTRY_ICT_REACHED
    assert ict["stopped"] == COUNTRY_ICT_STOPPED
    # 13 / 33 = 39.39…
    assert ict["rate"] == 39.4

    cra = _stretch(payload, "cra")["country"]
    assert cra["reached"] == COUNTRY_CRA_REACHED
    assert cra["stopped"] == COUNTRY_CRA_STOPPED
    # 11 / 20
    assert cra["rate"] == 55.0


@pytest.mark.parametrize("lens", sorted(ICT_STOPPED_BY_LENS))
def test_each_lens_reports_the_owners_it_should(client, actors, lens):
    payload = _road(client, actors["pm"], lens=lens)
    owners = _stretch(payload, "ict")["owners"]
    assert {o["name"]: o["stopped"] for o in owners} == ICT_STOPPED_BY_LENS[lens]


def test_the_owner_list_is_sorted_by_stopped_descending(client, actors):
    owners = _stretch(_road(client, actors["pm"], lens="province"), "ict")["owners"]
    counts = [owner["stopped"] for owner in owners]
    assert counts == sorted(counts, reverse=True)
    assert owners[0]["name"] in ("Tehran", "Ardabil")  # both stopped 4
    assert owners[0]["stopped"] == 4


def test_a_rate_is_the_stop_rate_and_carries_its_own_fraction(client, actors):
    owners = _stretch(_road(client, actors["pm"], lens="province"), "ict")["owners"]
    ardabil = next(o for o in owners if o["name"] == "Ardabil")
    assert ardabil["stopped"] == 4
    assert ardabil["reached"] == 6
    # 4 of 6 reached, so 66.7% -- and the two counts travel with it, because
    # the page never shows a rate without the fraction it came from.
    assert ardabil["rate"] == 66.7


def test_an_owner_with_nothing_on_a_stretch_keeps_its_row(client, actors):
    """Zanjan is on air with no drive test finished: it has reached nothing.

    The row must be there and must read no rate. Dropping it would say "this
    province has no gap" when the truth is "nothing here has got as far as the
    stretch yet", and it would also break the sum above.
    """
    owners = _stretch(_road(client, actors["pm"], lens="province"), "ict")["owners"]
    zanjan = next(o for o in owners if o["name"] == "Zanjan")
    assert (zanjan["stopped"], zanjan["reached"], zanjan["rate"]) == (0, 0, None)
    assert zanjan["villages"] == 5


def test_villages_nobody_owns_are_named_and_flagged(client, actors):
    """Three villages with no province and four with no contractor are rows of
    their own, carrying why -- not dropped, and not folded into a real owner."""
    by_lens = {
        lens: {
            owner["name"]: owner["attribution"]
            for owner in _stretch(_road(client, actors["pm"], lens=lens), "ict")[
                "owners"
            ]
        }
        for lens in ("province", "rm", "contractor")
    }
    assert by_lens["province"]["Unknown province"] == gaps.UNKNOWN_PROVINCE
    assert by_lens["rm"]["Unknown province"] == gaps.UNKNOWN_PROVINCE
    assert by_lens["contractor"]["Unassigned"] == gaps.UNASSIGNED
    assert by_lens["province"]["Tehran"] == gaps.OWNED


def test_a_province_with_no_mapping_row_becomes_its_own_row():
    """The ``unmapped`` case, on the function that decides it.

    Every province is given a mapping row at startup, so this is the state a
    reassignment could leave behind rather than one the seed can reach.
    """
    assert gaps._owner("rm", ARDABIL, None, {}) == (gaps.UNMAPPED_LABEL, gaps.UNMAPPED)
    assert gaps._owner("province", ARDABIL, None, {}) == ("Ardabil", gaps.OWNED)


# ----- What the page must not hide about its own inputs -------------------


def test_cra_approved_without_ict_is_counted_and_placed(client, actors):
    """Two villages are CRA-approved with no ICT approval.

    The road assumes ICT precedes CRA and nothing enforces it, so the count is
    reported on every load. Those two villages are stopped on the ICT stretch
    -- which is what they are -- and have not reached the CRA stretch, so they
    are on the road exactly once rather than counted twice or nowhere.
    """
    payload = _road(client, actors["pm"], lens="province")
    assert payload["data_quality"]["cra_approved_without_ict"] == 2

    owners = _stretch(payload, "ict")["owners"]
    mazandaran = next(o for o in owners if o["name"] == "Mazandaran")
    assert mazandaran["stopped"] == 2

    cra_owners = _stretch(payload, "cra")["owners"]
    cra_mazandaran = next(o for o in cra_owners if o["name"] == "Mazandaran")
    # 8 ICT-approved reached the CRA stretch; the 2 CRA-without-ICT did not.
    assert cra_mazandaran["reached"] == 8


def test_data_quality_reports_the_three_assumptions(client, actors):
    quality = _road(client, actors["pm"], lens="province")["data_quality"]
    assert quality["villages_without_province"] == 3
    assert quality["villages_without_contractor"] == 4
    # Startup opens a mapping row for all 31, so nothing is unmapped here.
    assert quality["unmapped_provinces"] == []


# ----- The two stretches that are not built yet ---------------------------


@pytest.mark.parametrize("key", ["tracker", "dep"])
def test_the_tracker_stretches_report_nothing_rather_than_a_guess(client, actors, key):
    """Both read a table that does not exist yet.

    They are drawn on the road and report zero. Counting every CRA-approved
    village as "not in the tracker" because there is no tracker to look in
    would put a confident, large, wrong number on the page.
    """
    stretch = _stretch(_road(client, actors["pm"], lens="coordinator"), key)
    assert stretch["available"] is False
    assert stretch["owners"] == []
    assert stretch["country"] == {"stopped": 0, "reached": 0, "rate": None}
    assert stretch["pending"]


# ----- Who may see what --------------------------------------------------


def test_admin_is_refused(client, actors):
    response = client.get(
        "/api/v1/gaps/road", headers=actors["admin"], params={"lens": "province"}
    )
    assert response.status_code == 403


@pytest.mark.parametrize(
    "actor,lens,own",
    [
        ("coordinator", "coordinator", "Hossein"),
        ("rm", "rm", "Pirayesh"),
        ("contractor", "contractor", ALPHA),
    ],
)
def test_a_non_pm_receives_its_own_row_and_no_other(client, actors, actor, lens, own):
    payload = _road(client, actors[actor], lens=lens)
    assert payload["selectable"] is False
    assert payload["scoped"] is True
    assert payload["key"] == own

    for stretch in payload["stretches"]:
        names = [owner["name"] for owner in stretch["owners"]]
        assert names in ([own], []), names

    # The country total is still there, and is still the whole country: it is
    # an aggregate of 31 provinces, it identifies nobody, and "% of gap"
    # cannot be computed without it.
    assert _stretch(payload, "ict")["country"]["stopped"] == COUNTRY_ICT_STOPPED


@pytest.mark.parametrize(
    "actor,lens",
    [
        ("coordinator", "rm"),
        ("coordinator", "province"),
        ("rm", "coordinator"),
        ("contractor", "province"),
        ("contractor", "region"),
    ],
)
def test_a_non_pm_asking_for_another_lens_is_refused(client, actors, actor, lens):
    """403 rather than a substitution. A page headed with somebody else's lens
    and filled with this account's numbers would be believed."""
    response = client.get(
        "/api/v1/gaps/road", headers=actors[actor], params={"lens": lens}
    )
    assert response.status_code == 403


def test_pm_may_switch_every_lens(client, actors):
    for lens in gaps.LENSES:
        payload = _road(client, actors["pm"], lens=lens)
        assert payload["selectable"] is True
        assert payload["scoped"] is False


# ----- The query string --------------------------------------------------


def test_one_stretch_can_be_asked_for_on_its_own(client, actors):
    payload = _road(client, actors["pm"], lens="province", stretch="cra")
    assert [s["key"] for s in payload["stretches"]] == ["cra"]
    assert _stretch(payload, "cra")["country"]["stopped"] == COUNTRY_CRA_STOPPED


def test_all_four_stretches_come_back_in_road_order(client, actors):
    payload = _road(client, actors["pm"], lens="province")
    assert [s["key"] for s in payload["stretches"]] == ["ict", "cra", "tracker", "dep"]


@pytest.mark.parametrize(
    "params",
    [{"lens": "nonsense"}, {"lens": "province", "stretch": "nonsense"}, {}],
)
def test_a_lens_or_stretch_that_does_not_exist_is_refused(client, actors, params):
    response = client.get("/api/v1/gaps/road", headers=actors["pm"], params=params)
    assert response.status_code == 422
