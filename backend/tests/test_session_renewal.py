"""The sliding session: 30 minutes idle, 8 hours at most.

Run with:  cd backend && pytest tests/test_session_renewal.py -q
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_session_renewal_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema, login_form  # noqa: E402

HTTPS = "https://testserver"
ME = "/api/v1/auth/me"


@pytest.fixture(scope="module")
def app():
    if os.path.exists("/tmp/uep_session_renewal_pytest.db"):
        os.remove("/tmp/uep_session_renewal_pytest.db")
    create_schema()
    from app.main import app as fastapi_app

    return fastapi_app


@pytest.fixture
def browser(app):
    from app.core.database import SessionLocal
    from app.core.rate_limit import login_rate_limiter

    db = SessionLocal()
    login_rate_limiter.reset(db)
    db.close()
    with TestClient(app, base_url=HTTPS) as c:
        c.post("/api/v1/auth/login", data=login_form(c))
        yield c


def _decode(token):
    from app.core.security import decode_access_token

    return decode_access_token(token)


def _aged(browser, *, issued_ago, signed_in_ago=None):
    """The browser's session token, re-minted as if issued ``issued_ago``."""
    from app.core.config import get_settings

    settings = get_settings()
    claims = _decode(browser.cookies.get("uep_session"))
    now = datetime.now(timezone.utc)
    claims["iat"] = int((now - issued_ago).timestamp())
    claims["auth_time"] = int((now - (signed_in_ago or issued_ago)).timestamp())
    claims["exp"] = int((now + timedelta(minutes=5)).timestamp())
    return jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _get(browser, token, **headers):
    """GET /me carrying exactly this session token, outside the cookie jar."""
    csrf = browser.cookies.get("uep_csrf")
    browser.cookies.clear()
    return browser.get(ME, headers={"Cookie": f"uep_session={token}; uep_csrf={csrf}", **headers})


def _set_cookies(response):
    return {h.split("=", 1)[0]: h for h in response.headers.get_list("set-cookie")}


def _issued(response):
    """The token a response set, decoded."""
    return _decode(_set_cookies(response)["uep_session"].split(";")[0].split("=", 1)[1])


def _max_age(response):
    return int(_set_cookies(response)["uep_session"].lower().split("max-age=")[1].split(";")[0])


def test_signing_in_gives_a_thirty_minute_session(browser):
    claims = _decode(browser.cookies.get("uep_session"))

    assert claims["exp"] - claims["iat"] == 30 * 60
    assert claims["auth_time"] == claims["iat"]


def test_activity_slides_the_idle_deadline(browser):
    csrf = browser.cookies.get("uep_csrf")
    token = _aged(browser, issued_ago=timedelta(minutes=10))

    response = _get(browser, token)

    assert response.status_code == 200
    assert _max_age(response) == 1800
    # The CSRF token is kept, so a write already in flight still matches.
    assert _set_cookies(response)["uep_csrf"].startswith(f"uep_csrf={csrf};")
    renewed = _issued(response)
    assert renewed["auth_time"] == _decode(token)["auth_time"]
    assert renewed["exp"] - renewed["iat"] == 30 * 60


def test_a_background_refresh_does_not_keep_the_session_alive(browser):
    token = _aged(browser, issued_ago=timedelta(minutes=10))

    response = _get(browser, token, **{"X-UEP-Background": "1"})

    assert response.status_code == 200
    assert "uep_session" not in _set_cookies(response)


def test_a_token_under_a_minute_old_is_not_reissued(browser):
    response = browser.get(ME)

    assert response.status_code == 200
    assert "uep_session" not in _set_cookies(response)


def test_renewal_never_passes_eight_hours_from_sign_in(browser):
    token = _aged(browser, issued_ago=timedelta(minutes=10), signed_in_ago=timedelta(hours=8, minutes=-10))

    response = _get(browser, token)

    assert 590 <= _max_age(response) <= 600


def test_a_session_past_eight_hours_is_not_renewed(browser):
    token = _aged(browser, issued_ago=timedelta(minutes=10), signed_in_ago=timedelta(hours=8, minutes=1))

    response = _get(browser, token)

    assert response.status_code == 200
    assert "uep_session" not in _set_cookies(response)


def test_bearer_clients_get_no_cookie(app):
    from app.core.security import create_access_token

    token = create_access_token(1, {"ver": 0}, expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))
    with TestClient(app, base_url=HTTPS) as c:
        response = c.get(ME, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert "uep_session" not in _set_cookies(response)
