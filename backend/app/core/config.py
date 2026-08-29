"""Application configuration loaded from environment variables."""
import hashlib
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The values the application shipped with. They are published in this repository
# and in .env.example, so anyone can read them. Booting with either one still in
# place means anyone on the network can mint themselves an admin token, so
# startup refuses unless APP_ENV says this is a development machine.
INSECURE_JWT_SECRET = "CHANGE_ME_IN_PRODUCTION"
INSECURE_ADMIN_PASSWORD = "Admin@12345"

# Below this, an HS256 signing key is worth brute-forcing offline.
MIN_JWT_SECRET_LENGTH = 32

DEVELOPMENT = "development"


class Settings(BaseSettings):
    """Central application settings.

    All values are overridable via environment variables, which keeps
    secrets out of source control and lets the same image run in any
    environment (12-factor style).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Which kind of machine this is. Set APP_ENV=development to allow the
    # insecure defaults below; anything else (including leaving it unset) is
    # treated as production and enforces the checks in _reject_insecure_config.
    app_env: str = "production"

    # Database
    database_url: str = "postgresql+psycopg://uep:uep_password@db:5432/uep"

    # Security / JWT
    jwt_secret_key: str = INSECURE_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8 hours

    # Signing key for the login captcha. Left empty it is derived from
    # jwt_secret_key rather than being the same value -- see captcha_key.
    captcha_secret_key: str = ""

    # Login throttling. Counts only failed attempts; a success clears the
    # counter, so ordinary users never meet it.
    login_max_attempts_per_username: int = 5
    login_max_attempts_per_ip: int = 20
    login_attempt_window_seconds: int = 300  # 5 minutes
    login_lockout_seconds: int = 900  # 15 minutes

    # File uploads (letters, attachments)
    upload_dir: str = "/data/uploads"
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

    @property
    def is_development(self) -> bool:
        return self.app_env.strip().lower() == DEVELOPMENT

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
        if self.is_development:
            return self

        problems: list[str] = []

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
            "because every setting then falls back to its published default.\n\n"
            "RUNBOOK.md has step-by-step instructions, including how to generate "
            "a strong JWT_SECRET_KEY.\n\n"
            "On a local development machine, set APP_ENV=development to allow "
            "these defaults.\n"
        )


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (loaded once per process)."""
    return Settings()
