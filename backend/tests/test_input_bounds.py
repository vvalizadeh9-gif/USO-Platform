"""Every input bounded, every response bounded.

None of these were exploitable in the access-control sense. They are the ways
a system that works today stops working under load, or under someone who is
deliberately unkind to it: a body read fully into memory before its size is
checked, a filename that reaches os.path.join, a list with no ceiling, a
response that returns a whole table.

Run with:  cd backend && pytest tests/test_input_bounds.py -q
"""
import io
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_bounds_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.services import evidence_store  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_bounds_pytest.db"):
        os.remove("/tmp/uep_bounds_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        yield c


def _admin(client) -> dict:
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _pm(client) -> dict:
    """Both bulk endpoints below exclude Admin by design (separation of
    duties), and a role guard is resolved before the request body is
    validated -- so an admin token gets 403 and never reaches the ceiling
    being tested here."""
    token = _admin(client)["Authorization"].split()[1]
    return login_as_role(client, token, "PM")


# ---------------------------------------------------------------------------
# H4 — size is enforced while reading, not after
# ---------------------------------------------------------------------------
def test_read_capped_stops_before_the_whole_body_is_in_memory():
    limit_mb = 1
    oversized = io.BytesIO(b"x" * (limit_mb * 1024 * 1024 + 1))

    with pytest.raises(evidence_store.EvidenceError) as exc:
        evidence_store.read_capped(oversized, limit_mb=limit_mb)
    assert "larger than" in str(exc.value)

    # It stopped early rather than draining the source: the read position is
    # at the cap, not at the end. That is the whole property being bought here.
    assert oversized.tell() <= limit_mb * 1024 * 1024 + evidence_store._CHUNK


def test_read_capped_returns_a_file_that_fits():
    content = b"y" * 2048
    assert evidence_store.read_capped(io.BytesIO(content), limit_mb=1) == content


def test_an_oversized_cpm_upload_is_refused(client):
    admin_h = _admin(client)
    from app.core.config import get_settings

    oversized = b"z" * (get_settings().max_upload_mb * 1024 * 1024 + 1024)
    r = client.post(
        "/api/v1/admin/cpm/import",
        headers=admin_h,
        files={"file": ("big.xlsx", oversized, "application/vnd.ms-excel")},
    )
    assert r.status_code == 400, r.text
    assert "larger than" in r.json()["detail"]


# ---------------------------------------------------------------------------
# H5 — an uploaded filename cannot escape the uploads directory
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "hostile",
    [
        "../../app/main.py",
        "../../../etc/passwd",
        "..\\..\\windows\\system32\\x.xlsx",
        "/etc/shadow",
        "....//....//escape.xlsx",
    ],
)
def test_safe_filename_cannot_traverse(hostile):
    cleaned = evidence_store.safe_filename(hostile)
    assert "/" not in cleaned
    assert "\\" not in cleaned
    assert not cleaned.startswith(".")
    assert ".." not in cleaned


def test_safe_filename_keeps_something_usable():
    assert evidence_store.safe_filename("CPM_2026_03.xlsx") == "CPM_2026_03.xlsx"
    assert evidence_store.safe_filename("") == "upload"
    # A name of nothing but dots collapses to a single placeholder character
    # rather than being kept; either way it is a name, not a path.
    assert evidence_store.safe_filename("...") == "_"


def test_a_traversing_cpm_filename_does_not_write_outside_uploads(client, tmp_path):
    """The whole path, not just the helper: nothing lands outside upload_dir."""
    from app.core.config import get_settings

    admin_h = _admin(client)
    upload_dir = get_settings().upload_dir
    before = set(os.listdir(upload_dir)) if os.path.isdir(upload_dir) else set()

    client.post(
        "/api/v1/admin/cpm/import",
        headers=admin_h,
        files={
            "file": (
                "../../../tmp/uep_escaped.xlsx",
                b"PK\x03\x04not-a-real-workbook",
                "application/vnd.ms-experimental",
            )
        },
    )

    assert not os.path.exists("/tmp/uep_escaped.xlsx"), (
        "the upload escaped the uploads directory"
    )
    after = set(os.listdir(upload_dir)) if os.path.isdir(upload_dir) else set()
    for name in after - before:
        assert "/" not in name and ".." not in name


# ---------------------------------------------------------------------------
# M5 / M6 — lists and pages have ceilings
# ---------------------------------------------------------------------------
def test_a_bulk_assignment_list_has_a_ceiling(client):
    from app.schemas import MAX_BULK_IDS

    r = client.post(
        "/api/v1/work-items/assign",
        headers=_pm(client),
        json={
            "work_item_ids": list(range(1, MAX_BULK_IDS + 2)),
            "contractor_id": 1,
        },
    )
    # 422 from the schema, before any role or scope check runs.
    assert r.status_code == 422, r.text


def test_a_health_check_assignment_list_has_a_ceiling(client):
    from app.schemas import MAX_BULK_IDS

    r = client.post(
        "/api/v1/hc/assignments",
        headers=_pm(client),
        json={
            "contractor_id": 1,
            "work_item_ids": list(range(1, MAX_BULK_IDS + 2)),
        },
    )
    assert r.status_code == 422, r.text


@pytest.mark.parametrize(
    "query",
    ["limit=999999", "limit=0", "limit=-1", "offset=-5"],
)
def test_audit_log_pagination_is_bounded(client, query):
    admin_h = _admin(client)
    r = client.get(f"/api/v1/admin/audit-logs?{query}", headers=admin_h)
    assert r.status_code == 422, f"{query} was accepted: {r.text}"


def test_audit_log_accepts_a_sensible_page(client):
    admin_h = _admin(client)
    r = client.get("/api/v1/admin/audit-logs?limit=50&offset=0", headers=admin_h)
    assert r.status_code == 200, r.text


def test_health_check_results_are_paginated(client):
    admin_h = _admin(client)
    assert client.get("/api/v1/hc/results?limit=10", headers=admin_h).status_code == 200
    over = client.get("/api/v1/hc/results?limit=99999", headers=admin_h)
    assert over.status_code == 422, over.text


# ---------------------------------------------------------------------------
# M10 — a download is served as the type we proved, not the type claimed
# ---------------------------------------------------------------------------
def test_media_type_comes_from_the_stored_extension():
    assert evidence_store.media_type_for("acceptance/aa/bb/x.pdf") == "application/pdf"
    assert evidence_store.media_type_for("acceptance/aa/bb/x.png") == "image/png"
    # Not text/html, whatever the uploader's Content-Type header said.
    assert (
        evidence_store.media_type_for("acceptance/aa/bb/x.unknown")
        == "application/octet-stream"
    )
