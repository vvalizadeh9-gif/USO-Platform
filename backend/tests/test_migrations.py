"""Tests for the Alembic migration chain, against a real PostgreSQL database.

The rest of the suite runs on SQLite, which is fine for application logic but
cannot check the things that actually went wrong here: foreign key constraints,
``timestamptz`` versus ``timestamp``, and ``ALTER TABLE`` behaviour. Those are
PostgreSQL-specific, so these tests need a real PostgreSQL server.

They are skipped unless ``UEP_TEST_POSTGRES_URL`` is set. The GitHub Actions
workflow sets it, so they run on every push and pull request.

To run them locally against a scratch database::

    UEP_TEST_POSTGRES_URL=postgresql+psycopg://user:pass@localhost/uep_test \\
        pytest tests/test_migrations.py

WARNING: the database named in that URL is emptied by these tests. Never point
it at anything you care about.
"""
import os

import pytest
import sqlalchemy as sa

PG_URL = os.environ.get("UEP_TEST_POSTGRES_URL")

pytestmark = pytest.mark.skipif(
    not PG_URL, reason="UEP_TEST_POSTGRES_URL not set; PostgreSQL migration tests skipped"
)

# The five columns that drifted, and the type the old raw-DDL bootstrap gave them.
LEGACY_DRIFT = [
    ("hc_tasks", "reviewed_at", "TIMESTAMP"),
    ("assignments", "returned_at", "TIMESTAMP"),
    ("hc_tasks", "reviewed_by", "INTEGER"),
    ("work_items", "dt_sc_contractor_id", "INTEGER"),
    ("problem_categories", "owner_role_id", "INTEGER"),
]

EXPECTED_FOREIGN_KEYS = [
    ("hc_tasks", "reviewed_by", "users"),
    ("work_items", "dt_sc_contractor_id", "contractors"),
    ("problem_categories", "owner_role_id", "roles"),
]

EXPECTED_TIMESTAMPTZ = [
    ("hc_tasks", "reviewed_at"),
    ("assignments", "returned_at"),
]


@pytest.fixture
def engine():
    eng = sa.create_engine(PG_URL)
    yield eng
    eng.dispose()


def _wipe(engine) -> None:
    with engine.begin() as conn:
        conn.execute(sa.text("DROP SCHEMA public CASCADE"))
        conn.execute(sa.text("CREATE SCHEMA public"))


def _upgrade(engine, revision: str = "head") -> None:
    from alembic import command
    from alembic.config import Config

    from tests.conftest import BACKEND_DIR

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, revision)


def _stamp(engine, revision: str) -> None:
    from alembic import command
    from alembic.config import Config

    from tests.conftest import BACKEND_DIR

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.stamp(cfg, revision)


def _build_legacy_database(engine, stamped: bool) -> None:
    """Recreate the shape the old startup code left behind.

    ``create_all`` made the tables correctly; the drift came from databases
    created by an earlier model version that then had columns bolted on by the
    raw ``ADDITIVE_COLUMNS`` DDL. Reproduce that by creating everything, then
    knocking the five columns back to the types that DDL used.
    """
    from app.core.database import Base
    import app.models  # noqa: F401  (registers every model on the metadata)

    _wipe(engine)
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        # Other test modules in this suite replace postgresql.JSONB with plain
        # JSON so they can build a SQLite database, which leaves create_all
        # emitting `json` here. The real legacy database was never subject to
        # that patch and has `jsonb`, so put it back before comparing.
        for column in ("old_value", "new_value"):
            conn.execute(sa.text(
                f"ALTER TABLE audit_logs ALTER COLUMN {column} TYPE jsonb "
                f"USING {column}::jsonb"
            ))
        for table, column, legacy_type in LEGACY_DRIFT:
            conn.execute(sa.text(f"ALTER TABLE {table} DROP COLUMN {column}"))
            conn.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN {column} {legacy_type}"))
    if stamped:
        _stamp(engine, "97e73674816a")


def _schema_facts(engine) -> list[tuple]:
    """Every column type, constraint and index, as comparable tuples."""
    with engine.begin() as conn:
        columns = conn.execute(sa.text(
            "SELECT table_name, column_name, data_type, is_nullable "
            "FROM information_schema.columns WHERE table_schema='public' "
            "ORDER BY table_name, column_name"
        )).fetchall()
        constraints = conn.execute(sa.text(
            "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) "
            "FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1, 2"
        )).fetchall()
        indexes = conn.execute(sa.text(
            "SELECT tablename, indexname, indexdef FROM pg_indexes "
            "WHERE schemaname='public' ORDER BY 1, 2"
        )).fetchall()
    return [tuple(r) for r in columns + constraints + indexes]


def _assert_repaired(engine) -> None:
    inspector = sa.inspect(engine)

    for table, column, parent in EXPECTED_FOREIGN_KEYS:
        targets = {
            fk["referred_table"]
            for fk in inspector.get_foreign_keys(table)
            if column in fk["constrained_columns"]
        }
        assert parent in targets, f"{table}.{column} has no foreign key to {parent}"

    for table, column in EXPECTED_TIMESTAMPTZ:
        col = next(c for c in inspector.get_columns(table) if c["name"] == column)
        assert col["type"].timezone, f"{table}.{column} is not timezone-aware"


def test_fresh_database_upgrades_to_head(engine):
    """A brand-new database gets the whole schema from the migrations alone."""
    _wipe(engine)
    _upgrade(engine)

    _assert_repaired(engine)
    assert len(sa.inspect(engine).get_table_names()) > 20


@pytest.mark.parametrize("stamped", [True, False], ids=["stamped", "never-stamped"])
def test_legacy_database_is_repaired(engine, stamped):
    """A database carrying the old drift is brought into line with the models.

    Both cases matter: a database Alembic already knows about, and one that was
    only ever built by ``create_all`` and has no ``alembic_version`` row at all.
    """
    _build_legacy_database(engine, stamped=stamped)

    inspector = sa.inspect(engine)
    reviewed_at = next(c for c in inspector.get_columns("hc_tasks") if c["name"] == "reviewed_at")
    assert not reviewed_at["type"].timezone, "harness did not reproduce the drift"

    _upgrade(engine)
    _assert_repaired(engine)


def test_repaired_legacy_matches_a_fresh_database(engine):
    """The two paths converge: same columns, same constraints, same indexes.

    This is the property the whole schema consolidation exists to provide. If it
    ever fails, a database that was upgraded and a database that was created
    fresh have diverged again.
    """
    _wipe(engine)
    _upgrade(engine)
    fresh = _schema_facts(engine)

    _build_legacy_database(engine, stamped=True)
    _upgrade(engine)
    repaired = _schema_facts(engine)

    assert repaired == fresh


def test_running_the_repair_twice_changes_nothing(engine):
    """Applying the repair to an already-correct database is a no-op."""
    _build_legacy_database(engine, stamped=True)
    _upgrade(engine)
    after_first = _schema_facts(engine)

    # Rewind the bookmark without undoing the work, so the repair runs again
    # against a database that is already correct.
    _stamp(engine, "97e73674816a")
    _upgrade(engine)

    assert _schema_facts(engine) == after_first


def test_orphaned_rows_abort_the_migration_without_changing_anything(engine):
    """Rows pointing at a deleted parent stop the migration, and nothing changes.

    Silently nulling them would erase who reviewed a health check, so the
    migration refuses and reports the offending rows instead.
    """
    _build_legacy_database(engine, stamped=True)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO roles (id, name, is_category_owner, created_at, updated_at) "
            "VALUES (1, 'Admin', false, now(), now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO problem_categories "
            "(id, name, active, owner_role_id, sla_days, created_at, updated_at) VALUES "
            "(1, 'Real', true, 1, 7, now(), now()), "
            "(2, 'Ghost', true, 404, 7, now(), now())"
        ))
    before = _schema_facts(engine)

    with pytest.raises(RuntimeError) as excinfo:
        _upgrade(engine)

    message = str(excinfo.value)
    assert "problem_categories.owner_role_id" in message
    assert "404" in message, "the error must name the orphaned value"
    assert "MIGRATION-RUNBOOK.md" in message, "the error must point somewhere useful"

    # The transaction rolled back, so not even the foreign keys added before the
    # failing one survive.
    assert _schema_facts(engine) == before


@pytest.mark.parametrize(
    "stored_zone, expected_zone",
    [("UTC", "UTC"), ("Asia/Tehran", "Asia/Tehran")],
)
def test_timestamp_conversion_detects_the_zone_values_were_written_in(
    engine, stored_zone, expected_zone, capfd
):
    """The conversion measures which clock the naive values were on.

    Guessing wrong shifts every health-check review date by 3.5 hours, and those
    dates carry contractual weight, so the migration compares each value against
    ``updated_at`` (which does record its zone) instead of assuming.
    """
    _build_legacy_database(engine, stamped=True)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO contractors (id, name, type, active, created_at, updated_at) "
            "VALUES (1, 'C', 'drive_test', true, now(), now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO sites (id, site_code, created_at, updated_at) "
            "VALUES (1, 'S1', now(), now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO work_items (id, site_id, site_type, current_stage, created_at, updated_at) "
            "VALUES (1, 1, 'type', 'stage', now(), now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO assignments (id, work_item_id, assignment_type, contractor_id, "
            "assigned_at, is_active, created_at, updated_at, returned_at) VALUES "
            f"(1, 1, 'dt', 1, now(), true, now(), now(), (now() AT TIME ZONE '{stored_zone}'))"
        ))

    _upgrade(engine)

    assert f"Converting as {expected_zone}" in capfd.readouterr().out
    _assert_repaired(engine)


def test_inconsistent_timestamps_abort_rather_than_guess(engine):
    """Values that disagree about their zone stop the migration.

    Mixed offsets mean the dates came from more than one source, so no single
    conversion is right for all of them. That needs a person.
    """
    _build_legacy_database(engine, stamped=True)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO contractors (id, name, type, active, created_at, updated_at) "
            "VALUES (1, 'C', 'drive_test', true, now(), now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO sites (id, site_code, created_at, updated_at) "
            "VALUES (1, 'S1', now(), now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO work_items (id, site_id, site_type, current_stage, created_at, updated_at) "
            "VALUES (1, 1, 'type', 'stage', now(), now())"
        ))
        conn.execute(sa.text(
            "INSERT INTO assignments (id, work_item_id, assignment_type, contractor_id, "
            "assigned_at, is_active, created_at, updated_at, returned_at) VALUES "
            "(1, 1, 'dt', 1, now(), true, now(), now(), (now() AT TIME ZONE 'UTC')), "
            "(2, 1, 'dt', 1, now(), true, now(), now(), (now() AT TIME ZONE 'Asia/Tehran'))"
        ))

    with pytest.raises(RuntimeError) as excinfo:
        _upgrade(engine)

    assert "assignments.returned_at" in str(excinfo.value)


def test_baseline_refuses_to_drop_the_database(engine):
    """Downgrading past the baseline would drop every table, so it is blocked."""
    from alembic import command
    from alembic.config import Config

    from tests.conftest import BACKEND_DIR

    _wipe(engine)
    _upgrade(engine)

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with pytest.raises(RuntimeError, match="cannot be downgraded"):
        with engine.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "base")

    assert "users" in sa.inspect(engine).get_table_names()
