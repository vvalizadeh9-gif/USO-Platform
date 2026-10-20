"""Province assignments (UEP-17): one coordinator per CRA region.

The 31 provinces are fixed to the 9 CRA regions (``province_mapping.cra_region``,
seeded from ``core/province_directory``). A coordinator is given a whole region,
never a single province, and the change is a plain overwrite: there are no
effective dates, so past months move to the new coordinator too.

A coordinator's ownership is read from three places, and this module is the
only writer that keeps them in step:

* ``provinces.coordinator_user_id`` -- the Acceptance filters and the Action
  Center's owner names;
* ``province_mapping.pso_coordinator`` on the open rows, written as the
  account's ``kpi_person_name`` -- Roles Performance and Lifecycle Gaps;
* the coordinators' province grants (``user_province_access``) -- Home and
  Acceptance Validation, through ``services/visibility``.

Every screen keeps reading the column it always read; only the values change,
and they change in one transaction. ``province_assignment_history`` keeps the
record of who held what.
"""
from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.deps import COORDINATOR
from app.models.kpi import ProvinceMapping
from app.models.province_assignment import ProvinceAssignmentHistory
from app.models.reference import Province, Role, User
from app.services import kpi_mapping
from app.services.audit import record_audit

#: How many coordinator colours the page cycles through (UEP-17 §3).
COLOUR_COUNT = 4

#: The 422 every other screen answers when asked to set a coordinator.
PER_REGION_ONLY = "Coordinators are assigned per CRA region in Province assignments"


class AssignmentError(Exception):
    """The request is invalid (422). The message is shown to the user."""


class StaleChange(Exception):
    """Someone saved meanwhile: ``stale`` maps region to its current owner id."""

    def __init__(self, stale: dict[str, int | None]):
        super().__init__("These regions were changed by someone else")
        self.stale = stale


@dataclass
class Region:
    """One CRA region as it stands: its open mapping rows, its provinces and
    the coordinator account that owns it (None when no account does)."""

    name: str
    rows: list[ProvinceMapping]
    provinces: list[Province]
    owner_id: int | None
    #: The coordinator as the mapping names them, for a region whose owner has
    #: no active account (a fresh install before accounts are linked).
    owner_name: str | None


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- people --
def coordinator_accounts(db: Session) -> list[User]:
    """Active Coordinator accounts in creation order -- the page's columns."""
    return list(
        db.execute(
            select(User)
            .join(Role, User.role_id == Role.id)
            .where(Role.name == COORDINATOR, User.active)
            .order_by(User.created_at, User.id)
        ).scalars()
    )


def display_name(user: User) -> str:
    """How the page names a coordinator: the mapping name, else the first name."""
    return user.kpi_person_name or user.first_name or user.full_name


def initials(user: User) -> str:
    parts = [p for p in (user.first_name, user.family_name) if p and p.strip()]
    if len(parts) == 2:
        return (parts[0][0] + parts[1][0]).upper()
    return display_name(user)[:2].upper()


def _by_person(accounts: list[User]) -> dict[str, User]:
    """Linked accounts by their mapping name, case-insensitively. The first
    account wins when two claim the same name."""
    out: dict[str, User] = {}
    for account in accounts:
        if account.kpi_person_name:
            out.setdefault(account.kpi_person_name.casefold(), account)
    return out


def _names(db: Session, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    users = db.execute(select(User).where(User.id.in_(ids))).scalars()
    return {u.id: display_name(u) for u in users}


# --------------------------------------------------------------- regions --
def _regions(db: Session, accounts: list[User], *, lock: bool = False) -> list[Region]:
    """Every CRA region with its open rows and provinces, in name order.

    ``lock`` takes row locks on both stores (PostgreSQL), so two saves cannot
    both pass the optimistic check and then interleave their writes.
    """
    rows_q = (
        select(ProvinceMapping)
        .where(ProvinceMapping.effective_to.is_(None))
        .order_by(ProvinceMapping.cra_region, ProvinceMapping.province_en)
    )
    if lock:
        rows_q = rows_q.with_for_update()
    rows = list(db.execute(rows_q).scalars())

    prov_q = select(Province).where(Province.name.in_([r.province_fa for r in rows]))
    if lock:
        prov_q = prov_q.with_for_update()
    provinces = {p.name: p for p in db.execute(prov_q).scalars()}

    grouped: dict[str, list[ProvinceMapping]] = {}
    for row in rows:
        grouped.setdefault(row.cra_region, []).append(row)

    people = _by_person(accounts)
    out = []
    for name in sorted(grouped):
        region_rows = grouped[name]
        region_provinces = [provinces[r.province_fa] for r in region_rows if r.province_fa in provinces]
        owner_name = Counter(r.pso_coordinator for r in region_rows).most_common(1)[0][0]
        out.append(Region(
            name=name,
            rows=region_rows,
            provinces=region_provinces,
            owner_id=_owner_id(region_provinces, owner_name, people),
            owner_name=owner_name,
        ))
    return out


def _owner_id(provinces: list[Province], owner_name: str, people: dict[str, User]) -> int | None:
    """The account that owns a region. ``provinces.coordinator_user_id`` when
    set (the stores agree after the UEP-17 migration); else the account the
    mapping's name is linked to."""
    held = Counter(p.coordinator_user_id for p in provinces if p.coordinator_user_id)
    if held:
        return held.most_common(1)[0][0]
    account = people.get(owner_name.casefold())
    return account.id if account else None


def region_coordinator_name(db: Session, cra_region: str) -> str | None:
    """The coordinator the mapping names for a region, or None for a region
    with no open rows yet."""
    names = db.execute(
        select(ProvinceMapping.pso_coordinator).where(
            ProvinceMapping.effective_to.is_(None),
            func.lower(ProvinceMapping.cra_region) == cra_region.strip().lower(),
        )
    ).scalars().all()
    return Counter(names).most_common(1)[0][0] if names else None


def require_region_coordinator(db: Session, cra_region: str, pso_coordinator: str) -> str:
    """Refuse a per-province coordinator that differs from its region's (422).

    For the KPI mapping endpoints, which still correct and reassign a
    province's regional manager. Returns the name spelled as the region
    spells it, so a differently capitalised echo is never written back.
    """
    current = region_coordinator_name(db, cra_region)
    if current is None:
        return pso_coordinator.strip()
    if current.casefold() != pso_coordinator.strip().casefold():
        raise AssignmentError(PER_REGION_ONLY)
    return current


# -------------------------------------------------------------- overview --
def get_overview(db: Session) -> dict:
    """The page's one read: regions, coordinator columns and the last change."""
    accounts = coordinator_accounts(db)
    regions = _regions(db, accounts)
    owned_regions = Counter(r.owner_id for r in regions)
    owned_provinces = Counter()
    for r in regions:
        owned_provinces[r.owner_id] += len(r.rows)

    last = history(db, limit=1)
    return {
        "regions": [
            {
                "name": r.name,
                "provinces": [{"fa": row.province_fa, "en": row.province_en} for row in r.rows],
                "coordinator_user_id": r.owner_id,
                "coordinator_name": r.owner_name,
            }
            for r in regions
        ],
        "coordinators": [
            {
                "user_id": a.id,
                "name": display_name(a),
                "initials": initials(a),
                "colour_index": i % COLOUR_COUNT,
                "linked": bool(a.kpi_person_name),
                "regions": owned_regions.get(a.id, 0),
                "provinces": owned_provinces.get(a.id, 0),
            }
            for i, a in enumerate(accounts)
        ],
        "total_provinces": sum(len(r.rows) for r in regions),
        "last_change": {"at": last[0]["at"], "by": last[0]["by"]} if last else None,
    }


# ---------------------------------------------------------------- writes --
def _eligible(db: Session, user_id: int) -> User:
    """The account a region may be given, or a 422 saying why not."""
    account = db.get(User, user_id)
    if account is None or account.role.name != COORDINATOR or not account.active:
        raise AssignmentError("That user is not an active Coordinator")
    return account


def _name_for(db: Session, account: User, actor: User) -> str:
    """The name ``province_mapping`` records for this account.

    An account is chosen on the page as itself; the mapping still records
    coordinators by name (it names people the KPI pages report on), so an
    account that has none yet gets its full name from Users & roles, set
    here and audit-logged. Refuses (422) a name another coordinator account
    already holds: the two would share each other's regions.
    """
    if account.kpi_person_name:
        return account.kpi_person_name
    name = account.full_name
    taken = db.execute(
        select(User.id)
        .join(Role, User.role_id == Role.id)
        .where(
            Role.name == COORDINATOR,
            User.id != account.id,
            func.lower(User.kpi_person_name) == name.lower(),
        )
    ).first()
    if taken:
        raise AssignmentError(
            f"Another coordinator account already reports as {name!r}. "
            "Give one of them a different name in Users & roles."
        )
    account.kpi_person_name = name
    record_audit(
        db, user_id=actor.id, action=audit_actions.UPDATED, module="Admin",
        entity_type="User", entity_id=account.id,
        old_value={"kpi_person_name": None}, new_value={"kpi_person_name": name},
        reason="Named in province_mapping when first given a CRA region",
    )
    return name


def _move_grants(db: Session, provinces: list[Province], owner: User) -> None:
    """Give the region's province grants to ``owner`` and take them from every
    other coordinator account, so Home and Acceptance Validation follow."""
    ids = {p.id for p in provinces}
    others = db.execute(
        select(User)
        .join(Role, User.role_id == Role.id)
        .where(
            Role.name == COORDINATOR,
            User.id != owner.id,
            User.sees_all_provinces.is_(False),
            User.provinces.any(Province.id.in_(ids)),
        )
    ).scalars()
    for other in others:
        other.provinces = [p for p in other.provinces if p.id not in ids]
    if not owner.sees_all_provinces:
        held = {p.id for p in owner.provinces}
        owner.provinces.extend(p for p in provinces if p.id not in held)


def _apply(
    db: Session, region: Region, owner: User, actor: User, change_id: uuid.UUID, now: datetime
) -> None:
    """Write one region's new owner to all three stores, and its history."""
    for row in region.rows:
        if row.pso_coordinator != owner.kpi_person_name:
            kpi_mapping.correct(
                db, row,
                cra_region=row.cra_region,
                pso_coordinator=owner.kpi_person_name,
                regional_manager=row.regional_manager,
            )
    for province in region.provinces:
        province.coordinator_user_id = owner.id
    _move_grants(db, region.provinces, owner)
    db.add(ProvinceAssignmentHistory(
        change_id=change_id, cra_region=region.name,
        old_coordinator_user_id=region.owner_id, new_coordinator_user_id=owner.id,
        changed_by=actor.id, changed_at=now,
    ))


def _commit_plan(
    db: Session, plan: list[tuple[Region, User]], actor: User, *, reason: str | None = None
) -> uuid.UUID:
    """Apply ``(region, new owner)`` pairs as one change and audit it."""
    change_id = uuid.uuid4()
    if not plan:
        return change_id
    now = _now()
    for region, owner in plan:
        _name_for(db, owner, actor)
        _apply(db, region, owner, actor, change_id, now)
    db.flush()
    record_audit(
        db, user_id=actor.id, action=audit_actions.UPDATED, module="Admin",
        entity_type="CraRegionCoordinator", entity_id=None,
        old_value={"change_id": str(change_id),
                   "coordinators": {r.name: r.owner_id for r, _ in plan}},
        new_value={"change_id": str(change_id),
                   "coordinators": {r.name: o.id for r, o in plan}},
        reason=reason,
    )
    return change_id


def update(db: Session, changes: list[dict], user: User) -> uuid.UUID:
    """Apply ``[{cra_region, coordinator_user_id, expected_coordinator_user_id}]``
    atomically. Raises :class:`AssignmentError` (422) for an unknown region, a
    repeated region or an ineligible account, and :class:`StaleChange` (409)
    when any expected owner is no longer current. The caller commits."""
    regions = {r.name: r for r in _regions(db, coordinator_accounts(db), lock=True)}
    seen: set[str] = set()
    stale: dict[str, int | None] = {}
    plan: list[tuple[Region, User]] = []
    for change in changes:
        name = change["cra_region"]
        region = regions.get(name)
        if region is None:
            raise AssignmentError(f"Unknown CRA region {name!r}")
        if name in seen:
            raise AssignmentError(f"{name} appears more than once")
        seen.add(name)
        owner = _eligible(db, change["coordinator_user_id"])
        if change["expected_coordinator_user_id"] != region.owner_id:
            stale[name] = region.owner_id
        elif owner.id != region.owner_id:
            plan.append((region, owner))
    if stale:
        raise StaleChange(stale)
    return _commit_plan(db, plan, user)


def revert(db: Session, change_id: uuid.UUID, user: User) -> uuid.UUID:
    """Restore the coordinators before ``change_id``, as a new change.

    Raises ``LookupError`` for an unknown change and :class:`AssignmentError`
    when a previous coordinator can no longer be given a region.
    """
    entries = db.execute(
        select(ProvinceAssignmentHistory).where(ProvinceAssignmentHistory.change_id == change_id)
    ).scalars().all()
    if not entries:
        raise LookupError(str(change_id))
    regions = {r.name: r for r in _regions(db, coordinator_accounts(db), lock=True)}
    plan = []
    for entry in entries:
        region = regions.get(entry.cra_region)
        old = entry.old_coordinator_user_id
        if region is None or old is None or old == region.owner_id:
            continue
        plan.append((region, _eligible(db, old)))
    return _commit_plan(db, plan, user, reason=f"Reverted change {change_id}")


def changed_regions(db: Session, change_id: uuid.UUID) -> list[str]:
    """The regions one change gave to someone, for the page's toast."""
    return sorted(db.execute(
        select(ProvinceAssignmentHistory.cra_region)
        .where(ProvinceAssignmentHistory.change_id == change_id)
    ).scalars())


# --------------------------------------------------------------- history --
def history(db: Session, limit: int = 50) -> list[dict]:
    """Changes, newest first: ``[{change_id, by, at, changes: [...]}]``."""
    heads = db.execute(
        select(
            ProvinceAssignmentHistory.change_id,
            func.max(ProvinceAssignmentHistory.changed_at).label("at"),
            func.max(ProvinceAssignmentHistory.id).label("last_id"),
        )
        .group_by(ProvinceAssignmentHistory.change_id)
        .order_by(func.max(ProvinceAssignmentHistory.changed_at).desc(),
                  func.max(ProvinceAssignmentHistory.id).desc())
        .limit(limit)
    ).all()
    if not heads:
        return []
    entries = db.execute(
        select(ProvinceAssignmentHistory)
        .where(ProvinceAssignmentHistory.change_id.in_([h.change_id for h in heads]))
        .order_by(ProvinceAssignmentHistory.cra_region)
    ).scalars().all()
    grouped: dict[uuid.UUID, list[ProvinceAssignmentHistory]] = {}
    for e in entries:
        grouped.setdefault(e.change_id, []).append(e)

    people = _names(db, {e.old_coordinator_user_id for e in entries}
                    | {e.new_coordinator_user_id for e in entries})
    actors = _first_names(db, {e.changed_by for e in entries})
    sizes = _region_sizes(db)
    out = []
    for head in heads:
        group = grouped.get(head.change_id, [])
        by = group[0].changed_by if group else None
        out.append({
            "change_id": str(head.change_id),
            "by": actors.get(by, "System") if by else "System",
            "at": head.at,
            "changes": [
                {
                    "cra_region": e.cra_region,
                    "provinces": sizes.get(e.cra_region, 0),
                    "old": people.get(e.old_coordinator_user_id),
                    "new": people.get(e.new_coordinator_user_id),
                }
                for e in group
            ],
        })
    return out


def _first_names(db: Session, ids: set[int | None]) -> dict[int, str]:
    """Who made a change, as the page's meta line names them ("by Vahid")."""
    ids = {i for i in ids if i}
    if not ids:
        return {}
    users = db.execute(select(User).where(User.id.in_(ids))).scalars()
    return {u.id: u.first_name or u.full_name for u in users}


def _region_sizes(db: Session) -> dict[str, int]:
    return dict(db.execute(
        select(ProvinceMapping.cra_region, func.count())
        .where(ProvinceMapping.effective_to.is_(None))
        .group_by(ProvinceMapping.cra_region)
    ).all())
