"""POST /client-errors: the browser's error screens report their Error ID here."""
import logging
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_client_errors_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema, login_form  # noqa: E402

BODY = {"error_id": "UEP-A1B2C3", "route": "/home", "message": "boom", "stack": "x" * 9000}


@pytest.fixture(scope="module")
def client():
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth(client):
    from app.api.client_errors import reset_rate_limit

    reset_rate_limit()
    token = client.post("/api/v1/auth/login", data=login_form(client)).cookies["uep_session"]
    return {"Authorization": f"Bearer {token}"}


def test_requires_a_session(client):
    assert client.post("/api/v1/client-errors", json=BODY).status_code == 401


def test_logs_one_error_line_with_the_user(client, auth, caplog):
    caplog.set_level(logging.ERROR, logger="uep.client")
    res = client.post("/api/v1/client-errors", json=BODY, headers=auth)
    assert res.status_code == 204
    record = [r for r in caplog.records if r.name == "uep.client"][-1]
    assert record.levelname == "ERROR"
    assert record.source == "client"
    assert record.error_id == "UEP-A1B2C3"
    assert record.user_id == 1
    assert record.role == "Admin"
    assert len(record.stack) == 4096


def test_rate_limited_to_thirty_a_minute(client, auth):
    codes = [client.post("/api/v1/client-errors", json=BODY, headers=auth).status_code for _ in range(31)]
    assert codes[:30] == [204] * 30
    assert codes[30] == 429
