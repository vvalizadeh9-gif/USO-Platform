"""Empty UEP's database before go-live (UEP-23). DESTRUCTIVE.

    python -m app.scripts.empty_database                    # look only
    python -m app.scripts.empty_database --confirm uep_prd  # really empty it

The practice deploys run against the real database (no test database exists),
so before go-live everything they created has to go. This drops every table,
sequence and enum type in schema ``public`` that belongs to UEP's login, so
the next backend start builds a fresh, empty UEP.

Guards, because there is no undo:

* Without ``--confirm`` it only prints what is there and drops nothing.
* ``--confirm`` must repeat the database name exactly.
* It refuses while any other session of the same login is connected to the
  database -- that is a running backend pod. Scale the backend to 0 first
  (KUBERNETES-RUNBOOK.md step 12).
* Objects that belong to another login are left alone.

Everything is dropped in one transaction: it either all happens or none of it.
Prints the number of tables before and after. Never prints the password.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.core.config import DatabaseSettings

DROP_OWNED = """
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tableowner = current_user LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences
           WHERE schemaname = 'public' AND sequenceowner = current_user LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequencename);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e'
             AND pg_get_userbyid(t.typowner) = current_user LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END $$;
"""

COUNT_TABLES = "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
COUNT_OWNED = ("SELECT count(*) FROM pg_tables WHERE schemaname = 'public' "
               "AND tableowner = current_user")
OTHER_SESSIONS = """
SELECT count(*) FROM pg_stat_activity
WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()
"""


def run(settings: DatabaseSettings, confirm: str | None, out=None) -> int:
    out = out or sys.stdout

    def say(message: str) -> None:
        print(message, file=out, flush=True)

    url = settings.sqlalchemy_url
    if not url.drivername.startswith("postgresql"):
        say("✘ This only works on PostgreSQL.")
        return 1
    database = url.database
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            actual = conn.execute(text("SELECT current_database()")).scalar_one()
            total = conn.execute(text(COUNT_TABLES)).scalar_one()
            owned = conn.execute(text(COUNT_OWNED)).scalar_one()
            others = conn.execute(text(OTHER_SESSIONS)).scalar_one()
        say(f"Database: {settings.database_description()}")
        say(f"Before: {total} table(s) in schema public, {owned} of them owned by "
            f'"{url.username}" (these are the ones that would be dropped).')

        if confirm is None:
            say("Nothing dropped. To empty it, run again with: "
                f"--confirm {actual}")
            return 0
        if confirm != actual or (database and confirm != database):
            say(f'✘ --confirm "{confirm}" does not match the database "{actual}". '
                "Nothing dropped.")
            return 1
        if others:
            say(f"✘ {others} other session(s) of \"{url.username}\" are connected -- a "
                "backend pod is probably still running. Scale the backend to 0, wait "
                "until its pods are gone, and try again. Nothing dropped.")
            return 1

        with engine.begin() as conn:
            conn.execute(text(DROP_OWNED))
        with engine.connect() as conn:
            after = conn.execute(text(COUNT_TABLES)).scalar_one()
        say(f"✔ Dropped. After: {after} table(s) in schema public.")
        if after:
            say(f"! {after} table(s) remain; they belong to another login and were left alone.")
        say("The next backend start creates UEP's tables again, empty, with the first "
            "admin from the uep-secrets Secret.")
        return 0
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--confirm", metavar="DATABASE_NAME",
                        help="really drop everything; must repeat the database name")
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    return run(DatabaseSettings(), args.confirm)


if __name__ == "__main__":
    sys.exit(main())
