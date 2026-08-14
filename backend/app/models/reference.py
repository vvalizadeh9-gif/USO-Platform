"""Reference / master data and RBAC models."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Table, Column, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Province(Base):
    __tablename__ = "provinces"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)


class Region(Base):
    __tablename__ = "regions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)


class Contractor(Base):
    __tablename__ = "contractors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    # 'site' = execution contractor, 'drive_test' = DT contractor
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="drive_test")
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ProblemCategory(Base):
    """Health-check problem categories. Admin-extendable without code changes.

    ``owner_role_id`` is the routing table for the health-check remediation
    loop: when a PM tags a Not-Ready site with a category, the fix is opened
    against that category's owning role. Because it is data rather than code,
    a new category needs no release — Admin adds the category row, points it
    at a role, and the queue appears for that role.
    """

    __tablename__ = "problem_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Which role owns fixing this category, and how long they have.
    owner_role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"))
    sla_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)

    owner_role: Mapped[Role | None] = relationship()


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # True for the roles that own a health-check problem category (CPG Power,
    # CPG Rollout PM, Managed Service, NWG Planning). Guards ask "is this an
    # owner?" through this flag rather than comparing against a hardcoded list
    # of role names, so adding a fifth category-owner role stays a data change.
    is_category_owner: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    users: Mapped[list[User]] = relationship(back_populates="role")


# Association table: which provinces a user may see (row-level security).
user_province_access = Table(
    "user_province_access",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("province_id", Integer, ForeignKey("provinces.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)

    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)
    role: Mapped[Role] = relationship(back_populates="users")

    # Contractor users are scoped to their own assigned work items.
    contractor_id: Mapped[int | None] = mapped_column(
        ForeignKey("contractors.id"), nullable=True
    )
    contractor: Mapped[Contractor | None] = relationship()

    # Admin / PM bypass province filtering entirely.
    sees_all_provinces: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    provinces: Mapped[list[Province]] = relationship(
        secondary=user_province_access, lazy="selectin"
    )
