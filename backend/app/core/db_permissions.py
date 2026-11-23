"""A readable reason when the database login may not create tables (UEP-20).

UEP applies its own schema updates at start-up (``alembic upgrade head`` in
``entrypoint.sh``), so its database login needs CREATE on the schema. When IT
supplies a login without it, PostgreSQL answers "permission denied" deep inside
a migration and the only clue used to be a stack trace. This turns that into
one line saying what to ask the database team for.

Never prints the password or the connection string: only the user and the
database name, both read from the configured URL.
"""
from __future__ import annotations

from sqlalchemy.engine import make_url

#: PostgreSQL's SQLSTATE for "insufficient_privilege" -- both "permission
#: denied for schema public" and "must be owner of table".
INSUFFICIENT_PRIVILEGE = "42501"


def _sqlstate(exc: BaseException) -> str | None:
    """The SQLSTATE of a DBAPI error, wrapped by SQLAlchemy or not."""
    for candidate in (exc, getattr(exc, "orig", None), exc.__cause__):
        if candidate is None:
            continue
        code = getattr(candidate, "sqlstate", None) or getattr(candidate, "pgcode", None)
        if code:
            return code
    return None


def is_permission_error(exc: BaseException) -> bool:
    return _sqlstate(exc) == INSUFFICIENT_PRIVILEGE


def permission_message(database_url: str, schema: str = "public") -> str:
    try:
        url = make_url(database_url)
        user, database = url.username or "?", url.database or "?"
    except Exception:  # noqa: BLE001 -- an unparseable URL still gets a message
        user, database = "?", "?"
    return (
        f'UEP cannot create its tables: the database user "{user}" has no CREATE '
        f'permission on schema "{schema}" in database "{database}". Ask the '
        "database team to make this user the owner of the database or grant "
        f"CREATE on schema {schema}."
    )
