"""Lifecycle Gaps overview (``GET /gaps/overview``): the six figures, their
owner rows, and who may see them.

Every expected figure is worked out by hand from ``_seed`` below, so an
assertion never agrees with whatever the code happened to produce. The seed
holds:

* every approval combination (both / ICT only / CRA only / neither) crossed
  with every Mojri standing (in_tracker / not_in_tracker / needs_look / no row),
  with Rejected as well as Pending and NotFiled standing for "not approved";
* the on-air stage in both spellings CPM writes (underscore and space), and a
  drive-tested site that is *not* on air, which cards 1-2 count all the same
  (they use the Acceptance dashboard's universe: هدف + drive test done);
* one village of each kind cards 1-2 must exclude: not هدف, drive test not
  done, soft-deleted village, soft-deleted work item -- the approved
  DT-not-done ones still count on the Mojri card, and one DT-not-done village
  nobody approved is outside the universe altogether;
* a village code that appears on two work items, which counts twice;
* a site with no province and a work item with no DT SC contractor.

Run with:  cd backend && pytest tests/test_gaps_overview.py -q
"""
import os
import sys
from datetime import datetime, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_gaps_overview_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.services import gaps  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

DB_FILE = "/tmp/uep_gaps_overview_pytest.db"

TEHRAN = "تهران"
MAZANDARAN = "مازندران"
ARDABIL = "اردبیل"
ZANJAN = "زنجان"

ALPHA = "DT-Alpha"
BETA = "DT-Beta"

PERM_ONAIR = "راه_اندازی_دائم"
#: The temporary on-air stage as older CPM rows spell it, with spaces.
TEMP_ONAIR_SPACED = "راه اندازی موقت"
DESIGN = "طراحی"

A, P, R, N = "Approved", "Pending", "Rejected", "NotFiled"
IN, OUT, LOOK = "in_tracker", "not_in_tracker", "needs_look"

# Who owns what, from app/core/province_directory.py:
#
#   Tehran      North       Amir     Allahyar
#   Mazandaran  North       Amir     Nobakht
#   Ardabil     Azar        Hossein  Pirayesh
#   Zanjan      North West  Amir     Pirayesh

# ----- The figures the seed produces, worked out by hand -------------------
#
# Cards 1-2 count the Acceptance dashboard's universe: هدف + drive test done,
# on air or not -- WI1-WI5. WI5 (Ardabil, stage طراحی, not on air, drive
# test done: 3 villages, both approved, no tracker row) is in it; before
# cards 1-2 dropped the on-air rule it was not, and eligible read 23, ICT
# approved 13, CRA approved 12. The Mojri card counts every approved هدف
# village, drive test done or not, so it also counts WI6 (Zanjan, drive test
# not done: 2 villages, both approved, no tracker row). WI6's V6-P is neither
# drive-tested nor approved, so it is in no figure at all.
#
#                       WI1  WI2  WI3  WI4  WI5  WI6 | total
#   eligible (DT done)   16    3    2    2    3    0 |   26
#   ICT approved          8    2    2    1    3    0 |   16   (DT done)
#   CRA approved          8    1    2    1    3    0 |   15   (DT done)
#   pending ICT           8    1    0    1    0    0 |   10
#   pending CRA           8    2    0    1    0    0 |   11
#   ICT remained          4    0    0    1    0    0 |    5   (CRA yes, ICT no)
#   CRA remained          4    1    0    1    0    0 |    6   (ICT yes, CRA no)
#   neither               4    1    0    0    0    0 |    5
#   ICT approved (all)    8    2    2    1    3    2 |   18   Mojri card base
#   CRA approved (all)    8    1    2    1    3    2 |   17   Mojri card base
#   ICT in tracker        2    1    0    0    0    0 |    3
#   ICT missing           6    1    2    1    3    2 |   15   (= 18 - 3)
#   ICT needs look        2    0    0    0    0    0 |    2
#   CRA in tracker        2    1    0    1    0    0 |    4
#   CRA missing           6    0    2    0    3    2 |   13   (= 17 - 4)
#   CRA needs look        2    0    0    0    0    0 |    2
#
# Before the Mojri card widened to every approved village its two rows read
# ICT 10 of 13 and CRA 8 of 12: the same figures without WI5 and WI6.
TOTALS = {
    "eligible": 26,
    "ict_approved": 16,
    "cra_approved": 15,
    "ict_approved_all": 18,
    "cra_approved_all": 17,
}
NEITHER = 5
GAPS = {
    "pending_ict": {"count": 10, "base": 26},
    "pending_cra": {"count": 11, "base": 26},
    "ict_remained": {"count": 5, "base": 15},
    "cra_remained": {"count": 6, "base": 16},
    "ict_missing_in_mojri": {"count": 15, "base": 18, "in_tracker": 3, "needs_look": 2},
    "cra_missing_in_mojri": {"count": 13, "base": 17, "in_tracker": 4, "needs_look": 2},
}
#: Cards 1-2's gaps: the figures that must not move when the Mojri card widens.
CARD_ONE_TWO = ("pending_ict", "pending_cra", "ict_remained", "cra_remained")

# Province rows for Pending ICT: Tehran is WI1 + WI4, Mazandaran WI2, and the
# province-less site WI3. Ardabil (WI5) is drive-tested but not on air: in the
# base, nothing pending. Zanjan holds only DT-not-done villages: it is in the
# universe for the Mojri card, so its row is here, reading zero.
PENDING_ICT_BY_PROVINCE = {
    "Tehran": (9, 18),
    "Mazandaran": (1, 3),
    "Unknown province": (0, 2),
    "Ardabil": (0, 3),
    "Zanjan": (0, 0),
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
    from app.models.mojri import MojriImportRun, MojriTrackerStatus
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem

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

        def work_item(site_row, contractor, *, stage=PERM_ONAIR, dt="Done",
                      site_type="A", deleted=False):
            row = WorkItem(
                site_id=site_row.id,
                site_type=site_type,
                requested_technology="2G",
                last_stage=stage,
                dt_status=dt,
                dt_sc_contractor_id=contractor.id if contractor else None,
                current_stage="New",
                deleted_at=datetime.now(timezone.utc) if deleted else None,
            )
            db.add(row)
            db.flush()
            return row

        def village(wi, code, ict=N, cra=N, mojri=None, *, target="هدف",
                    deleted=False):
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
            if mojri is not None:
                ict_m, cra_m = mojri
                db.add(MojriTrackerStatus(
                    village_id=row.id, ict_status=ict_m, cra_status=cra_m,
                ))
            return row

        tehran = site("S-TEH", TEHRAN)

        # WI1. Tehran / Alpha. Every approval combination crossed with every
        # Mojri standing (the same standing for both authorities, or no row).
        # "Not approved" is Rejected here, to prove Rejected counts as not
        # approved.
        wi1 = work_item(tehran, alpha)
        combos = [(A, A), (A, R), (R, A), (R, R)]
        standings = [(IN, IN), (OUT, OUT), (LOOK, LOOK), None]
        for i, (ict, cra) in enumerate(combos):
            for j, mojri in enumerate(standings):
                village(wi1, f"V1-{i}{j}", ict, cra, mojri)
        # Soft-deleted village on an eligible work item: excluded.
        village(wi1, "V1-DEL", A, A, deleted=True)
        # Not a pure target village: excluded.
        village(wi1, "V1-SIDE", A, A, target="هدف جانبی")

        # WI2. Mazandaran / Beta, temporary on-air spelled with spaces.
        wi2 = work_item(site("S-MAZ", MAZANDARAN), beta, stage=TEMP_ONAIR_SPACED)
        village(wi2, "V2-0", A, P)
        village(wi2, "V2-1", A, A, (IN, IN))
        village(wi2, "V2-2", P, P)

        # WI3. No province / Alpha. Both approved, no tracker row: missing
        # from Mojri for both authorities.
        wi3 = work_item(site("S-UNK", None), alpha)
        village(wi3, "V3-0", A, A)
        village(wi3, "V3-1", A, A)

        # WI4. Tehran, second site type, no DT SC contractor. One village is
        # the same village code as one on WI1: it counts again (no
        # de-duplication).
        wi4 = work_item(tehran, None, site_type="B")
        village(wi4, "V4-0", N, A, (OUT, IN))
        village(wi4, "V1-00", A, P, (OUT, OUT))

        # WI5: drive test done but not on air -- on cards 1-2 all the same,
        # as on the Acceptance dashboard. Off cards 1-2: drive test not done
        # (WI6), soft-deleted (WI7); WI6's approved villages still count on
        # the Mojri card.
        wi5 = work_item(site("S-ARD", ARDABIL), alpha, stage=DESIGN)
        for k in range(3):
            village(wi5, f"V5-{k}", A, A)
        wi6 = work_item(site("S-ZAN", ZANJAN), beta, dt="Ongoing")
        for k in range(2):
            village(wi6, f"V6-{k}", A, A)
        # Neither drive-tested nor approved: outside the universe altogether.
        village(wi6, "V6-P", P, R)
        wi7 = work_item(tehran, alpha, site_type="C", deleted=True)
        village(wi7, "V7-0", A, A)

        db.add(MojriImportRun(filename="mojri-1405-06.xlsx"))
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
    admin_h = _admin(client)
    pm = _token(client, "PM")
    rm = _token(client, "RegionalManager")
    coordinator = _token(client, "Coordinator")

    users = client.get("/api/v1/admin/users", headers=admin_h).json()
    by_username = {u["username"]: u for u in users}
    for username, name in (
        ("test_regionalmanager", "Allahyar"),
        ("test_coordinator", "Amir"),
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
    password = "Lifecycle-Alpha-Passw0rd-27"
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": "lifecycle_dt_alpha",
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
        "/api/v1/auth/login",
        data=login_form(client, "lifecycle_dt_alpha", password),
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _overview(client, headers, **params):
    response = client.get("/api/v1/gaps/overview", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


# ----- The universe and the six figures -----------------------------------


def test_the_totals_are_the_hand_worked_ones(client, actors):
    payload = _overview(client, actors["pm"])
    assert payload["totals"] == TOTALS
    assert payload["gaps"] == GAPS


def test_the_identities_hold(client, actors):
    """The three identities the spec names, each checked independently: every
    figure is counted in SQL, none derived from another by subtraction."""
    payload = _overview(client, actors["pm"])
    totals, g = payload["totals"], payload["gaps"]
    eligible = totals["eligible"]

    assert g["pending_ict"]["count"] == g["ict_remained"]["count"] + NEITHER
    assert g["pending_cra"]["count"] == g["cra_remained"]["count"] + NEITHER
    assert totals["ict_approved"] + g["pending_ict"]["count"] == eligible
    assert totals["cra_approved"] + g["pending_cra"]["count"] == eligible
    for authority in ("ict", "cra"):
        key = f"{authority}_missing_in_mojri"
        approved = totals[f"{authority}_approved_all"]
        assert g[key]["count"] + g[key]["in_tracker"] == approved, key


def test_rejected_counts_as_not_approved(client, actors):
    # WI1's 16 villages alone: 8 are ICT-Rejected, and all 8 are pending ICT.
    payload = _overview(client, actors["contractor"])
    # Alpha is WI1 (16) + WI3 (2); WI3 is fully approved.
    assert payload["gaps"]["pending_ict"]["count"] == 8
    assert payload["gaps"]["pending_cra"]["count"] == 8


def _universe_codes(condition=None) -> list[str]:
    """The village codes the overview's universe selects, optionally narrowed
    by one counter's condition -- straight at the query, no role in the way."""
    from sqlalchemy import select

    from app.models.workitem import Village

    db = SessionLocal()
    try:
        stmt = gaps._universe(db, select(Village.village_code))
        if condition is not None:
            stmt = stmt.where(gaps._counter_conditions(db)[condition])
        return sorted(db.execute(stmt).scalars().all())
    finally:
        db.close()


def test_the_universe_is_drive_tested_villages_plus_every_approved_village():
    """Straight at the grid, so no role or scope is in the way."""
    db = SessionLocal()
    try:
        grid = gaps._gap_grid(db)
    finally:
        db.close()
    # Ardabil (drive-tested, not on air) is on cards 1-2; Zanjan (drive test
    # not done) is in the universe only for its approved villages.
    assert {province for province, _ in grid} == {
        TEHRAN, MAZANDARAN, ARDABIL, ZANJAN, None,
    }
    assert sum(cell.eligible for cell in grid.values()) == TOTALS["eligible"]
    by_province = {province: cell for (province, _), cell in grid.items()}
    assert (by_province[ARDABIL].eligible, by_province[ARDABIL].ict_approved_all) == (3, 3)
    assert (by_province[ZANJAN].eligible, by_province[ZANJAN].cra_approved_all) == (0, 2)

    codes = _universe_codes()
    # 26 drive-tested + 2 approved with the drive test not done (WI6).
    assert len(codes) == 28
    # Not هدف, soft-deleted village, soft-deleted work item, and DT not done
    # with no approval: in no figure.
    for excluded in ("V1-SIDE", "V1-DEL", "V7-0", "V6-P"):
        assert excluded not in codes, excluded


def test_drive_tested_villages_off_air_are_on_cards_one_and_two():
    """The Acceptance dashboard's universe has no on-air condition, so neither
    have cards 1-2: WI5's villages (stage طراحی) are eligible and approved.
    Villages whose drive test is not done (WI6) stay off them."""
    eligible = _universe_codes("eligible")
    assert {"V5-0", "V5-1", "V5-2"} <= set(eligible)
    assert {"V5-0", "V5-1", "V5-2"} <= set(_universe_codes("cra_approved"))
    assert not {"V6-0", "V6-1", "V6-P"} & set(eligible)
    assert len(eligible) == TOTALS["eligible"]


def test_the_mojri_card_counts_every_approved_village_on_air_or_not(client, actors):
    """Counted straight from the table, not through any gaps helper: every
    live هدف village the authority approved is the Mojri card's base."""
    from app.models.workitem import Village, WorkItem

    db = SessionLocal()
    try:
        def approved(column) -> int:
            return (
                db.query(Village)
                .join(WorkItem, Village.work_item_id == WorkItem.id)
                .filter(
                    Village.deleted_at.is_(None),
                    WorkItem.deleted_at.is_(None),
                    Village.target_classification == "هدف",
                    column == A,
                )
                .count()
            )

        ict_all, cra_all = approved(Village.ict_status), approved(Village.cra_status)
    finally:
        db.close()

    payload = _overview(client, actors["pm"])
    totals, g = payload["totals"], payload["gaps"]
    assert g["ict_missing_in_mojri"]["base"] == ict_all == totals["ict_approved_all"]
    assert g["cra_missing_in_mojri"]["base"] == cra_all == totals["cra_approved_all"]
    # The seed has approved villages off air, so the widening is visible.
    assert totals["ict_approved_all"] > totals["ict_approved"]
    assert totals["cra_approved_all"] > totals["cra_approved"]


def test_the_template_lists_exactly_the_villages_the_mojri_card_compares():
    """The Mojri template and the Mojri card share one definition
    (``mojri_tracker.comparison_scope``); this holds them equal."""
    from sqlalchemy import or_, select

    from app.models.workitem import Village
    from app.services import mojri_tracker

    db = SessionLocal()
    try:
        template = {village.id for village in mojri_tracker.eligible_villages(db)}
        conditions = gaps._counter_conditions(db)
        card = set(
            db.execute(
                gaps._universe(db, select(Village.id)).where(
                    or_(conditions["ict_approved_all"], conditions["cra_approved_all"])
                )
            ).scalars().all()
        )
    finally:
        db.close()
    assert template == card
    assert template, "the seed should give the template rows"


def test_cards_one_and_two_are_unchanged_by_the_wider_universe(client, actors):
    """Widening the universe for the Mojri card must not move cards 1-2: the
    figures below are the hand-worked ones from before the change."""
    payload = _overview(client, actors["pm"])
    assert payload["totals"]["eligible"] == TOTALS["eligible"]
    assert payload["totals"]["ict_approved"] == TOTALS["ict_approved"]
    assert payload["totals"]["cra_approved"] == TOTALS["cra_approved"]
    for key in CARD_ONE_TWO:
        assert payload["gaps"][key] == GAPS[key], key


def test_a_repeated_village_code_counts_twice(client, actors):
    # V1-00 is on WI1 and WI4. Tehran's eligible base is 16 + 2 = 18, which
    # only holds if the second one is counted.
    rows = _overview(client, actors["pm"], lens="province")["rows"]["pending_ict"]
    tehran = next(row for row in rows if row["name"] == "Tehran")
    assert tehran["base"] == 18


def test_cra_approved_without_ict_is_no_longer_a_data_quality_note(client, actors):
    payload = _overview(client, actors["pm"])
    assert "cra_approved_without_ict" not in payload["data_quality"]
    assert payload["data_quality"] == {
        "villages_without_province": 2,
        "unmapped_provinces": [],
    }


def test_last_mojri_import_is_reported(client, actors):
    assert _overview(client, actors["pm"])["last_mojri_import"] is not None


# ----- Rows ---------------------------------------------------------------


@pytest.mark.parametrize("lens", gaps.LENSES)
def test_every_lens_sums_to_every_gap(client, actors, lens):
    payload = _overview(client, actors["pm"], lens=lens)
    assert payload["lens"] == lens
    problems = []
    for key in gaps.GAP_KEYS:
        rows = payload["rows"][key]
        total = payload["gaps"][key]
        count = sum(row["count"] for row in rows)
        base = sum(row["base"] for row in rows)
        if count != total["count"] or base != total["base"]:
            problems.append(
                f"{lens}/{key}: rows give {count} of {base}, "
                f"total is {total['count']} of {total['base']}"
            )
    assert not problems, "\n".join(problems)


def test_province_rows_are_the_hand_worked_ones(client, actors):
    rows = _overview(client, actors["pm"], lens="province")["rows"]["pending_ict"]
    assert {row["name"]: (row["count"], row["base"]) for row in rows} == (
        PENDING_ICT_BY_PROVINCE
    )
    unknown = next(row for row in rows if row["name"] == "Unknown province")
    assert unknown["attribution"] == gaps.UNKNOWN_PROVINCE


def test_rows_are_sorted_by_count_then_name(client, actors):
    for lens in gaps.LENSES:
        rows = _overview(client, actors["pm"], lens=lens)["rows"]
        for key, owner_rows in rows.items():
            order = [(-row["count"], row["name"]) for row in owner_rows]
            assert order == sorted(order), f"{lens}/{key}"


def test_a_work_item_with_no_contractor_is_an_unassigned_row(client, actors):
    rows = _overview(client, actors["pm"], lens="contractor")["rows"]["pending_ict"]
    unassigned = next(row for row in rows if row["name"] == "Unassigned")
    assert unassigned["attribution"] == gaps.UNASSIGNED
    assert (unassigned["count"], unassigned["base"]) == (1, 2)


# ----- Who sees what ------------------------------------------------------


def test_pm_defaults_to_province_and_may_switch_every_lens(client, actors):
    payload = _overview(client, actors["pm"])
    assert payload["lens"] == "province"
    assert payload["scoped"] is False
    assert [lens["key"] for lens in payload["lenses"]] == list(gaps.LENSES)
    for lens in gaps.LENSES:
        assert _overview(client, actors["pm"], lens=lens)["lens"] == lens


def test_admin_is_refused(client, actors):
    response = client.get("/api/v1/gaps/overview", headers=actors["admin"])
    assert response.status_code == 403


# Own figures, worked out by hand:
#   RM Allahyar       -> Tehran                   = WI1 + WI4
#   Coordinator Amir  -> Tehran+Mazandaran+Zanjan = WI1 + WI2 + WI4 + WI6
#   Contractor Alpha  -> WI1 + WI3 + WI5
# Eligible and pending ICT are drive-tested only: WI5 adds 3 eligible (none
# pending) to Alpha, WI6 adds nothing to Amir.
# CRA missing in Mojri counts every approved village:
#   Allahyar  6 (WI1) + 0 (WI4)                     =  6
#   Amir      6 (WI1) + 0 (WI2) + 0 (WI4) + 2 (WI6) =  8
#   Alpha     6 (WI1) + 2 (WI3) + 3 (WI5)           = 11
@pytest.mark.parametrize(
    "actor, lens, own, eligible, pending_ict, cra_missing",
    [
        ("rm", "rm", "Allahyar", 18, 9, 6),
        ("coordinator", "coordinator", "Amir", 21, 10, 8),
        ("contractor", "contractor", ALPHA, 21, 8, 11),
    ],
)
def test_a_non_pm_gets_only_their_own_figures(
    client, actors, actor, lens, own, eligible, pending_ict, cra_missing
):
    payload = _overview(client, actors[actor])
    assert payload["scoped"] is True
    assert payload["lens"] == lens
    assert payload["key"] == own
    assert payload["lenses"] == [{"key": lens, "label": gaps.LENS_LABELS[lens]}]
    assert payload["totals"]["eligible"] == eligible
    assert payload["gaps"]["pending_ict"]["count"] == pending_ict
    assert payload["gaps"]["cra_missing_in_mojri"]["count"] == cra_missing
    for key in gaps.GAP_KEYS:
        rows = payload["rows"][key]
        assert [row["name"] for row in rows] == [own], key
        assert rows[0]["count"] == payload["gaps"][key]["count"], key
        assert rows[0]["base"] == payload["gaps"][key]["base"], key


@pytest.mark.parametrize(
    "actor, lens",
    [
        ("rm", "province"),
        ("rm", "coordinator"),
        ("coordinator", "rm"),
        ("contractor", "region"),
    ],
)
def test_a_non_pm_asking_for_another_lens_is_refused(client, actors, actor, lens):
    response = client.get(
        "/api/v1/gaps/overview", headers=actors[actor], params={"lens": lens}
    )
    assert response.status_code == 403


def test_a_non_pm_asking_for_their_own_lens_gets_it(client, actors):
    payload = _overview(client, actors["rm"], lens="rm")
    assert payload["key"] == "Allahyar"


def test_a_key_sent_by_the_client_is_ignored(client, actors):
    # The endpoint takes no key. Sending one changes nothing.
    payload = _overview(client, actors["rm"], key="Pirayesh")
    assert payload["key"] == "Allahyar"


@pytest.mark.parametrize("lens", ["country", "", "PROVINCE", "rm;drop"])
def test_an_unknown_lens_is_refused(client, actors, lens):
    response = client.get(
        "/api/v1/gaps/overview", headers=actors["pm"], params={"lens": lens}
    )
    assert response.status_code == 422


def test_the_coverage_map_is_unchanged_by_the_on_air_rule(client, actors):
    """The map keeps its own counting: Ardabil's off-air villages still count
    as drive-test-done there."""
    response = client.get("/api/v1/gaps/map", headers=actors["pm"])
    assert response.status_code == 200, response.text
    ardabil = next(p for p in response.json()["provinces"] if p["key"] == ARDABIL)
    assert ardabil["ict"]["reached"] == 3


def test_coordinator_rows_name_their_regional_managers(client, actors):
    """Every manager over any province Amir coordinates, from the directory
    that seeds the mapping -- not only the provinces with villages here."""
    from app.core.province_directory import PROVINCE_DIRECTORY

    expected = sorted({p.regional_manager for p in PROVINCE_DIRECTORY if p.pso_coordinator == "Amir"})
    assert {"Allahyar", "Nobakht", "Pirayesh"} <= set(expected)
    rows = _overview(client, actors["pm"], lens="coordinator")["rows"]["pending_ict"]
    amir = next(row for row in rows if row["name"] == "Amir")
    assert amir["managers"] == expected
    unknown = next(row for row in rows if row["attribution"] == gaps.UNKNOWN_PROVINCE)
    assert unknown["managers"] == []


def test_other_lenses_carry_no_managers(client, actors):
    rows = _overview(client, actors["pm"], lens="province")["rows"]["pending_ict"]
    assert all("managers" not in row for row in rows)
