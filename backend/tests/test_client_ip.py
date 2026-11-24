"""Client address behind our proxies (UEP-23 5.4).

Each proxy appends the address it saw to X-Forwarded-For; whatever the client
sent itself sits further left and is not trusted. The client is the entry
TRUSTED_PROXY_HOPS places from the right.
"""
import os
import sys
from types import SimpleNamespace

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_client_ip_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.rate_limit import client_ip  # noqa: E402
from tests.conftest import create_schema, login_form  # noqa: E402


def _request(xff: str | None, peer: str = "10.42.0.9"):
    headers = {} if xff is None else {"x-forwarded-for": xff}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=peer))


@pytest.fixture
def hops(monkeypatch):
    def set_hops(value: int) -> None:
        monkeypatch.setattr(get_settings(), "trusted_proxy_hops", value)

    return set_hops


@pytest.mark.parametrize(
    "value, xff, expected",
    [
        # Compose: nginx appended the real client.
        (1, "203.0.113.5", "203.0.113.5"),
        # Compose: the client forged a leading entry; nginx's is still last.
        (1, "1.2.3.4, 203.0.113.5", "203.0.113.5"),
        # Kubernetes: the Ingress appended the client, nginx appended the Ingress pod.
        (2, "203.0.113.5, 10.42.1.7", "203.0.113.5"),
        (2, "1.2.3.4, 5.6.7.8, 203.0.113.5, 10.42.1.7", "203.0.113.5"),
        # Header shorter than the number of proxies: fall back to the connection.
        (2, "203.0.113.5", "10.42.0.9"),
        # No header at all.
        (1, None, "10.42.0.9"),
        # Hops = 0: the header is ignored entirely.
        (0, "203.0.113.5", "10.42.0.9"),
        # Stray spaces and empty entries.
        (1, " 1.2.3.4 ,, 203.0.113.5 ", "203.0.113.5"),
    ],
)
def test_client_ip_counts_from_the_right(hops, value, xff, expected):
    hops(value)
    assert client_ip(_request(xff)) == expected


# --- End to end: the per-IP login limit cannot be dodged -----------------


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_client_ip_pytest.db"):
        os.remove("/tmp/uep_client_ip_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _reset(client):
    from app.core.database import SessionLocal
    from app.core.rate_limit import login_rate_limiter

    db = SessionLocal()
    try:
        login_rate_limiter.reset(db)
    finally:
        db.close()


@pytest.mark.parametrize("value, real_chain", [(1, "203.0.113.77"), (2, "203.0.113.77, 10.42.1.7")])
def test_a_forged_forwarded_header_does_not_reset_the_per_ip_limit(client, hops, value, real_chain):
    """Every guess uses a new username and a new forged address; the IP limit still bites."""
    hops(value)
    _reset(client)
    limit = get_settings().login_max_attempts_per_ip
    statuses = []
    for i in range(limit + 1):
        forged = f"198.51.100.{i}"
        response = client.post(
            "/api/v1/auth/login",
            data=login_form(client, f"nobody_{value}_{i}", "wrong-password"),
            headers={"X-Forwarded-For": f"{forged}, {real_chain}"},
        )
        statuses.append(response.status_code)
    _reset(client)
    assert statuses[:limit] == [401] * limit
    assert statuses[limit] == 429, statuses
