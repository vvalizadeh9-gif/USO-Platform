"""UEP-06: the pipeline strip, contractor load, undo, and the All sites counts.

* each strip step that has a Home row shows Home's number (and so the rail's),
  and the pipeline-only steps equal the lists their pages show;
* contractor load: open and late from the queues, ``avg_submit_days`` null
  under five samples, province shares of at least 20% (at most five);
* undo: allowed for the same user within two minutes with nothing acted on
  since, 409 otherwise, restores the previous state and writes an audit entry;
* the list rows carry what the new site tables show (village, per-site
  pending checks, the HC result's waiting time);
* GET /work-items/counts sums to the list's scope, stage by stage.
"""
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_pipeline_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.core import audit_actions  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from tests.conftest import create_schema, login_as_role, login_form, sample_cpm_path  # noqa: E402

API = "/api/v1"


@pytest.fixture(scope="module")
def client():
    if os.path.exists("/tmp/uep_pipeline_pytest.db"):
        os.remove("/tmp/uep_pipeline_pytest.db")
    create_schema()
    from app.main import app

    with TestClient(app) as c:
        token = _admin(c)
        sample = sample_cpm_path()
        if not sample:
            pytest.skip("no sample CPM file available")
        with open(sample, "rb") as f:
            r = c.post(
                f"{API}/admin/cpm/import",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": ("cpm.xlsx", f, "application/vnd.ms-excel")},
            )
        assert r.status_code in (200, 201), r.text
        _more_sites(40)
        yield c


def _more_sites(n):
    """Copies of an imported on-air site, so every test can start one fresh."""
    from app.models.workitem import Site, WorkItem
    from app.services import cpm_columns as C

    db = SessionLocal()
    try:
        model = next(
            wi for wi in db.query(WorkItem).all()
            if C.normalize_stage(wi.last_stage) in C.ONAIR_STAGES and not wi.dt_status
        )
        for i in range(n):
            site = Site(site_code=f"PIPE{i:03d}", province_id=model.site.province_id)
            db.add(site)
            db.flush()
            db.add(WorkItem(
                site_id=site.id, site_type=model.site_type,
                requested_technology=model.requested_technology,
                last_stage=model.last_stage, launch_date_shamsi=model.launch_date_shamsi,
            ))
        db.commit()
    finally:
        db.close()


def _admin(client):
    return client.post(f"{API}/auth/login", data=login_form(client)).cookies["uep_session"]


@pytest.fixture(scope="module")
def pm(client):
    return login_as_role(client, _admin(client), "PM")


@pytest.fixture(scope="module")
def coordinator(client):
    return login_as_role(client, _admin(client), "Coordinator")


def _contractors():
    from app.models.reference import Contractor

    db = SessionLocal()
    try:
        return [c.id for c in db.query(Contractor).filter(Contractor.active.is_(True)).order_by(Contractor.id)]
    finally:
        db.close()


def _ready_to_assign(client, h, n=1):
    basket = client.get(f"{API}/hc/basket", headers=h).json()
    ready = [b for b in basket if b["hc_state"] in ("New", "Ready for re-check")]
    assert len(ready) >= n
    return ready[:n]


def _assign_hc(client, h, sites, contractor_id=None):
    r = client.post(
        f"{API}/hc/assignments", headers=h,
        json={"contractor_id": contractor_id or _contractors()[0],
              "work_item_ids": [s["work_item_id"] for s in sites]},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _submit_ready(client, h, task, techs):
    r = client.post(
        f"{API}/hc/tasks/{task['id']}/result", headers=h,
        json={"technology_results": [{"technology": t, "result": "Normal"} for t in techs]},
    )
    assert r.status_code == 200, r.text


def _ready_result(client, h):
    """One site taken through assign → Ready result, awaiting review."""
    site = _ready_to_assign(client, h)[0]
    assignment = _assign_hc(client, h, [site])
    _submit_ready(client, h, assignment["tasks"][0], site["requested_technologies"])
    return site, assignment["tasks"][0]


def _age_audit(entry_id, seconds):
    from app.models.acceptance import AuditLog

    db = SessionLocal()
    try:
        entry = db.get(AuditLog, entry_id)
        entry.created_at = datetime.now(timezone.utc) - timedelta(seconds=seconds)
        db.commit()
    finally:
        db.close()


def _audit_actions():
    from app.models.acceptance import AuditLog

    db = SessionLocal()
    try:
        return [a.action for a in db.query(AuditLog).order_by(AuditLog.id)]
    finally:
        db.close()


# --------------------------------------------------------------------------
# Pipeline summary
# --------------------------------------------------------------------------
STRIP = ["hc1", "hc2", "hc3", "dt4", "dt5", "dt6", "done", "remediation", "reroutes", "sent_back"]
HOME_ROWS = {"hc1": "hc_assign", "hc3": "hc_review", "dt4": "dt_assign", "dt6": "dt_review", "reroutes": "hc_reroutes"}


def _home_counts(client, h):
    home = client.get(f"{API}/me/home", headers=h).json()
    return {t["queue_key"]: t for g in home["groups"] for t in g["tickets"]}


def test_summary_has_every_strip_key_with_its_sla(client, pm):
    s = client.get(f"{API}/drive-test/pipeline/summary", headers=pm)
    assert s.status_code == 200, s.text
    body = s.json()
    assert list(body) == STRIP
    for key in STRIP:
        assert set(body[key]) == {"count", "late", "oldest_days", "sla_days"}
    # Lateness is a day count everywhere but on fixes (own due dates) and done.
    assert body["hc1"]["sla_days"] == 14
    assert body["remediation"]["sla_days"] is None
    assert body["done"]["late"] == 0 and body["done"]["sla_days"] is None


def test_summary_follows_the_admin_sla(client, pm):
    from app.models.action_center import ActionQueueSla

    db = SessionLocal()
    try:
        db.add(ActionQueueSla(queue_key="hc_in_check", sla_days=9))
        db.commit()
    finally:
        db.close()
    body = client.get(f"{API}/drive-test/pipeline/summary", headers=pm).json()
    assert body["hc2"]["sla_days"] == 9
    db = SessionLocal()
    try:
        db.query(ActionQueueSla).filter_by(queue_key="hc_in_check").delete()
        db.commit()
    finally:
        db.close()


@pytest.mark.parametrize("role", ["pm", "coordinator"])
def test_each_step_with_a_home_row_shows_homes_number(client, role, request, pm):
    h = request.getfixturevalue(role)
    _ready_result(client, pm)  # something in HC review (a PM submits it)
    summary = client.get(f"{API}/drive-test/pipeline/summary", headers=h).json()
    home = _home_counts(client, h)
    for step, queue in HOME_ROWS.items():
        ticket = home.get(queue, {"count": 0, "late": 0})
        assert summary[step]["count"] == ticket["count"], step
        assert summary[step]["late"] == ticket["late"], step


def test_pipeline_only_steps_equal_their_lists(client, pm):
    summary = client.get(f"{API}/drive-test/pipeline/summary", headers=pm).json()
    in_check = client.get(f"{API}/hc/queues/in-progress", headers=pm).json()
    assert summary["hc2"]["count"] == sum(len(a["pending"]) for a in in_check)
    dt_rows = client.get(f"{API}/hc/queues/dt-in-progress", headers=pm).json()
    assert summary["dt5"]["count"] == sum(r["status"] == "with_contractor" for r in dt_rows)
    assert summary["sent_back"]["count"] == sum(r["status"] == "sent_back" for r in dt_rows)
    fixes = client.get(f"{API}/hc/queues/remediations", headers=pm).json()
    assert summary["remediation"]["count"] == len(fixes)
    done = client.get(f"{API}/drive-test/sites", headers=pm, params={"bucket": "done"}).json()
    assert summary["done"]["count"] == done["total"]


def test_summary_is_for_review_authority_only(client):
    viewer = login_as_role(client, _admin(client), "Viewer")
    assert client.get(f"{API}/drive-test/pipeline/summary", headers=viewer).status_code == 403


# --------------------------------------------------------------------------
# Rows the site tables read
# --------------------------------------------------------------------------
def test_rows_carry_village_pending_sites_and_result_wait(client, pm):
    basket = client.get(f"{API}/hc/basket", headers=pm).json()
    assert all("village" in b and "village_count" in b for b in basket)
    assert any(b["village_count"] > 0 for b in basket)
    for b in basket:
        assert (b["village"] is None) == (b["village_count"] == 0)

    site = _ready_to_assign(client, pm)[0]
    assignment = _assign_hc(client, pm, [site])
    rows = client.get(f"{API}/hc/queues/in-progress", headers=pm).json()
    mine = next(a for a in rows if a["assignment_id"] == assignment["id"])
    assert [p["work_item_id"] for p in mine["pending"]] == [site["work_item_id"]]
    assert mine["pending"][0]["task_id"] == assignment["tasks"][0]["id"]

    _submit_ready(client, pm, assignment["tasks"][0], site["requested_technologies"])
    results = client.get(f"{API}/hc/results", headers=pm, params={"reviewed": False}).json()
    row = next(r for r in results if r["task_id"] == assignment["tasks"][0]["id"])
    assert row["completed_at"] and row["days_waiting"] == 0


# --------------------------------------------------------------------------
# Contractor load
# --------------------------------------------------------------------------
def test_load_counts_open_work_per_contractor(client, pm):
    load = client.get(f"{API}/hc/contractors/load", headers=pm)
    assert load.status_code == 200, load.text
    rows = load.json()
    assert [r["open"] for r in rows] == sorted(r["open"] for r in rows)
    in_check = client.get(f"{API}/hc/queues/in-progress", headers=pm).json()
    expected = Counter()
    for a in in_check:
        expected[a["contractor_id"]] += len(a["pending"])
    for r in rows:
        assert r["open"] == expected.get(r["contractor_id"], 0)
        assert 0 <= r["late"] <= r["open"]

    dt = client.get(f"{API}/drive-test/contractors/load", headers=pm)
    assert dt.status_code == 200, dt.text


def test_average_needs_five_samples_and_shares_need_twenty_percent(client, pm):
    from app.services import contractor_load as L

    assert L._mean_days([timedelta(days=2)] * 4) is None
    assert L._mean_days([timedelta(days=2)] * 4 + [timedelta(days=7)]) == 3.0

    shares = L._shares(Counter({"a": 50, "b": 25, "c": 15, "d": 10}))
    assert shares == [{"province": "a", "share": 0.5}, {"province": "b", "share": 0.25}]
    assert len(L._shares(Counter({str(i): 1 for i in range(5)}))) == 5
    assert L._shares(Counter()) == []


def test_load_avg_comes_from_submissions(client, pm):
    other = _contractors()[-1]
    sites = _ready_to_assign(client, pm, 5)
    assignment = _assign_hc(client, pm, sites, contractor_id=other)
    for task, site in zip(assignment["tasks"], sites):
        _submit_ready(client, pm, task, site["requested_technologies"])
    row = next(r for r in client.get(f"{API}/hc/contractors/load", headers=pm).json()
               if r["contractor_id"] == other)
    assert row["avg_submit_days"] is not None and row["avg_submit_days"] >= 0
    assert row["provinces"] and row["provinces"][0]["share"] >= 0.2


# --------------------------------------------------------------------------
# Undo
# --------------------------------------------------------------------------
def test_undo_a_health_check_assignment(client, pm):
    site = _ready_to_assign(client, pm)[0]
    assignment = _assign_hc(client, pm, [site])
    r = client.post(f"{API}/hc/assignments/{assignment['id']}/undo", headers=pm)
    assert r.status_code == 200, r.text
    basket = {b["work_item_id"]: b for b in client.get(f"{API}/hc/basket", headers=pm).json()}
    assert basket[site["work_item_id"]]["hc_state"] == site["hc_state"]
    assert _audit_actions()[-1] == audit_actions.UNDONE
    # Gone: a second undo has nothing to undo.
    assert client.post(f"{API}/hc/assignments/{assignment['id']}/undo", headers=pm).status_code == 404


def test_hc_assignment_undo_is_refused_once_a_result_is_in(client, pm):
    site = _ready_to_assign(client, pm)[0]
    assignment = _assign_hc(client, pm, [site])
    _submit_ready(client, pm, assignment["tasks"][0], site["requested_technologies"])
    r = client.post(f"{API}/hc/assignments/{assignment['id']}/undo", headers=pm)
    assert r.status_code == 409
    assert r.json()["detail"] == "Too late to undo; reassign the sites instead."


def test_hc_assignment_undo_is_for_the_user_who_made_it(client, pm, coordinator):
    site = _ready_to_assign(client, pm)[0]
    assignment = _assign_hc(client, pm, [site])
    assert client.post(f"{API}/hc/assignments/{assignment['id']}/undo", headers=coordinator).status_code == 404
    assert client.post(f"{API}/hc/assignments/{assignment['id']}/undo", headers=pm).status_code == 200


def test_hc_assignment_undo_is_refused_after_two_minutes(client, pm):
    from app.models.health_check import HcAssignment

    site = _ready_to_assign(client, pm)[0]
    assignment = _assign_hc(client, pm, [site])
    db = SessionLocal()
    try:
        db.get(HcAssignment, assignment["id"]).assigned_at = datetime.now(timezone.utc) - timedelta(minutes=3)
        db.commit()
    finally:
        db.close()
    assert client.post(f"{API}/hc/assignments/{assignment['id']}/undo", headers=pm).status_code == 409


def test_confirm_all_and_undo(client, pm):
    _, task = _ready_result(client, pm)
    r = client.post(f"{API}/hc/results/confirm", headers=pm, json={"task_ids": [task["id"]]})
    assert r.status_code == 200, r.text
    batch = r.json()["batch_id"]
    assert r.json()["confirmed"] == 1
    queue = client.get(f"{API}/hc/results", headers=pm, params={"reviewed": False}).json()
    assert task["id"] not in {q["task_id"] for q in queue}

    u = client.post(f"{API}/hc/results/confirm/{batch}/undo", headers=pm)
    assert u.status_code == 200, u.text
    queue = client.get(f"{API}/hc/results", headers=pm, params={"reviewed": False}).json()
    assert task["id"] in {q["task_id"] for q in queue}
    assert _audit_actions()[-1] == audit_actions.UNDONE
    # Already undone: the reviews are gone, so it is too late.
    assert client.post(f"{API}/hc/results/confirm/{batch}/undo", headers=pm).status_code == 409


def test_confirm_refuses_a_not_ready_result(client, pm):
    site = _ready_to_assign(client, pm)[0]
    assignment = _assign_hc(client, pm, [site])
    techs = site["requested_technologies"]
    client.post(
        f"{API}/hc/tasks/{assignment['tasks'][0]['id']}/result", headers=pm,
        json={"technology_results": [{"technology": techs[0], "result": "NotNormal", "comment": "x"}]
              + [{"technology": t, "result": "Normal"} for t in techs[1:]]},
    )
    r = client.post(f"{API}/hc/results/confirm", headers=pm, json={"task_ids": [assignment["tasks"][0]["id"]]})
    assert r.status_code == 400


def test_confirm_undo_is_refused_after_two_minutes(client, pm):
    _, task = _ready_result(client, pm)
    batch = client.post(f"{API}/hc/results/confirm", headers=pm, json={"task_ids": [task["id"]]}).json()["batch_id"]
    _age_audit(batch, 121)
    assert client.post(f"{API}/hc/results/confirm/{batch}/undo", headers=pm).status_code == 409


def _confirmed_site(client, pm):
    site, task = _ready_result(client, pm)
    client.post(f"{API}/hc/results/confirm", headers=pm, json={"task_ids": [task["id"]]})
    return site, task


def _dt_assign(client, h, work_item_id, contractor_id=None):
    r = client.post(
        f"{API}/work-items/assign", headers=h,
        json={"work_item_ids": [work_item_id], "contractor_id": contractor_id or _contractors()[0],
              "assignment_type": "official"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _stage(work_item_id):
    from app.models.workitem import WorkItem

    db = SessionLocal()
    try:
        return db.get(WorkItem, work_item_id).current_stage
    finally:
        db.close()


def test_undo_a_drive_test_assignment(client, pm):
    site, _ = _confirmed_site(client, pm)
    before = _stage(site["work_item_id"])
    body = _dt_assign(client, pm, site["work_item_id"])
    assert body["assigned"] == 1 and isinstance(body["batch_id"], int)
    assert _stage(site["work_item_id"]) == "Assigned"

    u = client.post(f"{API}/work-items/assign/{body['batch_id']}/undo", headers=pm)
    assert u.status_code == 200, u.text
    assert _stage(site["work_item_id"]) == before
    queue = client.get(f"{API}/hc/queues/dt-assignment", headers=pm).json()
    assert site["work_item_id"] in {r["work_item_id"] for r in queue}
    # Already undone: the assignment it created is gone.
    assert client.post(f"{API}/work-items/assign/{body['batch_id']}/undo", headers=pm).status_code == 409


def test_dt_undo_restores_the_assignment_it_replaced(client, pm):
    from app.models.workitem import Assignment

    site, _ = _confirmed_site(client, pm)
    first, second = _contractors()[0], _contractors()[-1]
    _dt_assign(client, pm, site["work_item_id"], first)
    # Handed back, then reassigned: the reassignment replaces the first.
    db = SessionLocal()
    try:
        a = db.query(Assignment).filter_by(work_item_id=site["work_item_id"], is_active=True).one()
        a.returned_at = datetime.now(timezone.utc)
        first_id = a.id
        db.commit()
    finally:
        db.close()
    batch = _dt_assign(client, pm, site["work_item_id"], second)["batch_id"]
    assert client.post(f"{API}/work-items/assign/{batch}/undo", headers=pm).status_code == 200
    db = SessionLocal()
    try:
        active = db.query(Assignment).filter_by(work_item_id=site["work_item_id"], is_active=True).all()
        assert [a.id for a in active] == [first_id]
    finally:
        db.close()


def test_dt_undo_is_refused_once_a_drive_test_is_filed(client, pm):
    site, _ = _confirmed_site(client, pm)
    batch = _dt_assign(client, pm, site["work_item_id"])["batch_id"]
    r = client.post(f"{API}/work-items/{site['work_item_id']}/drive-test", headers=pm, json={})
    assert r.status_code in (200, 201), r.text
    assert client.post(f"{API}/work-items/assign/{batch}/undo", headers=pm).status_code == 409


def test_dt_undo_is_refused_for_another_user_and_after_two_minutes(client, pm, coordinator):
    site, _ = _confirmed_site(client, pm)
    batch = _dt_assign(client, pm, site["work_item_id"])["batch_id"]
    assert client.post(f"{API}/work-items/assign/{batch}/undo", headers=coordinator).status_code == 404
    _age_audit(batch, 121)
    assert client.post(f"{API}/work-items/assign/{batch}/undo", headers=pm).status_code == 409


def test_confirm_undo_is_refused_once_the_site_is_assigned(client, pm):
    site, task = _ready_result(client, pm)
    batch = client.post(f"{API}/hc/results/confirm", headers=pm, json={"task_ids": [task["id"]]}).json()["batch_id"]
    _dt_assign(client, pm, site["work_item_id"])
    assert client.post(f"{API}/hc/results/confirm/{batch}/undo", headers=pm).status_code == 409


# --------------------------------------------------------------------------
# All sites counts
# --------------------------------------------------------------------------
def test_work_item_counts_match_the_list(client, pm):
    counts = client.get(f"{API}/work-items/counts", headers=pm)
    assert counts.status_code == 200, counts.text
    body = counts.json()
    assert body["All"] == sum(v for k, v in body.items() if k != "All")
    for stage, n in body.items():
        if stage == "All" or n > 500:
            continue
        rows = client.get(f"{API}/work-items", headers=pm, params={"stage": stage, "limit": 500}).json()
        assert len(rows) == n, stage


def test_work_item_search_narrows_the_list_and_its_counts(client, pm):
    rows = client.get(f"{API}/work-items", headers=pm, params={"q": "PIPE00", "limit": 500}).json()
    assert rows and all(r["site_code"].startswith("PIPE00") for r in rows)
    assert all("village" in r and "launch_date_shamsi" in r for r in rows)
    counts = client.get(f"{API}/work-items/counts", headers=pm, params={"q": "PIPE00"}).json()
    assert counts["All"] == len(rows)
