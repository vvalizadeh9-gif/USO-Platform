"""Application configuration loaded from environment variables."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central application settings.

    All values are overridable via environment variables, which keeps
    secrets out of source control and lets the same image run in any
    environment (12-factor style).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+psycopg://uep:uep_password@db:5432/uep"

    # Security / JWT
    jwt_secret_key: str = "CHANGE_ME_IN_PRODUCTION"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8 hours

    # File uploads (letters, attachments)
    upload_dir: str = "/data/uploads"
    max_upload_mb: int = 20

    # First admin bootstrapped on startup
    first_admin_username: str = "admin"
    first_admin_password: str = "Admin@12345"
    first_admin_fullname: str = "System Administrator"

    # CORS (frontend origin). "*" is fine because same-origin via Nginx in prod.
    cors_origins: str = "*"


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (loaded once per process)."""
    return Settings()
