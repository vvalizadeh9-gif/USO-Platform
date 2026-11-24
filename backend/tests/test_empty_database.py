"""The pre-go-live "empty the database" command (UEP-23, runbook step 12).

Needs a real PostgreSQL; skipped unless UEP_TEST_POSTGRES_URL is set. The
database named there is emptied -- never point it at anything you care about.
"""
import io
import os

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

from app.core.config import DatabaseSettings
from app.scripts.empty_database import run

PG_URL = os.environ.get("UEP_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="UEP_TEST_POSTGRES_URL not set")


@pytest.fixture
def engine():
    eng = sa.create_engine(PG_URL)
    with eng.begin() as conn:
        conn.execute(sa.text("CREATE TABLE IF NOT EXISTS public.uep_wipe_probe (id serial primary key)"))
        conn.execute(sa.text(
            "DO $$ BEGIN CREATE TYPE public.uep_wipe_mood AS ENUM ('a', 'b'); "
            "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
        ))
    yield eng
    with eng.begin() as conn:
        conn.execute(sa.text("DROP TABLE IF EXISTS public.uep_wipe_probe"))
        conn.execute(sa.text("DROP TYPE IF EXISTS public.uep_wipe_mood"))
    eng.dispose()


def _run(confirm):
    out = io.StringIO()
    code = run(DatabaseSettings(_env_file=None, database_url=PG_URL), confirm, out)
    return code, out.getvalue()


def _exists(engine) -> bool:
    with engine.connect() as conn:
        return conn.execute(sa.text("SELECT to_regclass('public.uep_wipe_probe')")).scalar() is not None


def test_without_confirm_nothing_is_dropped(engine):
    code, out = _run(None)
    assert code == 0
    assert "Nothing dropped" in out
    assert _exists(engine)


def test_a_wrong_name_drops_nothing(engine):
    code, out = _run("not_this_database")
    assert code == 1
    assert "does not match" in out
    assert _exists(engine)


def test_refuses_while_another_session_is_connected(engine):
    with engine.connect() as other:
        other.execute(sa.text("SELECT 1"))
        code, out = _run(make_url(PG_URL).database)
    assert code == 1
    assert "other session" in out
    assert _exists(engine)


def test_confirm_empties_it(engine):
    engine.dispose()  # no pooled connection may count as "another session"
    code, out = _run(make_url(PG_URL).database)
    assert code == 0, out
    assert "✔ Dropped." in out
    assert not _exists(engine)
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT to_regtype('public.uep_wipe_mood')")).scalar() is None
