"""Idempotent startup bootstrap: seed roles, categories and the first admin."""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
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

# Additive columns that may be missing on databases created by an earlier
# version. Each entry: table -> {column_name: SQL type}. This is a lightweight,
# idempotent forward-migration for simple column additions; anything more
# complex (renames, constraints, backfills) should use an Alembic migration.
ADDITIVE_COLUMNS: dict[str, dict[str, str]] = {
    "work_items": {
        "last_stage": "VARCHAR(60)",
        "dt_sc_contractor_id": "INTEGER",
        "dt_status": "VARCHAR(20)",
        "dt_problem_category": "VARCHAR(120)",
        "dt_date_gregorian": "DATE",
    },
    "monthly_snapshots": {
        "current_month_dt_done": "INTEGER DEFAULT 0",
    },
    "cpm_import_batches": {
        "new_villages_count": "INTEGER DEFAULT 0",
        "changed_village_qty": "INTEGER DEFAULT 0",
        "changed_site_type": "INTEGER DEFAULT 0",
        "changed_requested_tech": "INTEGER DEFAULT 0",
    },
    "cpm_change_requests": {
        "change_type": "VARCHAR(30) DEFAULT 'field'",
        "detail": "TEXT",
        "payload_json": "TEXT",
    },
    "villages": {
        "target_classification": "VARCHAR(60)",
    },
    "hc_tasks": {
        "reviewed_by": "INTEGER",
        "reviewed_at": "TIMESTAMP",
        "round_no": "INTEGER DEFAULT 1",
    },
    "roles": {
        "is_category_owner": "BOOLEAN DEFAULT FALSE",
    },
    "problem_categories": {
        "owner_role_id": "INTEGER",
        "sla_days": "INTEGER DEFAULT 7",
    },
    "assignments": {
        "returned_at": "TIMESTAMP",
        "return_reason": "TEXT",
    },
}

# Indexes on existing foreign-key columns, added for databases created before
# this change. Postgres does not auto-index foreign keys (only primary keys),
# and these columns are hit constantly by row-level security joins and chart
# grouping — the cost grows with data volume without them.
# Format: index_name -> (table, column).
ADDITIVE_INDEXES: dict[str, tuple[str, str]] = {
    "ix_sites_province_id": ("sites", "province_id"),
    "ix_sites_region_id": ("sites", "region_id"),
    "ix_work_items_site_id": ("work_items", "site_id"),
    "ix_work_items_dt_sc_contractor_id": ("work_items", "dt_sc_contractor_id"),
    "ix_villages_work_item_id": ("villages", "work_item_id"),
    "ix_acceptances_village_id": ("acceptances", "village_id"),
    "ix_health_checks_work_item_id": ("health_checks", "work_item_id"),
    "ix_assignments_work_item_id": ("assignments", "work_item_id"),
    "ix_assignments_contractor_id": ("assignments", "contractor_id"),
    "ix_drive_tests_work_item_id": ("drive_tests", "work_item_id"),
}

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
    """Create tables (dev convenience) and seed baseline data."""
    Base.metadata.create_all(bind=engine)
    _sync_additive_columns()
    _sync_additive_indexes()
    db = SessionLocal()
    try:
        _seed_roles(db)
        _seed_problem_categories(db)
        _seed_provinces(db)
        _seed_admin(db)
        db.commit()
    finally:
        db.close()


def _sync_additive_columns() -> None:
    """Add any missing additive columns to existing tables (idempotent).

    Lets a database created by an earlier schema pick up new nullable columns
    without a full wipe. Skips columns that already exist.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, columns in ADDITIVE_COLUMNS.items():
            if table not in existing_tables:
                continue  # create_all already made it with all columns
            present = {c["name"] for c in inspector.get_columns(table)}
            for col_name, col_type in columns.items():
                if col_name not in present:
                    conn.execute(
                        text(f'ALTER TABLE {table} ADD COLUMN {col_name} {col_type}')
                    )


def _sync_additive_indexes() -> None:
    """Create any missing indexes on existing tables (idempotent).

    Uses IF NOT EXISTS, supported by both Postgres and SQLite, so this is
    safe to run on every startup regardless of whether the index already
    exists (fresh install via create_all already has them).
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for index_name, (table, column) in ADDITIVE_INDEXES.items():
            if table not in existing_tables:
                continue
            present_cols = {c["name"] for c in inspector.get_columns(table)}
            if column not in present_cols:
                continue  # column itself doesn't exist yet on this DB
            conn.execute(
                text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})")
            )


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
