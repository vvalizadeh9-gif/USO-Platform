"""Roles Performance (Month and Area): the definitions, the same-day
comparison, ownership at the time, access, and exports.

"Today" is pinned to 10 Mehr 1405, so every window below is fixed. The
dataset is small and every expected figure names its arithmetic:

    site  province    contractor  on air       DT done     villages
    T1    Tehran      Alpha       1405/07/01   1405/07/03  12
    M1    Mazandaran  Beta        1405/06/02   1405/06/08  10
    A1    Ardabil     Alpha       1405/06/25*  1405/06/20  10
    Z1    Zanjan      Beta        1404/12/01   -            4
    U1    (unknown)   (none)      no date      1405/07/02   2
    (* typed Shamsi text only)

Tehran changes regional manager on 1405/07/03, from Allahyar to Karimi: T1
went on air under Allahyar and finished its drive test under Karimi.

Run with:  cd backend && pytest tests/test_roles_performance.py -q
"""
import os
import sys
from datetime import date, datetime, time, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_roles_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

DB_FILE = "/tmp/uep_roles_pytest.db"
TODAY = jalali.from_shamsi_date(1405, 7, 10)

TEHRAN, MAZANDARAN, ARDABIL, ZANJAN = "تهران", "مازندران", "اردبیل", "زنجان"
ALPHA, BETA = "RP-Alpha", "RP-Beta"
ON_AIR = "راه_اندازی_دائم"
NEW_RM = "Karimi"


def sh(year: int, month: int, day: int) -> date:
    return jalali.from_shamsi_date(year, month, day)


def at(year: int, month: int, day: int, hour: int = 12) -> datetime:
    """Noon in Tehran on a Shamsi day, as an aware UTC timestamp."""
    local = datetime.combine(sh(year, month, day), time(hour), tzinfo=jalali.TEHRAN)
    return local.astimezone(timezone.utc)


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(jalali, "tehran_today", lambda: TODAY)


@pytest.fixture(scope="module")
def client():
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


# ----- Accounts --------------------------------------------------------------


def _admin(client) -> dict:
    response = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {response.cookies['uep_session']}"}


def _token(client, role: str) -> dict:
    return login_as_role(client, _admin(client)["Authorization"].split()[1], role)


def _user_id(client, admin_h, username: str) -> int:
    users = client.get("/api/v1/admin/users", headers=admin_h).json()
    return next(u["id"] for u in users if u["username"] == username)


def _contractor_account(client, admin_h, contractor_id: int) -> dict:
    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Contractor")
    password = "Roles-Perf-Passw0rd"
    created = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": "rp_contractor", "password": password,
            "first_name": "Rp", "family_name": "Contractor", "role_id": role_id,
            "contractor_id": contractor_id, "sees_all_provinces": False,
            "province_ids": [],
        },
    )
    assert created.status_code == 201, created.text
    response = client.post(
        "/api/v1/auth/login", data=login_form(client, "rp_contractor", password)
    )
    return {"Authorization": f"Bearer {response.cookies['uep_session']}"}


@pytest.fixture(scope="module")
def actors(client):
    admin_h = _admin(client)
    pm = _token(client, "PM")
    viewer = _token(client, "Viewer")
    rm = _token(client, "RegionalManager")
    coordinator = _token(client, "Coordinator")
    for username, name in (("test_regionalmanager", "Nobakht"), ("test_coordinator", "Amir")):
        response = client.put(
            f"/api/v1/kpi/mapping/links/{_user_id(client, admin_h, username)}",
            headers=pm, json={"kpi_person_name": name},
        )
        assert response.status_code == 200, response.text

    ids = _seed(
        contractor_user=None,
        coordinator_user=_user_id(client, admin_h, "test_coordinator"),
    )
    contractor = _contractor_account(client, admin_h, ids["alpha"])
    return {
        "admin": admin_h, "pm": pm, "viewer": viewer, "rm": rm,
        "coordinator": coordinator, "contractor": contractor,
    }


# ----- Data ------------------------------------------------------------------


def _seed(contractor_user, coordinator_user) -> dict:
    from app.models.health_check import HcAssignment, HcTask
    from app.models.kpi import ProvinceMapping
    from app.models.reference import Contractor, Province
    from app.models.workitem import Site, Village, WorkItem
    from app.services import kpi_mapping

    db = SessionLocal()
    try:
        provinces = {
            p.name: p for p in db.query(Province).filter(
                Province.name.in_([TEHRAN, MAZANDARAN, ARDABIL, ZANJAN])
            )
        }
        alpha = Contractor(name=ALPHA, type="drive_test")
        beta = Contractor(name=BETA, type="drive_test")
        db.add_all([alpha, beta])
        db.flush()

        def work_item(code, province, contractor, *, launch=None, launch_text=None,
                      dt=None, on_air=True):
            site = Site(site_code=code,
                        province_id=provinces[province].id if province else None)
            db.add(site)
            db.flush()
            wi = WorkItem(
                site_id=site.id, site_type="A", requested_technology="2G",
                last_stage=ON_AIR if on_air else "Site Survey",
                launch_date_gregorian=launch, launch_date_shamsi=launch_text,
                dt_status="Done" if dt else "Ongoing", dt_date_gregorian=dt,
                dt_sc_contractor_id=contractor.id if contractor else None,
                current_stage="New",
            )
            db.add(wi)
            db.flush()
            return wi

        def villages(wi, count):
            made = [
                Village(work_item_id=wi.id, village_code=f"{wi.id}-{i}",
                        target_classification="هدف")
                for i in range(count)
            ]
            db.add_all(made)
            db.flush()
            return made

        t1 = work_item("T1", TEHRAN, alpha, launch=sh(1405, 7, 1), dt=sh(1405, 7, 3))
        m1 = work_item("M1", MAZANDARAN, beta, launch=sh(1405, 6, 2), dt=sh(1405, 6, 8))
        a1 = work_item("A1", ARDABIL, alpha, launch_text="1405/06/25", dt=sh(1405, 6, 20))
        z1 = work_item("Z1", ZANJAN, beta, launch=sh(1404, 12, 1))
        u1 = work_item("U1", None, None, dt=sh(1405, 7, 2))
        tv = villages(t1, 12)
        mv = villages(m1, 10)
        villages(a1, 10)
        villages(z1, 4)
        villages(u1, 2)

        # Approvals are dated by the validated round's reviewed_at.
        _approve(db, tv[0], "ICT", filed=at(1405, 7, 5), reviewed=at(1405, 7, 7),
                 by=contractor_user, reviewer=coordinator_user)
        _approve(db, tv[1], "ICT", filed=at(1405, 7, 5), reviewed=at(1405, 7, 7),
                 by=contractor_user, reviewer=coordinator_user)
        _approve(db, tv[2], "ICT", filed=at(1405, 7, 5), reviewed=at(1405, 7, 7),
                 by=contractor_user, reviewer=coordinator_user)
        # tv[0] is fully approved on the later of the two: 1405/07/08.
        _approve(db, tv[0], "CRA", filed=at(1405, 7, 5), reviewed=at(1405, 7, 8),
                 by=contractor_user, reviewer=coordinator_user)
        # Mazandaran's five approvals are from Shahrivar: before recording began.
        for village in mv[:5]:
            _approve(db, village, "ICT", filed=at(1405, 6, 3), reviewed=at(1405, 6, 5),
                     by=None, reviewer=coordinator_user)

        # Health checks: counted at confirmation (reviewed_at).
        assignment = HcAssignment(code="HC-RP", contractor_id=alpha.id,
                                  assigned_at=at(1405, 6, 1))
        db.add(assignment)
        db.flush()

        def hc(wi, result, completed, reviewed, round_no=1):
            db.add(HcTask(hc_assignment_id=assignment.id, work_item_id=wi.id,
                          round_no=round_no, overall_result=result,
                          completed_at=completed, reviewed_at=reviewed))

        # T1: submitted in Shahrivar, confirmed in Mehr -> a Mehr event.
        hc(t1, "Ready", at(1405, 6, 30), at(1405, 7, 6))
        db.flush()
        # M1 is in a second assignment (one task per site per assignment).
        second = HcAssignment(code="HC-RP2", contractor_id=beta.id, assigned_at=at(1405, 6, 1))
        third = HcAssignment(code="HC-RP3", contractor_id=beta.id, assigned_at=at(1405, 6, 1))
        db.add_all([second, third])
        db.flush()
        db.add(HcTask(hc_assignment_id=second.id, work_item_id=m1.id, overall_result="Ready",
                      completed_at=at(1405, 7, 1), reviewed_at=at(1405, 7, 2)))
        db.add(HcTask(hc_assignment_id=third.id, work_item_id=m1.id, round_no=2,
                      overall_result="NotReady", completed_at=at(1405, 7, 6),
                      reviewed_at=at(1405, 7, 7)))
        db.add(HcTask(hc_assignment_id=second.id, work_item_id=z1.id,
                      overall_result="NotReady", completed_at=at(1405, 6, 31),
                      reviewed_at=at(1405, 7, 1)))
        db.add(HcTask(hc_assignment_id=third.id, work_item_id=z1.id, round_no=2,
                      overall_result="Ready", completed_at=at(1405, 7, 8),
                      reviewed_at=at(1405, 7, 9)))

        # Tehran changes regional manager on 1405/07/03. The seed row opened
        # "today" (the real clock); move it back so the handover is possible.
        row = db.query(ProvinceMapping).filter(
            ProvinceMapping.province_fa == TEHRAN, ProvinceMapping.effective_to.is_(None)
        ).one()
        row.effective_from = date(2025, 1, 1)
        db.flush()
        kpi_mapping.reassign(db, row, cra_region=row.cra_region,
                             pso_coordinator=row.pso_coordinator,
                             regional_manager=NEW_RM, effective_from=sh(1405, 7, 3))
        db.commit()
        return {"alpha": alpha.id, "beta": beta.id, "t1_villages": [v.id for v in tv]}
    finally:
        db.close()


def _approve(db, village, authority, *, filed, reviewed, by, reviewer):
    from app.models.acceptance_workflow import (
        AcceptanceSubmission,
        AcceptanceSubmissionTech,
    )

    submission = AcceptanceSubmission(
        village_id=village.id, authority=authority, round_no=1,
        letter_number=f"L-{village.id}-{authority}", source="Contractor",
        review_status="Validated", submitted_by=by, submitted_at=filed,
        reviewed_by=reviewer, reviewed_at=reviewed,
    )
    submission.technologies = [AcceptanceSubmissionTech(technology="2G", claimed_status="Approved")]
    db.add(submission)
    setattr(village, f"{authority.lower()}_status", "Approved")
    db.flush()


# ----- Helpers ---------------------------------------------------------------


def _get(client, headers, path, status=200, **params):
    response = client.get(f"/api/v1/kpi/{path}", headers=headers, params=params)
    assert response.status_code == status, response.text
    return response.json() if status == 200 else response


def _row(payload, key):
    for section in payload["sections"]:
        for row in section["rows"]:
            if row["key"] == key:
                return row
    raise KeyError(key)


def _owner_now(row, name):
    """An owner's count this month; 0 when they are not listed (nothing in
    either window)."""
    return next((o["now"] for o in row["owners"] if o["name"] == name), 0)


# ----- Periods: the same-day comparison ----------------------------------------


def test_running_month_is_cut_at_the_same_day():
    from app.services.performance.periods import ShamsiMonth, compare

    pair = compare(ShamsiMonth(1405, 7), TODAY)
    assert pair.day == 10
    assert (pair.now.start, pair.now.end) == (sh(1405, 7, 1), sh(1405, 7, 11))
    assert (pair.ref.start, pair.ref.end) == (sh(1405, 6, 1), sh(1405, 6, 11))


def test_a_shorter_previous_month_caps_the_day():
    from app.services.performance.periods import ShamsiMonth, compare

    # 31 Farvardin 1405 against Esfand 1404, which has 29 days.
    today = sh(1405, 1, 31)
    pair = compare(ShamsiMonth(1405, 1), today)
    assert pair.day == 31
    assert jalali.days_in_month(1404, 12) == 29
    assert (pair.ref.start, pair.ref.end) == (sh(1404, 12, 1), sh(1405, 1, 1))


def test_a_closed_month_is_compared_whole_against_whole():
    from app.services.performance.periods import ShamsiMonth, compare

    pair = compare(ShamsiMonth(1405, 6), TODAY)
    assert not pair.running
    assert (pair.now.start, pair.now.end) == (sh(1405, 6, 1), sh(1405, 7, 1))
    assert (pair.ref.start, pair.ref.end) == (sh(1405, 5, 1), sh(1405, 6, 1))


def test_a_future_month_is_refused(client, actors):
    _get(client, actors["pm"], "month", status=422, month="1405-08")


# ----- Definitions --------------------------------------------------------------


def test_month_counts_each_measure_at_its_own_event(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07")
    assert p["day"] == 10 and p["running"] is True
    # DT done: T1 (07/03) and U1 (07/02) in Mehr 1-10; M1 (06/08) in Shahrivar 1-10.
    # A1 (06/20) is after the same-day cut, so it is not in the reference.
    dt = _row(p, "dt_done")
    assert (dt["now"], dt["ref"], dt["delta"]) == (2, 1, 1)
    assert (dt["villages"]["now"], dt["villages"]["ref"]) == (14, 10)
    # On air: T1 (07/01) now; M1 (06/02) in the reference; A1's typed date
    # (06/25) is past the cut; U1 has no date at all.
    on_air = _row(p, "on_air")
    assert (on_air["now"], on_air["ref"]) == (1, 1)
    assert p["undated_on_air"] == 1


def test_approvals_and_fully_approved(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07")
    assert _row(p, "ict_approved")["now"] == 3
    assert _row(p, "cra_approved")["now"] == 1
    # Fully approved on the later of the two approvals (07/08), in Mehr.
    assert _row(p, "fully_approved")["now"] == 1


def test_months_before_mehr_1405_are_not_recorded(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07")
    ict = _row(p, "ict_approved")
    assert ict["ref"] is None and ict["ref_recorded"] is False and ict["delta"] is None

    shahrivar = _get(client, actors["pm"], "month", month="1405-06")
    ict = _row(shahrivar, "ict_approved")
    # Five approvals happened in Shahrivar, but the month is not recorded:
    # null, never 0 and never 5.
    assert ict["now"] is None and ict["recorded"] is False
    # DT done has real dates for any month.
    assert _row(shahrivar, "dt_done")["recorded"] is True


def test_full_config_is_counted_at_confirmation(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07")
    # T1 submitted in Shahrivar, confirmed 07/06; M1 Ready 07/02; Z1 Ready
    # 07/09 after a NotReady: three sites became full config in Mehr.
    assert _row(p, "full_config")["now"] == 3
    # M1 went Ready -> NotReady on 07/07.
    fell = _row(p, "fell_back")
    assert fell["now"] == 1 and fell["lower_is_better"] is True


def test_problematic_flows(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07")
    # Z1 flagged 07/01 and cleared 07/09; M1 flagged 07/07.
    assert _row(p, "problem_new")["now"] == 2
    assert _row(p, "problem_resolved")["now"] == 1


# ----- Month: owners ----------------------------------------------------------


def test_owner_split_credits_the_owner_at_the_time(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07", by="rm")
    on_air = _row(p, "on_air")
    dt = _row(p, "dt_done")
    # T1 went on air (07/01) under Allahyar and finished DT (07/03) under Karimi.
    assert _owner_now(on_air, "Allahyar") == 1
    assert _owner_now(on_air, NEW_RM) == 0
    assert _owner_now(dt, NEW_RM) == 1
    assert _owner_now(dt, "Allahyar") == 0


def test_owner_splits_sum_to_the_total_with_unattributed(client, actors):
    for by in ("rm", "coordinator", "contractor"):
        p = _get(client, actors["pm"], "month", month="1405-07", by=by)
        for section in p["sections"]:
            for row in section["rows"]:
                if not row["recorded"]:
                    continue
                assert sum(o["now"] for o in row["owners"]) == row["now"], (by, row["key"])
        dt = _row(p, "dt_done")
        # U1 has no province and no contractor.
        assert dt["owners"][-1]["name"] == "Unattributed"
        assert dt["owners"][-1]["now"] == 1


def test_owners_are_sorted_high_to_low(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07", by="contractor")
    for section in p["sections"]:
        for row in section["rows"]:
            named = [o["now"] for o in row["owners"] or [] if o["name"] != "Unattributed"]
            assert named == sorted(named, reverse=True)


def test_owners_gives_three_lists_that_each_add_up(client, actors):
    p = _get(client, actors["pm"], "month", month="1405-07", by="owners")
    for section in p["sections"]:
        for row in section["rows"]:
            assert row["owners"] is None
            if not row["recorded"]:
                assert row["owners_by"] is None
                continue
            assert list(row["owners_by"]) == ["contractor", "rm", "coordinator"]
            for kind, entries in row["owners_by"].items():
                assert sum(o["now"] for o in entries) == row["now"], (kind, row["key"])
                named = [o["now"] for o in entries if o["name"] != "Unattributed"]
                assert named == sorted(named, reverse=True)
    dt = _row(p, "dt_done")["owners_by"]
    # U1 has no province and no contractor: Unattributed, last, in every list.
    for entries in dt.values():
        assert (entries[-1]["name"], entries[-1]["now"]) == ("Unattributed", 1)
    # The same crediting as by=rm: T1's DT done went to Karimi.
    assert _owner_now({"owners": dt["rm"]}, NEW_RM) == 1
    # Zero entries are listed, so the screen can say who had none: Allahyar
    # held Tehran until 07/03 and still holds other provinces.
    assert next(o for o in dt["rm"] if o["name"] == "Allahyar")["now"] == 0
    assert {o["name"] for o in dt["contractor"]} == {ALPHA, BETA, "Unattributed"}


def test_default_month_is_the_last_closed_one():
    from app.services.performance.month import default_month
    from app.services.performance.periods import ShamsiMonth

    # Shahrivar 1405 closed before UEP recorded approvals: the running month.
    assert default_month(sh(1405, 7, 10)) == ShamsiMonth(1405, 7)
    # From Aban on, the last closed month.
    assert default_month(sh(1405, 8, 1)) == ShamsiMonth(1405, 7)
    assert default_month(sh(1406, 1, 15)) == ShamsiMonth(1405, 12)


def test_month_defaults_and_picker_range(client, actors):
    p = _get(client, actors["pm"], "month")
    assert p["month"]["month"] == 7 and p["running"] is True
    assert p["current_month"] == {"year": 1405, "month": 7, "label_fa": p["month"]["label_fa"]}
    # Z1 went on air in Esfand 1404: the first year with data.
    assert p["first_year"] == 1404


# ----- Area -------------------------------------------------------------------


def test_area_country_totals_and_national(client, actors):
    p = _get(client, actors["pm"], "area")
    assert p["scope"]["lens"] == "country"
    t = p["totals"]
    # Villages 12+10+10+4+2 = 38, all on air; DT done 12+10+10+2 = 34.
    assert t["villages"] == 38
    assert t["onair"] == {"count": 38, "rate": 100.0}
    assert t["dt"] == {"count": 34, "rate": round(3400 / 38, 1)}
    # ICT and CRA divide by DT-done villages; Fully approved by villages.
    assert t["ict"] == {"count": 8, "rate": round(800 / 34, 1)}
    assert t["cra"] == {"count": 1, "rate": round(100 / 34, 1)}
    assert t["full"] == {"count": 1, "rate": round(100 / 38, 1)}
    assert p["national"] == {k: t[k]["rate"] for k in ("onair", "dt", "full", "ict", "cra")}
    for gone in ("cards", "open_work"):
        assert gone not in p


def test_area_rows_carry_the_five_measures(client, actors):
    p = _get(client, actors["pm"], "area", breakdown="province")
    rows = {r["name"]: r for r in p["rows"]}
    tehran = rows["Tehran"]["measures"]
    assert tehran["ict"] == {"count": 3, "rate": 25.0}
    assert tehran["full"] == {"count": 1, "rate": round(100 / 12, 1)}
    assert rows["Tehran"]["gaps_key"] == TEHRAN
    for gone in ("remaining", "on_air_only", "not_on_air", "dt_done"):
        assert gone not in rows["Tehran"]
    assert rows["Zanjan"]["low_sample"] is True
    assert rows["Tehran"]["low_sample"] is False
    names = [r["name"] for r in p["rows"]]
    assert names[-1] == "Unknown province"
    assert sum(r["villages"] for r in p["rows"]) == 38
    assert sum(r["measures"]["dt"]["count"] for r in p["rows"]) == 34


@pytest.mark.parametrize("lens,key", [("rm", "Nobakht"), ("rm", NEW_RM), ("contractor", ALPHA),
                                      ("province", TEHRAN)])
def test_a_scoped_area_is_the_sum_of_its_provinces(client, actors, lens, key):
    p = _get(client, actors["pm"], "area", lens=lens, key=key, breakdown="province")
    for k in ("onair", "dt", "full", "ict", "cra"):
        assert sum(r["measures"][k]["count"] for r in p["rows"]) == p["totals"][k]["count"]
    assert sum(r["villages"] for r in p["rows"]) == p["totals"]["villages"]


def test_breakdowns_offered_per_role(client, actors):
    pm = _get(client, actors["pm"], "area")
    assert pm["breakdowns"] == ["province", "region", "contractor", "coordinator", "rm"]
    assert pm["breakdown"] == "province"
    # The scope's own kind is not offered.
    scoped = _get(client, actors["viewer"], "area", lens="rm", key="Nobakht")
    assert scoped["breakdowns"] == ["province", "region", "contractor", "coordinator"]
    assert _get(client, actors["rm"], "area")["breakdowns"] == ["province", "region", "contractor"]
    assert _get(client, actors["coordinator"], "area")["breakdowns"] == [
        "province", "region", "contractor"]
    assert _get(client, actors["contractor"], "area")["breakdowns"] == ["province", "region"]


def test_people_breakdowns_are_pm_and_viewer_only(client, actors):
    for who in ("pm", "viewer"):
        rm = _get(client, actors[who], "area", breakdown="rm")
        assert NEW_RM in {r["name"] for r in rm["rows"]}
        assert next(r for r in rm["rows"] if r["name"] == NEW_RM)["gaps_key"] == NEW_RM
        coordinator = _get(client, actors[who], "area", breakdown="coordinator")
        assert sum(r["villages"] for r in coordinator["rows"]) == 38
    for who in ("rm", "coordinator", "contractor"):
        for breakdown in ("rm", "coordinator"):
            _get(client, actors[who], "area", status=403, breakdown=breakdown)


def test_my_area_is_the_regional_managers_own(client, actors):
    p = _get(client, actors["rm"], "area")
    assert p["scope"]["key"] == "Nobakht" and p["scope"]["selectable"] is False
    # Nobakht holds Mazandaran (10 villages) and Golestan (none here).
    assert p["totals"]["villages"] == 10
    assert p["breakdown"] == "province"


def test_contractor_area_is_their_own_sites(client, actors):
    p = _get(client, actors["contractor"], "area")
    assert p["breakdown"] == "province"
    assert "contractor" not in p["breakdowns"]
    # Alpha: T1 (12) and A1 (10).
    assert p["totals"]["villages"] == 22
    assert {r["name"] for r in p["rows"]} == {"Tehran", "Ardabil"}


def test_contractor_breakdown_is_refused_to_a_contractor(client, actors):
    _get(client, actors["contractor"], "area", status=403, breakdown="contractor")


# ----- Access -----------------------------------------------------------------

ROUTES = ["month", "area", "lenses", "month.xlsx", "area.xlsx"]


@pytest.mark.parametrize("path", ROUTES)
def test_admin_is_refused_everywhere(client, actors, path):
    _get(client, actors["admin"], path, status=403)


def test_viewer_reads_any_scope_but_writes_nothing(client, actors):
    viewer = actors["viewer"]
    assert _get(client, viewer, "area", lens="rm", key="Nobakht")["scope"]["key"] == "Nobakht"
    assert _get(client, viewer, "lenses")["selectable"] is True
    assert client.get("/api/v1/kpi/mapping", headers=viewer).status_code == 403
    assert client.put(
        "/api/v1/kpi/mapping/links/1", headers=viewer, json={"kpi_person_name": "x"}
    ).status_code == 403
    assert client.put("/api/v1/kpi/mapping/1", headers=viewer, json={}).status_code in (403, 422)
    assert client.get("/api/v1/gaps/overview", headers=viewer).json()["scoped"] is False


def test_only_pm_and_viewer_see_month(client, actors):
    for role in ("rm", "coordinator", "contractor"):
        _get(client, actors[role], "month", status=403)
        _get(client, actors[role], "month", status=403, by="owners")


def test_another_scope_is_a_403_never_empty(client, actors):
    _get(client, actors["rm"], "area", status=403, lens="rm", key="Allahyar")
    _get(client, actors["coordinator"], "area", status=403, lens="rm", key="Nobakht")
    _get(client, actors["contractor"], "area", status=403, lens="contractor", key=BETA)


def test_lenses_offer_the_new_owner_and_keep_the_old(client, actors):
    lenses = _get(client, actors["pm"], "lenses")
    assert "Allahyar" in lenses["options"]["rm"]  # still holds Alborz, Semnan, Qom
    assert NEW_RM in lenses["options"]["rm"]


# ----- Exports ----------------------------------------------------------------


def _rows_in(response) -> int:
    return int(response.headers["X-Row-Count"])


def test_exports_have_the_screens_row_counts(client, actors):
    pm = actors["pm"]
    month = _get(client, pm, "month", month="1405-07")
    response = client.get("/api/v1/kpi/month.xlsx", headers=pm, params={"month": "1405-07"})
    assert _rows_in(response) == sum(len(s["rows"]) for s in month["sections"])

    by = _get(client, pm, "month", month="1405-07", by="rm")
    response = client.get("/api/v1/kpi/month.xlsx", headers=pm,
                          params={"month": "1405-07", "by": "rm"})
    assert _rows_in(response) == sum(
        len(r["owners"] or []) for s in by["sections"] for r in s["rows"])

    area = _get(client, pm, "area", breakdown="province")
    response = client.get("/api/v1/kpi/area.xlsx", headers=pm, params={"breakdown": "province"})
    assert response.status_code == 200
    assert _rows_in(response) == len(area["rows"])

    owners = _get(client, pm, "month", month="1405-07", by="owners")
    response = client.get("/api/v1/kpi/month.xlsx", headers=pm,
                          params={"month": "1405-07", "by": "owners"})
    assert _rows_in(response) == sum(
        len(entries) for s in owners["sections"] for r in s["rows"]
        for entries in (r["owners_by"] or {}).values())


def test_removed_tabs_are_gone(client, actors):
    for path in ("performance", "performance.xlsx", "compare", "compare.xlsx"):
        _get(client, actors["pm"], path, status=404)


def test_viewer_may_download_and_others_only_their_own(client, actors):
    assert client.get("/api/v1/kpi/area.xlsx", headers=actors["viewer"]).status_code == 200
    assert client.get("/api/v1/kpi/area.xlsx", headers=actors["rm"]).status_code == 200
    assert client.get("/api/v1/kpi/area.xlsx", headers=actors["rm"],
                      params={"lens": "rm", "key": "Allahyar"}).status_code == 403


# ----- On-air history ----------------------------------------------------------


def test_on_air_history_backfills_once_and_is_idempotent(client, actors):
    from app.models.performance import LifecycleStatusHistory
    from app.services.performance.onair_history import record_on_air

    db = SessionLocal()
    try:
        db.query(LifecycleStatusHistory).delete()
        db.commit()
        first = record_on_air(db, None, at(1405, 7, 10))
        db.commit()
        # 4 on-air sites (T1, M1, A1, Z1, U1 is on air too = 5) and their villages.
        assert first == 5 + 12 + 10 + 10 + 4 + 2
        assert db.query(LifecycleStatusHistory).filter(
            LifecycleStatusHistory.backfilled.is_(False)).count() == 0
        assert record_on_air(db, None, at(1405, 7, 10)) == 0
        db.rollback()
    finally:
        db.close()


def test_a_rolled_back_import_leaves_no_history(client, actors):
    from app.models.performance import LifecycleStatusHistory
    from app.models.workitem import Site, WorkItem
    from app.services.performance.onair_history import record_on_air

    db = SessionLocal()
    try:
        before = db.query(LifecycleStatusHistory).count()
        site = Site(site_code="RB1")
        db.add(site)
        db.flush()
        db.add(WorkItem(site_id=site.id, site_type="A", last_stage=ON_AIR, current_stage="New"))
        assert record_on_air(db, None, at(1405, 7, 10)) == 1
        db.rollback()
        assert db.query(LifecycleStatusHistory).count() == before
    finally:
        db.close()
