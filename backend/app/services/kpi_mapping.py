"""Reading and changing province ownership, for the KPI mapping screen.

``province_mapping`` is effective-dated, so there are two different edits and
they must not be confused:

* **Reassignment** — a province genuinely changes hands. The open row is closed
  and a new one opened. Past results stay with the previous owner, which is the
  whole reason the table carries dates at all.
* **Correction** — the row was typed wrong. There was never a period during
  which the old value was true, so writing history would record a handover that
  never happened. The row is edited in place.

The API exposes them as POST and PUT respectively. Both are PM-only; that guard
lives on the endpoints, not here.

Intervals are half-open: a row is in force from ``effective_from`` up to but not
including ``effective_to``. That is what lets a reassignment on day D close the
old row at D and open the new one at D with no gap and no overlap, including
when a province is reassigned twice in one day.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.province_directory import PROVINCE_DIRECTORY
from app.models.kpi import ProvinceMapping
from app.models.reference import User
from app.services.kpi import LENS_COORDINATOR, LENS_RM

#: Which mapping column each role's ``kpi_person_name`` is matched against.
PERSON_COLUMN_BY_LENS = {
    LENS_RM: ProvinceMapping.regional_manager,
    LENS_COORDINATOR: ProvinceMapping.pso_coordinator,
}


def current_rows(db: Session) -> list[ProvinceMapping]:
    """Every province's current owners, in the page's display order."""
    return list(
        db.execute(
            select(ProvinceMapping)
            .where(ProvinceMapping.effective_to.is_(None))
            .order_by(ProvinceMapping.province_en)
        ).scalars().all()
    )


def history(db: Session, province_fa: str) -> list[ProvinceMapping]:
    """One province's rows, oldest first, closed rows included."""
    return list(
        db.execute(
            select(ProvinceMapping)
            .where(ProvinceMapping.province_fa == province_fa)
            .order_by(ProvinceMapping.effective_from, ProvinceMapping.id)
        ).scalars().all()
    )


def get_open_row(db: Session, mapping_id: int) -> ProvinceMapping:
    row = db.get(ProvinceMapping, mapping_id)
    if row is None:
        raise HTTPException(404, "No such province mapping")
    if row.effective_to is not None:
        raise HTTPException(
            422,
            "That mapping row is closed. Change the province's current row instead.",
        )
    return row


def reassign(
    db: Session,
    row: ProvinceMapping,
    *,
    cra_region: str,
    pso_coordinator: str,
    regional_manager: str,
    effective_from: date,
) -> ProvinceMapping:
    """Close the open row and open a new one. Caller commits.

    Refuses a start date earlier than the row it is replacing: that would put
    two rows in force at once for part of their life, and every lens would then
    count the province twice for that period.
    """
    if effective_from < row.effective_from:
        raise HTTPException(
            422,
            "The new assignment cannot start before the one it replaces "
            f"(which starts {row.effective_from.isoformat()})",
        )

    row.effective_to = effective_from
    fresh = ProvinceMapping(
        province_fa=row.province_fa,
        province_en=row.province_en,
        cra_region=cra_region.strip(),
        pso_coordinator=pso_coordinator.strip(),
        regional_manager=regional_manager.strip(),
        effective_from=effective_from,
        effective_to=None,
    )
    db.add(fresh)
    db.flush()
    return fresh


def correct(
    db: Session,
    row: ProvinceMapping,
    *,
    cra_region: str,
    pso_coordinator: str,
    regional_manager: str,
) -> ProvinceMapping:
    """Fix the current row in place, writing no history. Caller commits."""
    row.cra_region = cra_region.strip()
    row.pso_coordinator = pso_coordinator.strip()
    row.regional_manager = regional_manager.strip()
    db.flush()
    return row


def people_summary(db: Session) -> dict[str, list[dict]]:
    """Provinces per coordinator and per regional manager, for the side panel.

    This is a count of provinces, not a comparison of people. Nothing here
    ranks anybody: the rows are in name order.
    """
    rows = current_rows(db)

    def group(attribute: str) -> list[dict]:
        buckets: dict[str, list[str]] = {}
        for row in rows:
            buckets.setdefault(getattr(row, attribute), []).append(row.province_en)
        return [
            {"name": name, "provinces": sorted(provinces), "count": len(provinces)}
            for name, provinces in sorted(buckets.items())
        ]

    return {
        "coordinators": group("pso_coordinator"),
        "regional_managers": group("regional_manager"),
        "cra_regions": group("cra_region"),
    }


def known_names(db: Session, lens: str) -> list[str]:
    """The names a user account may be linked to, for one lens."""
    column = PERSON_COLUMN_BY_LENS[lens]
    return list(
        db.execute(
            select(column)
            .where(ProvinceMapping.effective_to.is_(None))
            .distinct()
            .order_by(column)
        ).scalars().all()
    )


def set_person_name(db: Session, account: User, name: str | None) -> User:
    """Link (or unlink) a user account to a person in the mapping.

    The name is checked against the mapping for that account's role, because a
    name with a typo in it produces an account whose KPI page is empty with no
    explanation — the request simply matches no province.
    """
    from app.core.deps import COORDINATOR, REGIONAL

    lens = {REGIONAL: LENS_RM, COORDINATOR: LENS_COORDINATOR}.get(account.role.name)
    if lens is None:
        raise HTTPException(
            422,
            "Only Regional Manager and Coordinator accounts are linked this way. "
            "A contractor account is linked through its contractor.",
        )

    if name is None or not name.strip():
        account.kpi_person_name = None
        db.flush()
        return account

    cleaned = name.strip()
    column = PERSON_COLUMN_BY_LENS[lens]
    match = db.execute(
        select(column).where(
            ProvinceMapping.effective_to.is_(None),
            func.lower(column) == cleaned.lower(),
        )
    ).scalars().first()
    if match is None:
        raise HTTPException(422, f"No province is currently mapped to {cleaned!r}")

    # Store it exactly as the mapping spells it, so the two never differ by a
    # capital letter.
    account.kpi_person_name = match
    db.flush()
    return account


def unmapped_cpm_provinces(db: Session) -> list[str]:
    """Province names in the platform that this mapping does not cover.

    The CPM import only ever creates one of the 31 canonical provinces, so in
    normal operation this is empty. It is reported anyway: if it is ever
    non-empty, those provinces belong to nobody and their villages would appear
    in the country total and in no one's lens.
    """
    from app.models.reference import Province

    mapped = {row.province_fa for row in current_rows(db)}
    known = {row.fa for row in PROVINCE_DIRECTORY}
    present = set(db.execute(select(Province.name)).scalars().all())
    return sorted(present - mapped - known)
