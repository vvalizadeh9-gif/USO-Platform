"""Tests for the startup configuration checks, token signing and login throttling.

These cover the things that are meant to fail loudly. A check that silently
stops working is worse than no check at all, because everyone assumes it is
still there -- so each one is pinned down here.
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_sec_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import (  # noqa: E402
    INSECURE_ADMIN_PASSWORD,
    INSECURE_JWT_SECRET,
    Settings,
)
from app.core.rate_limit import login_rate_limiter  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

# A configuration that should be accepted: real secret, real password, a named
# origin. Individual tests override one field at a time from this.
GOOD_CONFIG = dict(
    _env_file=None,
    app_env="production",
    jwt_secret_key="x" * 48,
    first_admin_password="a-genuinely-chosen-password",
    cors_origins="https://uep.example.com",
)


def _reset_throttle() -> None:
    """Clear the login-attempt table between tests.

    The throttle is database-backed now, so resetting it needs a session
    rather than clearing a dict.
    """
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
def _clear_rate_limiter():
    """Each test starts with no recorded failures, and leaves none behind."""
    _reset_throttle()
    yield
    _reset_throttle()


# --------------------------------------------------------------------------
# Startup configuration checks
# --------------------------------------------------------------------------

def test_production_accepts_a_properly_configured_environment():
    settings = Settings(**GOOD_CONFIG)
    assert settings.cors_origin_list == ["https://uep.example.com"]


@pytest.mark.parametrize(
    "override, expected_phrase",
    [
        ({"jwt_secret_key": INSECURE_JWT_SECRET}, "JWT_SECRET_KEY is still the default"),
        ({"jwt_secret_key": "tooshort"}, "at least 32"),
        ({"first_admin_password": INSECURE_ADMIN_PASSWORD}, "FIRST_ADMIN_PASSWORD"),
        ({"cors_origins": "*"}, "CORS_ORIGINS"),
        ({"cors_origins": ""}, "CORS_ORIGINS is empty"),
    ],
    ids=["default-secret", "short-secret", "default-password", "wildcard-cors", "empty-cors"],
)
def test_production_refuses_to_start_on_insecure_configuration(override, expected_phrase):
    """Each of these would previously have started the application quite happily.

    The one that matters most is the default JWT secret: it is published in this
    repository, so anyone could have signed their own admin token with it.
    """
    with pytest.raises(ValueError, match=expected_phrase):
        Settings(**{**GOOD_CONFIG, **override})


def test_the_error_names_every_problem_at_once_not_just_the_first():
    """Otherwise fixing the config becomes a guessing game, one restart at a time."""
    with pytest.raises(ValueError) as excinfo:
        Settings(
            _env_file=None,
            app_env="production",
            jwt_secret_key=INSECURE_JWT_SECRET,
            first_admin_password=INSECURE_ADMIN_PASSWORD,
            cors_origins="*",
        )

    message = str(excinfo.value)
    assert "JWT_SECRET_KEY" in message
    assert "FIRST_ADMIN_PASSWORD" in message
    assert "CORS_ORIGINS" in message


def test_development_is_allowed_to_use_the_insecure_defaults():
    """Local work must stay frictionless, or people will disable the check."""
    settings = Settings(
        _env_file=None,
        app_env="development",
        jwt_secret_key=INSECURE_JWT_SECRET,
        first_admin_password=INSECURE_ADMIN_PASSWORD,
        cors_origins="*",
    )
    assert settings.is_development


def test_an_unset_app_env_is_treated_as_production(monkeypatch):
    """The safe default: forgetting to set APP_ENV must not disable the checks.

    The test suite sets APP_ENV=development for the whole process, so this
    removes it to see what a server with nothing configured would do.
    """
    monkeypatch.delenv("APP_ENV", raising=False)

    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        Settings(_env_file=None, jwt_secret_key=INSECURE_JWT_SECRET)


# --------------------------------------------------------------------------
# Signing keys
# --------------------------------------------------------------------------

def test_captcha_is_not_signed_with_the_access_token_key():
    settings = Settings(**GOOD_CONFIG)
    assert settings.captcha_key != settings.jwt_secret_key


def test_the_derived_captcha_key_does_not_reveal_the_jwt_secret():
    """It is a one-way hash, so holding a captcha token tells you nothing."""
    settings = Settings(**GOOD_CONFIG)
    assert settings.jwt_secret_key not in settings.captcha_key


def test_an_explicit_captcha_key_is_used_as_given():
    settings = Settings(**{**GOOD_CONFIG, "captcha_secret_key": "y" * 40})
    assert settings.captcha_key == "y" * 40


def test_token_payload_shape_is_unchanged_after_moving_to_pyjwt():
    """Existing sessions keep working only if the claims stay identical."""
    from app.core.security import create_access_token, decode_access_token

    claims = decode_access_token(create_access_token(42, {"role": "Admin"}))

    assert claims["sub"] == "42"
    assert claims["role"] == "Admin"
    assert "exp" in claims


def test_a_tampered_token_is_rejected():
    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(1, {"role": "Viewer"})
    head, payload, signature = token.split(".")
    forged = f"{head}.{payload}.{signature[:-4]}AAAA"

    assert decode_access_token(forged) is None


def test_an_unsigned_token_is_rejected():
    """The 'alg: none' trick: a token that asks to be trusted without a signature."""
    import base64
    import json

    def b64(data: dict) -> str:
        raw = json.dumps(data).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    from app.core.security import decode_access_token

    forged = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'sub': '1', 'role': 'Admin'})}."

    assert decode_access_token(forged) is None


# --------------------------------------------------------------------------
# Login throttling
# --------------------------------------------------------------------------

def _attempt(client, password: str):
    return client.post(
        "/api/v1/auth/login", data=login_form(client, "admin", password)
    )


def test_repeated_wrong_passwords_eventually_lock_the_account(client):
    from app.core.config import get_settings

    limit = get_settings().login_max_attempts_per_username

    for i in range(limit):
        assert _attempt(client, "wrong").status_code == 401, f"attempt {i + 1}"

    blocked = _attempt(client, "wrong")
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_the_lockout_also_blocks_the_correct_password(client):
    """Otherwise the limit would not slow a guesser down at all."""
    from app.core.config import get_settings

    for _ in range(get_settings().login_max_attempts_per_username):
        _attempt(client, "wrong")

    assert _attempt(client, "Admin@12345").status_code == 429


def test_a_successful_login_clears_the_counter(client):
    """People who know their password must never hit the limit."""
    _attempt(client, "wrong")
    _attempt(client, "wrong")

    assert _attempt(client, "Admin@12345").status_code == 200

    # The two earlier failures are forgotten, so the full budget is available.
    from app.core.config import get_settings

    for i in range(get_settings().login_max_attempts_per_username):
        assert _attempt(client, "wrong").status_code == 401, f"attempt {i + 1}"


def test_normal_repeated_logins_are_never_throttled(client):
    """The suite itself logs in constantly; so does a real working day."""
    for _ in range(15):
        assert _attempt(client, "Admin@12345").status_code == 200


def test_a_wrong_captcha_does_not_count_towards_the_lockout(client):
    """A mistyped sum is a human slip, not an attack."""
    from app.core.config import get_settings

    for _ in range(get_settings().login_max_attempts_per_username + 3):
        response = client.post(
            "/api/v1/auth/login",
            data={
                "username": "admin",
                "password": "Admin@12345",
                "captcha_token": client.get("/api/v1/auth/captcha").json()["token"],
                "captcha_answer": 999999,
            },
        )
        assert response.status_code == 400

    assert _attempt(client, "Admin@12345").status_code == 200


def test_the_lockout_is_held_in_the_database_not_in_process_memory(client):
    """The property the database-backed throttle exists for.

    The counters used to live in a dict on the process, so any lockout in
    progress was cleared by the next deploy -- and the moment you least want
    that is the one where someone is working through a password list while a
    colleague happens to restart the backend.

    Constructing a second TestClient would *not* prove this: it makes a new
    application instance inside the same Python process, where a module-level
    dict survives just as happily as a table does. What distinguishes the two
    is where the decision is read from -- so this deletes the rows and checks
    the lockout lifts. Against the in-memory implementation it would not.
    """
    from app.core.config import get_settings
    from app.core.database import SessionLocal
    from app.models.auth import LoginAttempt

    limit = get_settings().login_max_attempts_per_username
    for _ in range(limit + 1):
        client.post(
            "/api/v1/auth/login", data=login_form(client, "admin", "wrong-password")
        )

    locked = client.post("/api/v1/auth/login", data=login_form(client, "admin"))
    assert locked.status_code == 429, locked.text

    db = SessionLocal()
    try:
        rows = db.query(LoginAttempt).filter(LoginAttempt.key == "user:admin").count()
        # Five, not six: the sixth attempt met the limit and was refused before
        # it could be counted, which is the throttle working as intended.
        assert rows == limit, (
            f"failures were not recorded in the database ({rows} rows)"
        )
        db.query(LoginAttempt).delete()
        db.commit()
    finally:
        db.close()

    lifted = client.post("/api/v1/auth/login", data=login_form(client, "admin"))
    assert lifted.status_code == 200, (
        "clearing the table did not lift the lockout, so the decision is still "
        "being read from process memory"
    )


def test_a_spent_captcha_is_recorded_in_the_database(client):
    """Same reasoning for the replay guard next door."""
    from app.core.database import SessionLocal
    from app.models.auth import SpentCaptcha

    challenge = client.get("/api/v1/auth/captcha").json()
    form = {
        "username": "admin",
        "password": "Admin@12345",
        "captcha_token": challenge["token"],
        "captcha_answer": challenge["num1"] + challenge["num2"],
    }
    assert client.post("/api/v1/auth/login", data=form).status_code == 200

    db = SessionLocal()
    try:
        assert db.query(SpentCaptcha).count() >= 1, (
            "the spent challenge was not recorded, so a restart would forget it"
        )
    finally:
        db.close()

    replayed = client.post("/api/v1/auth/login", data=form)
    assert replayed.status_code == 400, replayed.text
