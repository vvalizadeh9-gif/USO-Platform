"""Shared test helpers.

The important one is :func:`create_schema`. Tests build their database the same
way production does -- by running the Alembic migrations -- rather than by
calling ``Base.metadata.create_all()``. That is the whole point of the schema
consolidation: if the migrations are the only thing that builds a real database,
they must also be the only thing that builds the test database, or the tests
stop being evidence that a deploy will work.
"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# A small, synthetic CPM workbook lives in tests/fixtures/ and is committed to
# the repository, so the CPM tests run anywhere without needing real data.
# Point UEP_TEST_CPM_XLSX at a genuine workbook to run them against real data
# instead.
_BUNDLED_SAMPLE = BACKEND_DIR / "tests" / "fixtures" / "sample_cpm.xlsx"


def sample_cpm_path() -> str | None:
    """Return a path to a CPM workbook to import, or None if there isn't one.

    Returning None (rather than a path that does not exist) is what lets a test
    call ``pytest.skip`` correctly.
    """
    override = os.environ.get("UEP_TEST_CPM_XLSX")
    if override:
        return override if os.path.exists(override) else None
    if _BUNDLED_SAMPLE.exists():
        return str(_BUNDLED_SAMPLE)
    return None


def create_schema() -> None:
    """Drop everything and rebuild the schema by running the migrations.

    Runs against the engine the application itself is using, so it works with
    whatever throwaway SQLite file the calling test module configured.
    """
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from app.core.database import Base, engine

    # Start from nothing: previous modules in the same session share this engine.
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    with engine.begin() as conn:
        # Hand Alembic the live connection so migrations land on this engine
        # (and, for SQLite, this file) rather than on the URL in alembic.ini.
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")


def login_form(client, username: str = "admin", password: str = "Admin@12345") -> dict:
    """Build a login form payload, solving a fresh captcha challenge first."""
    challenge = client.get("/api/v1/auth/captcha").json()
    return {
        "username": username,
        "password": password,
        "captcha_token": challenge["token"],
        "captcha_answer": challenge["num1"] + challenge["num2"],
    }
