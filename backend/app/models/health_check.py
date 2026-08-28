"""Health Check workflow models (Phase A).

Replaces the old single-flag ``health_checks`` table with a fuller,
assignment-based model:

* HcAssignment  — a container: many sites assigned to one subcontractor.
* HcTask        — one site inside an assignment (independent per-site result).
* HcTaskTechnology — the subcontractor's Normal/NotNormal answer per requested
  technology. Only technologies the site actually requested are ever created.

The site's overall Ready / NotReady is computed from its technology rows, not
entered manually (see services/health_check.py).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class HcAssignment(Base):
    """A coordinator's assignment of many sites to one subcontractor for HC."""

    __tablename__ = "hc_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    contractor_id: Mapped[int] = mapped_column(
        ForeignKey("contractors.id"), nullable=False, index=True
    )
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        String(20), default="Open", nullable=False
    )  # Open | Completed
    remarks: Mapped[str | None] = mapped_column(Text)

    contractor = relationship("Contractor")
    tasks: Mapped[list[HcTask]] = relationship(
        back_populates="assignment", lazy="selectin"
    )


class HcTask(Base):
    """One site inside an HC assignment. Independent per-site result."""

    __tablename__ = "hc_tasks"
    __table_args__ = (
        UniqueConstraint("hc_assignment_id", "work_item_id", name="uq_hc_task_site"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hc_assignment_id: Mapped[int] = mapped_column(
        ForeignKey("hc_assignments.id"), nullable=False, index=True
    )
    work_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_items.id"), nullable=False, index=True
    )
    # Which pass this is for the site. 1 = first ever check; a site that failed,
    # was fixed by its category owners and came back for re-check gets 2, 3, …
    # Round 3+ is treated as an exception and surfaced to the PM.
    round_no: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # Auto-computed from the technology rows: None (pending) | Ready | NotReady
    overall_result: Mapped[str | None] = mapped_column(String(20))
    # Only set when NotReady — one of the 4 predefined problem categories.
    # Set by a Coordinator/PM during validation (NOT by the subcontractor).
    problem_category: Mapped[str | None] = mapped_column(String(120))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Coordinator/PM validation of the subcontractor's result. A Ready site
    # needs no category; a Not-Ready site is validated by assigning it one of
    # the four problem categories. reviewed_at marks that validation is done.
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    assignment: Mapped[HcAssignment] = relationship(back_populates="tasks")
    work_item = relationship("WorkItem", back_populates="hc_tasks")
    technologies: Mapped[list[HcTaskTechnology]] = relationship(
        back_populates="task", lazy="selectin", cascade="all, delete-orphan"
    )
    remediations: Mapped[list[HcRemediation]] = relationship(
        back_populates="task", lazy="selectin", cascade="all, delete-orphan"
    )


class HcRemediation(Base):
    """One owned fix for a Not-Ready site: a category, an owner, and a clock.

    This is what turns a problem *label* into work someone is accountable for.
    A site can fail for more than one reason, so a single HC task may carry
    several remediations — one per category — worked in parallel by different
    owner roles. The site only returns to the health-check basket once every
    one of them is closed (see ``services/health_check.maybe_return_to_basket``).

    ``owner_role_id`` is copied from the category at creation time rather than
    read through the category every time: re-pointing a category at a different
    role later must not silently reassign fixes that are already in flight.
    """

    __tablename__ = "hc_remediations"
    __table_args__ = (
        UniqueConstraint(
            "hc_task_id", "problem_category_id", name="uq_hc_remediation_task_category"
        ),
    )

    STATUS_OPEN = "Open"
    STATUS_FIXED = "Fixed"

    id: Mapped[int] = mapped_column(primary_key=True)
    hc_task_id: Mapped[int] = mapped_column(
        ForeignKey("hc_tasks.id"), nullable=False, index=True
    )
    # Denormalised from the task so an owner's queue can filter by site without
    # joining through hc_tasks on every request.
    work_item_id: Mapped[int] = mapped_column(
        ForeignKey("work_items.id"), nullable=False, index=True
    )
    problem_category_id: Mapped[int] = mapped_column(
        ForeignKey("problem_categories.id"), nullable=False, index=True
    )
    owner_role_id: Mapped[int | None] = mapped_column(
        ForeignKey("roles.id"), index=True
    )

    status: Mapped[str] = mapped_column(String(20), default=STATUS_OPEN, nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    resolution_note: Mapped[str | None] = mapped_column(Text)

    # "Not my area": the owner proposes a different category and gives a
    # reason; a PM approves or rejects. Kept on the same row (rather than a
    # separate table) so the proposal travels with the fix it disputes, and so
    # a rejected proposal leaves an auditable trace instead of vanishing.
    reroute_to_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("problem_categories.id")
    )
    reroute_reason: Mapped[str | None] = mapped_column(Text)
    reroute_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reroute_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    task: Mapped[HcTask] = relationship(back_populates="remediations")
    category = relationship("ProblemCategory", foreign_keys=[problem_category_id])
    reroute_to_category = relationship(
        "ProblemCategory", foreign_keys=[reroute_to_category_id]
    )
    owner_role = relationship("Role")

    @property
    def is_open(self) -> bool:
        return self.closed_at is None


class HcTaskTechnology(Base):
    """Per-technology result for one HC task. Only requested techs exist here."""

    __tablename__ = "hc_task_technologies"
    __table_args__ = (
        UniqueConstraint("hc_task_id", "technology", name="uq_hc_task_tech"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hc_task_id: Mapped[int] = mapped_column(
        ForeignKey("hc_tasks.id"), nullable=False, index=True
    )
    technology: Mapped[str] = mapped_column(String(10), nullable=False)  # 2G|3G|4G
    result: Mapped[str | None] = mapped_column(String(20))  # Normal|NotNormal|None
    reason_category: Mapped[str | None] = mapped_column(String(120))
    comment: Mapped[str | None] = mapped_column(Text)

    task: Mapped[HcTask] = relationship(back_populates="technologies")
