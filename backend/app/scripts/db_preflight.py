"""Can UEP use this database? A check that answers in plain sentences (UEP-23).

    python -m app.scripts.db_preflight             # by hand
    python -m app.scripts.db_preflight --startup   # from entrypoint.sh

It reads the same settings the application does (``DATABASE_URL``, or
``DB_HOST`` / ``DB_PORT`` / ``DB_NAME`` / ``DB_USER`` / ``DB_PASSWORD``) and
prints one line per check -- ``✔`` passed, ``!`` worth knowing, ``✘`` failed.
A failed line says what to ask IT for. It stops at the first failure, and
exits 0 only when nothing failed.

With ``--startup`` every line starts with ``[preflight]``, so the lines are
easy to find at the top of the backend log -- which, on the cluster, is the
only place the result can be read without a live connection to a pod.

It writes nothing. The one check that needs to (can UEP create tables?)
creates a table inside a transaction and rolls it back, so nothing is left
behind. It never prints the password or the connection string.
"""
from __future__ import annotations

import argparse
import secrets
import socket
import sys
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.pool import NullPool

from app.core.config import DatabaseSettings
from app.core.db_permissions import is_permission_error

TESTED_MAJOR = 16
MIN_MAJOR = 14
UNKNOWN_TABLES_SHOWN = 10

# PostgreSQL SQLSTATEs for a refused login and a database that does not exist.
INVALID_PASSWORD = "28P01"
INVALID_AUTHORIZATION = "28000"
INVALID_CATALOG = "3D000"


class CheckFailed(Exception):
    """A check failed; the message is the plain-English line to print."""


@dataclass
class Context:
    settings: DatabaseSettings
    url: URL | None = None
    engine: object | None = None


class Reporter:
    def __init__(self, prefix: str, out=None):
        self.prefix = prefix
        self.out = out or sys.stdout

    def line(self, mark: str, message: str) -> None:
        print(f"{self.prefix}{mark} {message}", file=self.out, flush=True)

    def ok(self, message: str) -> None:
        self.line("✔", message)

    def warn(self, message: str) -> None:
        self.line("!", message)

    def fail(self, message: str) -> None:
        self.line("✘", message)


def _sqlstate(exc: BaseException) -> str | None:
    for candidate in (exc, getattr(exc, "orig", None), exc.__cause__):
        code = getattr(candidate, "sqlstate", None) if candidate is not None else None
        if code:
            return code
    return None


def _first_line(exc: BaseException) -> str:
    """The database's own reason, one line, never the connection string."""
    orig = getattr(exc, "orig", None) or exc
    return (str(orig).strip().splitlines() or [type(orig).__name__])[0]


# --- The checks, in order -------------------------------------------------


def check_settings(ctx: Context, report: Reporter) -> None:
    missing = ctx.settings.missing_database_settings()
    if missing:
        raise CheckFailed(
            " ".join(f"{name} is not set." for name in missing)
            + " Set DATABASE_URL, or all of DB_HOST, DB_NAME, DB_USER and DB_PASSWORD."
        )
    ctx.url = ctx.settings.sqlalchemy_url
    if not ctx.url.drivername.startswith("postgresql"):
        raise CheckFailed(
            f'The database setting points at "{ctx.url.drivername}", but UEP needs PostgreSQL.'
        )
    report.ok(f"Settings present: {ctx.settings.database_description()}.")


def check_host(ctx: Context, report: Reporter) -> None:
    host, port = ctx.url.host, ctx.url.port or 5432
    if not host:
        report.ok("No host name given; using the local PostgreSQL socket.")
        return
    try:
        addresses = sorted({info[4][0] for info in socket.getaddrinfo(host, port)})
    except (socket.gaierror, UnicodeError):
        raise CheckFailed(
            f'The name "{host}" cannot be found from here. '
            "Ask IT for the full server name or IP."
        ) from None
    report.ok(f'The name "{host}" resolves to {", ".join(addresses)}.')


def check_port(ctx: Context, report: Reporter) -> None:
    host, port = ctx.url.host, ctx.url.port or 5432
    if not host:
        return
    timeout = ctx.settings.db_connect_timeout_seconds
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
    except OSError:
        raise CheckFailed(
            f"Cannot reach {host} on port {port} (waited {timeout} s). A firewall is "
            "probably blocking it. Ask the database team to allow the Kubernetes "
            "node IPs."
        ) from None
    report.ok(f"{host} answers on port {port}.")


def check_login(ctx: Context, report: Reporter) -> None:
    ctx.engine = create_engine(
        ctx.url,
        poolclass=NullPool,
        connect_args={"connect_timeout": ctx.settings.db_connect_timeout_seconds},
    )
    user, database = ctx.url.username, ctx.url.database
    try:
        with ctx.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 -- every failure becomes a sentence
        state = _sqlstate(exc)
        reason = _first_line(exc)
        if state in (INVALID_PASSWORD, INVALID_AUTHORIZATION) or "password authentication" in reason:
            raise CheckFailed(
                f'The database refused user "{user}". Check the password or ask IT '
                "to confirm the account."
            ) from None
        if state == INVALID_CATALOG or "does not exist" in reason and database and database in reason:
            raise CheckFailed(
                f'The database "{database}" does not exist on this server. Ask IT '
                "for the correct database name."
            ) from None
        raise CheckFailed(
            f'Could not log in as "{user}". The server said: {reason}'
        ) from None
    report.ok(f'Logged in as "{user}".')


def check_version(ctx: Context, report: Reporter) -> None:
    with ctx.engine.connect() as conn:
        number = int(conn.execute(text("SHOW server_version_num")).scalar_one())
        shown = conn.execute(text("SHOW server_version")).scalar_one()
    major = number // 10000
    if major < MIN_MAJOR:
        report.warn(
            f"PostgreSQL {shown} is older than {MIN_MAJOR}. UEP is tested on "
            f"{TESTED_MAJOR}; ask IT whether a newer server is available."
        )
    else:
        report.ok(f"PostgreSQL {shown} (UEP is tested on {TESTED_MAJOR}).")


def check_database_name(ctx: Context, report: Reporter) -> None:
    with ctx.engine.connect() as conn:
        actual = conn.execute(text("SELECT current_database()")).scalar_one()
    expected = ctx.url.database
    if expected and actual != expected:
        raise CheckFailed(
            f'Connected to database "{actual}", but the settings name "{expected}". '
            "Check DB_NAME."
        )
    report.ok(f'Connected to database "{actual}".')


def check_can_create(ctx: Context, report: Reporter) -> None:
    table = f"uep_preflight_{secrets.token_hex(6)}"
    user, database = ctx.url.username, ctx.url.database
    with ctx.engine.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text(f'CREATE TABLE public."{table}" (id integer)'))
        except Exception as exc:  # noqa: BLE001
            trans.rollback()
            if is_permission_error(exc):
                raise CheckFailed(
                    f'User "{user}" cannot create tables in "{database}". Ask IT to '
                    "make it the database owner or grant CREATE on schema public."
                ) from None
            raise CheckFailed(f"Could not create a test table. The server said: {_first_line(exc)}") from None
        # Rolled back, never committed: the table never existed for anyone else.
        trans.rollback()
    report.ok("UEP can create its tables (test table created and rolled back).")


def _uep_table_names() -> set[str] | None:
    """The tables UEP's own models define, or None if they cannot be loaded."""
    try:
        from app.core.database import Base
        import app.models  # noqa: F401
    except Exception:  # noqa: BLE001 -- e.g. the app's other settings are absent
        return None
    return set(Base.metadata.tables)


def check_contents(ctx: Context, report: Reporter) -> None:
    tables = set(inspect(ctx.engine).get_table_names(schema="public"))
    if not tables:
        report.ok("The database is empty. UEP will create its tables on first start.")
        return
    revision = None
    if "alembic_version" in tables:
        with ctx.engine.connect() as conn:
            revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    known = _uep_table_names()
    if known is None:
        unknown = set() if revision else tables
    else:
        unknown = tables - known - {"alembic_version"}
    if revision:
        report.ok(f"UEP's tables are already here, at schema revision {revision}.")
    if unknown:
        shown = ", ".join(sorted(unknown)[:UNKNOWN_TABLES_SHOWN])
        more = len(unknown) - UNKNOWN_TABLES_SHOWN
        extra = f" and {more} more" if more > 0 else ""
        report.warn(
            f"{len(unknown)} table(s) here are not UEP's: {shown}{extra}. UEP will "
            "leave them alone, but ask IT whether this is the right database."
        )


CHECKS: list[Callable[[Context, Reporter], None]] = [
    check_settings,
    check_host,
    check_port,
    check_login,
    check_version,
    check_database_name,
    check_can_create,
    check_contents,
]


def run(settings: DatabaseSettings, report: Reporter) -> int:
    ctx = Context(settings=settings)
    try:
        for check in CHECKS:
            check(ctx, report)
    except CheckFailed as failure:
        report.fail(str(failure))
        report.line(" ", "Database check FAILED -- UEP cannot start until this is fixed.")
        return 1
    except Exception as exc:  # noqa: BLE001 -- an unexpected error still gets one line
        report.fail(f"The check stopped unexpectedly: {type(exc).__name__}: {_first_line(exc)}")
        return 1
    finally:
        if ctx.engine is not None:
            ctx.engine.dispose()
    report.line(" ", "Database check passed.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--startup", action="store_true",
        help="prefix every line with [preflight] (used by entrypoint.sh)",
    )
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    report = Reporter("[preflight] " if args.startup else "")
    return run(DatabaseSettings(), report)


if __name__ == "__main__":
    sys.exit(main())
