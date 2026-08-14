"""baseline: the whole schema, exactly as the ORM models define it

Revision ID: 9309f88c62ca
Revises:
Create Date: 2026-08-14

This is the starting point for every UEP database. It creates all 25 tables
with the columns, foreign keys and indexes that the SQLAlchemy models declare.

Two things about it are deliberate and worth knowing:

1. **It is idempotent.** Every table and index is created only if it is not
   already there. That matters because the live database was not built by
   Alembic at all -- it was built by ``Base.metadata.create_all()`` running on
   every application start. Such a database already has all these tables, so
   this revision does nothing to it and simply records that the baseline has
   been reached. A brand-new database gets the full schema instead. Both end up
   in the same place, which is the entire point of this phase.

2. **It cannot be downgraded.** Downgrading a baseline means dropping every
   table in the database, which for this platform means destroying national USO
   acceptance records. ``downgrade()`` therefore refuses to run. To roll back a
   deployment, restore the backup you took beforehand -- see MIGRATION-RUNBOOK.md.

What this revision deliberately does NOT do is repair a legacy database whose
columns disagree with the models. That is the job of the next revision,
``b7f1c2d9e4a3_repair_legacy_schema_drift``.
"""
from alembic import op
import sqlalchemy as sa

revision = "9309f88c62ca"
down_revision = None
branch_labels = None
depends_on = None


def _json_type():
    """JSONB on PostgreSQL, plain JSON everywhere else.

    ``audit_logs.old_value`` and ``new_value`` are JSONB in production. SQLite,
    which the test suite runs on, has no JSONB, so the type has to be chosen
    when the migration runs rather than when it is imported.

    The import below deliberately reaches into the submodule that defines JSONB
    rather than the ``sqlalchemy.dialects.postgresql`` package attribute. Several
    test modules replace that attribute with plain ``JSON`` so their SQLite
    database can be built, and a migration running against real PostgreSQL must
    still get the real type.
    """
    if op.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql.json import JSONB

        return JSONB(astext_type=sa.Text())
    return sa.JSON()


def _create_index_if_missing(name: str, table: str, columns: list[str]) -> None:
    """Create an index only when the table exists and the index does not."""
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return
    if name in {ix["name"] for ix in inspector.get_indexes(table)}:
        return
    op.create_index(name, table, columns, unique=False)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if 'contractors' not in existing:
        op.create_table('contractors',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )

    if 'provinces' not in existing:
        op.create_table('provinces',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
        )

    if 'regions' not in existing:
        op.create_table('regions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
        )

    if 'roles' not in existing:
        op.create_table('roles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('is_category_owner', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
        )

    if 'monthly_snapshots' not in existing:
        op.create_table('monthly_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('shamsi_year', sa.Integer(), nullable=False),
        sa.Column('shamsi_month', sa.Integer(), nullable=False),
        sa.Column('province_id', sa.Integer(), nullable=True),
        sa.Column('total_onair', sa.Integer(), nullable=False),
        sa.Column('total_dt_done', sa.Integer(), nullable=False),
        sa.Column('total_remaining', sa.Integer(), nullable=False),
        sa.Column('total_ongoing', sa.Integer(), nullable=False),
        sa.Column('total_problematic', sa.Integer(), nullable=False),
        sa.Column('current_month_dt_done', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['province_id'], ['provinces.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('shamsi_year', 'shamsi_month', 'province_id', name='uq_snapshot_period')
        )

    if 'problem_categories' not in existing:
        op.create_table('problem_categories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('owner_role_id', sa.Integer(), nullable=True),
        sa.Column('sla_days', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['owner_role_id'], ['roles.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
        )

    if 'sites' not in existing:
        op.create_table('sites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('site_code', sa.String(length=50), nullable=False),
        sa.Column('temp_site_code', sa.String(length=50), nullable=True),
        sa.Column('province_id', sa.Integer(), nullable=True),
        sa.Column('region_id', sa.Integer(), nullable=True),
        sa.Column('county', sa.String(length=120), nullable=True),
        sa.Column('district', sa.String(length=120), nullable=True),
        sa.Column('rural_district', sa.String(length=120), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['province_id'], ['provinces.id'], ),
        sa.ForeignKeyConstraint(['region_id'], ['regions.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    _create_index_if_missing('ix_sites_province_id', 'sites', ['province_id'])
    _create_index_if_missing('ix_sites_region_id', 'sites', ['region_id'])
    _create_index_if_missing('ix_sites_site_code', 'sites', ['site_code'])
    if 'users' not in existing:
        op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(length=80), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=150), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('contractor_id', sa.Integer(), nullable=True),
        sa.Column('sees_all_provinces', sa.Boolean(), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['contractor_id'], ['contractors.id'], ),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username')
        )

    if 'audit_logs' not in existing:
        op.create_table('audit_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('module', sa.String(length=50), nullable=False),
        sa.Column('entity_type', sa.String(length=50), nullable=False),
        sa.Column('entity_id', sa.Integer(), nullable=True),
        sa.Column('old_value', _json_type(), nullable=True),
        sa.Column('new_value', _json_type(), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if 'cpm_import_batches' not in existing:
        op.create_table('cpm_import_batches',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('imported_by', sa.Integer(), nullable=True),
        sa.Column('total_rows', sa.Integer(), nullable=False),
        sa.Column('new_count', sa.Integer(), nullable=False),
        sa.Column('new_villages_count', sa.Integer(), nullable=False),
        sa.Column('changed_count', sa.Integer(), nullable=False),
        sa.Column('changed_village_qty', sa.Integer(), nullable=False),
        sa.Column('changed_site_type', sa.Integer(), nullable=False),
        sa.Column('changed_requested_tech', sa.Integer(), nullable=False),
        sa.Column('unchanged_count', sa.Integer(), nullable=False),
        sa.Column('skipped_satellite', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['imported_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if 'hc_assignments' not in existing:
        op.create_table('hc_assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('contractor_id', sa.Integer(), nullable=False),
        sa.Column('assigned_by', sa.Integer(), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['assigned_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['contractor_id'], ['contractors.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code')
        )

    _create_index_if_missing('ix_hc_assignments_contractor_id', 'hc_assignments', ['contractor_id'])
    if 'letters' not in existing:
        op.create_table('letters',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('letter_number', sa.String(length=120), nullable=False),
        sa.Column('letter_date', sa.Date(), nullable=True),
        sa.Column('authority', sa.String(length=30), nullable=False),
        sa.Column('province_id', sa.Integer(), nullable=True),
        sa.Column('attachment_path', sa.String(length=500), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['province_id'], ['provinces.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if 'notifications' not in existing:
        op.create_table('notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('type', sa.String(length=50), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('related_entity_type', sa.String(length=50), nullable=True),
        sa.Column('related_entity_id', sa.Integer(), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if 'user_province_access' not in existing:
        op.create_table('user_province_access',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('province_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['province_id'], ['provinces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'province_id')
        )

    if 'work_items' not in existing:
        op.create_table('work_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('site_id', sa.Integer(), nullable=False),
        sa.Column('site_type', sa.String(length=50), nullable=False),
        sa.Column('requested_technology', sa.String(length=50), nullable=True),
        sa.Column('deployed_technology', sa.String(length=50), nullable=True),
        sa.Column('project_name', sa.String(length=150), nullable=True),
        sa.Column('overall_project', sa.String(length=150), nullable=True),
        sa.Column('pm_name', sa.String(length=150), nullable=True),
        sa.Column('equipment_type', sa.String(length=120), nullable=True),
        sa.Column('operator', sa.String(length=120), nullable=True),
        sa.Column('power_status', sa.String(length=120), nullable=True),
        sa.Column('monthly_plan', sa.String(length=120), nullable=True),
        sa.Column('referral_letter_number', sa.String(length=120), nullable=True),
        sa.Column('referral_date_shamsi', sa.String(length=30), nullable=True),
        sa.Column('referral_date_gregorian', sa.Date(), nullable=True),
        sa.Column('launch_date_shamsi', sa.String(length=30), nullable=True),
        sa.Column('launch_date_gregorian', sa.Date(), nullable=True),
        sa.Column('last_stage', sa.String(length=60), nullable=True),
        sa.Column('current_stage', sa.String(length=50), nullable=False),
        sa.Column('dt_sc_contractor_id', sa.Integer(), nullable=True),
        sa.Column('dt_status', sa.String(length=20), nullable=True),
        sa.Column('dt_problem_category', sa.String(length=120), nullable=True),
        sa.Column('dt_date_gregorian', sa.Date(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['dt_sc_contractor_id'], ['contractors.id'], ),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('site_id', 'site_type', name='uq_site_type')
        )

    _create_index_if_missing('ix_work_items_dt_sc_contractor_id', 'work_items', ['dt_sc_contractor_id'])
    _create_index_if_missing('ix_work_items_site_id', 'work_items', ['site_id'])
    if 'assignments' not in existing:
        op.create_table('assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('work_item_id', sa.Integer(), nullable=False),
        sa.Column('assignment_type', sa.String(length=20), nullable=False),
        sa.Column('contractor_id', sa.Integer(), nullable=False),
        sa.Column('assigned_by', sa.Integer(), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('returned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('return_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['assigned_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['contractor_id'], ['contractors.id'], ),
        sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    _create_index_if_missing('ix_assignments_contractor_id', 'assignments', ['contractor_id'])
    _create_index_if_missing('ix_assignments_work_item_id', 'assignments', ['work_item_id'])
    if 'cpm_change_requests' not in existing:
        op.create_table('cpm_change_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('import_batch_id', sa.Integer(), nullable=False),
        sa.Column('work_item_id', sa.Integer(), nullable=True),
        sa.Column('site_code', sa.String(length=50), nullable=False),
        sa.Column('change_type', sa.String(length=30), nullable=False),
        sa.Column('field_name', sa.String(length=80), nullable=False),
        sa.Column('old_value', sa.Text(), nullable=True),
        sa.Column('new_value', sa.Text(), nullable=True),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('payload_json', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('decided_by', sa.Integer(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['decided_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['import_batch_id'], ['cpm_import_batches.id'], ),
        sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if 'drive_tests' not in existing:
        op.create_table('drive_tests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('work_item_id', sa.Integer(), nullable=False),
        sa.Column('execution_date', sa.Date(), nullable=True),
        sa.Column('report_link', sa.String(length=500), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('coordinator_reviewed_by', sa.Integer(), nullable=True),
        sa.Column('coordinator_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('coordinator_comment', sa.Text(), nullable=True),
        sa.Column('pm_reviewed_by', sa.Integer(), nullable=True),
        sa.Column('pm_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('pm_comment', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['coordinator_reviewed_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['pm_reviewed_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    _create_index_if_missing('ix_drive_tests_work_item_id', 'drive_tests', ['work_item_id'])
    if 'hc_tasks' not in existing:
        op.create_table('hc_tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('hc_assignment_id', sa.Integer(), nullable=False),
        sa.Column('work_item_id', sa.Integer(), nullable=False),
        sa.Column('round_no', sa.Integer(), nullable=False),
        sa.Column('overall_result', sa.String(length=20), nullable=True),
        sa.Column('problem_category', sa.String(length=120), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reviewed_by', sa.Integer(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['hc_assignment_id'], ['hc_assignments.id'], ),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('hc_assignment_id', 'work_item_id', name='uq_hc_task_site')
        )

    _create_index_if_missing('ix_hc_tasks_hc_assignment_id', 'hc_tasks', ['hc_assignment_id'])
    _create_index_if_missing('ix_hc_tasks_work_item_id', 'hc_tasks', ['work_item_id'])
    if 'health_checks' not in existing:
        op.create_table('health_checks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('work_item_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('problem_category_id', sa.Integer(), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('checked_by', sa.Integer(), nullable=True),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['checked_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['problem_category_id'], ['problem_categories.id'], ),
        sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    _create_index_if_missing('ix_health_checks_work_item_id', 'health_checks', ['work_item_id'])
    if 'villages' not in existing:
        op.create_table('villages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('work_item_id', sa.Integer(), nullable=False),
        sa.Column('village_code', sa.String(length=50), nullable=True),
        sa.Column('village_name', sa.String(length=150), nullable=True),
        sa.Column('target_classification', sa.String(length=60), nullable=True),
        sa.Column('households', sa.Integer(), nullable=True),
        sa.Column('population', sa.Integer(), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    _create_index_if_missing('ix_villages_work_item_id', 'villages', ['work_item_id'])
    if 'acceptances' not in existing:
        op.create_table('acceptances',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('village_id', sa.Integer(), nullable=False),
        sa.Column('technology', sa.String(length=10), nullable=False),
        sa.Column('ict_status', sa.String(length=10), nullable=False),
        sa.Column('ict_date', sa.Date(), nullable=True),
        sa.Column('cra_status', sa.String(length=10), nullable=False),
        sa.Column('cra_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['village_id'], ['villages.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('village_id', 'technology', name='uq_village_tech')
        )

    _create_index_if_missing('ix_acceptances_village_id', 'acceptances', ['village_id'])
    if 'hc_remediations' not in existing:
        op.create_table('hc_remediations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('hc_task_id', sa.Integer(), nullable=False),
        sa.Column('work_item_id', sa.Integer(), nullable=False),
        sa.Column('problem_category_id', sa.Integer(), nullable=False),
        sa.Column('owner_role_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('opened_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_by', sa.Integer(), nullable=True),
        sa.Column('resolution_note', sa.Text(), nullable=True),
        sa.Column('reroute_to_category_id', sa.Integer(), nullable=True),
        sa.Column('reroute_reason', sa.Text(), nullable=True),
        sa.Column('reroute_by', sa.Integer(), nullable=True),
        sa.Column('reroute_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['closed_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['hc_task_id'], ['hc_tasks.id'], ),
        sa.ForeignKeyConstraint(['owner_role_id'], ['roles.id'], ),
        sa.ForeignKeyConstraint(['problem_category_id'], ['problem_categories.id'], ),
        sa.ForeignKeyConstraint(['reroute_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['reroute_to_category_id'], ['problem_categories.id'], ),
        sa.ForeignKeyConstraint(['work_item_id'], ['work_items.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('hc_task_id', 'problem_category_id', name='uq_hc_remediation_task_category')
        )

    _create_index_if_missing('ix_hc_remediations_hc_task_id', 'hc_remediations', ['hc_task_id'])
    _create_index_if_missing('ix_hc_remediations_owner_role_id', 'hc_remediations', ['owner_role_id'])
    _create_index_if_missing('ix_hc_remediations_problem_category_id', 'hc_remediations', ['problem_category_id'])
    _create_index_if_missing('ix_hc_remediations_work_item_id', 'hc_remediations', ['work_item_id'])
    if 'hc_task_technologies' not in existing:
        op.create_table('hc_task_technologies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('hc_task_id', sa.Integer(), nullable=False),
        sa.Column('technology', sa.String(length=10), nullable=False),
        sa.Column('result', sa.String(length=20), nullable=True),
        sa.Column('reason_category', sa.String(length=120), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['hc_task_id'], ['hc_tasks.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('hc_task_id', 'technology', name='uq_hc_task_tech')
        )

    _create_index_if_missing('ix_hc_task_technologies_hc_task_id', 'hc_task_technologies', ['hc_task_id'])
    if 'letter_villages' not in existing:
        op.create_table('letter_villages',
        sa.Column('letter_id', sa.Integer(), nullable=False),
        sa.Column('village_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['letter_id'], ['letters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['village_id'], ['villages.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('letter_id', 'village_id')
        )


def downgrade() -> None:
    """Refuse to tear the database down.

    Reversing a baseline drops every table. On this platform that would delete
    live acceptance records, so it is not something a migration should ever do
    by accident. Restore from a backup instead.
    """
    raise RuntimeError(
        "The baseline revision cannot be downgraded: doing so would drop every "
        "table and destroy all data. To go back to an earlier state, restore "
        "the database backup you took before upgrading. See MIGRATION-RUNBOOK.md."
    )
