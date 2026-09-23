"""KPI & Performance endpoints.

Every route here re-checks the role and re-derives the scope from the signed-in
account. Nothing trusts ``lens`` or ``key`` from the query string except for a
PM, who is the only role allowed to look at somebody else's numbers. A request
for data outside the caller's scope is a 403, not an empty result — an empty
result reads as "there is nothing there", which is a different and misleading
answer.

Admin is refused everywhere in this module. That is deliberate and is the
product owner's rule: Admin administers the platform and has no business in the
delivery numbers.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.database import get_db
from app.core.deps import COORDINATOR, PM, REGIONAL, get_current_user, require_roles
from app.models.reference import User
from app.schemas import (
    KpiLinkableUser,
    KpiPersonLink,
    ProvinceMappingOut,
    ProvinceMappingReassign,
    ProvinceMappingWrite,
)
from app.services import kpi, kpi_export, kpi_mapping
from app.services.audit import record_audit

router = APIRouter(prefix="/kpi", tags=["kpi"])

_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _lens_key(
    lens: str | None = Query(
        None, description="rm | coordinator | contractor | region (PM only)"
    ),
    key: str | None = Query(None, description="The person, region or contractor"),
) -> tuple[str | None, str | None]:
    return lens, key


@router.get("/summary")
def kpi_summary(
    lens_key: tuple[str | None, str | None] = Depends(_lens_key),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """The whole page for one scope: both funnels, the heatmap, the country
    benchmark, and when CPM was last imported."""
    lens, key = lens_key
    return kpi.summary(db, user, lens, key)


@router.get("/lenses")
def kpi_lenses(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """What the lens row may offer this user.

    For PM, every person behind each of the four lenses. For everyone else,
    only their own — the page shows it as a fixed chip, and the server would
    refuse anything else anyway.
    """
    kpi.require_kpi_access(user)
    if user.role.name == PM:
        return {
            "selectable": True,
            "options": {lens: kpi.lens_options(db, lens) for lens in kpi.LENSES},
        }
    scope = kpi.resolve_scope(db, user, None, None)
    return {"selectable": False, "options": {scope.lens: [scope.key]}, "lens": scope.lens, "key": scope.key}


@router.get("/contractors")
def kpi_contractors(
    key: str | None = Query(None, description="The PSO coordinator"),
    mode: str = Query("ict", description="ict | cra"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Per-contractor acceptance progress inside one coordinator's regions.

    PM and PSO Coordinator only. A Regional Manager or a Contractor asking for
    this gets a 403 — the brief hides contractor comparison from both.
    """
    return kpi.contractors(db, user, key, mode)


@router.get("/export.xlsx")
def kpi_export_xlsx(
    lens_key: tuple[str | None, str | None] = Depends(_lens_key),
    mode: str = Query("ict", description="Which mode the contractors sheet uses"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The same page as a workbook. Built from the same service call the screen
    makes, so a number in the file cannot differ from the one on screen."""
    lens, key = lens_key
    payload = kpi.summary(db, user, lens, key)
    contractor_block = _contractor_block(db, user, payload, mode)
    content = kpi_export.build_workbook(payload, contractor_block)
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{kpi_export.filename(payload, "xlsx")}"'
            )
        },
    )


@router.get("/export.pdf")
def kpi_export_pdf(
    lens_key: tuple[str | None, str | None] = Depends(_lens_key),
    mode: str = Query("ict", description="Which mode the contractors table uses"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The same page as an A4 landscape PDF, from the same service call."""
    lens, key = lens_key
    payload = kpi.summary(db, user, lens, key)
    contractor_block = _contractor_block(db, user, payload, mode)
    content = kpi_export.build_pdf(payload, contractor_block)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{kpi_export.filename(payload, "pdf")}"'
            )
        },
    )


def _contractor_block(db: Session, user: User, payload: dict, mode: str) -> dict | None:
    """The contractors table, but only where the screen would show one.

    The export must contain exactly what the screen shows, so this mirrors the
    page's rule rather than inventing its own: the section exists under the
    coordinator lens, for the roles allowed to see it, and nowhere else.
    """
    if payload["lens"] != kpi.LENS_COORDINATOR:
        return None
    if user.role.name not in (PM, COORDINATOR):
        return None
    return kpi.contractors(db, user, payload["key"], mode)


# ----- Mapping (PM only) --------------------------------------------------


@router.get("/mapping")
def get_mapping(
    include_history: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(PM)),
) -> dict:
    """The 31 provinces and who currently owns each, plus the side panel.

    PM only. Admin is excluded here as well as from the page: the brief gives
    this data to the PM alone.
    """
    rows = kpi_mapping.current_rows(db)
    payload = {
        "rows": [ProvinceMappingOut.model_validate(r).model_dump() for r in rows],
        "people": kpi_mapping.people_summary(db),
        "unmapped_provinces": kpi_mapping.unmapped_cpm_provinces(db),
        "last_cpm_import": kpi.last_cpm_import(db),
    }
    if include_history:
        payload["history"] = {
            row.province_fa: [
                ProvinceMappingOut.model_validate(h).model_dump()
                for h in kpi_mapping.history(db, row.province_fa)
            ]
            for row in rows
        }
    return payload


@router.put("/mapping/{mapping_id}", response_model=ProvinceMappingOut)
def correct_mapping(
    mapping_id: int,
    payload: ProvinceMappingWrite,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM)),
) -> ProvinceMappingOut:
    """Correct the current row in place, writing no history.

    For a row that was typed wrong. Use POST for a real handover — there was
    never a period during which a typo was true, and recording one as a
    reassignment would invent a handover that never happened.
    """
    row = kpi_mapping.get_open_row(db, mapping_id)
    before = _snapshot(row)
    kpi_mapping.correct(
        db,
        row,
        cra_region=payload.cra_region,
        pso_coordinator=payload.pso_coordinator,
        regional_manager=payload.regional_manager,
    )
    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.UPDATED,
        module="KPI",
        entity_type="ProvinceMapping",
        entity_id=row.id,
        old_value=before,
        new_value=_snapshot(row),
        reason="Corrected in place (no handover)",
    )
    db.commit()
    db.refresh(row)
    return ProvinceMappingOut.model_validate(row)


@router.post("/mapping/{mapping_id}/reassign", response_model=ProvinceMappingOut)
def reassign_mapping(
    mapping_id: int,
    payload: ProvinceMappingReassign,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM)),
) -> ProvinceMappingOut:
    """Hand a province over: close the current row, open a new one."""
    row = kpi_mapping.get_open_row(db, mapping_id)
    before = _snapshot(row)
    fresh = kpi_mapping.reassign(
        db,
        row,
        cra_region=payload.cra_region,
        pso_coordinator=payload.pso_coordinator,
        regional_manager=payload.regional_manager,
        effective_from=payload.effective_from or date.today(),
    )
    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.ASSIGNED,
        module="KPI",
        entity_type="ProvinceMapping",
        entity_id=fresh.id,
        old_value=before,
        new_value=_snapshot(fresh),
        reason=f"Province reassigned from {fresh.effective_from.isoformat()}",
    )
    db.commit()
    db.refresh(fresh)
    return ProvinceMappingOut.model_validate(fresh)


@router.get("/mapping/links", response_model=list[KpiLinkableUser])
def list_links(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(PM)),
) -> list[KpiLinkableUser]:
    """Every Regional Manager and Coordinator account, and who it is linked to.

    An unlinked account is refused the KPI page, so this list is how a PM sees
    which ones still need linking.
    """
    accounts = db.execute(
        select(User).join(User.role).where(
            User.role.has(name=REGIONAL) | User.role.has(name=COORDINATOR)
        ).order_by(User.first_name, User.family_name)
    ).scalars().all()
    return [
        KpiLinkableUser(
            id=a.id,
            username=a.username,
            full_name=a.full_name,
            role_name=a.role.name,
            kpi_person_name=a.kpi_person_name,
        )
        for a in accounts
    ]


@router.put("/mapping/links/{user_id}", response_model=KpiLinkableUser)
def set_link(
    user_id: int,
    payload: KpiPersonLink,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(PM)),
) -> KpiLinkableUser:
    """Point a user account at a name in the mapping, or clear it."""
    account = db.get(User, user_id)
    if account is None:
        raise HTTPException(404, "No such user")
    before = account.kpi_person_name
    kpi_mapping.set_person_name(db, account, payload.kpi_person_name)
    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.USER_UPDATED,
        module="KPI",
        entity_type="User",
        entity_id=account.id,
        old_value={"kpi_person_name": before},
        new_value={"kpi_person_name": account.kpi_person_name},
        reason="KPI person link changed",
    )
    db.commit()
    db.refresh(account)
    return KpiLinkableUser(
        id=account.id,
        username=account.username,
        full_name=account.full_name,
        role_name=account.role.name,
        kpi_person_name=account.kpi_person_name,
    )


@router.get("/mapping/names")
def mapping_names(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(PM)),
) -> dict:
    """The distinct names currently in use, to offer in the link picker."""
    return {
        "regional_managers": kpi_mapping.known_names(db, kpi.LENS_RM),
        "coordinators": kpi_mapping.known_names(db, kpi.LENS_COORDINATOR),
    }


def _snapshot(row) -> dict:
    return {
        "province_fa": row.province_fa,
        "cra_region": row.cra_region,
        "pso_coordinator": row.pso_coordinator,
        "regional_manager": row.regional_manager,
        "effective_from": row.effective_from.isoformat(),
        "effective_to": row.effective_to.isoformat() if row.effective_to else None,
    }
