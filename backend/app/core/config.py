"""Application configuration loaded from environment variables."""
import hashlib
from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url

# The values the application shipped with. They are published in this repository
# and in .env.example, so anyone can read them. Booting with either one still in
# place means anyone on the network can mint themselves an admin token, so
# startup refuses unless APP_ENV says this is a development machine.
INSECURE_JWT_SECRET = "CHANGE_ME_IN_PRODUCTION"
INSECURE_ADMIN_PASSWORD = "Admin@12345"

# Below this, an HS256 signing key is worth brute-forcing offline.
MIN_JWT_SECRET_LENGTH = 32

DEVELOPMENT = "development"

# What a development machine connects to when no database setting is given at
# all: the Compose database. Production never falls back to it (see
# DatabaseSettings.missing_database_settings).
DEVELOPMENT_DATABASE_URL = "postgresql+psycopg://uep:uep_password@db:5432/uep"

# The four settings that, together, replace DATABASE_URL (UEP-23).
REQUIRED_DB_PARTS = ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD")


class DatabaseSettings(BaseSettings):
    """Where the database is, and nothing else.

    Two ways to say it:

    * ``DATABASE_URL`` -- one connection string. Docker Compose uses this, and
      if it is set it wins.
    * ``DB_HOST`` / ``DB_PORT`` / ``DB_NAME`` / ``DB_USER`` / ``DB_PASSWORD``
      -- the parts, in the shape IT hands them out. Kubernetes uses these. The
      URL is built by SQLAlchemy, which escapes characters such as ``@ : / %
      #`` in the password; pasting such a password into a URL by hand breaks
      it.

    Kept apart from :class:`Settings` so the database pre-flight check
    (``app.scripts.db_preflight``) can read just these, without the
    application's other start-up checks getting in the way.

    The password and the URL are excluded from ``repr`` so they never reach a
    log by way of printing the settings object.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Which kind of machine this is. Set APP_ENV=development to allow the
    # insecure defaults below; anything else (including leaving it unset) is
    # treated as production and enforces the checks in _reject_insecure_config.
    app_env: str = "production"

    database_url: str | None = Field(default=None, repr=False)
    db_host: str | None = None
    db_port: int = 5432
    db_name: str | None = None
    db_user: str | None = None
    db_password: str | None = Field(default=None, repr=False)
    # libpq's sslmode: "prefer" uses TLS when the server offers it.
    db_sslmode: str = "prefer"
    # How long to wait for the database server to answer a new connection.
    db_connect_timeout_seconds: int = 10

    @property
    def is_development(self) -> bool:
        return self.app_env.strip().lower() == DEVELOPMENT

    def _parts(self) -> dict[str, str | None]:
        return {
            "DB_HOST": self.db_host,
            "DB_NAME": self.db_name,
            "DB_USER": self.db_user,
            "DB_PASSWORD": self.db_password,
        }

    def missing_database_settings(self) -> list[str]:
        """The database settings that still have to be set, in order.

        Empty when ``DATABASE_URL`` is set, when all four parts are set, or on
        a development machine where none of them is (it then uses the Compose
        database, as it always did).
        """
        if self.database_url:
            return []
        parts = self._parts()
        if self.is_development and not any(parts.values()):
            return []
        return [name for name, value in parts.items() if not value]

    @property
    def sqlalchemy_url(self) -> URL:
        """The connection URL, built in one place for the app, Alembic and scripts.

        A ``URL`` object, not a string: rendering it as a string is what
        exposes the password, so callers that only connect never need to.
        """
        if self.database_url:
            return make_url(self.database_url)
        if self.missing_database_settings():
            raise ValueError(database_settings_message(self.missing_database_settings()))
        if not any(self._parts().values()):
            return make_url(DEVELOPMENT_DATABASE_URL)
        return URL.create(
            "postgresql+psycopg",
            username=self.db_user,
            password=self.db_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
            query={
                "sslmode": self.db_sslmode,
                "connect_timeout": str(self.db_connect_timeout_seconds),
            },
        )

    def database_description(self) -> str:
        """``user@host:port/database`` -- safe to log. Never the password."""
        try:
            url = self.sqlalchemy_url
        except ValueError:
            return "(database not configured)"
        if url.drivername.startswith("sqlite"):
            return f"sqlite:{url.database}"
        return f"{url.username}@{url.host}:{url.port or 5432}/{url.database}"


def database_settings_message(missing: list[str]) -> str:
    names = ", ".join(missing)
    return (
        f"The database is not configured: {names} "
        f"{'is' if len(missing) == 1 else 'are'} not set. Set DATABASE_URL, or "
        "all of DB_HOST, DB_NAME, DB_USER and DB_PASSWORD (DB_PORT defaults to "
        "5432). On Kubernetes they come from the uep-config ConfigMap and the "
        "uep-secrets Secret -- see KUBERNETES-RUNBOOK.md."
    )


class Settings(DatabaseSettings):
    """Central application settings.

    All values are overridable via environment variables, which keeps
    secrets out of source control and lets the same image run in any
    environment (12-factor style). The database settings are inherited from
    :class:`DatabaseSettings`.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # How many proxies we run in front of the backend, counted from the
    # backend outwards. The client's address is that many entries from the
    # RIGHT of X-Forwarded-For; everything further left was supplied by the
    # client and cannot be trusted. Docker Compose: 1 (nginx). Kubernetes: 2
    # (the cluster's Ingress, then nginx). 0 ignores the header entirely.
    trusted_proxy_hops: int = 1

    # How long a starting backend waits for another one to finish migrating
    # before giving up (app/scripts/migrate_with_lock.py).
    migration_lock_timeout_seconds: int = 600

    # Security / JWT
    jwt_secret_key: str = INSECURE_JWT_SECRET
    jwt_algorithm: str = "HS256"
    # The idle timeout: a session nobody has used for this long ends. Every
    # request the person makes (not the page's own background refresh) slides
    # it forward -- see app/core/session_renewal.py. 30 minutes is the upper
    # end of OWASP's recommendation for an internal application of this kind.
    access_token_expire_minutes: int = 30
    # The absolute timeout: however busy, a sign-in ends this long after it
    # began, and the person signs in again.
    session_absolute_timeout_minutes: int = 480  # 8 hours

    # The browser session (see app/core/session_cookies.py). The access token
    # travels in an HttpOnly cookie that page scripts cannot read, with a
    # second, readable cookie carrying the CSRF token the page echoes back.
    session_cookie_name: str = "uep_session"
    csrf_cookie_name: str = "uep_csrf"
    csrf_header_name: str = "X-CSRF-Token"
    # Whether the cookies are marked Secure (sent over HTTPS only). Unset, it
    # follows the scheme the request arrived on (nginx's X-Forwarded-Proto), so
    # a TLS deployment gets Secure cookies without configuring anything and a
    # plain-HTTP one can still sign in. Set it to true once TLS is in place to
    # make that unconditional.
    session_cookie_secure: bool | None = None

    # Signing key for the login captcha. Left empty it is derived from
    # jwt_secret_key rather than being the same value -- see captcha_key.
    captcha_secret_key: str = ""

    # Login throttling. Counts only failed attempts; a success clears the
    # counter, so ordinary users never meet it. Five failures for one username
    # inside fifteen minutes locks that username for fifteen minutes.
    login_max_attempts_per_username: int = 5
    login_max_attempts_per_ip: int = 20
    login_attempt_window_seconds: int = 900  # 15 minutes
    login_lockout_seconds: int = 900  # 15 minutes
    # Failures (per username or per address, inside the window above) after
    # which the captcha is demanded. Below it the login form shows none -- see
    # the login endpoint for why that costs nothing.
    login_captcha_after_failures: int = 2
    # Whether the login form's maths question is used at all (UEP-26). Off by
    # default: the per-username lockout above is the defence against guessing,
    # and the sign-in page no longer shows the question. Set to true to restore
    # the pre-UEP-26 behaviour; /auth/captcha keeps working either way.
    login_captcha_enabled: bool = False

    # File uploads (letters, attachments). The files themselves are kept in
    # the database (stored_files, UEP-20); there is no uploads folder.
    max_upload_mb: int = 20

    # First admin bootstrapped on startup.
    #
    # ``first_admin_fullname`` is kept, rather than replaced by a pair of
    # first/family settings, because it is an environment variable that real
    # deployments already set -- renaming it would silently rename the platform
    # administrator on the next restart. Bootstrap splits it, the same way the
    # migration splits every other user's name.
    first_admin_username: str = "admin"
    first_admin_password: str = INSECURE_ADMIN_PASSWORD
    first_admin_fullname: str = "System Administrator"
    first_admin_email: str | None = None

    # Comma-separated list of origins the browser may call the API from.
    # "*" is rejected in production: the API sends credentials, and a wildcard
    # combined with credentials makes Starlette echo back whichever origin asked.
    cors_origins: str = "*"

    # Logging (see app/core/logging_config.py)
    log_level: str = "INFO"
    log_format: str = "json"  # "json" for collectors, "text" for reading by eye

    # Outgoing mail, used by the daily pending-work digest only
    # (``python -m app.jobs.daily_digest``). Empty ``smtp_host`` means no mail
    # server is configured: the job still writes the daily snapshot, and logs
    # each digest as failed with the reason, so a later run can send it.
    smtp_host: str = ""
    smtp_port: int = 25
    # "starttls", "ssl" (implicit TLS, usually port 465) or "none" for an
    # internal relay that does not offer TLS.
    smtp_security: str = "starttls"
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_timeout_seconds: int = 30
    mail_from: str = "UEP <uep-noreply@localhost>"

    # Where links in an email point: the address people open UEP at.
    app_base_url: str = "http://localhost"

    # The Tehran-calendar weekdays the digest is emailed on. The snapshot is
    # written every day the job runs; only the email follows this list.
    digest_weekdays: str = "sat,sun,mon,tue,wed"

    # Home's "Due in 1 week" (UEP-27; 3 before): an item that turns late
    # within this many days. The digest and snapshot read the same setting.
    home_due_soon_days: int = 7

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def captcha_key(self) -> str:
        """The signing key for captcha challenges.

        Deliberately not the same value as ``jwt_secret_key``. Captcha tokens
        are handed to anyone who loads the login page, so they are the most
        widely distributed thing the application signs; sharing a key between
        them and access tokens means one signing key doing two jobs for no
        benefit.

        If ``CAPTCHA_SECRET_KEY`` is not set, one is derived from the JWT secret
        instead. The derivation is one-way, so a captcha token reveals nothing
        about the key that signs access tokens, and there is nothing extra to
        configure on the server.
        """
        if self.captcha_secret_key:
            return self.captcha_secret_key
        return hashlib.sha256(f"uep-captcha:{self.jwt_secret_key}".encode()).hexdigest()

    @property
    def scan_key(self) -> str:
        """The signing key for acceptance scan tokens (``services/scan_tokens``).

        Derived one-way from the JWT secret for the same reason as
        :attr:`captcha_key`: one key, one job, nothing extra to configure.
        """
        return hashlib.sha256(f"uep-scan:{self.jwt_secret_key}".encode()).hexdigest()

    @model_validator(mode="after")
    def _reject_insecure_config(self) -> "Settings":
        """Refuse to start with configuration that is not safe to expose.

        The failure this prevents: if ``.env`` is missing or does not get
        mounted into the container, every setting below falls back to its
        default. The application would previously start quite happily with a
        signing key that is printed in this repository, and anyone who noticed
        could forge an admin token. Failing loudly at startup turns a silent
        compromise into an obvious deployment error.
        """
        # No database configured (UEP-23) stops start-up everywhere, naming the
        # missing settings; on a server it is listed with the other problems.
        missing = self.missing_database_settings()
        problems: list[str] = [database_settings_message(missing)] if missing else []

        if self.is_development:
            if problems:
                raise ValueError("\n\n" + problems[0] + "\n")
            return self

        if self.jwt_secret_key == INSECURE_JWT_SECRET:
            problems.append(
                "JWT_SECRET_KEY is still the default value from .env.example. "
                "Anyone reading this project's source can sign their own admin "
                "token with it."
            )
        elif len(self.jwt_secret_key) < MIN_JWT_SECRET_LENGTH:
            problems.append(
                f"JWT_SECRET_KEY is only {len(self.jwt_secret_key)} characters long; "
                f"it must be at least {MIN_JWT_SECRET_LENGTH}. A short key can be "
                "guessed offline."
            )

        if self.first_admin_password == INSECURE_ADMIN_PASSWORD:
            problems.append(
                "FIRST_ADMIN_PASSWORD is still the default value from "
                ".env.example, which is public knowledge."
            )

        if "*" in self.cors_origin_list:
            problems.append(
                'CORS_ORIGINS is "*", but the API sends credentials. That '
                "combination makes the server accept requests from any website "
                "a logged-in user visits. List the exact address the UEP "
                'frontend is served from instead, for example '
                '"https://uep.example.com".'
            )
        elif not self.cors_origin_list:
            problems.append(
                "CORS_ORIGINS is empty. Set it to the address the UEP frontend "
                "is served from."
            )

        if not problems:
            return self

        numbered = "\n".join(f"  {i}. {p}" for i, p in enumerate(problems, 1))
        raise ValueError(
            "\n\nThe application will not start with this configuration:\n\n"
            f"{numbered}\n\n"
            "Fix these in the .env file on the server, then start it again. If "
            "the .env file looks correct, check that it is actually reaching the "
            "container -- a missing or unmounted .env is the usual cause, "
            "because every setting then falls back to its published default. "
            "On Kubernetes the settings come from the uep-config ConfigMap and "
            "the uep-secrets Secret instead (KUBERNETES-RUNBOOK.md).\n\n"
            "RUNBOOK.md has step-by-step instructions, including how to generate "
            "a strong JWT_SECRET_KEY.\n\n"
            "On a local development machine, set APP_ENV=development to allow "
            "these defaults.\n"
        )


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (loaded once per process)."""
    return Settings()
