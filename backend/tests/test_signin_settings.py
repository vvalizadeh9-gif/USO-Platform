"""UEP-26: the sign-in page settings, and the captcha switch.

* The captcha is never required while ``login_captcha_enabled`` is false (the
  default), a sent one is ignored, and it is required again when true.
* The lockout is unchanged: five failures give 429 with ``Retry-After``.
* ``GET /auth/signin-settings`` works signed out, returns only the public
  fields, and shows the notice only inside its window.
* ``PUT /admin/signin-settings`` validates, is Admin only, and is audited.
* The migration seeds exactly one row, the feature and Admin's grant, and a
  re-run changes nothing.

Run with:  cd backend && pytest tests/test_signin_settings.py -q
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_signin_settings_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.rate_limit import login_rate_limiter  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402

API = "/api/v1"
PUBLIC = f"{API}/auth/signin-settings"
ADMIN = f"{API}/admin/signin-settings"


def _reset_throttle() -> None:
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        login_rate_limiter.reset(db)
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_rate_limiter(client):
    _reset_throttle()
    yield
    _reset_throttle()


@pytest.fixture(scope="module")
def admin_headers(client):
    response = client.post(f"{API}/auth/login", data=login_form(client))
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies['uep_session']}"}


def _bare(client, password, username="admin"):
    return client.post(f"{API}/auth/login", data={"username": username, "password": password})


def _settings(**overrides) -> dict:
    body = {
        "support_name": "UEP support desk",
        "support_hours": "Saturday to Wednesday, 8:00 to 16:00",
        "support_email": "support@uep.example",
        "support_phone": "Extension 2140",
        "notice_enabled": False,
        "notice_text": None,
        "notice_from": None,
        "notice_to": None,
    }
    body.update(overrides)
    return body


def _iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


# --------------------------------------------------------------------------
# Captcha switch and lockout
# --------------------------------------------------------------------------
def test_captcha_is_off_by_default():
    from app.core.config import Settings

    assert Settings(_env_file=None).login_captcha_enabled is False


def test_no_captcha_is_required_after_failures_when_switched_off(client):
    for _ in range(3):
        assert _bare(client, "wrong").status_code == 401
    # Past the old two-failure threshold, the right password still works.
    assert _bare(client, "Admin@12345").status_code == 200


def test_a_wrong_captcha_is_ignored_when_switched_off(client):
    response = client.post(f"{API}/auth/login", data={
        "username": "admin", "password": "Admin@12345",
        "captcha_token": "not-a-token", "captcha_answer": 999,
    })
    assert response.status_code == 200, response.text


@pytest.mark.usefixtures("captcha_on")
def test_captcha_is_required_again_when_switched_on(client):
    from app.core.config import get_settings

    for _ in range(get_settings().login_captcha_after_failures):
        assert _bare(client, "wrong").status_code == 401
    refused = _bare(client, "Admin@12345")
    assert refused.status_code == 400
    assert refused.headers.get("x-captcha-required") == "true"


def test_lockout_after_five_failures_returns_429_with_retry_after(client):
    from app.core.config import get_settings

    for _ in range(get_settings().login_max_attempts_per_username):
        assert _bare(client, "wrong").status_code == 401
    locked = _bare(client, "Admin@12345")
    assert locked.status_code == 429
    retry_after = int(locked.headers["retry-after"])
    assert 0 < retry_after <= get_settings().login_lockout_seconds
    assert locked.json()["detail"].startswith("Too many attempts.")


def test_captcha_endpoint_still_answers(client):
    challenge = client.get(f"{API}/auth/captcha").json()
    assert {"token", "num1", "num2"} <= set(challenge)


# --------------------------------------------------------------------------
# GET /auth/signin-settings (public)
# --------------------------------------------------------------------------
def test_public_settings_need_no_sign_in_and_start_empty(client):
    response = client.get(PUBLIC)
    assert response.status_code == 200
    assert response.json() == {
        "support": {"name": None, "hours": None, "email": None, "phone": None},
        "notice": None,
    }
    assert response.headers["cache-control"] == "public, max-age=60"


def test_public_settings_return_only_the_public_fields(client, admin_headers):
    saved = client.put(ADMIN, headers=admin_headers, json=_settings(
        notice_enabled=True, notice_text="UEP is offline on Friday 22:00 to 23:00.",
    ))
    assert saved.status_code == 200, saved.text
    body = client.get(PUBLIC).json()
    assert set(body) == {"support", "notice"}
    assert set(body["support"]) == {"name", "hours", "email", "phone"}
    assert body["notice"] == {"text": "UEP is offline on Friday 22:00 to 23:00."}
    assert "updated_by" not in str(body)


@pytest.mark.parametrize(
    "start, end, shown",
    [
        (timedelta(hours=1), timedelta(hours=2), False),     # before
        (timedelta(hours=-1), timedelta(hours=1), True),     # inside
        (timedelta(hours=-2), timedelta(hours=-1), False),   # after
        (None, timedelta(hours=1), True),                    # open start
        (timedelta(hours=-1), None, True),                   # open end
        (None, None, True),                                  # no window
    ],
    ids=["before", "inside", "after", "open-start", "open-end", "always"],
)
def test_notice_window(client, admin_headers, start, end, shown):
    saved = client.put(ADMIN, headers=admin_headers, json=_settings(
        notice_enabled=True, notice_text="Planned update",
        notice_from=_iso(start) if start is not None else None,
        notice_to=_iso(end) if end is not None else None,
    ))
    assert saved.status_code == 200, saved.text
    notice = client.get(PUBLIC).json()["notice"]
    assert (notice is not None) is shown


def test_notice_switched_off_is_never_shown(client, admin_headers):
    client.put(ADMIN, headers=admin_headers, json=_settings(notice_enabled=False, notice_text="Kept"))
    assert client.get(PUBLIC).json()["notice"] is None


# --------------------------------------------------------------------------
# GET / PUT /admin/signin-settings
# --------------------------------------------------------------------------
def test_admin_reads_the_full_row_with_who_saved_it(client, admin_headers):
    client.put(ADMIN, headers=admin_headers, json=_settings())
    body = client.get(ADMIN, headers=admin_headers).json()
    assert body["support_name"] == "UEP support desk"
    assert body["updated_by_name"]
    assert body["updated_at"]


def test_values_are_trimmed_and_empty_means_not_set(client, admin_headers):
    body = client.put(ADMIN, headers=admin_headers, json=_settings(
        support_name="  Desk  ", support_phone="   ",
    )).json()
    assert body["support_name"] == "Desk"
    assert body["support_phone"] is None


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"support_email": "name@company"}, "Enter an email like name@company.com."),
        ({"support_name": "x" * 81}, "Team or person can be at most 80 characters."),
        ({"support_hours": "x" * 81}, "Working hours can be at most 80 characters."),
        ({"support_phone": "1" * 41}, "Phone or extension can be at most 40 characters."),
        ({"notice_enabled": True, "notice_text": "x" * 141}, "Message can be at most 140 characters."),
        ({"notice_enabled": True, "notice_text": "  "}, "Enter the message to show on the sign-in page."),
        (
            {"notice_from": "2026-12-01T10:00:00+03:30", "notice_to": "2026-12-01T09:00:00+03:30"},
            "Hide after must be later than Show from.",
        ),
    ],
    ids=["email", "name", "hours", "phone", "notice-long", "notice-required", "window"],
)
def test_validation_errors(client, admin_headers, overrides, message):
    response = client.put(ADMIN, headers=admin_headers, json=_settings(**overrides))
    assert response.status_code == 422
    assert response.json()["detail"] == message


@pytest.mark.parametrize("role", ["PM", "Viewer", "Coordinator", "RegionalManager"])
def test_only_admin_may_read_or_save(client, admin_headers, role):
    token = admin_headers["Authorization"].split(" ", 1)[1]
    headers = login_as_role(client, token, role)
    assert client.get(ADMIN, headers=headers).status_code == 403
    assert client.put(ADMIN, headers=headers, json=_settings()).status_code == 403


def test_every_save_is_audited_with_before_and_after(client, admin_headers):
    from app.core import audit_actions
    from app.core.database import SessionLocal
    from app.models.acceptance import AuditLog

    client.put(ADMIN, headers=admin_headers, json=_settings(support_phone="Extension 1000"))
    client.put(ADMIN, headers=admin_headers, json=_settings(support_phone="Extension 2000"))
    db = SessionLocal()
    try:
        entry = (
            db.query(AuditLog)
            .filter(AuditLog.action == audit_actions.SIGNIN_SETTINGS_CHANGED)
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert entry is not None
        assert entry.old_value["support_phone"] == "Extension 1000"
        assert entry.new_value["support_phone"] == "Extension 2000"
        assert entry.module == "Admin"
    finally:
        db.close()


# --------------------------------------------------------------------------
# Migration and feature seed
# --------------------------------------------------------------------------
def test_migration_seeds_one_row_and_is_idempotent(client):
    from alembic.runtime.migration import MigrationContext
    from alembic.operations import Operations
    import importlib.util
    from pathlib import Path

    from sqlalchemy import text

    from app.core.database import engine

    path = next(Path(__file__).resolve().parents[1].glob("alembic/versions/*_signin_settings.py"))
    spec = importlib.util.spec_from_file_location("uep26_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    with engine.begin() as conn:
        version_before = conn.execute(text("SELECT version FROM access_version")).scalar()
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
            module.upgrade()
        assert conn.execute(text("SELECT COUNT(*) FROM signin_settings")).scalar() == 1
        assert conn.execute(
            text("SELECT COUNT(*) FROM features WHERE key = 'signin_settings'")
        ).scalar() == 1
        grants = conn.execute(text(
            "SELECT r.name, g.level FROM role_feature_grants g JOIN roles r ON r.id = g.role_id "
            "WHERE g.feature_key = 'signin_settings'"
        )).all()
        assert grants == [("Admin", "edit")]
        # Nothing new was granted, so the version did not move.
        assert conn.execute(text("SELECT version FROM access_version")).scalar() == version_before
