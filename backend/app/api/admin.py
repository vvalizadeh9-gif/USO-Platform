"""Admin module endpoints: CPM import, user management, CPM validation."""
import logging
import os
from datetime import date as date_type, datetime, time, timedelta, timezone
from pathlib import Path

from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import ADMIN, COORDINATOR, PM, require_roles
from app.core.security import hash_password
from app.models.acceptance import AuditLog, CpmChangeRequest, CpmImportBatch
from app.models.reference import Contractor, Province, Role, User, user_province_access
from app.models.workitem import WorkItem
from app.schemas import (
    AdminStatsOut,
    AuditLogListOut,
    AuditLogOut,
    CpmChangeRequestOut,
    CpmDecisionRequest,
    CpmImportSummary,
    CpmWipeRequest,
    CpmWipeResult,
    LastCpmImportOut,
    SystemHealthOut,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services.audit import record_audit
from app.services.cpm_import import CpmImportService
from app.services import evidence_store
from app.services.data_wipe import REQUIRED_CONFIRMATION_PHRASE, wipe_cpm_data

logger = logging.getLogger("uep.admin")

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()

_ALEMBIC_DIR = str(Path(__file__).resolve().parents[2] / "alembic")


# ---------------- Tab 1: CPM Import ----------------
@router.post("/cpm/import", response_model=CpmImportSummary)
def import_cpm(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN)),
):
    """Upload and process a monthly CPM Excel file."""
    if not (file.filename or "").lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files are accepted")

    # Read with a ceiling before anything touches the disk. The workbook was
    # previously streamed straight to a file with no size limit at all, so the
    # only bound on it was nginx's.
    try:
        content = evidence_store.read_capped(file.file)
    except evidence_store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from None
    if not content:
        raise HTTPException(400, "The file is empty")

    os.makedirs(settings.upload_dir, exist_ok=True)
    # safe_filename, because file.filename is supplied by the caller and lands
    # in a path. "../../app/x.xlsx" escaped the uploads directory, and /app is
    # owned by the user this container runs as -- so this was a route from an
    # admin account to overwriting application code.
    dest = os.path.join(
        settings.upload_dir,
        f"cpm_{datetime.now(timezone.utc):%Y%m%d%H%M%S}_"
        f"{evidence_store.safe_filename(file.filename or '')}",
    )
    with open(dest, "wb") as buffer:
        buffer.write(content)

    service = CpmImportService(db, user_id=user.id)
    try:
        batch = service.import_file(dest, file.filename)
    except Exception as exc:
        # A file that is not the workbook it claims to be reached pandas and
        # came back as an unhandled 500 with a stack trace -- BadZipFile for
        # anything that is not really an .xlsx, or a KeyError for a real
        # workbook without the expected sheet. Neither is a server fault; both
        # are "that file is not the one we need", and the person who picked it
        # is the one who can fix it.
        db.rollback()
        os.unlink(dest) if os.path.exists(dest) else None
        # "filename" is a reserved LogRecord attribute; using it raises inside
        # the logger itself, turning a handled 400 back into an unhandled 500.
        logger.warning(
            "CPM import rejected",
            extra={"upload_filename": file.filename, "error": str(exc)},
        )
        raise HTTPException(
            400,
            "That file could not be read as a CPM workbook. Check it is the "
            "monthly CPM Excel file and that it opens correctly.",
        ) from None
    return batch


@router.get("/cpm/import-history", response_model=list[CpmImportSummary])
def cpm_import_history(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """List past CPM import batches, most recent first, for the history panel."""
    return (
        db.query(CpmImportBatch)
        .order_by(CpmImportBatch.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/cpm/wipe-data", response_model=CpmWipeResult)
def wipe_cpm_import_data(
    payload: CpmWipeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN)),
):
    """Erase all CPM-imported data (sites, work items, villages, acceptances,
    letters, import history, monthly snapshots). Users, roles, contractors,
    provinces, and problem categories are preserved.

    Requires the exact confirmation phrase to guard against accidental calls,
    including direct API calls that bypass the UI's confirmation dialog.
    """
    if payload.confirm != REQUIRED_CONFIRMATION_PHRASE:
        raise HTTPException(
            400,
            f"Confirmation phrase did not match. Expected exactly: "
            f"'{REQUIRED_CONFIRMATION_PHRASE}'",
        )

    deleted = wipe_cpm_data(db)
    total = sum(deleted.values())

    record_audit(
        db,
        user_id=user.id,
        module="Admin",
        entity_type="CpmDataWipe",
        entity_id=None,
        new_value=deleted,
        reason="Manual CPM data wipe requested from Admin Console",
    )
    db.commit()

    return CpmWipeResult(deleted=deleted, total_deleted=total)


# ---------------- Tab 3: Validate CPM ----------------
@router.get("/cpm/change-requests", response_model=list[CpmChangeRequestOut])
def list_change_requests(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN, PM)),
):
    """List pending CPM change requests awaiting a decision."""
    return (
        db.query(CpmChangeRequest)
        .filter(CpmChangeRequest.status == "Pending")
        .order_by(CpmChangeRequest.id.desc())
        .all()
    )


@router.get("/cpm/change-requests/count")
def pending_change_request_count(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN, PM, COORDINATOR)),
):
    """Count of pending CPM change requests, for the Validate CPM badge."""
    count = (
        db.query(CpmChangeRequest)
        .filter(CpmChangeRequest.status == "Pending")
        .count()
    )
    return {"pending": count}


@router.post("/cpm/change-requests/{cr_id}/decide")
def decide_change_request(
    cr_id: int,
    payload: CpmDecisionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(ADMIN, PM)),
):
    """Accept / Ignore / Archive a CPM change request.

    Accept applies the new value to the work item; the others just close it.
    """
    cr = db.get(CpmChangeRequest, cr_id)
    if cr is None:
        raise HTTPException(404, "Change request not found")
    if cr.status != "Pending":
        raise HTTPException(400, "Change request already decided")

    if payload.decision == "Accepted":
        from app.services.cpm_apply import apply_change_request

        apply_change_request(db, cr)

    cr.status = payload.decision
    cr.decided_by = user.id
    cr.decided_at = datetime.now(timezone.utc)
    record_audit(
        db, user_id=user.id, module="CPM", entity_type="CpmChangeRequest",
        entity_id=cr.id, new_value={"decision": payload.decision},
    )
    db.commit()
    return {"status": "ok"}


# ---------------- Tab 2: User Management ----------------
@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db), _: User = Depends(require_roles(ADMIN))
):
    return db.query(User).order_by(User.id).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(400, "Username already exists")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role_id=payload.role_id,
        contractor_id=payload.contractor_id,
        sees_all_provinces=payload.sees_all_provinces,
    )
    _set_provinces(db, user, payload.province_ids)
    db.add(user)
    db.flush()
    record_audit(
        db, user_id=admin.id, module="Admin", entity_type="User",
        entity_id=user.id, new_value={"username": user.username},
    )
    db.commit()
    db.refresh(user)
    return user


def _guard_deactivation(db: Session, user: User, admin: User) -> None:
    """Refuse the two deactivations that would lock people out.

    Shared by DELETE /users/{id} and by PATCH with ``active=false``, because
    both now do exactly the same thing.
    """
    if user.id == admin.id:
        raise HTTPException(400, "You cannot deactivate your own account.")
    if user.role and user.role.name == ADMIN:
        other_admins = (
            db.query(User)
            .join(User.role)
            .filter(Role.name == ADMIN, User.id != user.id, User.active.is_(True))
            .count()
        )
        if other_admins == 0:
            raise HTTPException(400, "Cannot deactivate the last administrator.")


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        # Ends every session this account already has. Resetting a password is
        # the standard response to a compromised account, and until this line
        # existed it left the attacker's token working for another eight hours.
        user.token_version += 1
    if payload.role_id is not None:
        user.role_id = payload.role_id
    # contractor_id needs special handling: None is a valid value here
    # (clearing the contractor when a user's role changes away from
    # Contractor). "is not None" would silently ignore that clear, so we
    # check whether the field was explicitly sent instead.
    if "contractor_id" in payload.model_fields_set:
        user.contractor_id = payload.contractor_id
    if payload.sees_all_provinces is not None:
        user.sees_all_provinces = payload.sees_all_provinces
    if payload.active is not None:
        # Keep the deactivation record consistent with the flag, so an account
        # that is active never carries a stale "deactivated by X on Y".
        if payload.active and not user.active:
            user.deactivated_at = None
            user.deactivated_by = None
        elif not payload.active and user.active:
            # Setting active=false here does the same thing as DELETE, so it
            # has to be protected the same way -- otherwise the guards are a
            # lock on one door of two.
            _guard_deactivation(db, user, admin)
            user.deactivated_at = datetime.now(timezone.utc)
            user.deactivated_by = admin.id
        user.active = payload.active
    if payload.province_ids is not None:
        _set_provinces(db, user, payload.province_ids)

    record_audit(
        db, user_id=admin.id, module="Admin", entity_type="User",
        entity_id=user.id, reason="User updated",
    )
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    """Deactivate a user. The row is kept.

    This endpoint used to call ``db.delete(user)``. It no longer removes
    anything, because user rows are referenced by ``audit_logs.user_id``,
    ``hc_tasks.reviewed_by``, ``work_items.coordinator_reviewed_by`` and
    ``work_items.pm_reviewed_by``. Deleting a reviewer turned every health check
    they had signed off into one reviewed by nobody -- the accountability trail
    went anonymous exactly where it mattered most. Over a ten-year platform,
    staff turnover guarantees that happens.

    After deactivation the account cannot sign in and receives no new
    notifications, but their name still resolves everywhere it already appears.
    An Admin can reactivate the account later by setting ``active`` back to true.

    Province assignments are deliberately left in place, so reactivating
    restores the person's original access rather than silently giving them none.

    Guards are unchanged: an admin cannot deactivate their own account, and the
    last remaining active admin cannot be deactivated (which would lock everyone
    out of the platform).
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    _guard_deactivation(db, user, admin)

    username = user.username
    if not user.active:
        # Already deactivated. Return success without moving the timestamp, so
        # the audit trail keeps pointing at whoever actually did it.
        return {"status": "ok", "deactivated": username}

    user.active = False
    user.deactivated_at = datetime.now(timezone.utc)
    user.deactivated_by = admin.id
    record_audit(
        db, user_id=admin.id, module="Admin", entity_type="User",
        entity_id=user_id, reason=f"User '{username}' deactivated",
    )
    db.commit()
    return {"status": "ok", "deactivated": username}


# ---------------- Admin Dashboard ----------------
@router.get("/stats", response_model=AdminStatsOut)
def admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """Headline user/contractor counts for the Admin console overview."""
    active_users_count = db.query(User).filter(User.active.is_(True)).count()
    active_contractors_count = (
        db.query(Contractor).filter(Contractor.active.is_(True)).count()
    )

    role_counts = (
        db.query(Role.name, func.count(User.id))
        .join(User, User.role_id == Role.id)
        .group_by(Role.name)
        .all()
    )
    users_by_role = {name: count for name, count in role_counts}

    users_with_access = select(user_province_access.c.user_id).distinct()
    users_without_province_access = (
        db.query(User)
        .filter(
            User.active.is_(True),
            User.sees_all_provinces.is_(False),
            User.id.not_in(users_with_access),
        )
        .count()
    )

    dormant_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    dormant_users = (
        db.query(User)
        .filter(
            User.active.is_(True),
            or_(User.last_login_at.is_(None), User.last_login_at < dormant_cutoff),
        )
        .count()
    )

    return AdminStatsOut(
        active_users_count=active_users_count,
        active_contractors_count=active_contractors_count,
        users_by_role=users_by_role,
        users_without_province_access=users_without_province_access,
        dormant_users=dormant_users,
    )


@router.get("/system-health", response_model=SystemHealthOut)
def system_health(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """DB reachability, Alembic migration state, and CPM import freshness."""
    try:
        db.execute(select(1))
        db_status = "ok"
    except Exception:
        db.rollback()
        db_status = "error"

    try:
        current_revision = db.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar()
    except Exception:
        db.rollback()
        current_revision = None

    head_revision = ScriptDirectory(_ALEMBIC_DIR).get_current_head()

    last_batch = (
        db.query(CpmImportBatch)
        .order_by(CpmImportBatch.created_at.desc())
        .first()
    )
    last_cpm_import = None
    if last_batch is not None:
        importer = (
            db.get(User, last_batch.imported_by)
            if last_batch.imported_by is not None
            else None
        )
        last_cpm_import = LastCpmImportOut(
            filename=last_batch.filename,
            imported_by=importer.full_name if importer else None,
            created_at=last_batch.created_at,
            total_rows=last_batch.total_rows,
            new_count=last_batch.new_count,
            changed_count=last_batch.changed_count,
        )

    pending_change_requests_count = (
        db.query(CpmChangeRequest).filter(CpmChangeRequest.status == "Pending").count()
    )

    return SystemHealthOut(
        db_status=db_status,
        alembic_current_revision=current_revision,
        alembic_head_revision=head_revision,
        alembic_mismatch=current_revision != head_revision,
        last_cpm_import=last_cpm_import,
        pending_change_requests_count=pending_change_requests_count,
    )


@router.get("/audit-logs", response_model=AuditLogListOut)
def list_audit_logs(
    # Bounded, unlike before. audit_logs is the table that grows fastest over a
    # ten-year deployment, and it was the one endpoint that would hand back as
    # much of it as a single request asked for.
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    module: str | None = None,
    entity_type: str | None = None,
    user_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """Paginated, filterable view of the append-only audit log."""
    query = db.query(AuditLog)
    if module is not None:
        query = query.filter(AuditLog.module == module)
    if entity_type is not None:
        query = query.filter(AuditLog.entity_type == entity_type)
    if user_id is not None:
        query = query.filter(AuditLog.user_id == user_id)
    if date_from is not None:
        query = query.filter(
            AuditLog.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        )
    if date_to is not None:
        query = query.filter(
            AuditLog.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        )

    total_count = query.count()
    rows = query.order_by(AuditLog.id.desc()).offset(offset).limit(limit).all()

    user_ids = {r.user_id for r in rows if r.user_id is not None}
    names_by_id = {}
    if user_ids:
        names_by_id = {
            u.id: u.full_name
            for u in db.query(User).filter(User.id.in_(user_ids)).all()
        }

    items = [
        AuditLogOut(
            id=r.id,
            user_id=r.user_id,
            user_full_name=names_by_id.get(r.user_id),
            module=r.module,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            old_value=r.old_value,
            new_value=r.new_value,
            reason=r.reason,
            ip_address=r.ip_address,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return AuditLogListOut(total_count=total_count, items=items)


def _set_provinces(db: Session, user: User, province_ids: list[int]) -> None:
    """Replace the user's province grants with the given list."""
    provinces = (
        db.query(Province).filter(Province.id.in_(province_ids)).all()
        if province_ids
        else []
    )
    user.provinces = provinces
