"""UEP-20 against a real PostgreSQL: the migration, BYTEA storage, a database
not called ``uep``, and the readable message for a login without CREATE.

Skipped unless ``UEP_TEST_POSTGRES_URL`` is set (CI sets it). The URL's user
must be able to create databases and roles (the CI service user is a
superuser). Scratch databases and a role are created and dropped here.
"""
import os
import subprocess
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

PG_URL = os.environ.get("UEP_TEST_POSTGRES_URL")

pytestmark = pytest.mark.skipif(
    not PG_URL, reason="UEP_TEST_POSTGRES_URL not set; PostgreSQL migration tests skipped"
)

BEFORE = "a3c7e9b1d522"
THIS = "c4e8a2f6b310"


def _cfg(conn):
    from alembic.config import Config

    from tests.conftest import BACKEND_DIR

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["connection"] = conn
    return cfg


def _migrate(engine, action: str, revision: str) -> None:
    from alembic import command

    with engine.begin() as conn:
        getattr(command, action)(_cfg(conn), revision)


@pytest.fixture
def engine():
    eng = sa.create_engine(PG_URL)
    with eng.begin() as conn:
        conn.execute(sa.text("DROP SCHEMA public CASCADE"))
        conn.execute(sa.text("CREATE SCHEMA public"))
    yield eng
    eng.dispose()


def _columns(engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        return dict(conn.execute(sa.text(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_name = :t"), {"t": table}).all())


def test_upgrade_and_downgrade_with_existing_data(engine):
    _migrate(engine, "upgrade", BEFORE)
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO cpm_import_batches (filename, total_rows, new_count, new_villages_count, "
            "changed_count, changed_village_qty, changed_site_type, changed_requested_tech, "
            "unchanged_count, skipped_satellite) VALUES ('old.xlsx', 0, 0, 0, 0, 0, 0, 0, 0, 0)"))
        conn.execute(sa.text(
            "INSERT INTO submission_letter_files (sha256, stored_path, original_filename, size_bytes) "
            "VALUES (:s, :p, 'mtn.pdf', 4)"), {"s": "ab" * 32, "p": "acceptance/ab/ab/" + "ab" * 32 + ".pdf"})

    _migrate(engine, "upgrade", THIS)
    cols = _columns(engine, "stored_files")
    assert cols["content"] == "bytea"
    assert cols["created_at"] == "timestamp with time zone"
    assert cols["retain"] == "boolean"
    assert "source_sha256" in _columns(engine, "cpm_import_batches")
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT filename, source_sha256 FROM cpm_import_batches")).one() == ("old.xlsx", None)
        assert conn.execute(sa.text("SELECT count(*) FROM submission_letter_files")).scalar() == 1

    _migrate(engine, "downgrade", BEFORE)
    assert _columns(engine, "stored_files") == {}
    assert "source_sha256" not in _columns(engine, "cpm_import_batches")
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT count(*) FROM cpm_import_batches")).scalar() == 1
        assert conn.execute(sa.text("SELECT count(*) FROM submission_letter_files")).scalar() == 1

    _migrate(engine, "upgrade", "head")


def test_store_and_read_on_postgresql(engine):
    """The PostgreSQL ON CONFLICT path: dedupe, retain only turns on, round trip."""
    from app.models.stored_file import StoredFile
    from app.services import evidence_store

    _migrate(engine, "upgrade", "head")
    content = b"%PDF-1.7 " + bytes(range(256)) * 400  # binary-safe, ~100 KB
    with Session(engine) as db:
        first = evidence_store.store(db, "a.pdf", content)
        evidence_store.store(db, "b.pdf", content)
        db.commit()
        assert db.query(StoredFile).count() == 1
        assert evidence_store.read(db, first["stored_path"]) == content
        evidence_store.store_retained(db, "pdf", content)
        evidence_store.store(db, "c.pdf", content)
        db.commit()
        assert db.get(StoredFile, first["sha256"]).retain is True
        with pytest.raises(evidence_store.FileMissing):
            evidence_store.read_digest(db, "00" * 32)


def _alembic_cli(url: str) -> subprocess.CompletedProcess:
    """``alembic upgrade head`` exactly as entrypoint.sh runs it: its own
    process, its own connection, configured only by DATABASE_URL."""
    from tests.conftest import BACKEND_DIR

    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development"}
    return subprocess.run(
        [sys.executable, "-c", "from alembic.config import main; main(argv=['upgrade', 'head'])"],
        cwd=str(BACKEND_DIR), env=env, capture_output=True, text=True, timeout=300,
    )


@pytest.fixture
def admin():
    eng = sa.create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    yield eng
    eng.dispose()


def _with_db(name: str) -> str:
    return make_url(PG_URL).set(database=name).render_as_string(hide_password=False)


def test_an_empty_database_not_called_uep_upgrades_and_downgrades(admin):
    name = "uep_prd_scratch"
    with admin.connect() as conn:
        conn.execute(sa.text(f"DROP DATABASE IF EXISTS {name}"))
        conn.execute(sa.text(f"CREATE DATABASE {name}"))
    try:
        result = _alembic_cli(_with_db(name))
        assert result.returncode == 0, result.stderr
        scratch = sa.create_engine(_with_db(name))
        try:
            assert "content" in _columns(scratch, "stored_files")
            _migrate(scratch, "downgrade", BEFORE)
            assert _columns(scratch, "stored_files") == {}
        finally:
            scratch.dispose()
    finally:
        with admin.connect() as conn:
            conn.execute(sa.text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))


def test_a_login_without_create_gets_one_readable_line(admin):
    name, role, password = "uep_nocreate_scratch", "uep_nocreate_svc", "Nocreate-Test-Pw-77"
    with admin.connect() as conn:
        conn.execute(sa.text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
        conn.execute(sa.text(f"DROP ROLE IF EXISTS {role}"))
        conn.execute(sa.text(f"CREATE ROLE {role} LOGIN PASSWORD '{password}'"))
        conn.execute(sa.text(f"CREATE DATABASE {name}"))
    scratch_admin = sa.create_engine(_with_db(name), isolation_level="AUTOCOMMIT")
    try:
        with scratch_admin.connect() as conn:
            # What a cautious DBA hands out: connect and use, but not create.
            conn.execute(sa.text("REVOKE CREATE ON SCHEMA public FROM PUBLIC"))
            conn.execute(sa.text(f"GRANT USAGE ON SCHEMA public TO {role}"))
        url = make_url(_with_db(name)).set(username=role, password=password)
        result = _alembic_cli(url.render_as_string(hide_password=False))

        assert result.returncode != 0
        output = result.stdout + result.stderr
        assert (
            f'UEP cannot create its tables: the database user "{role}" has no CREATE '
            f'permission on schema "public" in database "{name}".'
        ) in output
        assert "Traceback" not in output
        assert password not in output
    finally:
        scratch_admin.dispose()
        with admin.connect() as conn:
            conn.execute(sa.text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
            conn.execute(sa.text(f"DROP ROLE IF EXISTS {role}"))
