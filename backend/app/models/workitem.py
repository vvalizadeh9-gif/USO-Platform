"""Core domain models: Site, WorkItem, Village and workflow entities."""
from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    # Only for the annotation on Village.acceptances below. Importing it at
    # runtime would be circular. It resolved anyway, because
    # `from __future__ import annotations` makes the annotation a string and
    # SQLAlchemy looks the name up in its own registry -- but nothing said so,
    # and a reader (or a linter) had no way to tell the name was defined.
    from app.models.acceptance import Acceptance


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_code: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    temp_site_code: Mapped[str | None] = mapped_column(String(50), nullable=True)

    province_id: Mapped[int | None] = mapped_column(ForeignKey("provinces.id"), index=True)
    region_id: Mapped[int | None] = mapped_column(ForeignKey("regions.id"), index=True)

    county: Mapped[str | None] = mapped_column(String(120))
    district: Mapped[str | None] = mapped_column(String(120))
    rural_district: Mapped[str | None] = mapped_column(String(120))

    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)

    province = relationship("Province")
    region = relationship("Region")
    work_items: Mapped[list[WorkItem]] = relationship(back_populates="site")


class WorkItem(Base):
    """Aggregate root. Unique per (site, site_type)."""

    __tablename__ = "work_items"
    __table_args__ = (UniqueConstraint("site_id", "site_type", name="uq_site_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), nullable=False, index=True)

    site_type: Mapped[str] = mapped_column(String(50), nullable=False)
    requested_technology: Mapped[str | None] = mapped_column(String(50))
    deployed_technology: Mapped[str | None] = mapped_column(String(50))

    project_name: Mapped[str | None] = mapped_column(String(150))
    overall_project: Mapped[str | None] = mapped_column(String(150))
    pm_name: Mapped[str | None] = mapped_column(String(150))
    equipment_type: Mapped[str | None] = mapped_column(String(120))
    operator: Mapped[str | None] = mapped_column(String(120))
    power_status: Mapped[str | None] = mapped_column(String(120))
    monthly_plan: Mapped[str | None] = mapped_column(String(120))

    referral_letter_number: Mapped[str | None] = mapped_column(String(120))
    referral_date_shamsi: Mapped[str | None] = mapped_column(String(30))
    referral_date_gregorian: Mapped[date | None] = mapped_column(Date)
    launch_date_shamsi: Mapped[str | None] = mapped_column(String(30))
    launch_date_gregorian: Mapped[date | None] = mapped_column(Date)

    # Last completed stage from CPM column X (آخرین مرحله انجام شده).
    # Master field (A..AU) — refreshed on every monthly import. Drives the
    # "on-air" KPIs. Stored normalised (underscores), e.g. راه_اندازی_دائم.
    last_stage: Mapped[str | None] = mapped_column(String(60))

    # Derived lifecycle stage (see workflow service).
    current_stage: Mapped[str] = mapped_column(
        String(50), default="New", nullable=False
    )

    # ----- Drive Test Project fields (CPM cols AV..AZ) -----
    # Seeded ONCE from the first CPM import, then maintained inside the app.
    # These power the Drive Test Project dashboard, independent of the
    # workflow-driven drive_tests table.
    dt_sc_contractor_id: Mapped[int | None] = mapped_column(
        ForeignKey("contractors.id"), index=True
    )
    dt_status: Mapped[str | None] = mapped_column(String(20))  # Done|Problematic|None
    dt_problem_category: Mapped[str | None] = mapped_column(String(120))
    dt_date_gregorian: Mapped[date | None] = mapped_column(Date)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    site: Mapped[Site] = relationship(back_populates="work_items")
    dt_sc_contractor = relationship("Contractor", foreign_keys=[dt_sc_contractor_id])
    # NOTE: no default eager loading here (deliberately). Loading the full
    # villages+acceptances graph is expensive and most endpoints (work item
    # list, CPM admin, etc.) never touch it. Endpoints that DO need it
    # (work item detail, dashboards, Drive Test analytics, Acceptance
    # overview) request it explicitly via selectinload() query options —
    # see services/eager_loading.py for the single shared helper.
    villages: Mapped[list[Village]] = relationship(back_populates="work_item")
    health_checks: Mapped[list[HealthCheck]] = relationship(back_populates="work_item")
    hc_tasks = relationship(
        "HcTask", back_populates="work_item", viewonly=False
    )
    assignments: Mapped[list[Assignment]] = relationship(back_populates="work_item")
    drive_tests: Mapped[list[DriveTest]] = relationship(back_populates="work_item")


class Village(Base):
    """Only pure هدف villages get a row here; every other classification is
    dropped on import (see cpm_columns.is_pure_target)."""

    __tablename__ = "villages"

    id: Mapped[int] = mapped_column(primary_key=True)
    work_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_items.id"), nullable=False, index=True
    )
    village_code: Mapped[str | None] = mapped_column(String(50))
    village_name: Mapped[str | None] = mapped_column(String(150))
    # Raw هدف/اقماری classification from CPM column AD (target_flag). Imports
    # now store only the exact هدف value, so on fresh data this column is
    # effectively constant; it is kept because rows written by earlier, laxer
    # imports may still hold a sub-flag ("هدف (Verbally)" and friends), and the
    # Acceptance dashboard filters on it (see cpm_columns.is_pure_target).
    target_classification: Mapped[str | None] = mapped_column(String(60))
    households: Mapped[int | None] = mapped_column(Integer)
    population: Mapped[int | None] = mapped_column(Integer)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)

    # Where this village stands with each authority, as the acceptance queue
    # reads it: Approved | Rejected | Returned | Pending | NotFiled.
    #
    # A cache, not a fact. The truth is derived from ``acceptances`` and
    # ``acceptance_submissions`` by acceptance_workflow.authority_status(), and
    # these two columns are written through in the same transaction as every
    # state change that could alter them. They exist because the My Work queue
    # groups, filters, sorts and counts four hundred villages per contractor,
    # and doing that in Python means loading the whole acceptance graph to
    # answer "how many need attention".
    #
    # If they are ever suspected of drift, the fix is to recompute them from
    # the submissions — never to treat them as the record.
    ict_status: Mapped[str] = mapped_column(
        String(20), default="NotFiled", server_default="NotFiled",
        nullable=False, index=True,
    )
    cra_status: Mapped[str] = mapped_column(
        String(20), default="NotFiled", server_default="NotFiled",
        nullable=False, index=True,
    )

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    work_item: Mapped[WorkItem] = relationship(back_populates="villages")
    # See note above — no default eager load; opt in explicitly per query.
    acceptances: Mapped[list[Acceptance]] = relationship(back_populates="village")


class HealthCheck(Base):
    __tablename__ = "health_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    work_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_items.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # Ready|Problematic
    problem_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("problem_categories.id")
    )
    comment: Mapped[str | None] = mapped_column(Text)
    checked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    work_item: Mapped[WorkItem] = relationship(back_populates="health_checks")
    problem_category = relationship("ProblemCategory")


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    work_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_items.id"), nullable=False, index=True
    )
    assignment_type: Mapped[str] = mapped_column(String(20), nullable=False)  # first|official
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id"), nullable=False, index=True
    )
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    remarks: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # A contractor hands the site back before attempting DT (road blocked,
    # site down, access denied, etc). The assignment stays active/visible to
    # the coordinator/PM queue but is flagged so it surfaces distinctly from
    # a normal in-progress assignment — see workflow.STAGE_RETURNED. Cleared
    # implicitly whenever a new assignment supersedes this one.
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    return_reason: Mapped[str | None] = mapped_column(Text)

    work_item: Mapped[WorkItem] = relationship(back_populates="assignments")
    contractor = relationship("Contractor")



class DriveTest(Base):
    __tablename__ = "drive_tests"

    id: Mapped[int] = mapped_column(primary_key=True)
    work_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_items.id"), nullable=False, index=True
    )
    execution_date: Mapped[date | None] = mapped_column(Date)
    report_link: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(
        String(20), default="Submitted", nullable=False
    )  # Submitted|Approved|Rejected|Returned

    coordinator_reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    coordinator_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    coordinator_comment: Mapped[str | None] = mapped_column(Text)

    pm_reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    pm_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pm_comment: Mapped[str | None] = mapped_column(Text)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    work_item: Mapped[WorkItem] = relationship(back_populates="drive_tests")
