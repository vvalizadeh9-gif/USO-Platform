"""Admin > Access: change what roles and people may use (UEP-25).

Every write here:

* checks the safety rules no tick can break (``validate_*`` below);
* records one audit entry with before -> after and the reason;
* bumps ``access_version`` so every pod re-reads its grants within 30 s.

Callers commit.

The safety rules, enforced here and tested in tests/test_feature_access.py:

1. **Data area always applies.** Row scope stays in services/visibility.py.
   The one feature that reads beyond the user's own rows, "Explorer: every
   site", can never be given to a contractor, province or region role.
2. **Admin can't lock themselves out.** Users and Access stay at Edit on the
   Admin role, and no exception may take them from the last active Admin.
3. **Outcome rules.** Edit on acceptance outcome filing and approval only for
   roles whose data scope is all, provinces, CRA regions or contractor. Team
   basket roles keep "Mark fixed" through Filing (acceptance_cases), as in
   UEP-24 F10.
4. **Expired exceptions** stop working at once (core/access.py ignores them)
   and the daily job deletes them, logging each.
5. **Explicit grants only.** Nothing is granted implicitly -- the Admin role
   gets workflow edit features only by a tick like any other role.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit_actions, user_status
from app.core import access
from app.core.access import Feature
from app.core.deps import ADMIN
from app.models.access import (
    LEVEL_EDIT,
    LEVEL_NONE,
    LEVEL_RANK,
    LEVEL_VIEW,
    Feature as FeatureRow,
    RoleFeatureGrant,
    UserFeatureOverride,
)
from app.models.reference import Role, User
from app.services.audit import record_audit

MODULE = "Access"

DATA_SCOPE_TYPES = ("all", "provinces", "cra_regions", "contractor", "team_basket", "none")
LANDINGS = ("standard", "region", "work")

#: Never removable from the Admin role, nor from the last active Admin.
LOCKOUT_FEATURES = (Feature.USERS, Feature.ACCESS)
#: Edit only for these data scopes (UEP-24 F10: team baskets mark fixed only).
OUTCOME_FEATURES = (Feature.ACCEPTANCE_FILING, Feature.ACCEPTANCE_APPROVE)
OUTCOME_SCOPES = ("all", "provinces", "cra_regions", "contractor")
#: The one feature that widens rows. Never for a scoped role.
ALL_SITES_FORBIDDEN_SCOPES = ("contractor", "provinces", "cra_regions")


class AccessRuleError(ValueError):
    """A change the safety rules refuse. The message says what to do."""


@dataclass(frozen=True)
class FeatureInfo:
    key: str
    app: str
    label: str
    description: str
    levels: tuple[str, ...]
    sort_order: int


def catalogue(db: Session) -> list[FeatureInfo]:
    rows = db.scalars(select(FeatureRow).order_by(FeatureRow.sort_order, FeatureRow.key))
    return [
        FeatureInfo(r.key, r.app, r.label, r.description, tuple(r.level_list), r.sort_order)
        for r in rows
    ]


def _features(db: Session) -> dict[str, FeatureInfo]:
    return {f.key: f for f in catalogue(db)}


def role_grants(db: Session, role_id: int) -> dict[str, RoleFeatureGrant]:
    return {
        g.feature_key: g
        for g in db.scalars(select(RoleFeatureGrant).where(RoleFeatureGrant.role_id == role_id))
    }


def user_counts(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(User.role_id, func.count(User.id))
        .where(User.status != user_status.INACTIVE)
        .group_by(User.role_id)
    )
    return {role_id: count for role_id, count in rows}


# --------------------------------------------------------------------------
# Safety rules
# --------------------------------------------------------------------------
def _check_level(info: FeatureInfo | None, key: str, level: str) -> None:
    if info is None:
        raise AccessRuleError(f"Unknown feature '{key}'.")
    if level != LEVEL_NONE and level not in info.levels:
        raise AccessRuleError(
            f"{info.label} supports {' and '.join(info.levels)} only, not {level}."
        )


def _check_scope_rules(label_of: dict[str, FeatureInfo], scope: str, key: str, level: str,
                       who: str) -> None:
    if key in OUTCOME_FEATURES and level == LEVEL_EDIT and scope not in OUTCOME_SCOPES:
        raise AccessRuleError(
            f"{who} has data area '{scope}', so it can't get Edit on "
            f"{label_of[key].label}. Team baskets mark cases fixed through Filing."
        )
    if key == Feature.EXPLORER_ALL_SITES and level != LEVEL_NONE and scope in ALL_SITES_FORBIDDEN_SCOPES:
        raise AccessRuleError(
            f"{who} sees only its own {scope.replace('_', ' ')}, so it can't get "
            f"{label_of[key].label}: that would widen its rows."
        )


def validate_role(db: Session, role: Role, grants: dict[str, str], scope: str) -> None:
    """Refuse a role's full set of grants if it breaks a safety rule."""
    infos = _features(db)
    if scope not in DATA_SCOPE_TYPES:
        raise AccessRuleError(f"Data area must be one of {', '.join(DATA_SCOPE_TYPES)}.")
    for key, level in grants.items():
        _check_level(infos.get(key), key, level)
        _check_scope_rules(infos, scope, key, level, f"The {role.name} role")
    if role.name == ADMIN:
        for key in LOCKOUT_FEATURES:
            if grants.get(key, LEVEL_NONE) != LEVEL_EDIT:
                raise AccessRuleError(
                    f"{infos[key].label} stays at Edit on the Admin role, so nobody is locked out."
                )


def _admins_who_can_manage(db: Session, exclude_user_id: int | None = None) -> int:
    """Active Admin-role users with Edit on Users and Access."""
    count = 0
    admins = db.scalars(
        select(User).join(User.role).where(Role.name == ADMIN, User.active)
    )
    for user in admins:
        if user.id == exclude_user_id:
            continue
        if all(access.has(user, key, LEVEL_EDIT, db) for key in LOCKOUT_FEATURES):
            count += 1
    return count


def validate_override(db: Session, user: User, key: str, level: str) -> None:
    infos = _features(db)
    _check_level(infos.get(key), key, level)
    scope = user.role.data_scope_type if user.role else "none"
    _check_scope_rules(infos, scope, key, level, user.full_name)
    if key in LOCKOUT_FEATURES and level != LEVEL_EDIT and user.role and user.role.name == ADMIN:
        if user.active and _admins_who_can_manage(db, exclude_user_id=user.id) == 0:
            raise AccessRuleError(
                f"{user.full_name} is the last active Admin who can manage access, so "
                f"{infos[key].label} can't be taken away."
            )


# --------------------------------------------------------------------------
# Role changes
# --------------------------------------------------------------------------
def _grant_map(db: Session, role_id: int) -> dict[str, str]:
    return {k: g.level for k, g in role_grants(db, role_id).items()}


def save_role(
    db: Session,
    role: Role,
    *,
    actor: User,
    grants: dict[str, str] | None = None,
    description: str | None = None,
    landing: str | None = None,
    data_scope_type: str | None = None,
    reason: str | None = None,
) -> dict:
    """Apply a role's new grants and settings. ``grants`` maps a feature to
    'none' | 'view' | 'edit' and only needs the features that change.
    Returns {'added': [...], 'removed': [...], 'changed': [...]}."""
    before = _grant_map(db, role.id)
    after = dict(before)
    for key, level in (grants or {}).items():
        if level == LEVEL_NONE:
            after.pop(key, None)
        else:
            after[key] = level
    scope = data_scope_type or role.data_scope_type
    if landing is not None:
        _check_landing(landing)
    validate_role(db, role, after, scope)

    meta_before = {"description": role.description, "landing": role.landing,
                   "data_scope_type": role.data_scope_type}
    if description is not None:
        role.description = description.strip() or None
    if landing is not None:
        role.landing = landing
    if data_scope_type is not None:
        role.data_scope_type = data_scope_type
    meta_after = {"description": role.description, "landing": role.landing,
                  "data_scope_type": role.data_scope_type}

    existing = role_grants(db, role.id)
    for key in set(before) | set(after):
        if before.get(key) == after.get(key):
            continue
        row = existing.get(key)
        if key not in after:
            db.delete(row)
        elif row is None:
            db.add(RoleFeatureGrant(role_id=role.id, feature_key=key, level=after[key]))
        else:
            row.level = after[key]
            # A level chosen in Admin is meant to be seen: it is offered in menus.
            row.hidden_in_menus = False

    summary = {
        "added": sorted(k for k in after if k not in before),
        "removed": sorted(k for k in before if k not in after),
        "changed": sorted(k for k in after if k in before and after[k] != before[k]),
    }
    if any(summary.values()) or meta_before != meta_after:
        record_audit(
            db, user_id=actor.id, action=audit_actions.ACCESS_ROLE_GRANT_CHANGED,
            module=MODULE, entity_type="Role", entity_id=role.id,
            old_value={"role": role.name, "grants": before, **meta_before},
            new_value={"role": role.name, "grants": after, **meta_after},
            reason=reason or _describe(role.name, before, after),
        )
        access.bump_version(db)
    return summary


def _describe(role_name: str, before: dict, after: dict) -> str:
    parts = []
    for key in sorted(set(before) | set(after)):
        if key not in before:
            parts.append(f"+{key} ({after[key]})")
        elif key not in after:
            parts.append(f"-{key}")
        elif before[key] != after[key]:
            parts.append(f"{key} {before[key]} -> {after[key]}")
    return f"{role_name}: " + (", ".join(parts) if parts else "settings changed")


def _check_landing(landing: str) -> None:
    if landing in LANDINGS or (landing.startswith("/") and len(landing) <= 80 and " " not in landing):
        return
    raise AccessRuleError("Landing must be standard, region, work, or an app route such as /explorer.")


def _check_name(db: Session, name: str) -> str:
    name = (name or "").strip()
    if not name or len(name) > 50:
        raise AccessRuleError("Give the role a name of 1 to 50 characters.")
    if db.scalar(select(Role.id).where(func.lower(Role.name) == name.lower())) is not None:
        raise AccessRuleError(f"A role called {name} already exists.")
    return name


def duplicate_role(db: Session, source: Role, *, name: str, actor: User,
                   description: str | None = None) -> Role:
    """A new, non-system role with the source's grants, landing and data area."""
    name = _check_name(db, name)
    role = Role(
        name=name,
        description=(description or "").strip() or f"Copy of {source.name}",
        landing=source.landing,
        data_scope_type=source.data_scope_type,
        is_system=False,
        is_category_owner=False,
    )
    db.add(role)
    db.flush()
    grants = role_grants(db, source.id)
    for key, g in grants.items():
        db.add(RoleFeatureGrant(role_id=role.id, feature_key=key, level=g.level,
                                hidden_in_menus=g.hidden_in_menus))
    record_audit(
        db, user_id=actor.id, action=audit_actions.ACCESS_ROLE_CREATED,
        module=MODULE, entity_type="Role", entity_id=role.id,
        old_value=None,
        new_value={"role": role.name, "copied_from": source.name,
                   "grants": {k: g.level for k, g in grants.items()},
                   "landing": role.landing, "data_scope_type": role.data_scope_type},
        reason=f"Created {role.name} from {source.name}",
    )
    access.bump_version(db)
    return role


def delete_role(db: Session, role: Role, *, actor: User) -> None:
    if role.is_system:
        raise AccessRuleError(f"{role.name} is a built-in role and can't be deleted.")
    users = db.scalar(select(func.count(User.id)).where(User.role_id == role.id)) or 0
    if users:
        raise AccessRuleError(
            f"{users} account{'s' if users != 1 else ''} still use {role.name}. "
            "Move them to another role first."
        )
    before = _grant_map(db, role.id)
    record_audit(
        db, user_id=actor.id, action=audit_actions.ACCESS_ROLE_DELETED,
        module=MODULE, entity_type="Role", entity_id=role.id,
        old_value={"role": role.name, "grants": before}, new_value=None,
        reason=f"Deleted role {role.name}",
    )
    for g in role_grants(db, role.id).values():
        db.delete(g)
    db.delete(role)
    access.bump_version(db)


# --------------------------------------------------------------------------
# Personal exceptions
# --------------------------------------------------------------------------
def overrides_for(db: Session, user_id: int) -> dict[str, UserFeatureOverride]:
    return {
        o.feature_key: o
        for o in db.scalars(select(UserFeatureOverride).where(UserFeatureOverride.user_id == user_id))
    }


def _override_value(o: UserFeatureOverride | None) -> dict | None:
    if o is None:
        return None
    return {"level": o.level, "reason": o.reason,
            "expires_at": o.expires_at.isoformat() if o.expires_at else None}


def set_override(db: Session, user: User, key: str, *, level: str, reason: str,
                 actor: User, expires_at: datetime | None = None) -> UserFeatureOverride:
    reason = (reason or "").strip()
    if not reason:
        raise AccessRuleError("Give a reason for this exception.")
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise AccessRuleError("The expiry date must be in the future.")
    validate_override(db, user, key, level)
    before_level = access.effective_level(user, key, db)
    row = overrides_for(db, user.id).get(key)
    old = _override_value(row)
    if row is None:
        row = UserFeatureOverride(user_id=user.id, feature_key=key)
        db.add(row)
    row.level = level
    row.reason = reason[:500]
    row.granted_by = actor.id
    row.granted_at = datetime.now(timezone.utc)
    row.expires_at = expires_at
    db.flush()
    record_audit(
        db, user_id=actor.id, action=audit_actions.ACCESS_USER_OVERRIDE_CHANGED,
        module=MODULE, entity_type="User", entity_id=user.id,
        old_value={"user": user.username, "feature": key, "effective": before_level,
                   "exception": old},
        new_value={"user": user.username, "feature": key, "effective": level,
                   "exception": _override_value(row)},
        reason=reason,
    )
    access.bump_version(db)
    return row


def remove_override(db: Session, user: User, key: str, *, actor: User,
                    reason: str | None = None) -> bool:
    row = overrides_for(db, user.id).get(key)
    if row is None:
        return False
    role_level = role_grants(db, user.role_id).get(key)
    role_level = role_level.level if role_level else LEVEL_NONE
    if key in LOCKOUT_FEATURES and role_level != LEVEL_EDIT:
        validate_override(db, user, key, role_level)
    before = _override_value(row)
    db.delete(row)
    record_audit(
        db, user_id=actor.id, action=audit_actions.ACCESS_USER_OVERRIDE_CHANGED,
        module=MODULE, entity_type="User", entity_id=user.id,
        old_value={"user": user.username, "feature": key, "effective": before["level"],
                   "exception": before},
        new_value={"user": user.username, "feature": key, "effective": role_level,
                   "exception": None},
        reason=(reason or "").strip() or "Exception removed; back to the role's level",
    )
    access.bump_version(db)
    return True


def expire_overrides(db: Session, now: datetime | None = None) -> int:
    """Delete exceptions past their expiry, logging each. The daily job."""
    now = now or datetime.now(timezone.utc)
    expired = [
        o for o in db.scalars(select(UserFeatureOverride).where(UserFeatureOverride.expires_at.isnot(None)))
        if access._aware(o.expires_at) <= now
    ]
    for o in expired:
        record_audit(
            db, user_id=None, action=audit_actions.ACCESS_OVERRIDE_EXPIRED,
            module=MODULE, entity_type="User", entity_id=o.user_id,
            old_value={"feature": o.feature_key, "exception": _override_value(o)},
            new_value=None, reason=f"Exception on {o.feature_key} expired",
        )
        db.delete(o)
    if expired:
        access.bump_version(db)
    return len(expired)


def user_view(db: Session, user: User) -> list[dict]:
    """Every feature with the user's effective level and where it comes from."""
    grants = role_grants(db, user.role_id)
    overrides = overrides_for(db, user.id)
    now = datetime.now(timezone.utc)
    rows = []
    for info in catalogue(db):
        grant = grants.get(info.key)
        role_level = grant.level if grant else LEVEL_NONE
        o = overrides.get(info.key)
        active = o is not None and (o.expires_at is None or access._aware(o.expires_at) > now)
        rows.append({
            "key": info.key,
            "role_level": role_level,
            "effective": o.level if active else role_level,
            "exception": None if o is None else {
                "level": o.level, "reason": o.reason,
                "granted_by": o.granted_by,
                "granted_at": o.granted_at,
                "expires_at": o.expires_at,
                "active": active,
            },
        })
    return rows


def affected_users(db: Session, role_id: int) -> int:
    return user_counts(db).get(role_id, 0)


__all__ = [
    "AccessRuleError", "DATA_SCOPE_TYPES", "LANDINGS", "LEVEL_RANK", "LEVEL_VIEW",
    "catalogue", "save_role", "duplicate_role", "delete_role", "set_override",
    "remove_override", "expire_overrides", "user_view", "role_grants", "user_counts",
]
