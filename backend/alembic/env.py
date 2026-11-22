"""Alembic migration environment."""
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.core.db_permissions import is_permission_error, permission_message
from app.core.database import Base
import app.models  # noqa: F401  (register all models on metadata)

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url)

if config.config_file_name is not None:
    # disable_existing_loggers=False matters. The default is True, which
    # switches off every logger that already exists -- including the
    # application's own "uep.request" logger. Running migrations in the same
    # process as the application (as the test suite does) would otherwise
    # silence request logging from that point on, with nothing to indicate why.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _configure_and_run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        # SQLite cannot ALTER a column in place, so any migration that changes
        # one has to rebuild the table. Batch mode does that automatically and
        # is ignored on PostgreSQL.
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database.

    The test suite calls Alembic in-process and hands it an existing connection
    through ``config.attributes`` so that migrations run on the very same engine
    (and, for SQLite, the very same file) the application is using. When no
    connection is supplied -- the normal case, running ``alembic upgrade head``
    from the command line -- one is built from the configured URL.
    """
    injected = config.attributes.get("connection")
    if injected is not None:
        _configure_and_run(injected)
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    try:
        with connectable.connect() as connection:
            _configure_and_run(connection)
    except Exception as exc:
        # A login without CREATE on the schema (UEP-20): one readable line
        # instead of a stack trace, and a non-zero exit so entrypoint.sh stops
        # before the application starts on a half-built schema.
        if not is_permission_error(exc):
            raise
        print(permission_message(get_settings().database_url), file=sys.stderr, flush=True)
        raise SystemExit(1) from None


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
