"""Who may use which feature of UEP (UEP-25).

Access is data, managed in Admin > Access:

* a **role** is a ready-made set of features (``role_feature_grants``);
* a **personal exception** grants or removes one feature for one person on top
  of their role (``user_feature_overrides``), with a reason and an optional
  expiry;
* the **data area** (provinces, regions, contractor, basket) is separate and
  unchanged: ``services/visibility.py``, ``services/kpi.py`` and
  ``services/submissions/scope.py`` still decide *which rows* a person sees.
  A feature only says whether they may use a screen or an action at all.

``effective_level(user, feature)`` is the override if present and not expired,
otherwise the role's grant, otherwise none. Levels are ordered
none < view < edit; writes need ``edit``.

Several pods serve UEP, so each keeps the grants in memory and re-reads them
when ``access_version`` changes, checking the version at most every
``CHECK_SECONDS``. A change therefore reaches every pod within 30 seconds, and
the pod that made it at once.

``access_matrix.json`` is no longer read here: it is the day-one seed and the
test fixture (see the UEP-25 migration and ``tests/test_feature_access.py``).
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path

from fastapi import Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session, object_session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.access import (
    LEVEL_EDIT,
    LEVEL_NONE,
    LEVEL_RANK,
    LEVEL_VIEW,
    AccessVersion,
    Feature as FeatureRow,
    RoleFeatureGrant,
    UserFeatureOverride,
)
from app.models.reference import User

MATRIX_PATH = Path(__file__).with_name("access_matrix.json")

FORBIDDEN = "You do not have permission to perform this action"

#: How often a pod looks at ``access_version``.
CHECK_SECONDS = 30.0


class Feature(StrEnum):
    """Every feature key the code checks. A typo is an AttributeError, not a
    silent "nobody may"; a test asserts this list equals the ``features``
    table."""

    # The pre-UEP-25 areas.
    ROLES_PERFORMANCE = "roles_performance"
    LIFECYCLE_GAPS = "lifecycle_gaps"
    #: The "ICT vs CRA vs Mojri tracker" card on Lifecycle Gaps and its exports.
    MOJRI_SECTION = "mojri_section"
    #: Insights > Drive test dashboard and Acceptance dashboard.
    INSIGHTS_DASHBOARDS = "insights_dashboards"
    EXPLORER = "explorer"
    #: Explorer and header search read every site rather than the caller's
    #: usual row scope. Read only. Never grantable to a contractor, province or
    #: region role (see services/access_admin.py).
    EXPLORER_ALL_SITES = "explorer_all_sites"
    ACCEPTANCE_WORKSPACE = "acceptance_workspace"
    ACCEPTANCE_CASES = "acceptance_cases"
    ACCEPTANCE_BASKETS = "acceptance_baskets"
    MONTHLY_PLAN_QUEUE = "monthly_plan_queue"
    INTERNAL_PIP = "internal_pip"
    #: Acceptance > Submissions. Who may *act* is narrower (PM and the owner
    #: coordinator) and decided by services/submissions/scope.py.
    SUBMISSIONS = "submissions"

    # Drive test.
    HC_WORK = "hc_work"
    DT_ASSIGNMENT = "dt_assignment"
    DT_REVIEW = "dt_review"
    DT_EVIDENCE = "dt_evidence"
    FIELD_RESULTS = "field_results"
    CONTRACTOR_WORK = "contractor_work"
    FIX_QUEUE = "fix_queue"
    REASSIGN_WORK = "reassign_work"
    # Acceptance.
    ACCEPTANCE_FILING = "acceptance_filing"
    ACCEPTANCE_APPROVE = "acceptance_approve"
    VALIDATION = "validation"
    SCAN_UPLOAD = "scan_upload"
    # Planning.
    CONTRACTOR_PLAN = "contractor_plan"
    PLAN_APPROVALS = "plan_approvals"
    # Insights.
    ACCEPTANCE_TARGET = "acceptance_target"
    KPI_MAPPING = "kpi_mapping"
    EXPORTS = "exports"
    # Admin.
    USERS = "users"
    ACCESS = "access"
    PROVINCE_ASSIGNMENTS = "province_assignments"
    SLA_POLICIES = "sla_policies"
    #: Admin > Sign-in page (UEP-26): support contact and planned-update notice.
    SIGNIN_SETTINGS = "signin_settings"
    PROBLEM_CATEGORIES = "problem_categories"
    PROVINCES = "provinces"
    ACTION_SLA = "action_sla"
    CPM_IMPORT = "cpm_import"
    CPM_CHANGE_REQUESTS = "cpm_change_requests"
    MOJRI_UPLOAD = "mojri_upload"
    ADMIN_OVERVIEW = "admin_overview"
    SYSTEM_HEALTH = "system_health"
    AUDIT_LOG = "audit_log"


#: The pre-UEP-25 name, kept so the area checks read as they did.
Area = Feature


# --------------------------------------------------------------------------
# The per-pod cache
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class _Grant:
    level: str
    hidden: bool = False


@dataclass(frozen=True)
class _Override:
    level: str
    expires_at: datetime | None


@dataclass
class _Snapshot:
    version: int
    #: role_id -> feature -> grant
    roles: dict[int, dict[str, _Grant]] = field(default_factory=dict)
    #: user_id -> feature -> override
    overrides: dict[int, dict[str, _Override]] = field(default_factory=dict)
    #: feature -> its supported levels
    features: dict[str, tuple[str, ...]] = field(default_factory=dict)


_lock = threading.Lock()
_snapshot: _Snapshot | None = None
_checked_at = 0.0


def invalidate() -> None:
    """Forget the cached grants; the next check re-reads them. Called by the
    pod that changes access, so its own change applies at once."""
    global _snapshot, _checked_at
    with _lock:
        _snapshot = None
        _checked_at = 0.0


def bump_version(db: Session) -> None:
    """Record that access changed, for every pod. Call inside the writing
    transaction; the version moves when it commits."""
    db.execute(update(AccessVersion).values(version=AccessVersion.version + 1))
    invalidate()


def _load(db: Session, version: int) -> _Snapshot:
    snap = _Snapshot(version=version)
    for key, levels in db.execute(select(FeatureRow.key, FeatureRow.levels)):
        snap.features[key] = tuple(x for x in levels.split(",") if x)
    for g in db.scalars(select(RoleFeatureGrant)):
        snap.roles.setdefault(g.role_id, {})[g.feature_key] = _Grant(g.level, bool(g.hidden_in_menus))
    for o in db.scalars(select(UserFeatureOverride)):
        snap.overrides.setdefault(o.user_id, {})[o.feature_key] = _Override(o.level, _aware(o.expires_at))
    return snap


def _current(db: Session) -> _Snapshot:
    global _snapshot, _checked_at
    now = time.monotonic()
    with _lock:
        snap, checked = _snapshot, _checked_at
    if snap is not None and now - checked < CHECK_SECONDS:
        return snap
    version = db.execute(select(AccessVersion.version)).scalar() or 0
    if snap is None or snap.version != version:
        snap = _load(db, version)
    with _lock:
        _snapshot, _checked_at = snap, now
    return snap


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _session_for(user: User, db: Session | None) -> Session:
    session = db or object_session(user)
    if session is None:
        raise RuntimeError("effective_level needs a database session")
    return session


# --------------------------------------------------------------------------
# Answers
# --------------------------------------------------------------------------
def at_least(level: str, needed: str) -> bool:
    return LEVEL_RANK.get(level, 0) >= LEVEL_RANK[needed]


def active_override(snap: _Snapshot, user_id: int, feature: str, now: datetime | None = None):
    override = snap.overrides.get(user_id, {}).get(feature)
    if override is None:
        return None
    if override.expires_at is not None and override.expires_at <= (now or datetime.now(timezone.utc)):
        return None  # Expired exceptions stop working at once; the daily job deletes them.
    return override


def effective_level(user: User, feature: str, db: Session | None = None) -> str:
    """'none', 'view' or 'edit': the user's override if present and not
    expired, otherwise their role's grant, otherwise none."""
    snap = _current(_session_for(user, db))
    override = active_override(snap, user.id, str(feature))
    if override is not None:
        return override.level
    grant = snap.roles.get(user.role_id, {}).get(str(feature))
    return grant.level if grant else LEVEL_NONE


def has(user: User, feature: str, level: str = LEVEL_VIEW, db: Session | None = None) -> bool:
    return at_least(effective_level(user, feature, db), level)


def allows(user: User, area: str) -> bool:
    """Whether ``user`` may use ``area`` (at view level)."""
    return has(user, area)


def check(user: User, area: str, level: str = LEVEL_VIEW) -> None:
    """403 unless the user has at least ``level`` on ``area``."""
    if not has(user, area, level):
        raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)


def access_map(user: User, db: Session | None = None) -> dict:
    """What GET /me/access returns: every feature the user has, its level,
    and the ones that are usable but not offered in menus."""
    snap = _current(_session_for(user, db))
    features: dict[str, str] = {}
    hidden: list[str] = []
    exceptions: list[str] = []
    for key in snap.features:
        override = active_override(snap, user.id, key)
        grant = snap.roles.get(user.role_id, {}).get(key)
        if override is not None:
            level = override.level
            exceptions.append(key)
        else:
            level = grant.level if grant else LEVEL_NONE
        if level == LEVEL_NONE:
            continue
        features[key] = level
        if override is None and grant is not None and grant.hidden:
            hidden.append(key)
    role = user.role
    return {
        "features": features,
        "hidden_in_menus": sorted(hidden),
        "exceptions": sorted(exceptions),
        "landing": landing_for(user),
        "role": role.name if role else None,
        "data_scope_type": role.data_scope_type if role else "none",
        "version": snap.version,
    }


def landing_for(user: User) -> str:
    """'standard', 'region', 'work', or an app route such as '/explorer'."""
    role = user.role
    return (role.landing if role is not None else None) or "standard"


def require_access(feature: str, level: str = LEVEL_VIEW) -> Callable[..., User]:
    """FastAPI dependency: the current user, refused with 403 below ``level``
    on ``feature``. Writes ask for ``edit``.

    The guard carries ``feature`` and ``level`` so a test can list every route
    and fail when one has no feature check (tests/test_feature_access.py).
    """
    feature = Feature(feature)
    if level not in (LEVEL_VIEW, LEVEL_EDIT):
        raise ValueError(f"level must be view or edit, not {level!r}")

    def guard(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not has(current_user, feature, level, db):
            raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)
        return current_user

    guard.feature = feature  # type: ignore[attr-defined]
    guard.level = level  # type: ignore[attr-defined]
    guard.__name__ = f"require_access_{feature.value}_{level}"
    return guard
