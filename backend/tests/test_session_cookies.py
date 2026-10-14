"""The browser session: cookies, CSRF, the sign-in messages and the lockout.

The sign-in page holds no token. The server sets an HttpOnly session cookie
and a readable CSRF cookie, and every write made with the session cookie must
echo the CSRF value in a header. These tests drive that through an https://
client, because the cookies are Secure and a client on http:// never sends them
back (which is also why the rest of the suite can keep using Bearer headers).

Run with:  cd backend && pytest tests/test_session_cookies.py -q
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_session_cookies_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema, login_form  # noqa: E402

HTTPS = "https://testserver"
LOGIN = "/api/v1/auth/login"
ADMIN = "admin"
ADMIN_PASSWORD = "Admin@12345"


def _reset_throttle() -> None:
    from app.core.database import SessionLocal
    from app.core.rate_limit import login_rate_limiter

    db = SessionLocal()
    try:
        login_rate_limiter.reset(db)
    finally:
        db.close()


def _audit_entries(action: str) -> list:
    from app.core.database import SessionLocal
    from app.models.acceptance import AuditLog

    db = SessionLocal()
    try:
        return db.query(AuditLog).filter(AuditLog.action == action).order_by(AuditLog.id).all()
    finally:
        db.close()


@pytest.fixture(scope="module")
def app():
    if os.path.exists("/tmp/uep_session_cookies_pytest.db"):
        os.remove("/tmp/uep_session_cookies_pytest.db")
    create_schema()
    from app.main import app as fastapi_app

    return fastapi_app


@pytest.fixture
def browser(app):
    """A fresh https client, so each test starts with an empty cookie jar."""
    _reset_throttle()
    with TestClient(app, base_url=HTTPS) as c:
        yield c
    _reset_throttle()


def _sign_in(client, username=ADMIN, password=ADMIN_PASSWORD, **kwargs):
    return client.post(LOGIN, data=login_form(client, username, password), **kwargs)


def _set_cookie_headers(response) -> dict[str, str]:
    """Each Set-Cookie header, keyed by the cookie's name, lower-cased."""
    headers = response.headers.get_list("set-cookie")
    return {h.split("=", 1)[0]: h.lower() for h in headers}


def _csrf_header(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("uep_csrf")}


# ---------------------------------------------------------------------------
# Signing in
# ---------------------------------------------------------------------------


def test_sign_in_sets_an_httponly_session_and_a_readable_csrf_cookie(browser):
    response = _sign_in(browser)

    assert response.status_code == 200, response.text
    cookies = _set_cookie_headers(response)
    session, csrf = cookies["uep_session"], cookies["uep_csrf"]
    for attribute in ("secure", "samesite=strict", "max-age=1800"):
        assert attribute in session
        assert attribute in csrf
    assert "httponly" in session and "path=/api" in session
    assert "httponly" not in csrf and "path=/;" in csrf + ";"


def test_the_token_is_never_in_the_response_body(browser):
    body = _sign_in(browser).json()

    assert "access_token" not in body
    assert body["user"]["username"] == ADMIN


def test_the_session_cookie_authenticates_reads(browser):
    _sign_in(browser)

    response = browser.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["username"] == ADMIN


def test_no_cookie_and_no_header_is_unauthenticated(browser):
    assert browser.get("/api/v1/auth/me").status_code == 401


def test_a_wrong_password_gets_the_generic_message(browser):
    response = _sign_in(browser, password="not-the-password")

    assert response.status_code == 401
    assert response.json()["detail"] == "Username or password is incorrect."
    assert "uep_session" not in _set_cookie_headers(response)


def test_an_unknown_username_gets_the_same_message(browser):
    response = _sign_in(browser, username="nobody-by-this-name")

    assert response.status_code == 401
    assert response.json()["detail"] == "Username or password is incorrect."


# ---------------------------------------------------------------------------
# Lockout and audit
# ---------------------------------------------------------------------------


def test_five_failures_lock_the_username_and_say_for_how_long(browser):
    from app.core.config import get_settings

    limit = get_settings().login_max_attempts_per_username
    for _ in range(limit):
        assert _sign_in(browser, password="wrong").status_code == 401

    # The right password does not get through a lock.
    locked = _sign_in(browser)

    assert locked.status_code == 429
    assert locked.json()["detail"] == "Too many attempts. Try again in 15 minutes."
    assert 0 < int(locked.headers["retry-after"]) <= 900


def test_every_sign_in_outcome_is_audited(browser):
    successes_before = len(_audit_entries("LOGIN_SUCCESS"))
    failures_before = len(_audit_entries("LOGIN_FAILED"))

    _sign_in(browser, password="wrong")
    _sign_in(browser)

    failures = _audit_entries("LOGIN_FAILED")
    assert len(failures) == failures_before + 1
    assert failures[-1].result == "Failure"
    assert failures[-1].new_value == {"username": ADMIN}
    assert len(_audit_entries("LOGIN_SUCCESS")) == successes_before + 1


def test_a_refusal_while_locked_out_is_audited_too(browser):
    from app.core.config import get_settings

    for _ in range(get_settings().login_max_attempts_per_username):
        _sign_in(browser, password="wrong")
    before = len(_audit_entries("LOGIN_FAILED"))

    _sign_in(browser)

    after = _audit_entries("LOGIN_FAILED")
    assert len(after) == before + 1
    assert "Locked out" in after[-1].reason


def test_no_audit_entry_carries_the_password(browser):
    _sign_in(browser, password="a-very-distinctive-wrong-password")

    for entry in _audit_entries("LOGIN_FAILED"):
        assert "a-very-distinctive-wrong-password" not in repr(entry.new_value)
        assert "a-very-distinctive-wrong-password" not in (entry.reason or "")


# ---------------------------------------------------------------------------
# CSRF
# ---------------------------------------------------------------------------


def test_a_cookie_write_without_the_csrf_header_is_refused(browser):
    _sign_in(browser)

    response = browser.post("/api/v1/auth/logout")

    assert response.status_code == 403
    assert "security token" in response.json()["detail"]


def test_a_cookie_write_with_a_wrong_csrf_header_is_refused(browser):
    _sign_in(browser)

    response = browser.post("/api/v1/auth/logout", headers={"X-CSRF-Token": "guess"})

    assert response.status_code == 403


def test_a_cookie_write_with_the_csrf_header_goes_through(browser):
    _sign_in(browser)

    response = browser.post("/api/v1/auth/logout", headers=_csrf_header(browser))

    assert response.status_code == 200


def test_signing_out_expires_both_cookies(browser):
    _sign_in(browser)

    response = browser.post("/api/v1/auth/logout", headers=_csrf_header(browser))

    cookies = _set_cookie_headers(response)
    assert "max-age=0" in cookies["uep_session"]
    assert "max-age=0" in cookies["uep_csrf"]
    assert browser.get("/api/v1/auth/me").status_code == 401


def test_a_bearer_write_needs_no_csrf_header(browser):
    token = _sign_in(browser).cookies["uep_session"]
    browser.cookies.clear()

    response = browser.post(
        "/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200


def test_a_sign_in_posted_from_another_site_is_refused(browser):
    response = _sign_in(browser, headers={"Origin": "https://evil.example"})

    assert response.status_code == 403
    assert "another site" in response.json()["detail"]


def test_a_sign_in_from_this_site_is_accepted(browser):
    response = _sign_in(browser, headers={"Origin": HTTPS})

    assert response.status_code == 200


def test_a_null_origin_is_refused(browser):
    assert _sign_in(browser, headers={"Origin": "null"}).status_code == 403


def test_reads_are_never_refused_for_csrf(browser):
    _sign_in(browser)

    response = browser.get("/api/v1/auth/me", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Session renewal. Last of the sign-in tests: it changes the admin's password.
# ---------------------------------------------------------------------------


def test_changing_your_password_renews_the_session_cookie(browser):
    _sign_in(browser)
    old_session = browser.cookies.get("uep_session")
    new_password = "A-Fresh-Session-Passw0rd"

    response = browser.post(
        "/api/v1/auth/me/password",
        headers=_csrf_header(browser),
        json={"current_password": ADMIN_PASSWORD, "new_password": new_password},
    )
    assert response.status_code == 200, response.text
    assert "access_token" not in response.json()

    new_session = browser.cookies.get("uep_session")
    assert new_session and new_session != old_session
    assert browser.get("/api/v1/auth/me").status_code == 200


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (1, "Too many attempts. Try again in 1 minute."),
        (60, "Too many attempts. Try again in 1 minute."),
        (61, "Too many attempts. Try again in 2 minutes."),
        (900, "Too many attempts. Try again in 15 minutes."),
    ],
)
def test_lockout_message_rounds_up_to_whole_minutes(seconds, expected):
    from app.api.auth import lockout_message

    assert lockout_message(seconds) == expected
