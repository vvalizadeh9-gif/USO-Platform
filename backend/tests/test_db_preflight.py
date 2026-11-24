"""The database pre-flight check (UEP-23 5.2).

The settings, name and port checks need no database. The login, permission
and "nothing left behind" checks need a real PostgreSQL and are skipped unless
``UEP_TEST_POSTGRES_URL`` is set (CI sets it).
"""
import io
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

from app.core.config import DatabaseSettings
from app.scripts.db_preflight import Reporter, run

PG_URL = os.environ.get("UEP_TEST_POSTGRES_URL")
needs_pg = pytest.mark.skipif(not PG_URL, reason="UEP_TEST_POSTGRES_URL not set")
BACKEND_DIR = Path(__file__).resolve().parent.parent

NO_CREATE_ROLE = "uep_preflight_nocreate"
NO_CREATE_PASSWORD = "No-create-p@ss:w/rd%#"


def _check(prefix: str = "", **settings) -> tuple[int, str]:
    out = io.StringIO()
    code = run(DatabaseSettings(_env_file=None, **settings), Reporter(prefix, out))
    return code, out.getvalue()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_missing_settings_are_named(monkeypatch):
    code, out = _check(app_env="production", database_url=None,
                       db_host="h", db_name="n", db_user="u")
    assert code == 1
    assert "✘ DB_PASSWORD is not set." in out
    assert "Settings present" not in out


def test_a_name_that_does_not_resolve():
    code, out = _check(database_url=None, db_host="no-such-host.invalid", db_name="uep_prd",
                       db_user="uep_app_svc", db_password="x")
    assert code == 1
    assert 'The name "no-such-host.invalid" cannot be found from here.' in out
    assert "Ask IT for the full server name or IP." in out


def test_a_closed_port():
    port = _free_port()
    code, out = _check(database_url=None, db_host="127.0.0.1", db_port=port, db_name="uep_prd",
                       db_user="uep_app_svc", db_password="x", db_connect_timeout_seconds=3)
    assert code == 1
    assert f"Cannot reach 127.0.0.1 on port {port}" in out
    assert "allow the Kubernetes node IPs" in out
    # It stopped at the first failure.
    assert "Logged in" not in out


def test_startup_mode_prefixes_every_line_and_exits_non_zero():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DB_", "DATABASE_URL"))}
    env.update(APP_ENV="production", DB_HOST="no-such-host.invalid", DB_NAME="uep_prd",
               DB_USER="uep_app_svc", DB_PASSWORD="super-secret-value")
    result = subprocess.run(
        [sys.executable, "-m", "app.scripts.db_preflight", "--startup"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    assert result.returncode == 1
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert lines and all(line.startswith("[preflight] ") for line in lines), result.stdout
    assert "super-secret-value" not in result.stdout + result.stderr


def test_the_password_is_never_printed():
    code, out = _check(database_url=None, db_host="127.0.0.1", db_port=_free_port(),
                       db_name="uep_prd", db_user="uep_app_svc", db_password="super-secret-value",
                       db_connect_timeout_seconds=3)
    assert "super-secret-value" not in out


# --- Against a real PostgreSQL -------------------------------------------


def _preflight_tables(engine) -> list[str]:
    with engine.connect() as conn:
        return list(conn.execute(sa.text(
            "SELECT tablename FROM pg_tables WHERE tablename LIKE 'uep_preflight_%'"
        )).scalars())


@needs_pg
def test_all_checks_pass_and_nothing_is_left_behind():
    engine = sa.create_engine(PG_URL)
    try:
        code, out = _check(database_url=PG_URL)
        assert code == 0, out
        for phrase in ("Settings present", "resolves to", "answers on port", "Logged in as",
                       "PostgreSQL", "Connected to database", "UEP can create its tables",
                       "Database check passed."):
            assert phrase in out, out
        assert _preflight_tables(engine) == []
    finally:
        engine.dispose()


@needs_pg
def test_wrong_password():
    url = make_url(PG_URL).set(password="definitely-the-wrong-password")
    code, out = _check(database_url=url.render_as_string(hide_password=False))
    assert code == 1
    assert f'The database refused user "{url.username}".' in out
    assert "definitely-the-wrong-password" not in out


@needs_pg
def test_a_login_without_create_permission():
    admin = sa.create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    url = make_url(PG_URL)
    try:
        with admin.connect() as conn:
            conn.execute(sa.text(f"DROP ROLE IF EXISTS {NO_CREATE_ROLE}"))
            conn.execute(sa.text(
                f"CREATE ROLE {NO_CREATE_ROLE} LOGIN PASSWORD '{NO_CREATE_PASSWORD}'"
            ))
            conn.execute(sa.text(f'GRANT CONNECT ON DATABASE "{url.database}" TO {NO_CREATE_ROLE}'))
            conn.execute(sa.text("CREATE SCHEMA IF NOT EXISTS public"))
            conn.execute(sa.text("REVOKE CREATE ON SCHEMA public FROM PUBLIC"))
            conn.execute(sa.text(f"GRANT USAGE ON SCHEMA public TO {NO_CREATE_ROLE}"))
        # From parts, so the special characters in this password are exercised too.
        code, out = _check(database_url=None, db_host=url.host, db_port=url.port or 5432,
                           db_name=url.database, db_user=NO_CREATE_ROLE,
                           db_password=NO_CREATE_PASSWORD, db_sslmode="disable")
        assert code == 1, out
        assert "Logged in as" in out
        assert (f'User "{NO_CREATE_ROLE}" cannot create tables in "{url.database}". '
                "Ask IT to make it the database owner or grant CREATE on schema public.") in out
        assert _preflight_tables(admin) == []
    finally:
        with admin.connect() as conn:
            conn.execute(sa.text(f"REVOKE ALL ON SCHEMA public FROM {NO_CREATE_ROLE}"))
            conn.execute(sa.text(f'REVOKE ALL ON DATABASE "{url.database}" FROM {NO_CREATE_ROLE}'))
            conn.execute(sa.text(f"DROP ROLE IF EXISTS {NO_CREATE_ROLE}"))
        admin.dispose()


@needs_pg
def test_unknown_tables_are_reported():
    engine = sa.create_engine(PG_URL)
    try:
        with engine.begin() as conn:
            conn.execute(sa.text("CREATE TABLE IF NOT EXISTS public.someone_elses_table (id int)"))
        code, out = _check(database_url=PG_URL)
        assert code == 0, out
        assert "someone_elses_table" in out
        assert "not UEP's" in out
    finally:
        with engine.begin() as conn:
            conn.execute(sa.text("DROP TABLE IF EXISTS public.someone_elses_table"))
        engine.dispose()
