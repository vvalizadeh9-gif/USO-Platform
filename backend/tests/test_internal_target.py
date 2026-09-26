"""Tests for the MTN internal target per stream (``/pip/internal-target``).

The rules being checked:

* The PM sets a DT target and an Acceptance target independently: each
  stream has its own version sequence, and setting one never touches the
  other.
* Only the PM may set either one. Admin and Coordinator get 403.
* Reading through ``/pip/internal-target`` is staff only; a contractor gets
  403 for either stream.
* The Acceptance side is the same data ``/acceptance/plan`` has always
  served: a target set there is read here, and the other way round. A DT
  target never reaches ``/acceptance/plan`` or the acceptance trend.
* Every existing service caller that passes no stream still reads
  ``ACCEPTANCE``.

Run with:  cd backend && pytest tests/test_internal_target.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_internal_target_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import jalali  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

PIP = "/api/v1/pip"
ACC = "/api/v1/acceptance"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_internal_target_pytest.db"):
        os.remove("/tmp/uep_internal_target_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="admin", password="Admin@12345"):
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _contractor_login(client, admin_h):
    from app.models.reference import Contractor

    db = SessionLocal()
    contractor = Contractor(name="Target Reader Co", type="drive_test", active=True)
    db.add(contractor)
    db.commit()
    contractor_id = contractor.id
    db.close()

    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Contractor")
    password = "Test-Fixture-Passphrase"
    r = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": "target_contractor",
            "password": password,
            "first_name": "Test",
            "family_name": "Contractor",
            "role_id": role_id,
            "sees_all_provinces": True,
            "province_ids": [],
            "contractor_id": contractor_id,
        },
    )
    assert r.status_code == 201, r.text
    return _login(client, "target_contractor", password)


@pytest.fixture(scope="module")
def actors(client):
    admin_h = _login(client)
    token = admin_h["Authorization"].split()[1]
    return {
        "admin": admin_h,
        "pm": login_as_role(client, token, "PM"),
        "coordinator": login_as_role(client, token, "Coordinator"),
        "contractor": _contractor_login(client, admin_h),
    }


_NOW_YEAR, _NOW_MONTH = jalali.current_shamsi_period()


def _back(n: int) -> tuple[int, int]:
    year, month = _NOW_YEAR, _NOW_MONTH
    for _ in range(n):
        year, month = jalali.previous_period(year, month)
    return year, month


def _put(client, headers, stream, period, count, note=None):
    body = {
        "stream": stream,
        "year": period[0],
        "month": period[1],
        "target_count": count,
    }
    if note is not None:
        body["note"] = note
    return client.put(f"{PIP}/internal-target", headers=headers, json=body)


def _get(client, headers, stream, period=None):
    url = f"{PIP}/internal-target?stream={stream}"
    if period is not None:
        url += f"&year={period[0]}&month={period[1]}"
    return client.get(url, headers=headers)


# ---------------------------------------------------------------------------
# Setting and reading
# ---------------------------------------------------------------------------
def test_pm_sets_and_reads_a_dt_target(client, actors):
    period = _back(1)
    r = _put(client, actors["pm"], "DT", period, 140, note="Committed to management")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stream"] == "DT"
    assert body["target_count"] == 140
    assert body["version"] == 1
    assert body["shamsi_month_name"] == jalali.month_name(period[1])
    assert body["set_by"]

    r = _get(client, actors["coordinator"], "DT", period)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["stream"] == "DT"
    assert got["current"]["target_count"] == 140
    assert got["current"]["note"] == "Committed to management"
    assert [h["target_count"] for h in got["history"]] == [140]


def test_dt_and_acceptance_keep_separate_versions(client, actors):
    period = _back(2)
    assert _put(client, actors["pm"], "DT", period, 100).json()["version"] == 1
    assert _put(client, actors["pm"], "DT", period, 110).json()["version"] == 2
    acc = _put(client, actors["pm"], "ACCEPTANCE", period, 900)
    assert acc.status_code == 200, acc.text
    assert acc.json()["version"] == 1

    assert _get(client, actors["pm"], "DT", period).json()["current"]["target_count"] == 110
    assert (
        _get(client, actors["pm"], "ACCEPTANCE", period).json()["current"]["target_count"]
        == 900
    )

    from app.models.acceptance_plan import AcceptanceMonthlyTarget

    db = SessionLocal()
    try:
        rows = (
            db.query(AcceptanceMonthlyTarget)
            .filter_by(shamsi_year=period[0], shamsi_month=period[1])
            .order_by(AcceptanceMonthlyTarget.stream, AcceptanceMonthlyTarget.version)
            .all()
        )
        assert [(t.stream, t.version, t.is_current, t.target_count) for t in rows] == [
            ("ACCEPTANCE", 1, True, 900),
            ("DT", 1, False, 100),
            ("DT", 2, True, 110),
        ]
    finally:
        db.close()


def test_previous_month_is_returned(client, actors):
    earlier, later = _back(4), _back(3)
    _put(client, actors["pm"], "DT", earlier, 50)
    _put(client, actors["pm"], "DT", later, 60)
    got = _get(client, actors["pm"], "DT", later).json()
    assert got["current"]["target_count"] == 60
    assert got["previous"]["target_count"] == 50


def test_no_target_is_null_not_zero(client, actors):
    got = _get(client, actors["pm"], "DT", (1460, 1)).json()
    assert got["current"] is None
    assert got["previous"] is None
    assert got["history"] == []


def test_defaults_to_the_running_month(client, actors):
    got = _get(client, actors["pm"], "DT").json()
    assert (got["shamsi_year"], got["shamsi_month"]) == (_NOW_YEAR, _NOW_MONTH)


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "body",
    [
        {"stream": "DT", "year": 1405, "month": 1, "target_count": -1},
        {"stream": "DT", "year": 1405, "month": 13, "target_count": 5},
        {"stream": "DT", "year": 1405, "month": 1, "target_count": 2.5},
        {"stream": "DT", "year": 1405, "month": 1, "target_count": "5"},
        {"stream": "HC", "year": 1405, "month": 1, "target_count": 5},
        {"year": 1405, "month": 1, "target_count": 5},
        {"stream": "DT", "year": 1405, "month": 1, "target_count": 5, "extra": 1},
    ],
)
def test_bad_input_is_rejected(client, actors, body):
    r = client.put(f"{PIP}/internal-target", headers=actors["pm"], json=body)
    assert r.status_code == 422, r.text


def test_stream_is_required_on_read(client, actors):
    assert client.get(f"{PIP}/internal-target", headers=actors["pm"]).status_code == 422


def test_half_a_period_is_rejected(client, actors):
    r = client.get(f"{PIP}/internal-target?stream=DT&year=1405", headers=actors["pm"])
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("who", ["admin", "coordinator", "contractor"])
@pytest.mark.parametrize("stream", ["DT", "ACCEPTANCE"])
def test_only_the_pm_can_set(client, actors, who, stream):
    r = _put(client, actors[who], stream, _back(5), 10)
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("stream", ["DT", "ACCEPTANCE"])
def test_contractor_cannot_read(client, actors, stream):
    assert _get(client, actors["contractor"], stream).status_code == 403


@pytest.mark.parametrize("who", ["pm", "coordinator", "admin"])
def test_staff_can_read_dt(client, actors, who):
    assert _get(client, actors[who], "DT").status_code == 200


# ---------------------------------------------------------------------------
# The Acceptance Dashboard is unchanged
# ---------------------------------------------------------------------------
def test_acceptance_plan_is_shared_and_dt_stays_out_of_it(client, actors):
    period = (_NOW_YEAR, _NOW_MONTH)
    r = client.put(
        f"{ACC}/plan",
        headers=actors["pm"],
        json={"shamsi_year": period[0], "shamsi_month": period[1], "target_count": 777},
    )
    assert r.status_code == 200, r.text
    # A DT target in the same month, set afterwards, with a different number.
    assert _put(client, actors["pm"], "DT", period, 33).status_code == 200

    plan = client.get(f"{ACC}/plan", headers=actors["coordinator"]).json()
    assert plan["current"]["target_count"] == 777
    assert all(h["target_count"] != 33 for h in plan["history"])

    trend = client.get(f"{ACC}/trends?months=3", headers=actors["coordinator"]).json()
    running = next(
        m for m in trend["months"]
        if (m["shamsi_year"], m["shamsi_month"]) == period
    )
    assert running["target_count"] == 777

    # And the Acceptance target reads the same through the new endpoint.
    got = _get(client, actors["pm"], "ACCEPTANCE", period).json()
    assert got["current"]["target_count"] == 777


def test_service_defaults_to_acceptance(client, actors):
    from app.services import acceptance_plan

    period = _back(6)
    _put(client, actors["pm"], "DT", period, 12)
    db = SessionLocal()
    try:
        assert acceptance_plan.get_current_target(db, *period) is None
        assert acceptance_plan.get_current_target(db, *period, "DT").target_count == 12
    finally:
        db.close()
