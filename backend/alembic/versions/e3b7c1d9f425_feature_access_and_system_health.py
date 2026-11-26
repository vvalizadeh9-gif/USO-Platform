"""UEP-25: feature access managed in Admin, and System health storage.

Creates ``features``, ``role_feature_grants``, ``user_feature_overrides``,
``access_version``, ``system_snapshots``, ``backup_confirmations`` and
``error_events``, and adds ``description``, ``landing``, ``data_scope_type``
and ``is_system`` to ``roles``.

**Day one is the same access as before.** The seed below is a frozen copy of
``app/core/access_matrix.json`` (the pre-UEP-25 areas plus one feature per
former ``require_roles`` group). ``tests/test_feature_access.py`` asserts the
migrated tables reproduce that file exactly.

The built-in roles are created here when missing (bootstrap used to be the
only place), so grants can be seeded against them on a fresh database too.

Idempotent: every insert is skipped when its row exists, so a re-run after a
partial failure changes nothing. Migrations run at every start-up through
``app.scripts.migrate_with_lock``.

Revision ID: e3b7c1d9f425
Revises: d2a7f4c9e815
Create Date: 2026-11-25
"""
import logging

import sqlalchemy as sa
from alembic import op

revision = "e3b7c1d9f425"
down_revision = "d2a7f4c9e815"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

#: (name, description, landing, data_scope_type, is_category_owner)
SYSTEM_ROLES = [
    ('Admin', 'Administers the platform: users, access and data', 'standard', 'all', False),
    ('PM', 'Runs the programme; decides plans and approvals', 'standard', 'all', False),
    ('Coordinator', 'Runs health checks, drive tests and acceptance in their regions', 'standard', 'cra_regions', False),
    ('RegionalManager', 'Follows delivery in their provinces', 'region', 'provinces', False),
    ('Contractor', 'Field work and filing for one contractor company', 'standard', 'contractor', False),
    ('Viewer', 'Reads everything a PM sees, changes nothing', 'standard', 'all', False),
    ('CpgPso', 'Acceptance team basket', 'work', 'team_basket', False),
    ('CpgPower', 'Temp Power fixes and acceptance basket', 'work', 'team_basket', True),
    ('CpgRolloutPM', 'CPG project fixes and acceptance basket', 'work', 'team_basket', True),
    ('ManagedService', 'Managed Service fixes and acceptance basket', 'work', 'team_basket', True),
    ('NwgPlanning', 'NWG RND fixes and acceptance basket', 'work', 'team_basket', True),
    ('HuaweiCleanup', 'Huawei Cleanup fixes', 'work', 'none', True),
]

#: (key, app, label, description, levels, sort_order)
FEATURES = [
    ('explorer', 'Explorer', 'Explorer', 'Every site and village and its full record', 'view', 10),
    ('explorer_all_sites', 'Explorer', 'Explorer: every site', "Reads every live site instead of the user's own area (read only)", 'view', 20),
    ('hc_work', 'Drive test', 'Health check work', 'Assign, review and confirm health checks', 'view,edit', 30),
    ('dt_assignment', 'Drive test', 'Drive test assignment', 'Assign drive tests and choose the contractor', 'view,edit', 40),
    ('dt_review', 'Drive test', 'Drive test review', 'Approve or send back submitted drive tests', 'view,edit', 50),
    ('dt_evidence', 'Drive test', 'Drive test evidence', 'Attach reports to a submitted drive test', 'edit', 60),
    ('field_results', 'Drive test', 'Submit field results', 'Upload health check and drive test results', 'edit', 70),
    ('contractor_work', 'Drive test', 'Contractor work queues', "A contractor's own health checks and drive tests", 'view,edit', 80),
    ('fix_queue', 'Drive test', 'Fix queue', "Work and close fixes for the role's problem category", 'view,edit', 90),
    ('reassign_work', 'Drive test', 'Reassign work', 'Move an assigned check or test to another contractor', 'edit', 100),
    ('submissions', 'Drive test', 'ICT submissions', 'Send DT-done villages to ICT HQ', 'view', 110),
    ('acceptance_cases', 'Acceptance', 'Filing', 'The acceptance cases inbox', 'view', 120),
    ('acceptance_workspace', 'Acceptance', 'Acceptance workspace', 'Village acceptance records behind Filing', 'view', 130),
    ('acceptance_filing', 'Acceptance', 'Acceptance outcome filing', 'File ICT and CRA submissions, letters and evidence', 'edit', 140),
    ('acceptance_approve', 'Acceptance', 'Approve acceptance', 'Approve or reject filed acceptance', 'edit', 150),
    ('validation', 'Acceptance', 'ICT and CRA validation', 'Validate filed letters against CPM', 'view', 160),
    ('scan_upload', 'Acceptance', 'Upload scans', 'Upload scanned acceptance letters', 'edit', 170),
    ('monthly_plan_queue', 'Planning', 'Monthly plan queue', "The month's contractor plans", 'view', 180),
    ('internal_pip', 'Planning', 'Internal PIP and history', "MTN's internal plan and its history", 'view', 190),
    ('contractor_plan', 'Planning', 'File monthly plan', 'A contractor files its own monthly plan', 'edit', 200),
    ('plan_approvals', 'Planning', 'Monthly plan approvals', 'Approve, adjust or return plans and set the internal target', 'edit', 210),
    ('insights_dashboards', 'Insights', 'Dashboards', 'Drive test and Acceptance dashboards', 'view', 220),
    ('roles_performance', 'Insights', 'Roles performance', 'Delivery and acceptance against national', 'view', 230),
    ('lifecycle_gaps', 'Insights', 'Lifecycle gaps', 'Where approvals are still waiting', 'view', 240),
    ('mojri_section', 'Insights', 'Mojri figures', 'The ICT vs CRA vs Mojri card and its exports', 'view', 250),
    ('acceptance_baskets', 'Insights', 'Acceptance baskets', 'Who holds each acceptance case, and for how long', 'view', 260),
    ('acceptance_target', 'Insights', 'Acceptance target', "Set the Acceptance dashboard's monthly target", 'edit', 270),
    ('kpi_mapping', 'Insights', 'KPI person mapping', 'Link KPI names to accounts for Roles performance', 'view,edit', 280),
    ('exports', 'Insights', 'Export to Excel', 'Download workbooks and exports from any page', 'view', 290),
    ('users', 'Admin', 'Users', 'Create, edit and suspend accounts; reset passwords', 'view,edit', 300),
    ('access', 'Admin', 'Access', 'Roles, feature grants and personal exceptions', 'view,edit', 310),
    ('province_assignments', 'Admin', 'Province assignments', 'Who coordinates and manages each province', 'view,edit', 320),
    ('sla_policies', 'Admin', 'SLA policies', 'Target days per workflow step', 'view,edit', 330),
    ('problem_categories', 'Admin', 'Problem categories', 'Health-check problem categories and owners', 'view,edit', 340),
    ('provinces', 'Admin', 'Provinces', 'Province coordinator and manager settings', 'view,edit', 350),
    ('action_sla', 'Admin', 'Action SLA', 'Home queue SLA settings', 'view,edit', 360),
    ('cpm_import', 'Admin', 'CPM import', 'Import the CPM workbook and wipe CPM data', 'view,edit', 370),
    ('cpm_change_requests', 'Admin', 'CPM changes', 'Review changes a CPM import proposes', 'view,edit', 380),
    ('mojri_upload', 'Admin', 'Mojri upload', 'Mojri template and tracker upload', 'view,edit', 390),
    ('admin_overview', 'Admin', 'Admin overview', 'Platform statistics', 'view', 400),
    ('system_health', 'Admin', 'System health', 'App, resources, database, backups and freshness; Edit adds usage and backup dates', 'view,edit', 410),
    ('audit_log', 'Admin', 'Audit log', 'Every recorded action', 'view', 420),
]

#: (role, feature, level, hidden_in_menus)
GRANTS = [
    ('PM', 'roles_performance', 'view', False),
    ('Coordinator', 'roles_performance', 'view', False),
    ('Viewer', 'roles_performance', 'view', False),
    ('Contractor', 'roles_performance', 'view', False),
    ('RegionalManager', 'roles_performance', 'view', False),
    ('PM', 'lifecycle_gaps', 'view', False),
    ('Coordinator', 'lifecycle_gaps', 'view', False),
    ('Viewer', 'lifecycle_gaps', 'view', False),
    ('Contractor', 'lifecycle_gaps', 'view', False),
    ('RegionalManager', 'lifecycle_gaps', 'view', False),
    ('PM', 'mojri_section', 'view', False),
    ('Coordinator', 'mojri_section', 'view', False),
    ('Viewer', 'mojri_section', 'view', False),
    ('PM', 'insights_dashboards', 'view', False),
    ('Coordinator', 'insights_dashboards', 'view', False),
    ('Viewer', 'insights_dashboards', 'view', False),
    ('Contractor', 'insights_dashboards', 'view', False),
    ('Admin', 'insights_dashboards', 'view', True),
    ('PM', 'explorer', 'view', False),
    ('Coordinator', 'explorer', 'view', False),
    ('Viewer', 'explorer', 'view', False),
    ('Contractor', 'explorer', 'view', False),
    ('RegionalManager', 'explorer', 'view', False),
    ('NwgPlanning', 'explorer', 'view', False),
    ('ManagedService', 'explorer', 'view', False),
    ('HuaweiCleanup', 'explorer', 'view', False),
    ('CpgPower', 'explorer', 'view', False),
    ('CpgRolloutPM', 'explorer', 'view', False),
    ('CpgPso', 'explorer', 'view', False),
    ('Admin', 'explorer', 'view', True),
    ('NwgPlanning', 'explorer_all_sites', 'view', False),
    ('ManagedService', 'explorer_all_sites', 'view', False),
    ('HuaweiCleanup', 'explorer_all_sites', 'view', False),
    ('CpgPower', 'explorer_all_sites', 'view', False),
    ('CpgRolloutPM', 'explorer_all_sites', 'view', False),
    ('CpgPso', 'explorer_all_sites', 'view', False),
    ('PM', 'acceptance_workspace', 'view', False),
    ('Coordinator', 'acceptance_workspace', 'view', False),
    ('Viewer', 'acceptance_workspace', 'view', False),
    ('Contractor', 'acceptance_workspace', 'view', False),
    ('PM', 'acceptance_cases', 'view', False),
    ('Coordinator', 'acceptance_cases', 'view', False),
    ('Viewer', 'acceptance_cases', 'view', False),
    ('Contractor', 'acceptance_cases', 'view', False),
    ('NwgPlanning', 'acceptance_cases', 'view', False),
    ('CpgPso', 'acceptance_cases', 'view', False),
    ('CpgRolloutPM', 'acceptance_cases', 'view', False),
    ('CpgPower', 'acceptance_cases', 'view', False),
    ('ManagedService', 'acceptance_cases', 'view', False),
    ('PM', 'acceptance_baskets', 'view', False),
    ('Coordinator', 'acceptance_baskets', 'view', False),
    ('Viewer', 'acceptance_baskets', 'view', False),
    ('PM', 'monthly_plan_queue', 'view', False),
    ('Coordinator', 'monthly_plan_queue', 'view', False),
    ('Viewer', 'monthly_plan_queue', 'view', False),
    ('Admin', 'monthly_plan_queue', 'view', True),
    ('PM', 'internal_pip', 'view', False),
    ('Coordinator', 'internal_pip', 'view', False),
    ('Viewer', 'internal_pip', 'view', False),
    ('PM', 'submissions', 'view', False),
    ('Coordinator', 'submissions', 'view', False),
    ('Viewer', 'submissions', 'view', False),
    ('PM', 'hc_work', 'edit', False),
    ('Coordinator', 'hc_work', 'edit', False),
    ('Admin', 'hc_work', 'view', False),
    ('PM', 'dt_assignment', 'edit', False),
    ('Coordinator', 'dt_assignment', 'edit', False),
    ('PM', 'dt_review', 'edit', False),
    ('Coordinator', 'dt_review', 'edit', False),
    ('PM', 'dt_evidence', 'edit', False),
    ('Coordinator', 'dt_evidence', 'edit', False),
    ('Contractor', 'dt_evidence', 'edit', False),
    ('NwgPlanning', 'fix_queue', 'edit', False),
    ('ManagedService', 'fix_queue', 'edit', False),
    ('HuaweiCleanup', 'fix_queue', 'edit', False),
    ('CpgPower', 'fix_queue', 'edit', False),
    ('CpgRolloutPM', 'fix_queue', 'edit', False),
    ('PM', 'field_results', 'edit', False),
    ('Contractor', 'field_results', 'edit', False),
    ('Contractor', 'contractor_work', 'edit', False),
    ('PM', 'reassign_work', 'edit', False),
    ('PM', 'validation', 'view', False),
    ('Coordinator', 'validation', 'view', False),
    ('PM', 'acceptance_filing', 'edit', False),
    ('Coordinator', 'acceptance_filing', 'edit', False),
    ('Contractor', 'acceptance_filing', 'edit', False),
    ('PM', 'acceptance_approve', 'edit', False),
    ('Coordinator', 'acceptance_approve', 'edit', False),
    ('PM', 'scan_upload', 'edit', False),
    ('Coordinator', 'scan_upload', 'edit', False),
    ('Contractor', 'scan_upload', 'edit', False),
    ('NwgPlanning', 'scan_upload', 'edit', False),
    ('CpgPso', 'scan_upload', 'edit', False),
    ('CpgRolloutPM', 'scan_upload', 'edit', False),
    ('CpgPower', 'scan_upload', 'edit', False),
    ('ManagedService', 'scan_upload', 'edit', False),
    ('PM', 'acceptance_target', 'edit', False),
    ('Contractor', 'contractor_plan', 'edit', False),
    ('PM', 'plan_approvals', 'edit', False),
    ('PM', 'kpi_mapping', 'edit', False),
    ('Admin', 'exports', 'view', False),
    ('PM', 'exports', 'view', False),
    ('Coordinator', 'exports', 'view', False),
    ('RegionalManager', 'exports', 'view', False),
    ('Contractor', 'exports', 'view', False),
    ('Viewer', 'exports', 'view', False),
    ('CpgPso', 'exports', 'view', False),
    ('NwgPlanning', 'exports', 'view', False),
    ('ManagedService', 'exports', 'view', False),
    ('HuaweiCleanup', 'exports', 'view', False),
    ('CpgPower', 'exports', 'view', False),
    ('CpgRolloutPM', 'exports', 'view', False),
    ('PM', 'sla_policies', 'edit', False),
    ('Admin', 'sla_policies', 'edit', False),
    ('Viewer', 'sla_policies', 'view', False),
    ('PM', 'province_assignments', 'edit', False),
    ('Admin', 'province_assignments', 'edit', False),
    ('Viewer', 'province_assignments', 'view', False),
    ('Admin', 'cpm_import', 'edit', False),
    ('PM', 'cpm_change_requests', 'edit', False),
    ('Admin', 'cpm_change_requests', 'edit', True),
    ('Coordinator', 'cpm_change_requests', 'view', False),
    ('PM', 'mojri_upload', 'edit', False),
    ('Admin', 'mojri_upload', 'view', False),
    ('Admin', 'users', 'edit', False),
    ('Admin', 'access', 'edit', False),
    ('PM', 'access', 'view', False),
    ('Viewer', 'access', 'view', False),
    ('Admin', 'problem_categories', 'edit', False),
    ('Admin', 'provinces', 'edit', False),
    ('Admin', 'admin_overview', 'view', False),
    ('Admin', 'system_health', 'edit', False),
    ('PM', 'system_health', 'view', False),
    ('Viewer', 'system_health', 'view', False),
    ('Admin', 'audit_log', 'view', False),
    ('Admin', 'action_sla', 'edit', False),
]


def _stamps() -> list[sa.Column]:
    """The created_at / updated_at pair every table carries (core/database.Base)."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Each step is skipped when its column, table or index already exists: a
    # legacy database built by create_all (tests/test_migrations.py) has them.
    new_columns = [
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("landing", sa.String(80), nullable=False, server_default="standard"),
        sa.Column("data_scope_type", sa.String(20), nullable=False, server_default="all"),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
    ]
    have = _columns("roles")
    missing = [c for c in new_columns if c.name not in have]
    if missing:
        with op.batch_alter_table("roles") as batch:
            for column in missing:
                batch.add_column(column)
    existing = _tables()

    if "features" not in existing:
        op.create_table(
            "features",
            sa.Column("key", sa.String(60), primary_key=True),
            sa.Column("app", sa.String(40), nullable=False),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("description", sa.String(255), nullable=False, server_default=""),
            sa.Column("levels", sa.String(20), nullable=False, server_default="view,edit"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            *_stamps(),
        )
    if "role_feature_grants" not in existing:
        op.create_table(
            "role_feature_grants",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
            sa.Column("feature_key", sa.String(60), sa.ForeignKey("features.key", ondelete="CASCADE"), nullable=False),
            sa.Column("level", sa.String(10), nullable=False),
            sa.Column("hidden_in_menus", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.UniqueConstraint("role_id", "feature_key", name="uq_role_feature_grant"),
            *_stamps(),
        )
        op.create_index("ix_role_feature_grants_role_id", "role_feature_grants", ["role_id"])
    if "user_feature_overrides" not in existing:
        op.create_table(
            "user_feature_overrides",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("feature_key", sa.String(60), sa.ForeignKey("features.key", ondelete="CASCADE"), nullable=False),
            sa.Column("level", sa.String(10), nullable=False),
            sa.Column("reason", sa.String(500), nullable=False),
            sa.Column("granted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("user_id", "feature_key", name="uq_user_feature_override"),
            *_stamps(),
        )
        op.create_index("ix_user_feature_overrides_user_id", "user_feature_overrides", ["user_id"])
    if "access_version" not in existing:
        op.create_table(
            "access_version",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
            *_stamps(),
        )
    if "system_snapshots" not in existing:
        op.create_table(
            "system_snapshots",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("taken_on", sa.Date(), nullable=False, unique=True),
            sa.Column("db_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("files_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("active_users", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failed_logins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("errors", sa.Integer(), nullable=False, server_default="0"),
            *_stamps(),
        )
    if "backup_confirmations" not in existing:
        op.create_table(
            "backup_confirmations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("confirmed_on", sa.Date(), nullable=False),
            sa.Column("note", sa.String(500), nullable=True),
            sa.Column("entered_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("entered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            *_stamps(),
        )
    if "error_events" not in existing:
        op.create_table(
            "error_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("source", sa.String(10), nullable=False),
            sa.Column("route", sa.String(255), nullable=True),
            *_stamps(),
        )
        op.create_index("ix_error_events_occurred_at", "error_events", ["occurred_at"])

    seed(op.get_bind())


def seed(bind) -> None:
    """Roles, catalogue, grants and the version row. Each insert is skipped
    when its row is already there."""
    roles = {}
    for name, description, landing, scope, owner in SYSTEM_ROLES:
        role_id = bind.execute(sa.text("SELECT id FROM roles WHERE name = :n"), {"n": name}).scalar()
        if role_id is None:
            bind.execute(sa.text(
                "INSERT INTO roles (name, is_category_owner, description, landing, data_scope_type, is_system) "
                "VALUES (:n, :o, :d, :l, :s, :t)"
            ), {"n": name, "o": owner, "d": description, "l": landing, "s": scope, "t": True})
            role_id = bind.execute(sa.text("SELECT id FROM roles WHERE name = :n"), {"n": name}).scalar()
        else:
            bind.execute(sa.text(
                "UPDATE roles SET description = COALESCE(description, :d), landing = :l, "
                "data_scope_type = :s, is_system = :t WHERE id = :i"
            ), {"d": description, "l": landing, "s": scope, "t": True, "i": role_id})
        roles[name] = role_id

    added = 0
    for key, app, label, description, levels, order in FEATURES:
        if bind.execute(sa.text("SELECT 1 FROM features WHERE key = :k"), {"k": key}).first() is None:
            bind.execute(sa.text(
                "INSERT INTO features (key, app, label, description, levels, sort_order) "
                "VALUES (:k, :a, :l, :d, :v, :o)"
            ), {"k": key, "a": app, "l": label, "d": description, "v": levels, "o": order})
            added += 1
    log.info("UEP-25: %s features seeded", added)

    granted = 0
    for role, key, level, hidden in GRANTS:
        exists = bind.execute(sa.text(
            "SELECT 1 FROM role_feature_grants WHERE role_id = :r AND feature_key = :k"
        ), {"r": roles[role], "k": key}).first()
        if exists is None:
            bind.execute(sa.text(
                "INSERT INTO role_feature_grants (role_id, feature_key, level, hidden_in_menus) "
                "VALUES (:r, :k, :l, :h)"
            ), {"r": roles[role], "k": key, "l": level, "h": hidden})
            granted += 1
    log.info("UEP-25: %s role grants seeded", granted)

    if bind.execute(sa.text("SELECT 1 FROM access_version")).first() is None:
        bind.execute(sa.text("INSERT INTO access_version (id, version) VALUES (1, 1)"))


def downgrade() -> None:
    op.drop_index("ix_error_events_occurred_at", table_name="error_events")
    op.drop_table("error_events")
    op.drop_table("backup_confirmations")
    op.drop_table("system_snapshots")
    op.drop_table("access_version")
    op.drop_index("ix_user_feature_overrides_user_id", table_name="user_feature_overrides")
    op.drop_table("user_feature_overrides")
    op.drop_index("ix_role_feature_grants_role_id", table_name="role_feature_grants")
    op.drop_table("role_feature_grants")
    op.drop_table("features")
    if op.get_bind().dialect.name == "sqlite":
        # A native DROP COLUMN (SQLite 3.35+), not a batch rebuild: rebuilding
        # roles -- which users, problem categories and others reference --
        # would leave their foreign keys pointing at a dropped table.
        for column in ("is_system", "data_scope_type", "landing", "description"):
            op.execute(f"ALTER TABLE roles DROP COLUMN {column}")
        return
    with op.batch_alter_table("roles") as batch:
        batch.drop_column("is_system")
        batch.drop_column("data_scope_type")
        batch.drop_column("landing")
        batch.drop_column("description")
