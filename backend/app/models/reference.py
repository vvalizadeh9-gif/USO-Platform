"""Reference / master data and RBAC models."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Table, Column, Integer, func
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import user_status
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
    """A person who signs in to the platform.

    Rows are never deleted. ``audit_logs.user_id``, ``hc_tasks.reviewed_by`` and
    both reviewer columns on ``work_items`` point here, so removing a user turns
    every health check they signed off into one reviewed by nobody -- the
    accountability trail goes anonymous exactly where it matters most. Ending
    someone's access is a :attr:`status` change; see ``core/user_status.py``.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Stored as two fields rather than one "full name", because they are two
    # facts. Letters address a person by family name, the operational reports
    # sort by it, and a single string forces every one of those to guess where
    # the boundary is -- a guess that is wrong for a good share of Persian
    # names. ``full_name`` below is derived, so nothing that reads it changed.
    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    family_name: Mapped[str] = mapped_column(String(80), nullable=False)

    # How an administrator reaches this person outside the platform -- to hand
    # over a temporary password, or to ask about an account they are about to
    # suspend. Optional, because the deployment has users who genuinely have no
    # work address, and unique when present, so two accounts cannot claim the
    # same mailbox. Not a login identifier: ``username`` remains the only one.
    email: Mapped[str | None] = mapped_column(String(255), unique=True)

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

    # Active / Inactive / Suspended. See ``core/user_status.py`` for what each
    # means and why this replaced a boolean.
    status: Mapped[str] = mapped_column(
        String(20), default=user_status.ACTIVE, nullable=False, index=True
    )

    # Who last moved this account between statuses, and when. Cleared on the
    # way back to Active, so a live account never carries a stale "suspended by
    # X on Y" -- the audit log is where the history of those moves lives.
    status_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    status_changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    # Set when an administrator resets the password to a temporary value. While
    # it is true the account can do exactly two things -- read its own profile
    # and set a new password -- so the credential the administrator saw is
    # never the one that stays on the account. Cleared by that password change.
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Bumped whenever this account's credentials change. Access tokens carry
    # the value they were minted with, and a token whose value no longer
    # matches is refused -- which is what makes "reset the password" actually
    # end the sessions an attacker already holds. Without it a stolen token
    # stayed valid for its full eight hours after the password was changed,
    # and the only way to end it was rotating JWT_SECRET_KEY, which signs out
    # every user in the platform.
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    @hybrid_property
    def full_name(self) -> str:
        """The person's name as one string, for display and for letters.

        Derived rather than stored. It used to be the only name column, and
        roughly twenty places read it -- the sidebar, the audit log, the CPM
        import summary, the acceptance letters. Keeping it as a property means
        splitting the column underneath changed none of them, and there is no
        second copy of the name to drift out of step with the first.
        """
        return f"{self.first_name} {self.family_name}".strip()

    @full_name.inplace.expression
    @classmethod
    def _full_name_expression(cls):
        """The same value in SQL, so it can still be selected and ordered by.

        ``+`` on two String columns compiles to the dialect's concatenation
        operator, which is ``||`` on both PostgreSQL and SQLite.
        """
        return func.trim(cls.first_name + " " + cls.family_name)

    @hybrid_property
    def active(self) -> bool:
        """Whether this account may sign in.

        The boolean this replaced was a column; it is now a reading of
        :attr:`status`. Kept because "is this user active" is genuinely the
        question most callers are asking, and spelling it out at each of them
        would put the definition of Active in a dozen places.
        """
        return user_status.may_sign_in(self.status)

    @active.inplace.expression
    @classmethod
    def _active_expression(cls):
        return cls.status.in_(user_status.SIGN_IN_STATUSES)

    provinces: Mapped[list[Province]] = relationship(
        secondary=user_province_access, lazy="selectin"
    )
