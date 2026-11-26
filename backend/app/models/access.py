"""UEP-25: feature access managed in Admin, and the System health snapshots.

* ``features`` is the catalogue: one row per app or sensitive action, with the
  levels it supports. Seeded by migration; new features arrive by migration.
* ``role_feature_grants`` gives a role a level on a feature. No row means no
  access. ``hidden_in_menus`` keeps the old "direct" entries of the access
  matrix: usable by URL and API, not offered in navigation.
* ``user_feature_overrides`` is a single-person exception on top of the role,
  with a required reason and an optional expiry.
* ``access_version`` is one row holding a counter, increased on every change,
  so every pod knows when to re-read its cached grants (core/access.py).
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

LEVEL_NONE = "none"
LEVEL_VIEW = "view"
LEVEL_EDIT = "edit"
LEVEL_RANK = {LEVEL_NONE: 0, LEVEL_VIEW: 1, LEVEL_EDIT: 2}


class Feature(Base):
    __tablename__ = "features"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    #: Drive test, Acceptance, Explorer, Insights, Planning, Admin.
    app: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    #: 'view', 'edit' or 'view,edit'.
    levels: Mapped[str] = mapped_column(String(20), nullable=False, default="view,edit")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    @property
    def level_list(self) -> list[str]:
        return [x for x in self.levels.split(",") if x]


class RoleFeatureGrant(Base):
    __tablename__ = "role_feature_grants"
    __table_args__ = (UniqueConstraint("role_id", "feature_key", name="uq_role_feature_grant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(
        ForeignKey("features.key", ondelete="CASCADE"), nullable=False
    )
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    hidden_in_menus: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class UserFeatureOverride(Base):
    __tablename__ = "user_feature_overrides"
    __table_args__ = (UniqueConstraint("user_id", "feature_key", name="uq_user_feature_override"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(
        ForeignKey("features.key", ondelete="CASCADE"), nullable=False
    )
    #: 'none' removes a feature the role has; 'view'/'edit' grant one.
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    granted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccessVersion(Base):
    __tablename__ = "access_version"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)


class SystemSnapshot(Base):
    """One row per day for the System health 90-day charts. Kept 2 years."""

    __tablename__ = "system_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    taken_on: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    db_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    files_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    active_users: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class BackupConfirmation(Base):
    """'Last backup confirmed', entered by an Admin. UEP cannot see the
    database team's backups, so a person confirms them. Every entry is kept;
    the newest is the one shown."""

    __tablename__ = "backup_confirmations"

    id: Mapped[int] = mapped_column(primary_key=True)
    confirmed_on: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))
    entered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    entered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ErrorEvent(Base):
    """One server (5xx) or browser error, counted on System health. Only the
    moment, the source and the route are kept -- never a message or a stack,
    which stay in the log. Pruned after 30 days by the daily job."""

    __tablename__ = "error_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    #: 'server' or 'client'.
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    route: Mapped[str | None] = mapped_column(String(255))
