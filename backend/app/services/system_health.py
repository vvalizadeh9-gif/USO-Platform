"""Admin > System health (UEP-25): is UEP healthy, at a glance.

Six blocks. Four come from UEP's own database -- database and files, backups,
data freshness, usage. Two (App, Resources) come from the Kubernetes API,
reading UEP's **own namespace only** with an in-cluster ServiceAccount that
DevOps grants read-only access (deploy/k8s/uep-reader-serviceaccount.yaml).
Without that access, or without metrics-server, those two blocks say
"Not connected" and everything else still works. Node and server hardware is
IT's view and is never read.

Never read or returned: secrets, environment variables, logs.

``summary()`` is the one-line verdict ("All systems normal" or the first
problem). The Admin Overview, the System health page and the footer all read
it, so they cannot disagree.
"""
from __future__ import annotations

import json
import logging
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from alembic.script import ScriptDirectory
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.models.access import BackupConfirmation, ErrorEvent, SystemSnapshot
from app.models.acceptance import AuditLog, CpmImportBatch
from app.models.mojri import MojriImportRun
from app.models.reference import User

log = logging.getLogger("uep.system_health")

_ALEMBIC_DIR = str(Path(__file__).resolve().parents[2] / "alembic")

# Thresholds (the brief's numbers).
AMBER_AT = 75.0
RED_AT = 90.0
BACKUP_RED_DAYS = 7
MOJRI_RED_DAYS = 30
SNAPSHOT_KEEP_DAYS = 730
ERROR_EVENTS_KEEP_DAYS = 30

OK, AMBER, RED, UNKNOWN = "ok", "amber", "red", "unknown"


# --------------------------------------------------------------------------
# Small maths, tested on its own
# --------------------------------------------------------------------------
def gauge(used: float | None, limit: float | None) -> dict:
    """{used, limit, percent, state}: amber at 75%, red at 90%."""
    if used is None or not limit:
        return {"used": used, "limit": limit, "percent": None, "state": UNKNOWN}
    percent = round(100.0 * float(used) / float(limit), 1)
    state = RED if percent >= RED_AT else AMBER if percent >= AMBER_AT else OK
    return {"used": used, "limit": limit, "percent": percent, "state": state}


def age_state(day: date | None, red_after_days: int, today: date | None = None) -> str:
    """Red when ``day`` is more than ``red_after_days`` old; unknown when none."""
    if day is None:
        return UNKNOWN
    today = today or datetime.now(timezone.utc).date()
    return RED if (today - day).days > red_after_days else OK


_CPU = {"n": Decimal("1e-9"), "u": Decimal("1e-6"), "m": Decimal("0.001"), "": Decimal(1)}
_MEM = {"Ki": 2**10, "Mi": 2**20, "Gi": 2**30, "Ti": 2**40,
        "k": 10**3, "K": 10**3, "M": 10**6, "G": 10**9, "T": 10**12, "": 1}


def quantity(value, kind: str) -> float | None:
    """A Kubernetes quantity: CPU in cores ("250m", "123456n"), memory in bytes."""
    if value is None:
        return None
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)([a-zA-Z]*)", str(value).strip())
    if not match:
        return None
    table = _CPU if kind == "cpu" else _MEM
    suffix = match.group(2)
    if suffix not in table:
        return None
    return float(Decimal(match.group(1)) * Decimal(table[suffix]))


# --------------------------------------------------------------------------
# Kubernetes: own namespace, read only
# --------------------------------------------------------------------------
SA_DIR = Path(os.environ.get("UEP_SA_DIR", "/var/run/secrets/kubernetes.io/serviceaccount"))
K8S_CACHE_SECONDS = 30.0
NOT_CONNECTED = "Not connected — needs read access from DevOps"


class K8sUnavailable(Exception):
    pass


class KubeClient:
    """The four reads UEP needs. Mocked in tests."""

    def __init__(self, sa_dir: Path = SA_DIR, timeout: float = 3.0):
        self.sa_dir = sa_dir
        self.timeout = timeout
        host = os.environ.get("KUBERNETES_SERVICE_HOST")
        port = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
        self.base = f"https://{host}:{port}" if host else None

    @property
    def namespace(self) -> str:
        try:
            return (self.sa_dir / "namespace").read_text().strip()
        except OSError:
            return os.environ.get("UEP_NAMESPACE", "prd-uep")

    def _get(self, path: str) -> dict:
        token_file = self.sa_dir / "token"
        if self.base is None or not token_file.exists():
            raise K8sUnavailable("not running in a cluster with a ServiceAccount token")
        ctx = ssl.create_default_context(cafile=str(self.sa_dir / "ca.crt"))
        request = urllib.request.Request(
            self.base + path,
            headers={"Authorization": f"Bearer {token_file.read_text().strip()}",
                     "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout, context=ctx) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise K8sUnavailable(str(exc)) from None

    def pods(self) -> dict:
        return self._get(f"/api/v1/namespaces/{self.namespace}/pods"
                         "?labelSelector=app.kubernetes.io%2Fpart-of%3Duep")

    def resource_quotas(self) -> dict:
        return self._get(f"/api/v1/namespaces/{self.namespace}/resourcequotas")

    def pod_metrics(self) -> dict:
        return self._get(f"/apis/metrics.k8s.io/v1beta1/namespaces/{self.namespace}/pods")


_client: KubeClient | None = None
_k8s_lock = threading.Lock()
_k8s_cache: tuple[float, dict] | None = None


def set_client(client: KubeClient | None) -> None:
    """Swap the Kubernetes client (tests) and forget the cached reads."""
    global _client, _k8s_cache
    with _k8s_lock:
        _client, _k8s_cache = client, None


def _get_client() -> KubeClient:
    global _client
    if _client is None:
        _client = KubeClient()
    return _client


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def app_block(pods: dict, now: datetime | None = None) -> dict:
    """Version, pods running/ready, restarts in 24 h, last start. Backend pods
    are the ones named; the frontend's are counted too, as the app is both."""
    now = now or datetime.now(timezone.utc)
    items = pods.get("items", [])
    out = []
    version = None
    restarts_24h = 0
    restarts_total = 0
    last_start = None
    for pod in items:
        meta, spec, st = pod.get("metadata", {}), pod.get("spec", {}), pod.get("status", {})
        component = meta.get("labels", {}).get("app.kubernetes.io/name", "")
        statuses = st.get("containerStatuses", []) or []
        ready = bool(statuses) and all(c.get("ready") for c in statuses)
        restarts = sum(int(c.get("restartCount", 0)) for c in statuses)
        restarts_total += restarts
        for c in statuses:
            finished = _parse_time(((c.get("lastState") or {}).get("terminated") or {}).get("finishedAt"))
            if finished and now - finished <= timedelta(hours=24):
                restarts_24h += 1
        started = _parse_time(st.get("startTime"))
        if started and (last_start is None or started > last_start):
            last_start = started
        if component == "backend" and version is None:
            for c in spec.get("containers", []):
                image = c.get("image", "")
                if ":" in image.rsplit("/", 1)[-1]:
                    version = image.rsplit(":", 1)[-1]
        out.append({"name": meta.get("name"), "component": component,
                    "phase": st.get("phase"), "ready": ready, "restarts": restarts})
    running = sum(1 for p in out if p["phase"] == "Running")
    ready_n = sum(1 for p in out if p["ready"])
    state = OK if out and ready_n == len(out) else (RED if not ready_n else AMBER)
    return {"version": version, "pods": out, "running": running, "ready": ready_n,
            "total": len(out), "restarts_24h": restarts_24h, "restarts_total": restarts_total,
            "last_start": last_start, "state": state}


def resources_block(quotas: dict, metrics: dict | None) -> dict:
    """CPU and memory used against the namespace limits (ResourceQuota)."""
    hard: dict = {}
    used_quota: dict = {}
    for q in quotas.get("items", []):
        hard.update(q.get("status", {}).get("hard", {}) or q.get("spec", {}).get("hard", {}))
        used_quota.update(q.get("status", {}).get("used", {}))
    cpu_limit = quantity(hard.get("limits.cpu"), "cpu")
    mem_limit = quantity(hard.get("limits.memory"), "memory")
    cpu_used = mem_used = None
    metrics_ok = metrics is not None
    if metrics_ok:
        cpu_used = mem_used = 0.0
        for pod in metrics.get("items", []):
            for c in pod.get("containers", []):
                cpu_used += quantity(c.get("usage", {}).get("cpu"), "cpu") or 0.0
                mem_used += quantity(c.get("usage", {}).get("memory"), "memory") or 0.0
    return {
        "cpu": gauge(cpu_used, cpu_limit),
        "memory": gauge(mem_used, mem_limit),
        # What the pods reserve as limits, from the quota's own accounting.
        "cpu_reserved": quantity(used_quota.get("limits.cpu"), "cpu"),
        "memory_reserved": quantity(used_quota.get("limits.memory"), "memory"),
        "metrics_available": metrics_ok,
    }


def kubernetes(now: float | None = None) -> dict:
    """{connected, app, resources}, cached 30 s per pod."""
    global _k8s_cache
    now = now if now is not None else time.monotonic()
    with _k8s_lock:
        cached = _k8s_cache
    if cached and now - cached[0] < K8S_CACHE_SECONDS:
        return cached[1]
    client = _get_client()
    try:
        pods = client.pods()
        quotas = client.resource_quotas()
    except K8sUnavailable as exc:
        log.info("kubernetes not connected: %s", exc)
        result = {"connected": False, "message": NOT_CONNECTED, "app": None, "resources": None}
    else:
        try:
            metrics = client.pod_metrics()
        except K8sUnavailable:
            metrics = None  # metrics-server missing: pods still shown, gauges not.
        result = {"connected": True, "message": None, "app": app_block(pods),
                  "resources": resources_block(quotas, metrics)}
        if metrics is None:
            result["message"] = "CPU and memory need metrics-server"
    with _k8s_lock:
        _k8s_cache = (now, result)
    return result


# --------------------------------------------------------------------------
# UEP's own database
# --------------------------------------------------------------------------
def _is_postgres(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def database_bytes(db: Session) -> int | None:
    try:
        if _is_postgres(db):
            return int(db.execute(text("SELECT pg_database_size(current_database())")).scalar())
        pages = db.execute(text("PRAGMA page_count")).scalar()
        size = db.execute(text("PRAGMA page_size")).scalar()
        return int(pages * size)
    except SQLAlchemyError:
        db.rollback()
        return None


def largest_tables(db: Session, limit: int = 5) -> list[dict]:
    try:
        if _is_postgres(db):
            rows = db.execute(text(
                "SELECT c.relname, pg_total_relation_size(c.oid) AS bytes "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE c.relkind = 'r' AND n.nspname = current_schema() "
                "ORDER BY bytes DESC LIMIT :n"
            ), {"n": limit})
        else:
            rows = db.execute(text(
                "SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name "
                "ORDER BY bytes DESC LIMIT :n"
            ), {"n": limit})
        return [{"table": name, "bytes": int(size or 0)} for name, size in rows]
    except SQLAlchemyError:
        db.rollback()  # SQLite without dbstat: no list, not an error.
        return []


def files_bytes(db: Session) -> int:
    try:
        return int(db.execute(text("SELECT COALESCE(SUM(size_bytes), 0) FROM stored_files")).scalar() or 0)
    except SQLAlchemyError:
        db.rollback()
        return 0


def _day_start(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def active_users_on(db: Session, day: date) -> int:
    start, end = _day_start(day), _day_start(day + timedelta(days=1))
    ids = set(db.scalars(
        select(AuditLog.user_id).where(
            AuditLog.created_at >= start, AuditLog.created_at < end, AuditLog.user_id.isnot(None),
        ).distinct()
    ))
    ids |= set(db.scalars(select(User.id).where(User.last_login_at >= start, User.last_login_at < end)))
    return len(ids)


def failed_logins_since(db: Session, since: datetime) -> int:
    return db.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.action == audit_actions.LOGIN_FAILED, AuditLog.created_at >= since)) or 0


def errors_since(db: Session, since: datetime) -> int:
    return db.scalar(select(func.count(ErrorEvent.id)).where(ErrorEvent.occurred_at >= since)) or 0


def record_error(source: str, route: str | None) -> None:
    """Count one server or browser error. Its own session and transaction, and
    never raises: a failing database must not turn one error into two."""
    from app.core.database import SessionLocal

    try:
        db = SessionLocal()
        try:
            db.add(ErrorEvent(source=source, route=(route or "")[:255] or None))
            db.commit()
        finally:
            db.close()
    except Exception:  # noqa: BLE001 - best effort by design
        log.debug("could not record error event", exc_info=True)


def migration_state(db: Session) -> dict:
    try:
        current = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except SQLAlchemyError:
        db.rollback()
        current = None
    head = ScriptDirectory(_ALEMBIC_DIR).get_current_head()
    return {"current": current, "head": head, "mismatch": current != head,
            "state": RED if current != head else OK}


def _name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    user = db.get(User, user_id)
    return user.full_name if user else None


def freshness_block(db: Session, today: date | None = None) -> dict:
    today = today or datetime.now(timezone.utc).date()
    batch = db.scalars(select(CpmImportBatch).order_by(CpmImportBatch.created_at.desc()).limit(1)).first()
    cpm = None
    if batch is not None:
        cpm = {"at": batch.created_at, "by": _name(db, batch.imported_by),
               "rows": batch.total_rows, "filename": batch.filename}
    run = db.scalars(select(MojriImportRun).order_by(MojriImportRun.created_at.desc()).limit(1)).first()
    mojri = None
    mojri_state = UNKNOWN
    if run is not None:
        at = run.created_at
        mojri = {"at": at, "by": _name(db, run.imported_by), "rows": run.total_rows,
                 "filename": run.filename}
        mojri_state = age_state(at.date() if at else None, MOJRI_RED_DAYS, today)
    return {"cpm": cpm, "mojri": mojri, "mojri_state": mojri_state,
            "migrations": migration_state(db)}


def backups_block(db: Session, today: date | None = None) -> dict:
    row = db.scalars(select(BackupConfirmation).order_by(BackupConfirmation.id.desc()).limit(1)).first()
    if row is None:
        return {"confirmed_on": None, "note": None, "entered_by": None, "entered_at": None,
                "state": UNKNOWN, "age_days": None}
    today = today or datetime.now(timezone.utc).date()
    return {"confirmed_on": row.confirmed_on, "note": row.note,
            "entered_by": _name(db, row.entered_by), "entered_at": row.entered_at,
            "age_days": (today - row.confirmed_on).days,
            "state": age_state(row.confirmed_on, BACKUP_RED_DAYS, today)}


def history(db: Session, days: int = 90) -> list[dict]:
    since = datetime.now(timezone.utc).date() - timedelta(days=days)
    rows = db.scalars(select(SystemSnapshot).where(SystemSnapshot.taken_on >= since)
                      .order_by(SystemSnapshot.taken_on))
    return [{"day": r.taken_on, "db_bytes": r.db_bytes, "files_bytes": r.files_bytes,
             "active_users": r.active_users, "failed_logins": r.failed_logins,
             "errors": r.errors} for r in rows]


def database_block(db: Session) -> dict:
    size = database_bytes(db)
    series = history(db, 90)
    first = series[0]["db_bytes"] if series else None
    return {"bytes": size, "files_bytes": files_bytes(db), "largest_tables": largest_tables(db),
            "growth_90d_bytes": (size - first) if (size is not None and first is not None) else None,
            "series": [{"day": s["day"], "db_bytes": s["db_bytes"], "files_bytes": s["files_bytes"]}
                       for s in series]}


def usage_block(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    today = now.date()
    by_day = {s["day"]: s["active_users"] for s in history(db, 14)}
    by_day[today] = active_users_on(db, today)
    series = [{"day": today - timedelta(days=i), "active_users": by_day.get(today - timedelta(days=i), 0)}
              for i in range(13, -1, -1)]
    return {"active_today": by_day[today], "series_14d": series,
            "failed_logins_24h": failed_logins_since(db, now - timedelta(hours=24)),
            "errors_24h": errors_since(db, now - timedelta(hours=24))}


# --------------------------------------------------------------------------
# The verdict
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Verdict:
    status: str  # normal | attention | degraded
    headline: str
    problems: tuple[str, ...]


def verdict(*, db_ok: bool, migrations: dict, backups: dict, freshness: dict,
            k8s: dict | None) -> Verdict:
    """'All systems normal', or the first problem. Grey "unknown" states (no
    backup confirmed yet, no Mojri upload yet, Kubernetes not connected) are
    not problems: they are things UEP cannot see, shown in grey."""
    problems: list[str] = []
    if not db_ok:
        problems.append("Database not reachable")
    if migrations.get("mismatch"):
        problems.append("Database migrations are not at the latest version")
    if k8s and k8s.get("connected") and k8s.get("app"):
        app = k8s["app"]
        if app["total"] and app["ready"] < app["total"]:
            problems.append(f"{app['total'] - app['ready']} of {app['total']} pods not ready")
        for key, label in (("cpu", "CPU"), ("memory", "Memory")):
            g = (k8s.get("resources") or {}).get(key) or {}
            if g.get("state") == RED:
                problems.append(f"{label} at {g['percent']:.0f}% of the namespace limit")
    if backups.get("state") == RED:
        problems.append(f"Last backup confirmed {backups['age_days']} days ago")
    if freshness.get("mojri_state") == RED:
        problems.append("Mojri tracker not uploaded for over 30 days")
    status = "degraded" if not db_ok else ("attention" if problems else "normal")
    return Verdict(status, problems[0] if problems else "All systems normal", tuple(problems))


_summary_lock = threading.Lock()
_summary_cache: tuple[float, Verdict] | None = None
SUMMARY_CACHE_SECONDS = 30.0


def clear_cache() -> None:
    global _summary_cache, _k8s_cache
    with _summary_lock:
        _summary_cache = None
    with _k8s_lock:
        _k8s_cache = None


def summary(db: Session) -> Verdict:
    """The shared verdict, cached 30 s per pod (the footer asks on every page)."""
    global _summary_cache
    now = time.monotonic()
    with _summary_lock:
        cached = _summary_cache
    if cached and now - cached[0] < SUMMARY_CACHE_SECONDS:
        return cached[1]
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except SQLAlchemyError:
        db.rollback()
        db_ok = False
    if not db_ok:
        result = verdict(db_ok=False, migrations={}, backups={}, freshness={}, k8s=None)
    else:
        fresh = freshness_block(db)
        result = verdict(db_ok=True, migrations=fresh["migrations"], backups=backups_block(db),
                         freshness=fresh, k8s=kubernetes())
    with _summary_lock:
        _summary_cache = (now, result)
    return result


def full(db: Session, *, include_usage: bool) -> dict:
    """Every block for GET /admin/system-health."""
    k8s = kubernetes()
    fresh = freshness_block(db)
    backups = backups_block(db)
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except SQLAlchemyError:
        db.rollback()
        db_ok = False
    v = verdict(db_ok=db_ok, migrations=fresh["migrations"], backups=backups, freshness=fresh, k8s=k8s)
    return {
        "summary": {"status": v.status, "headline": v.headline, "problems": list(v.problems)},
        "kubernetes_connected": k8s["connected"],
        "kubernetes_message": k8s["message"],
        "app": k8s["app"],
        "resources": k8s["resources"],
        "database": database_block(db),
        "backups": backups,
        "freshness": fresh,
        "usage": usage_block(db) if include_usage else None,
    }


# --------------------------------------------------------------------------
# The daily job
# --------------------------------------------------------------------------
def take_snapshot(db: Session, day: date | None = None) -> SystemSnapshot:
    """Write (or rewrite) the day's snapshot and prune old rows. Idempotent."""
    day = day or datetime.now(timezone.utc).date()
    row = db.scalars(select(SystemSnapshot).where(SystemSnapshot.taken_on == day)).first()
    if row is None:
        row = SystemSnapshot(taken_on=day)
        db.add(row)
    start = _day_start(day)
    end = start + timedelta(days=1)
    row.db_bytes = database_bytes(db) or 0
    row.files_bytes = files_bytes(db)
    row.active_users = active_users_on(db, day)
    row.failed_logins = db.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.action == audit_actions.LOGIN_FAILED,
        AuditLog.created_at >= start, AuditLog.created_at < end)) or 0
    row.errors = db.scalar(select(func.count(ErrorEvent.id)).where(
        ErrorEvent.occurred_at >= start, ErrorEvent.occurred_at < end)) or 0
    db.query(SystemSnapshot).filter(
        SystemSnapshot.taken_on < day - timedelta(days=SNAPSHOT_KEEP_DAYS)).delete()
    db.query(ErrorEvent).filter(
        ErrorEvent.occurred_at < start - timedelta(days=ERROR_EVENTS_KEEP_DAYS)).delete()
    return row
