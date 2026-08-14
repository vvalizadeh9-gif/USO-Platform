"""Tests for the two-stage Health Check flow and basket DT-status exclusion.

Stage 1 (subcontractor): mark each requested technology Normal / NotNormal;
NotNormal requires a comment (NOT a problem category).
Stage 2 (coordinator/PM): validate — a Ready site needs no category, a
NotReady site must be assigned one of the four problem categories.

Also verifies the basket excludes on-air sites whose DT status is Done or
Ongoing (Problematic / blank remain eligible).
"""
import os
import sys

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_hcreview_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from tests.conftest import login_form, sample_cpm_path  # noqa: E402


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_hcreview_pytest.db"):
        os.remove("/tmp/uep_hcreview_pytest.db")
    Base.metadata.drop_all(bind=engine)
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client):
    r = client.post("/api/v1/auth/login", data=login_form(client))
    return r.json()["access_token"]


def _seed(client, token):
    sample = sample_cpm_path()
    if not sample:
        pytest.skip("no sample CPM file available")
    with open(sample, "rb") as f:
        client.post(
            "/api/v1/admin/cpm/import",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("cpm.xlsx", f, "application/vnd.ms-excel")},
        )


def _contractor_id():
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        c = db.query(Contractor).first()
        return c.id if c else None
    finally:
        db.close()


def test_basket_excludes_done_and_ongoing(client):
    token = _login(client)
    _seed(client, token)
    h = {"Authorization": f"Bearer {token}"}
    basket = client.get("/api/v1/hc/basket", headers=h).json()
    assert len(basket) > 0

    from app.models.workitem import WorkItem
    from app.services import cpm_columns as C

    db = SessionLocal()
    try:
        ids = [b["work_item_id"] for b in basket]
        wis = db.query(WorkItem).filter(WorkItem.id.in_(ids)).all()
        # No basket item may have a Done/Ongoing DT status.
        for wi in wis:
            assert (
                C.normalize_dt_status(wi.dt_status)
                not in C.DT_STATUS_EXCLUDED_FROM_HC
            )
        # And at least one Done site exists in the data but is NOT in basket.
        done_ids = {
            wi.id
            for wi in db.query(WorkItem).all()
            if C.normalize_dt_status(wi.dt_status) == C.DT_STATUS_DONE
        }
        assert done_ids and done_ids.isdisjoint(set(ids))
    finally:
        db.close()


def _assign_first(client, h):
    basket = client.get("/api/v1/hc/basket", headers=h).json()
    site = basket[0]
    cid = _contractor_id()
    r = client.post(
        "/api/v1/hc/assignments",
        headers=h,
        json={"contractor_id": cid, "work_item_ids": [site["work_item_id"]]},
    )
    assert r.status_code == 201, r.text
    return site, r.json()["tasks"][0]


def test_contractor_notnormal_requires_comment_not_category(client):
    token = _login(client)
    _seed(client, token)
    h = {"Authorization": f"Bearer {token}"}
    site, task = _assign_first(client, h)
    techs = site["requested_technologies"]

    # NotNormal without a comment → 400 (comment mandatory).
    bad = [{"technology": techs[0], "result": "NotNormal"}]
    bad += [{"technology": t, "result": "Normal"} for t in techs[1:]]
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/result",
        headers=h,
        json={"technology_results": bad},
    )
    assert r.status_code == 400

    # NotNormal WITH a comment and NO category → accepted, NotReady, no category.
    good = [{"technology": techs[0], "result": "NotNormal", "comment": "no power"}]
    good += [{"technology": t, "result": "Normal"} for t in techs[1:]]
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/result",
        headers=h,
        json={"technology_results": good},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["overall_result"] == "NotReady"

    from app.models.health_check import HcTask

    db = SessionLocal()
    try:
        t = db.get(HcTask, task["id"])
        assert t.problem_category is None  # contractor never sets category
        assert t.reviewed_at is None
    finally:
        db.close()


def test_coordinator_review_sets_category(client):
    token = _login(client)
    _seed(client, token)
    h = {"Authorization": f"Bearer {token}"}
    site, task = _assign_first(client, h)
    techs = site["requested_technologies"]

    results = [{"technology": techs[0], "result": "NotNormal", "comment": "x"}]
    results += [{"technology": t, "result": "Normal"} for t in techs[1:]]
    client.post(
        f"/api/v1/hc/tasks/{task['id']}/result",
        headers=h,
        json={"technology_results": results},
    )

    # Coordinator review of a NotReady task WITHOUT a category → 400.
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/review", headers=h, json={}
    )
    assert r.status_code == 400

    # WITH a category → 200 and category stored.
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/review",
        headers=h,
        json={"problem_category": "Temporary Power"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["problem_category"] == "Temporary Power"
    assert r.json()["reviewed"] is True


def test_ready_site_review_needs_no_category(client):
    token = _login(client)
    _seed(client, token)
    h = {"Authorization": f"Bearer {token}"}
    site, task = _assign_first(client, h)
    techs = site["requested_technologies"]

    results = [{"technology": t, "result": "Normal"} for t in techs]
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/result",
        headers=h,
        json={"technology_results": results},
    )
    assert r.json()["overall_result"] == "Ready"

    # Ready site: review with null category is fine.
    r = client.post(
        f"/api/v1/hc/tasks/{task['id']}/review", headers=h, json={}
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed"] is True
    assert r.json()["problem_category"] is None
