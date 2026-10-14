"""How long a session lasts: the idle timeout, the absolute one, and renewal.

A session ends after 30 minutes of nobody using it and after 8 hours whatever
happens. The page renews it (POST /auth/session/refresh) only while the person
is working, and a renewal keeps the original sign-in time, so it can never push
the absolute limit out.

Run with:  cd backend && pytest tests/test_session_lifetime.py -q
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_session_lifetime_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema, login_form  # noqa: E402

HTTPS = "https://testserver"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/session/refresh"
IDLE_SECONDS = 30 * 60
ABSOLUTE = timedelta(minutes=480)


@pytest.fixture(scope="module")
def app():
    if os.path.exists("/tmp/uep_session_lifetime_pytest.db"):
        os.remove("/tmp/uep_session_lifetime_pytest.db")
    create_schema()
    from app.main import app as fastapi_app

    return fastapi_app


@pytest.fixture
def browser(app):
    with TestClient(app, base_url=HTTPS) as c:
        yield c


def _sign_in(client):
    response = client.post(LOGIN, data=login_form(client))
    assert response.status_code == 200, response.text
    return response


def _claims(token: str) -> dict:
    from app.core.security import decode_access_token

    claims = decode_access_token(token)
    assert claims is not None
    return claims


def _admin_token_signed_in_at(began: datetime) -> str:
    """A token for the admin account whose session began at ``began``."""
    from app.core.database import SessionLocal
    from app.core.security import create_access_token
    from app.models.reference import User

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        return create_access_token(
            admin.id,
            {"role": admin.role.name, "ver": admin.token_version},
            auth_time=began,
        )
    finally:
        db.close()


def _refresh_with(client, token: str):
    """POST the refresh as an API client holding ``token``.

    A Bearer header wins over the cookie jar, which lets a test hand the server a
    token with any sign-in time it likes without fighting the jar. Bearer calls
    carry no CSRF risk, so they skip that check by design.
    """
    return client.post(REFRESH, headers={"Authorization": f"Bearer {token}"})


def _session_cookie_max_age(response) -> int:
    for header in response.headers.get_list("set-cookie"):
        if header.lower().startswith("uep_session="):
            for part in header.split(";"):
                if part.strip().lower().startswith("max-age="):
                    return int(part.split("=")[1])
    raise AssertionError("no session cookie with a Max-Age in the response")


# ---------------------------------------------------------------------------
# The limits themselves
# ---------------------------------------------------------------------------


def test_the_idle_timeout_is_thirty_minutes():
    from app.core.config import get_settings

    assert get_settings().access_token_expire_minutes == 30


def test_the_absolute_timeout_is_eight_hours():
    from app.core.config import get_settings

    assert get_settings().session_max_minutes == 480


def test_signing_in_gives_a_thirty_minute_session(browser):
    response = _sign_in(browser)

    assert _session_cookie_max_age(response) == IDLE_SECONDS
    claims = _claims(browser.cookies.get("uep_session"))
    assert claims["exp"] - claims["iat"] == IDLE_SECONDS
    assert claims["auth_time"] == claims["iat"]


def test_a_token_never_outlives_the_absolute_limit():
    from app.core.security import create_access_token

    began = datetime.now(timezone.utc) - ABSOLUTE + timedelta(minutes=5)
    claims = _claims(create_access_token(1, auth_time=began))

    # Five minutes of the day left, so five minutes is all it gets -- not thirty.
    assert 0 < claims["exp"] - claims["iat"] <= 5 * 60


def test_claimed_auth_time_falls_back_to_iat_then_to_now():
    from app.core.security import claimed_auth_time

    assert claimed_auth_time({"auth_time": 1_700_000_000}).timestamp() == 1_700_000_000
    # A token minted before auth_time existed: the sign-in is its iat.
    assert claimed_auth_time({"iat": 1_700_000_000}).timestamp() == 1_700_000_000
    # Nothing readable at all: begins now, so a deploy signs nobody out.
    assert abs(claimed_auth_time({}).timestamp() - datetime.now(timezone.utc).timestamp()) < 5
    assert abs(claimed_auth_time({"auth_time": "x"}).timestamp() - datetime.now(timezone.utc).timestamp()) < 5


# ---------------------------------------------------------------------------
# Renewal
# ---------------------------------------------------------------------------


def test_a_refresh_starts_the_idle_clock_again(browser):
    _sign_in(browser)
    # A token minted 25 minutes into the half hour would have 5 left; the
    # refresh must hand back a whole new half hour, not those 5.
    began = datetime.now(timezone.utc) - timedelta(minutes=25)
    token = _admin_token_signed_in_at(began)

    response = _refresh_with(browser, token)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ok"
    assert IDLE_SECONDS - 5 <= response.json()["expires_in"] <= IDLE_SECONDS
    assert _session_cookie_max_age(response) == response.json()["expires_in"]


def test_a_refresh_keeps_the_original_sign_in_time(browser):
    _sign_in(browser)
    began = datetime.now(timezone.utc) - timedelta(hours=3)

    response = _refresh_with(browser, _admin_token_signed_in_at(began))

    assert response.status_code == 200, response.text
    renewed = [h for h in response.headers.get_list("set-cookie") if h.startswith("uep_session=")][0]
    token = renewed.split("=", 1)[1].split(";", 1)[0]
    assert _claims(token)["auth_time"] == int(began.timestamp())


def test_a_refresh_cannot_push_past_the_absolute_limit(browser):
    _sign_in(browser)
    began = datetime.now(timezone.utc) - ABSOLUTE + timedelta(minutes=4)

    response = _refresh_with(browser, _admin_token_signed_in_at(began))

    assert response.status_code == 200, response.text
    # Four minutes of the working day left: that is what it is given, not thirty.
    assert 0 < response.json()["expires_in"] <= 4 * 60
    assert _session_cookie_max_age(response) == response.json()["expires_in"]


def test_a_session_past_the_absolute_limit_cannot_be_refreshed(browser):
    _sign_in(browser)
    began = datetime.now(timezone.utc) - ABSOLUTE - timedelta(minutes=1)
    # The token's own exp is already in the past, so it is simply not a session.
    response = _refresh_with(browser, _admin_token_signed_in_at(began))

    assert response.status_code == 401


def test_a_refresh_keeps_the_csrf_value_so_requests_in_flight_survive(browser):
    _sign_in(browser)
    csrf = browser.cookies.get("uep_csrf")

    response = browser.post(REFRESH, headers={"X-CSRF-Token": csrf})

    assert response.status_code == 200
    csrf_headers = [h for h in response.headers.get_list("set-cookie") if h.startswith("uep_csrf=")]
    assert csrf_headers and csrf_headers[0].split("=", 1)[1].startswith(csrf)


def test_a_refresh_without_a_session_is_refused(browser):
    assert browser.post(REFRESH).status_code in (401, 403)


def test_a_refresh_needs_the_csrf_token_like_any_other_write(browser):
    _sign_in(browser)

    response = browser.post(REFRESH)

    assert response.status_code == 403
