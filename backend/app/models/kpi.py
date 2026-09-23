"""Province ownership over time, for the KPI & Performance page.

``provinces`` already carries ``coordinator_user_id`` and
``regional_manager_user_id``, set by Admin. This table is deliberately not that.
It answers a different question and answers it differently:

* it records **names**, not user accounts, because the four KPI lenses group by
  a person whether or not that person has ever signed in;
* it carries the **CRA region**, which exists nowhere else (``regions`` holds
  CPM's ``منطقه``, an operational region per site, which is a different thing);
* it is **effective-dated**, so a reassignment does not rewrite history. Past
  results stay with the owner who held the province at the time.

The two are left side by side rather than merged, because merging them would
change who may edit the existing Admin screen and what the reports reading it
see — neither of which this feature was asked to touch.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ProvinceMapping(Base):
    """One province's owners over one period of time.

    ``effective_to`` NULL means "current". At most one row per province may be
    current at a time, which the partial unique index below is what actually
    guarantees — the service checks it too, but a check-then-insert is not a
    guarantee, and two current rows would make every lens count that province
    twice.
    """

    __tablename__ = "province_mapping"
    __table_args__ = (
        # Every read is either "the current row for this province" or "the
        # current rows for this person", and both start from the open rows.
        Index("ix_province_mapping_province", "province_fa", "effective_to"),
        Index(
            "uq_province_mapping_one_open",
            "province_fa",
            unique=True,
            postgresql_where=text("effective_to IS NULL"),
            sqlite_where=text("effective_to IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    # The exact Persian string ``provinces.name`` holds, which is what the CPM
    # import wrote. The KPI queries join on it, so it is the load-bearing one.
    province_fa: Mapped[str] = mapped_column(String(100), nullable=False)
    # The same province as the KPI page shows it. The page is English and
    # left-to-right, and translating in the frontend would put the mapping in a
    # second place.
    province_en: Mapped[str] = mapped_column(String(100), nullable=False)

    cra_region: Mapped[str] = mapped_column(String(60), nullable=False)
    pso_coordinator: Mapped[str] = mapped_column(String(120), nullable=False)
    regional_manager: Mapped[str] = mapped_column(String(120), nullable=False)

    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)

    @property
    def is_current(self) -> bool:
        return self.effective_to is None
