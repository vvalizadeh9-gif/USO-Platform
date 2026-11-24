"""Liveness and readiness (UEP-23 5.5)."""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_health_ready_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from tests.conftest import create_schema  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_health_ready_pytest.db"):
        os.remove("/tmp/uep_health_ready_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


class _Broken:
    """Stands in for the engine when the database is down."""

    def connect(self):
        raise ConnectionError("database is down")


def test_ready_with_a_database(client):
    response = client.get("/api/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_not_ready_without_a_database(client, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "engine", _Broken())
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "database unavailable"}


def test_not_ready_when_the_database_hangs(client, monkeypatch):
    import threading

    import app.main as main

    release = threading.Event()

    class _Hanging:
        def connect(self):
            release.wait(10)
            raise ConnectionError("gave up")

    monkeypatch.setattr(main, "engine", _Hanging())
    monkeypatch.setattr(main, "READY_TIMEOUT_SECONDS", 0.2)
    try:
        assert client.get("/api/health/ready").status_code == 503
    finally:
        release.set()


def test_liveness_does_not_touch_the_database(client, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "engine", _Broken())
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
