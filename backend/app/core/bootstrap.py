"""Idempotent startup seeding: roles, categories, provinces and the first admin.

This module used to manage the database schema as well, in three overlapping
ways: ``Base.metadata.create_all()``, a hand-written ``ADDITIVE_COLUMNS`` table
of raw ``ALTER TABLE`` statements, and ``ADDITIVE_INDEXES``. They disagreed with
each other and with the models, so a database that grew through them came out
subtly different from a freshly created one.

All three are gone. **Alembic is now the only thing that changes the schema**,
and it runs at deploy time (see ``backend/entrypoint.sh``), not from inside the
application. What is left here is seeding reference data, which is a different
job: it inserts rows, never structure, and it is safe to repeat.
"""
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.deps import (
    CPG_POWER,
    CPG_ROLLOUT_PM,
    MANAGED_SERVICE,
    NWG_PLANNING,
)
from app.core.security import hash_password
from app.models.reference import ProblemCategory, Province, Role, User
from app.services.cpm_columns import IRAN_PROVINCES

settings = get_settings()

DEFAULT_ROLES = [
    "Admin",
    "PM",
    "Coordinator",
    "RegionalManager",
    "Contractor",
    "Viewer",
]

# The roles that own a health-check problem category. Seeded with
# is_category_owner=True, which is what every permission check keys off.
CATEGORY_OWNER_ROLES = [
    CPG_POWER,
    CPG_ROLLOUT_PM,
    MANAGED_SERVICE,
    NWG_PLANNING,
]

# category name -> (owning role, SLA in days). This is the routing table for
# the remediation loop; it is seeded here but owned by Admin afterwards, so a
# re-pointed category is never overwritten on restart.
DEFAULT_PROBLEM_CATEGORIES: dict[str, tuple[str, int]] = {
    "Temporary Power": (CPG_POWER, 7),
    "Project Responsibility": (CPG_ROLLOUT_PM, 7),
    "MS Responsibility": (MANAGED_SERVICE, 10),
    "NWG Responsibility": (NWG_PLANNING, 14),
}


def init_db() -> None:
    """Seed baseline reference data. Does not touch the schema.

    Safe to run on every start: each seeding step checks what is already there
    and only fills in what is missing, so it never overwrites an Admin's later
    edits (a re-pointed problem category keeps its new owning role, for example).

    The schema itself must already exist. ``entrypoint.sh`` runs
    ``alembic upgrade head`` before the application starts, and the test suite
    calls ``tests.conftest.create_schema()``.
    """
    db = SessionLocal()
    try:
        _seed_roles(db)
        _seed_problem_categories(db)
        _seed_provinces(db)
        _seed_admin(db)
        db.commit()
    finally:
        db.close()


def _seed_roles(db: Session) -> None:
    existing = {r.name: r for r in db.query(Role).all()}
    for name in DEFAULT_ROLES:
        if name not in existing:
            db.add(Role(name=name))
    for name in CATEGORY_OWNER_ROLES:
        role = existing.get(name)
        if role is None:
            db.add(Role(name=name, is_category_owner=True))
        elif not role.is_category_owner:
            # Repair a row created before the flag existed.
            role.is_category_owner = True
    db.flush()


def _seed_problem_categories(db: Session) -> None:
    """Seed the four categories and point each at its owning role.

    Only *fills in* routing that is missing. An Admin who re-points a category
    at a different role, or changes its SLA, keeps that choice across restarts.
    """
    roles = {r.name: r for r in db.query(Role).all()}
    existing = {c.name: c for c in db.query(ProblemCategory).all()}

    for name, (role_name, sla_days) in DEFAULT_PROBLEM_CATEGORIES.items():
        owner = roles.get(role_name)
        category = existing.get(name)
        if category is None:
            db.add(
                ProblemCategory(
                    name=name,
                    owner_role_id=owner.id if owner else None,
                    sla_days=sla_days,
                )
            )
        elif category.owner_role_id is None and owner is not None:
            category.owner_role_id = owner.id
            category.sla_days = category.sla_days or sla_days
    db.flush()


def _seed_provinces(db: Session) -> None:
    """Seed the 31 official Iranian provinces (idempotent).

    CPM import resolves every استان cell to one of these canonical rows, so the
    provinces table never accumulates stray non-province values.
    """
    existing = {p.name for p in db.query(Province).all()}
    for name in IRAN_PROVINCES:
        if name not in existing:
            db.add(Province(name=name))
    db.flush()


def _seed_admin(db: Session) -> None:
    if db.query(User).filter(User.username == settings.first_admin_username).first():
        return
    admin_role = db.query(Role).filter(Role.name == "Admin").one()
    db.add(
        User(
            username=settings.first_admin_username,
            password_hash=hash_password(settings.first_admin_password),
            full_name=settings.first_admin_fullname,
            role_id=admin_role.id,
            sees_all_provinces=True,
            active=True,
        )
    )
