"""Database engine, session factory and declarative base.

Uses SQLAlchemy 2.0 style (typed, ``DeclarativeBase``).
"""
from collections.abc import Generator
from datetime import datetime

from sqlalchemy import DateTime, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# A URL object built in app/core/config.py from DATABASE_URL or the DB_* parts
# (UEP-23); passing the object rather than a string keeps the password out of
# anything that renders it.
engine = create_engine(
    settings.sqlalchemy_url,
    pool_pre_ping=True,  # transparently recover dropped connections
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base with common audit timestamp columns.

    Every table inherits ``created_at`` and ``updated_at`` automatically,
    avoiding repetition across models (DRY).
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


def get_db() -> Generator:
    """FastAPI dependency that yields a database session and closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
