"""Session integrity: what it takes to end a session someone else is holding.

Deactivating an account always worked, because ``get_current_user`` reads
``users.active`` on every request. Changing a password did not, because nothing
in the request path looked at the password at all -- so the standard response
to a compromised account left the attacker's token working for the rest of its
eight hours, and the only way to end it was rotating ``JWT_SECRET_KEY``, which
signs out every user in the platform.

Run with:  cd backend && pytest tests/test_session_integrity.py -q
"""
import os
import sys
import time

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_session_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema, login_form  # noqa: E402

PASSWORD = "Session-Test-Passw0rd"
NEW_PASSWORD = "Session-Test-Passw0rd-2"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_session_pytest.db"):
        os.remove("/tmp/uep_session_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _admin(client) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _make_user(client, admin_h, username: str) -> int:
    roles = client.get("/api/v1/reference/roles", headers=admin_h).json()
    role_id = next(r["id"] for r in roles if r["name"] == "Viewer")
    r = client.post(
        "/api/v1/admin/users",
        headers=admin_h,
        json={
            "username": username,
            "password": PASSWORD,
            "full_name": "Session Test",
            "role_id": role_id,
            "sees_all_provinces": True,
            "province_ids": [],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _token_for(client, username: str, password: str = PASSWORD) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client, username, password))
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _still_works(client, headers) -> bool:
    return client.get("/api/v1/action-center", headers=headers).status_code == 200


# ---------------------------------------------------------------------------
# H3 — a password change ends existing sessions
# ---------------------------------------------------------------------------
def test_changing_a_password_invalidates_tokens_already_issued(client):
    admin_h = _admin(client)
    user_id = _make_user(client, admin_h, "si_compromised")

    stolen = _token_for(client, "si_compromised")
    assert _still_works(client, stolen), "the token should work before the reset"

    r = client.patch(
        f"/api/v1/admin/users/{user_id}",
        headers=admin_h,
        json={"password": NEW_PASSWORD},
    )
    assert r.status_code == 200, r.text

    assert not _still_works(client, stolen), (
        "the token issued before the password change must be refused"
    )
    assert client.get("/api/v1/action-center", headers=stolen).status_code == 401


def test_the_user_can_sign_in_again_with_the_new_password(client):
    admin_h = _admin(client)
    user_id = _make_user(client, admin_h, "si_reset_then_login")
    _token_for(client, "si_reset_then_login")

    client.patch(
        f"/api/v1/admin/users/{user_id}",
        headers=admin_h,
        json={"password": NEW_PASSWORD},
    )

    fresh = _token_for(client, "si_reset_then_login", NEW_PASSWORD)
    assert _still_works(client, fresh)


def test_resetting_one_password_does_not_sign_anyone_else_out(client):
    admin_h = _admin(client)
    target_id = _make_user(client, admin_h, "si_target")
    _make_user(client, admin_h, "si_bystander")

    bystander = _token_for(client, "si_bystander")
    client.patch(
        f"/api/v1/admin/users/{target_id}",
        headers=admin_h,
        json={"password": NEW_PASSWORD},
    )
    assert _still_works(client, bystander), (
        "rotating one account's sessions must not rotate everybody's -- that "
        "was the only tool available before token_version existed"
    )


def test_an_unrelated_edit_does_not_sign_the_user_out(client):
    admin_h = _admin(client)
    user_id = _make_user(client, admin_h, "si_renamed")
    token = _token_for(client, "si_renamed")

    r = client.patch(
        f"/api/v1/admin/users/{user_id}",
        headers=admin_h,
        json={"full_name": "Renamed Person"},
    )
    assert r.status_code == 200, r.text
    assert _still_works(client, token), "only a credential change ends sessions"


def test_deactivation_still_ends_the_session(client):
    admin_h = _admin(client)
    user_id = _make_user(client, admin_h, "si_deactivated")
    token = _token_for(client, "si_deactivated")

    r = client.delete(f"/api/v1/admin/users/{user_id}", headers=admin_h)
    assert r.status_code == 200, r.text
    assert not _still_works(client, token)


# ---------------------------------------------------------------------------
# M12 — a captcha challenge is good for one attempt
# ---------------------------------------------------------------------------
def test_a_captcha_challenge_cannot_be_reused(client):
    admin_h = _admin(client)
    _make_user(client, admin_h, "si_captcha")

    challenge = client.get("/api/v1/auth/captcha").json()
    form = {
        "username": "si_captcha",
        "password": PASSWORD,
        "captcha_token": challenge["token"],
        "captcha_answer": challenge["num1"] + challenge["num2"],
    }

    assert client.post("/api/v1/auth/login", data=form).status_code == 200
    second = client.post("/api/v1/auth/login", data=form)
    assert second.status_code == 400, second.text
    assert "aptcha" in second.json()["detail"]


def test_a_wrong_captcha_answer_does_not_spend_the_challenge(client):
    """A mistyped sum should not force a page reload to get a new challenge."""
    challenge = client.get("/api/v1/auth/captcha").json()
    wrong = {
        "username": "si_captcha",
        "password": PASSWORD,
        "captcha_token": challenge["token"],
        "captcha_answer": challenge["num1"] + challenge["num2"] + 1,
    }
    assert client.post("/api/v1/auth/login", data=wrong).status_code == 400

    right = dict(wrong, captcha_answer=challenge["num1"] + challenge["num2"])
    assert client.post("/api/v1/auth/login", data=right).status_code == 200


# ---------------------------------------------------------------------------
# M11 — an unknown username costs the same as a known one
# ---------------------------------------------------------------------------
def test_an_unknown_username_is_not_faster_than_a_wrong_password(client):
    """Login used to short-circuit on an unknown user, skipping bcrypt.

    The response body was already identical; the response *time* was what said
    whether the account existed. The ratio asserted here is deliberately loose
    -- the two paths should now cost the same, and anything above a fifth is
    far outside the old behaviour, where the unknown-user path returned in
    microseconds against bcrypt's hundreds of milliseconds.
    """
    admin_h = _admin(client)
    _make_user(client, admin_h, "si_timing")

    def attempt(username: str) -> float:
        form = login_form(client, username, "definitely-not-the-password")
        start = time.perf_counter()
        r = client.post("/api/v1/auth/login", data=form)
        assert r.status_code == 401, r.text
        return time.perf_counter() - start

    known = min(attempt("si_timing") for _ in range(3))
    unknown = min(attempt("si_no_such_person_at_all") for _ in range(3))

    assert unknown > known * 0.2, (
        f"unknown username returned in {unknown:.4f}s against {known:.4f}s for a "
        "known one, which tells an attacker which accounts exist"
    )


# ---------------------------------------------------------------------------
# L7 — a user can change their own password, and see who they are
# ---------------------------------------------------------------------------
def test_a_user_can_read_their_own_profile(client):
    admin_h = _admin(client)
    _make_user(client, admin_h, "si_me")
    token = _token_for(client, "si_me")

    r = client.get("/api/v1/auth/me", headers=token)
    assert r.status_code == 200, r.text
    assert r.json()["username"] == "si_me"
    assert r.json()["role"]["name"] == "Viewer"


def test_auth_me_refuses_an_invalidated_token(client):
    """Which is what makes it usable for revalidating a cached user."""
    admin_h = _admin(client)
    user_id = _make_user(client, admin_h, "si_me_stale")
    token = _token_for(client, "si_me_stale")

    client.patch(
        f"/api/v1/admin/users/{user_id}",
        headers=admin_h,
        json={"password": NEW_PASSWORD},
    )
    assert client.get("/api/v1/auth/me", headers=token).status_code == 401


def test_changing_your_own_password_works_and_rotates_the_token(client):
    admin_h = _admin(client)
    _make_user(client, admin_h, "si_selfchange")
    old = _token_for(client, "si_selfchange")

    r = client.post(
        "/api/v1/auth/me/password",
        headers=old,
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert r.status_code == 200, r.text

    # The old token went with every other session for this account...
    assert client.get("/api/v1/auth/me", headers=old).status_code == 401
    # ...and the caller was handed a working one rather than signed out for
    # succeeding.
    fresh = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=fresh).status_code == 200

    # And the new password is the one that signs in.
    assert _still_works(client, _token_for(client, "si_selfchange", NEW_PASSWORD))


def test_changing_your_password_requires_the_current_one(client):
    """A borrowed unlocked laptop must not become a permanent takeover."""
    admin_h = _admin(client)
    _make_user(client, admin_h, "si_needs_current")
    token = _token_for(client, "si_needs_current")

    r = client.post(
        "/api/v1/auth/me/password",
        headers=token,
        json={"current_password": "not-it", "new_password": NEW_PASSWORD},
    )
    assert r.status_code == 400, r.text
    assert _still_works(client, token), "a failed attempt must not sign anyone out"


def test_the_new_password_must_actually_be_new(client):
    admin_h = _admin(client)
    _make_user(client, admin_h, "si_same_again")
    token = _token_for(client, "si_same_again")

    r = client.post(
        "/api/v1/auth/me/password",
        headers=token,
        json={"current_password": PASSWORD, "new_password": PASSWORD},
    )
    assert r.status_code == 400, r.text


def test_a_short_password_is_refused_by_the_schema(client):
    admin_h = _admin(client)
    _make_user(client, admin_h, "si_short_pw")
    token = _token_for(client, "si_short_pw")

    r = client.post(
        "/api/v1/auth/me/password",
        headers=token,
        json={"current_password": PASSWORD, "new_password": "short"},
    )
    assert r.status_code == 422, r.text


def test_guessing_the_current_password_is_throttled(client):
    """The endpoint must not be an unlimited oracle for the current password.

    Someone holding a stolen token already has the session; confirming the
    password is what lets them try it on the user's other systems.
    """
    from app.core.rate_limit import login_rate_limiter

    admin_h = _admin(client)
    _make_user(client, admin_h, "si_throttled")
    token = _token_for(client, "si_throttled")
    login_rate_limiter.reset()

    codes = []
    for _ in range(8):
        r = client.post(
            "/api/v1/auth/me/password",
            headers=token,
            json={"current_password": "wrong", "new_password": NEW_PASSWORD},
        )
        codes.append(r.status_code)

    assert 429 in codes, f"never throttled: {codes}"
    login_rate_limiter.reset()
