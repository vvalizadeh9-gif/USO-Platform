"""The sign-in page settings (UEP-26): support contact and planned-update notice.

One row (id = 1), seeded empty by the migration and edited in Admin >
Sign-in page. The public part is served unauthenticated by
``GET /auth/signin-settings``; see ``services/signin_settings``.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

#: The one row's primary key.
SINGLETON_ID = 1


class SignInSettings(Base):
    __tablename__ = "signin_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    support_name: Mapped[str | None] = mapped_column(String(80))
    support_hours: Mapped[str | None] = mapped_column(String(80))
    support_email: Mapped[str | None] = mapped_column(String(254))
    support_phone: Mapped[str | None] = mapped_column(String(40))
    notice_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notice_text: Mapped[str | None] = mapped_column(String(140))
    notice_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notice_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # ``updated_at`` comes from Base.

    editor = relationship("User", foreign_keys=[updated_by])
