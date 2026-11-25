"""UEP-25: Admin > System health.

* The maths: gauges (amber 75 %, red 90 %), age thresholds, Kubernetes
  quantities.
* The Kubernetes client mocked connected (pods, quota, metrics) and not
  connected (the page still loads, the two blocks say "Not connected").
* Red rules: backup older than 7 days, Mojri older than 30 days, migration
  mismatch.
* The Overview summary and the footer read the same verdict.
* Who sees what: Admin everything; PM and Viewer without Usage; others 403.
* The daily snapshot is idempotent and feeds the history endpoint.

Run with:  cd backend && pytest tests/test_system_health.py -q
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_system_health_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON  # noqa: E402

_pg.JSONB = JSON

from fastapi.testclient import TestClient  # noqa: E402

from app.services import system_health as sh  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

API = "/api/v1"


# --------------------------------------------------------------------------
# 1. The maths
# --------------------------------------------------------------------------
@pytest.mark.parametrize("used, limit, state", [
    (1, 10, "ok"), (7.4, 10, "ok"), (7.5, 10, "amber"), (8.99, 10, "amber"),
    (9, 10, "red"), (12, 10, "red"), (None, 10, "unknown"), (1, None, "unknown"), (1, 0, "unknown"),
])
def test_gauge_thresholds(used, limit, state):
    assert sh.gauge(used, limit)["state"] == state


def test_gauge_percent():
    assert sh.gauge(3, 4)["percent"] == 75.0


def test_age_state():
    today = date(2026, 11, 25)
    assert sh.age_state(None, 7, today) == "unknown"
    assert sh.age_state(today - timedelta(days=7), 7, today) == "ok"
    assert sh.age_state(today - timedelta(days=8), 7, today) == "red"
    assert sh.age_state(today - timedelta(days=31), 30, today) == "red"


@pytest.mark.parametrize("value, kind, expected", [
    ("250m", "cpu", 0.25), ("2", "cpu", 2.0), ("123456789n", "cpu", 0.123456789),
    ("512Mi", "memory", 512 * 2**20), ("1Gi", "memory", 2**30), ("1G", "memory", 10**9),
    ("bad", "cpu", None), (None, "cpu", None),
])
def test_quantity(value, kind, expected):
    got = sh.quantity(value, kind)
    assert got == pytest.approx(expected) if expected is not None else got is None


def test_verdict_first_problem_and_unknowns_are_not_problems():
    ok = sh.verdict(db_ok=True, migrations={"mismatch": False}, backups={"state": "unknown"},
                    freshness={"mojri_state": "unknown"}, k8s={"connected": False})
    assert ok.status == "normal" and ok.headline == "All systems normal"
    bad = sh.verdict(db_ok=True, migrations={"mismatch": True}, backups={"state": "red", "age_days": 9},
                     freshness={"mojri_state": "red"}, k8s=None)
    assert bad.status == "attention" and bad.headline.startswith("Database migrations")
    assert len(bad.problems) == 3
    down = sh.verdict(db_ok=False, migrations={}, backups={}, freshness={}, k8s=None)
    assert down.status == "degraded"


# --------------------------------------------------------------------------
# 2. Kubernetes, mocked
# --------------------------------------------------------------------------
NOW = datetime.now(timezone.utc)


def _pod(name, component, ready=True, restarts=0, finished=None, image="reg/uep-backend:abc1234"):
    last = {"terminated": {"finishedAt": finished.isoformat()}} if finished else {}
    return {
        "metadata": {"name": name, "labels": {"app.kubernetes.io/name": component}},
        "spec": {"containers": [{"name": component, "image": image}]},
        "status": {"phase": "Running", "startTime": (NOW - timedelta(hours=3)).isoformat(),
                   "containerStatuses": [{"ready": ready, "restartCount": restarts, "lastState": last}]},
    }


class FakeKube:
    def __init__(self, metrics=True):
        self.metrics = metrics

    def pods(self):
        return {"items": [
            _pod("backend-1", "backend", restarts=2, finished=NOW - timedelta(hours=2)),
            _pod("backend-2", "backend"),
            _pod("frontend-1", "frontend", image="reg/uep-frontend:abc1234"),
        ]}

    def resource_quotas(self):
        return {"items": [{"status": {"hard": {"limits.cpu": "16", "limits.memory": "32Gi"},
                                      "used": {"limits.cpu": "6", "limits.memory": "12Gi"}}}]}

    def pod_metrics(self):
        if not self.metrics:
            raise sh.K8sUnavailable("metrics-server missing")
        return {"items": [
            {"containers": [{"usage": {"cpu": "12000m", "memory": "10Gi"}}]},
            {"containers": [{"usage": {"cpu": "2500m", "memory": "2Gi"}}]},
        ]}


class NoKube:
    def pods(self):
        raise sh.K8sUnavailable("forbidden")

    resource_quotas = pod_metrics = pods


@pytest.fixture
def kube():
    def use(client):
        sh.set_client(client)
        sh.clear_cache()
    yield use
    sh.set_client(None)
    sh.clear_cache()


def test_connected_blocks(kube):
    kube(FakeKube())
    k = sh.kubernetes()
    assert k["connected"]
    app = k["app"]
    assert app["version"] == "abc1234" and app["total"] == 3 and app["ready"] == 3
    assert app["restarts_24h"] == 1 and app["restarts_total"] == 2
    res = k["resources"]
    assert res["cpu"]["percent"] == pytest.approx(90.6, abs=0.1) and res["cpu"]["state"] == "red"
    assert res["memory"]["percent"] == pytest.approx(37.5) and res["memory"]["state"] == "ok"


def test_metrics_server_missing_keeps_pods(kube):
    kube(FakeKube(metrics=False))
    k = sh.kubernetes()
    assert k["connected"] and k["app"]["total"] == 3
    assert k["resources"]["cpu"]["state"] == "unknown"
    assert "metrics-server" in k["message"]


def test_not_connected(kube):
    kube(NoKube())
    k = sh.kubernetes()
    assert not k["connected"] and k["message"] == sh.NOT_CONNECTED
    assert k["app"] is None and k["resources"] is None


def test_kubernetes_reads_are_cached_30_seconds(kube):
    calls = []

    class Counting(FakeKube):
        def pods(self):
            calls.append(1)
            return super().pods()

    kube(Counting())
    sh.kubernetes(now=100.0)
    sh.kubernetes(now=120.0)
    assert len(calls) == 1
    sh.kubernetes(now=131.0)
    assert len(calls) == 2


# --------------------------------------------------------------------------
# 3. The endpoints
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def world():
    path = "/tmp/uep_system_health_pytest.db"
    if os.path.exists(path):
        os.remove(path)
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    from app.core import user_status
    from app.core.database import SessionLocal
    from app.core.security import create_access_token
    from app.main import app
    from app.models.reference import Role, User

    db = SessionLocal()
    roles = {r.name: r for r in db.query(Role).all()}
    accounts = {}
    for role in ("Admin", "PM", "Viewer", "Contractor", "Coordinator"):
        u = User(username=f"sh_{role.lower()}", password_hash="x", first_name=role, family_name="T",
                 role_id=roles[role].id, status=user_status.ACTIVE, sees_all_provinces=True)
        db.add(u)
        db.flush()
        accounts[role] = u
    db.commit()
    h = {r: {"Authorization": f"Bearer {create_access_token(u.id, {'ver': u.token_version})}"}
         for r, u in accounts.items()}
    db.close()
    sh.set_client(NoKube())
    sh.clear_cache()
    yield {"client": TestClient(app), "h": h, "SessionLocal": SessionLocal}
    sh.set_client(None)
    sh.clear_cache()


def _get(world, who, path, **params):
    return world["client"].get(f"{API}{path}", headers=world["h"][who], params=params)


def test_page_loads_without_kubernetes_and_keeps_old_fields(world):
    r = _get(world, "Admin", "/admin/system-health")
    assert r.status_code == 200, r.text
    body = r.json()
    for old in ("db_status", "alembic_current_revision", "alembic_head_revision",
                "alembic_mismatch", "last_cpm_import", "pending_change_requests_count"):
        assert old in body
    assert body["kubernetes_connected"] is False
    assert body["kubernetes_message"].startswith("Not connected")
    assert body["app"] is None and body["resources"] is None
    for block in ("database", "backups", "freshness", "usage", "summary"):
        assert body[block] is not None, block
    assert body["database"]["bytes"] > 0


@pytest.mark.parametrize("who", ["PM", "Viewer"])
def test_pm_and_viewer_read_without_usage(world, who):
    r = _get(world, who, "/admin/system-health")
    assert r.status_code == 200, r.text
    assert r.json()["usage"] is None
    rows = _get(world, who, "/admin/system-health/history").json()
    assert all("active_users" not in row for row in rows)


@pytest.mark.parametrize("who", ["Contractor", "Coordinator"])
def test_others_get_403(world, who):
    assert _get(world, who, "/admin/system-health").status_code == 403


def test_backup_turns_red_after_7_days_and_is_audited(world):
    client = world["client"]
    old = (date.today() - timedelta(days=8)).isoformat()
    r = client.put(f"{API}/admin/system-health/backup-confirmation", headers=world["h"]["PM"],
                   json={"date": old, "note": "x"})
    assert r.status_code == 403
    r = client.put(f"{API}/admin/system-health/backup-confirmation", headers=world["h"]["Admin"],
                   json={"date": old, "note": "DB team ticket 42"})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "red" and r.json()["entered_by"]
    body = _get(world, "Admin", "/admin/system-health").json()
    assert body["backups"]["state"] == "red"
    assert body["summary"]["status"] == "attention"
    assert body["summary"]["headline"].startswith("Last backup confirmed 8 days ago")
    logs = _get(world, "Admin", "/admin/audit-logs").json()["items"]
    assert any(i["action"] == "BACKUP_CONFIRMED" for i in logs)
    future = (date.today() + timedelta(days=1)).isoformat()
    assert client.put(f"{API}/admin/system-health/backup-confirmation", headers=world["h"]["Admin"],
                      json={"date": future}).status_code == 422
    # Today: back to normal.
    client.put(f"{API}/admin/system-health/backup-confirmation", headers=world["h"]["Admin"],
               json={"date": date.today().isoformat()})
    assert _get(world, "Admin", "/admin/system-health").json()["backups"]["state"] == "ok"


def test_mojri_turns_red_after_30_days(world):
    from app.models.mojri import MojriImportRun

    db = world["SessionLocal"]()
    try:
        db.add(MojriImportRun(filename="m.xlsx", total_rows=5,
                              created_at=datetime.now(timezone.utc) - timedelta(days=31)))
        db.commit()
        fresh = sh.freshness_block(db)
        assert fresh["mojri_state"] == "red"
    finally:
        db.query(MojriImportRun).delete()
        db.commit()
        db.close()


def test_migration_mismatch_is_red(world, monkeypatch):
    db = world["SessionLocal"]()
    try:
        assert sh.migration_state(db)["state"] == "ok"
        monkeypatch.setattr(sh.ScriptDirectory, "get_current_head", lambda self: "not-the-head")
        state = sh.migration_state(db)
        assert state["mismatch"] and state["state"] == "red"
    finally:
        db.close()


def test_overview_and_footer_read_the_same_verdict(world):
    sh.clear_cache()
    health = _get(world, "Admin", "/admin/system-health").json()["summary"]
    footer = _get(world, "PM", "/me/home").json()["system"]
    assert footer["status"] == health["status"]
    assert footer["headline"] == health["headline"]


def test_snapshot_is_idempotent_and_feeds_history(world):
    from app.models.access import SystemSnapshot
    from app.services import daily_jobs

    db = world["SessionLocal"]()
    try:
        assert daily_jobs.run_once(db) is not None
        assert daily_jobs.run_once(db) is not None
        today = datetime.now(timezone.utc).date()
        assert db.query(SystemSnapshot).filter_by(taken_on=today).count() == 1
        assert db.query(SystemSnapshot).count() == 2  # yesterday and today
    finally:
        db.close()
    rows = _get(world, "Admin", "/admin/system-health/history", days=90).json()
    assert len(rows) == 2 and rows[-1]["db_bytes"] > 0 and "active_users" in rows[-1]


def test_errors_are_counted(world):
    sh.record_error("client", "/explorer")
    db = world["SessionLocal"]()
    try:
        assert sh.errors_since(db, datetime.now(timezone.utc) - timedelta(minutes=5)) >= 1
    finally:
        db.close()
