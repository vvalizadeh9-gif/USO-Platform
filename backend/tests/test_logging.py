"""Tests for request logging.

Two things need to stay true. The logs must contain enough to investigate a
failure -- which request, which user, what went wrong -- and they must never
contain a password, a token, or a request body. Both are easy to break by
accident later, so both are pinned here.
"""
import json
import logging
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_logging_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.logging_config import JsonFormatter, TextFormatter  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402

ADMIN_PASSWORD = "Admin@12345"


@pytest.fixture(scope="module")
def client():
    create_schema()
    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def captured(caplog):
    """Capture request-log records."""
    caplog.set_level(logging.INFO, logger="uep.request")
    return caplog


def _records(captured):
    return [r for r in captured.records if r.name == "uep.request"]


def test_a_request_is_logged_with_path_status_and_timing(client, captured):
    client.get("/api/health")

    record = _records(captured)[-1]
    assert record.path == "/api/health"
    assert record.status_code == 200
    assert record.duration_ms >= 0
    assert record.request_id


def test_an_anonymous_request_logs_no_user(client, captured):
    client.get("/api/v1/work-items")

    assert _records(captured)[-1].user_id is None


def test_an_authenticated_request_logs_who_made_it(client, captured):
    token = client.post("/api/v1/auth/login", data=login_form(client)).json()[
        "access_token"
    ]

    client.get("/api/v1/work-items", headers={"Authorization": f"Bearer {token}"})

    assert _records(captured)[-1].user_id == 1


def test_a_forged_token_does_not_produce_a_user_id(client, captured):
    """The log must reflect who really is signed in, not who claims to be."""
    client.get("/api/v1/work-items", headers={"Authorization": "Bearer not.a.token"})

    assert _records(captured)[-1].user_id is None


def test_the_password_never_reaches_the_log(client, captured):
    """A login body contains a password; the log records the outcome only."""
    client.post("/api/v1/auth/login", data=login_form(client))

    for record in _records(captured):
        rendered = JsonFormatter().format(record)
        assert ADMIN_PASSWORD not in rendered
        assert "password" not in rendered.lower()


def test_the_token_never_reaches_the_log(client, captured):
    token = client.post("/api/v1/auth/login", data=login_form(client)).json()[
        "access_token"
    ]

    client.get("/api/v1/work-items", headers={"Authorization": f"Bearer {token}"})

    for record in _records(captured):
        assert token not in JsonFormatter().format(record)


def test_the_query_string_is_not_logged(client, captured):
    """Filter values end up in logs that get copied around; the path is enough."""
    client.get("/api/v1/work-items?province_id=7&search=something-identifying")

    rendered = JsonFormatter().format(_records(captured)[-1])
    assert "something-identifying" not in rendered
    assert "province_id" not in rendered


def test_an_unhandled_exception_is_logged_with_the_request_and_the_user(
    client, captured
):
    """The failure this exists for: a 500 with no idea who hit it or where."""
    from app.main import app

    @app.get("/api/v1/_test_explode")
    def _explode():
        raise RuntimeError("something went badly wrong")

    token = client.post("/api/v1/auth/login", data=login_form(client)).json()[
        "access_token"
    ]

    client.get("/api/v1/_test_explode", headers={"Authorization": f"Bearer {token}"})

    errors = [r for r in _records(captured) if r.levelno >= logging.ERROR]
    assert errors, "an unhandled exception must be logged"

    failure = errors[-1]
    assert failure.path == "/api/v1/_test_explode"
    assert failure.user_id == 1
    assert failure.exc_info is not None, "the stack trace must be kept"
    assert "something went badly wrong" in JsonFormatter().format(failure)


def test_an_http_exception_is_not_logged_as_a_server_error(client, captured):
    """A 403 is the application working correctly, not something to page about."""
    from app.main import app

    @app.get("/api/v1/_test_forbidden")
    def _forbidden():
        raise HTTPException(status_code=403, detail="nope")

    client.get("/api/v1/_test_forbidden")

    assert _records(captured)[-1].levelno == logging.INFO


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

def test_json_output_is_one_valid_object_per_line():
    record = logging.LogRecord(
        "uep.request", logging.INFO, "f.py", 1, "GET /x -> 200", None, None
    )
    record.path = "/x"
    record.user_id = 7

    line = JsonFormatter().format(record)

    assert "\n" not in line
    parsed = json.loads(line)
    assert parsed["message"] == "GET /x -> 200"
    assert parsed["path"] == "/x"
    assert parsed["user_id"] == 7
    assert parsed["level"] == "INFO"
    assert parsed["timestamp"].endswith("+00:00"), "timestamps must carry a zone"


def test_text_output_includes_the_extra_context():
    record = logging.LogRecord(
        "uep.request", logging.INFO, "f.py", 1, "GET /x -> 200", None, None
    )
    record.user_id = 7

    line = TextFormatter().format(record)

    assert "GET /x -> 200" in line
    assert "user_id=7" in line


def test_farsi_text_survives_the_json_formatter():
    """Village names and problem categories are Farsi; escaping them makes the
    logs unreadable for the people who need them."""
    record = logging.LogRecord(
        "uep.request", logging.INFO, "f.py", 1, "import: هدف", None, None
    )

    assert "هدف" in JsonFormatter().format(record)
