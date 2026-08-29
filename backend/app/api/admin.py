"""Admin module endpoints: CPM import, user management, CPM validation."""
import logging
import os
from datetime import date as date_type, datetime, time, timedelta, timezone
from pathlib import Path

from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.core import audit_actions, user_status
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import ADMIN, COORDINATOR, PM, require_roles
from app.core.passwords import PasswordError, validate_password
from app.core.security import generate_temporary_password, hash_password
from app.models.acceptance import AuditLog, CpmChangeRequest, CpmImportBatch
from app.models.auth import PasswordResetRequest
from app.models.reference import Contractor, Province, Role, User, user_province_access
from app.schemas import (
    AdminPasswordReset,
    AdminPasswordResetResult,
    AdminStatsOut,
    AuditLogListOut,
    AuditLogOut,
    CpmChangeRequestOut,
    CpmDecisionRequest,
    CpmImportSummary,
    CpmWipeRequest,
    CpmWipeResult,
    LastCpmImportOut,
    PasswordResetRequestDecision,
    PasswordResetRequestOut,
    SystemHealthOut,
    UserCreate,
    UserOut,
    UserStatusChange,
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
        action=audit_actions.DATA_WIPED,
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
    # Locked, not just read: the status check and the write that follows it were
    # a read-then-write with nothing between them, so two admins deciding the
    # same request at the same time both passed the check and both applied the
    # change. Harmless for an idempotent field assignment, not for anything
    # cumulative. SQLite ignores the row lock and does not need it -- one
    # writer at a time -- so this is a no-op there and real on PostgreSQL.
    cr = db.execute(
        select(CpmChangeRequest)
        .where(CpmChangeRequest.id == cr_id)
        .with_for_update()
    ).scalar_one_or_none()
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
        db, user_id=user.id,
        action=(
            audit_actions.APPROVED if payload.decision == "Accepted"
            else audit_actions.REJECTED
        ),
        module="CPM", entity_type="CpmChangeRequest",
        entity_id=cr.id, new_value={"decision": payload.decision},
    )
    db.commit()
    return {"status": "ok"}


# ---------------- Tab 2: User Management ----------------
#
# The whole of what an administrator can do to an account lives in this
# section: create, read, search, edit, move between statuses, reset the
# password, and read that person's history. Deliberately no more than that --
# no public registration, no invitation flow, no self-service role changes.
# This is an internal platform with a few dozen accounts, and every one of them
# is created by someone who knows the person.
#
# What is here is arranged so that more can be added without a redesign. Roles
# are already rows rather than an enum; province access is already a join
# table; statuses come from one module and are validated at the schema edge.
# A permissions table, when it is needed, hangs off Role without touching any
# of this.

def _user_snapshot(user: User) -> dict:
    """The audit-log view of a user row.

    Never includes ``password_hash``. The audit log is readable by every
    administrator and is kept forever; a hash in it is a hash that outlives the
    account, the password, and any reason anyone had to protect it.
    """
    return {
        "username": user.username,
        "first_name": user.first_name,
        "family_name": user.family_name,
        "email": user.email,
        "role_id": user.role_id,
        "contractor_id": user.contractor_id,
        "sees_all_provinces": user.sees_all_provinces,
        "status": user.status,
        "province_ids": sorted(p.id for p in user.provinces),
    }


def _changed(before: dict, after: dict) -> dict:
    """Only the keys that actually differ, as ``{key: [old, new]}``.

    An audit entry that stores the whole row twice is technically complete and
    practically unreadable: the reader has to diff two JSON blobs by eye to
    find the one field that moved. Both full snapshots stay in ``old_value``
    and ``new_value``; this is what the summary line is built from.
    """
    return {k: [before.get(k), after.get(k)] for k in after if before.get(k) != after.get(k)}


@router.get("/users", response_model=list[UserOut])
def list_users(
    search: str | None = Query(
        default=None,
        max_length=100,
        description="Matches name, username or email, case-insensitively.",
    ),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Active, Inactive or Suspended.",
    ),
    role_id: int | None = Query(default=None),
    # Bounded, like every other list in this API. A deployment with a few dozen
    # users will never reach the ceiling; a bug that would have selected the
    # whole table now cannot.
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """List users, optionally searched and filtered.

    Ordered by family name rather than by id, because this is a list a person
    reads to find someone. Insertion order is meaningless to them.
    """
    query = db.query(User)

    if search:
        # ILIKE-equivalent that works on SQLite too: lower() both sides rather
        # than relying on a dialect's case-insensitive operator.
        needle = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(User.first_name).like(needle),
                func.lower(User.family_name).like(needle),
                func.lower(User.username).like(needle),
                func.lower(User.email).like(needle),
            )
        )
    if status_filter:
        if status_filter not in user_status.USER_STATUSES:
            raise HTTPException(
                400,
                "Unknown status. Expected one of: "
                + ", ".join(user_status.USER_STATUSES),
            )
        query = query.filter(User.status == status_filter)
    if role_id is not None:
        query = query.filter(User.role_id == role_id)

    return (
        query.order_by(User.family_name, User.first_name, User.id)
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/users/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """One user, for the detail view."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    return user


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(400, "Username already exists")
    if payload.email and db.query(User).filter(User.email == payload.email).first():
        # Checked here as well as by the unique constraint, so the answer is a
        # sentence naming the problem rather than an IntegrityError surfacing
        # as a 500.
        raise HTTPException(400, "Another account already uses that email address")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        first_name=payload.first_name,
        family_name=payload.family_name,
        email=payload.email,
        role_id=payload.role_id,
        contractor_id=payload.contractor_id,
        sees_all_provinces=payload.sees_all_provinces,
        status=payload.status,
    )
    _set_provinces(db, user, payload.province_ids)
    db.add(user)
    db.flush()
    record_audit(
        db,
        user_id=admin.id,
        action=audit_actions.USER_CREATED,
        module="Admin",
        entity_type="User",
        entity_id=user.id,
        new_value=_user_snapshot(user),
        reason=f"Created account '{user.username}' for {user.full_name}",
    )
    db.commit()
    db.refresh(user)
    return user


def _other_active_admins(db: Session, user: User) -> int:
    return (
        db.query(User)
        .join(User.role)
        .filter(Role.name == ADMIN, User.id != user.id, User.active)
        .count()
    )


def _guard_status_change(db: Session, user: User, admin: User, new_status: str) -> None:
    """Refuse the status changes that would lock people out.

    Both guards apply to any move away from Active, not only to deactivation:
    suspending the last administrator locks the platform exactly as thoroughly
    as deactivating them, and when this only checked one of the two states the
    other was a way straight past it.
    """
    if user_status.may_sign_in(new_status):
        return
    if user.id == admin.id:
        raise HTTPException(
            400,
            "You cannot change your own account out of Active. Ask another "
            "administrator to do it.",
        )
    if user.role and user.role.name == ADMIN and _other_active_admins(db, user) == 0:
        raise HTTPException(
            400,
            "Cannot remove access from the last administrator. Give another "
            "account the Admin role first.",
        )


def _guard_role_change(db: Session, user: User, new_role_id: int) -> None:
    """Refuse a role change that would leave the platform with no administrator.

    The status guard above was a lock on one door of two. Deactivating the last
    admin was refused; changing that same account's role to Viewer was not, and
    produced exactly the same outcome -- a platform nobody can administer,
    recoverable only with database access.
    """
    if not (user.role and user.role.name == ADMIN):
        return
    new_role = db.get(Role, new_role_id)
    if new_role is not None and new_role.name == ADMIN:
        return  # Admin to Admin is not a change worth guarding.
    if user.active and _other_active_admins(db, user) == 0:
        raise HTTPException(
            400,
            "Cannot change the role of the last administrator. Give another "
            "account the Admin role first.",
        )


def _apply_status(
    db: Session, user: User, admin: User, new_status: str, reason: str | None
) -> bool:
    """Move a user between statuses, recording who did it. Returns False if unchanged.

    Shared by the general update, the dedicated status route and the legacy
    DELETE, because all three do exactly this and any difference between them
    would be a difference in what the guards catch.
    """
    previous = user.status
    if previous == new_status:
        return False

    _guard_status_change(db, user, admin, new_status)

    user.status = new_status
    if user_status.may_sign_in(new_status):
        # A live account must not carry a stale "suspended by X on Y". The
        # history of the moves lives in the audit log, which is the right place
        # for it -- these two columns only ever answer "and now?".
        user.status_changed_at = None
        user.status_changed_by = None
    else:
        user.status_changed_at = datetime.now(timezone.utc)
        user.status_changed_by = admin.id
        # Losing the right to sign in should end the sessions already open, not
        # take effect whenever the current token happens to expire. The
        # get_current_user check catches this too, on the next request; bumping
        # the version is what makes it unambiguous.
        user.token_version += 1

    record_audit(
        db,
        user_id=admin.id,
        action=audit_actions.status_change_action(new_status, previous),
        module="Admin",
        entity_type="User",
        entity_id=user.id,
        old_value={"status": previous},
        new_value={"status": new_status},
        reason=reason or f"Status changed from {previous} to {new_status}",
    )
    return True


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    """Edit a user's details, and optionally their status.

    Passwords are not settable here any more -- see
    ``POST /users/{id}/reset-password``. Folding a credential reset into the
    same call as "correct the spelling of their surname" made the two
    indistinguishable in the audit log afterwards, which is exactly the
    distinction anyone reading it later needs.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")

    before = _user_snapshot(user)

    if payload.first_name is not None:
        user.first_name = payload.first_name
    if payload.family_name is not None:
        user.family_name = payload.family_name
    if "email" in payload.model_fields_set:
        # None is a meaningful value here -- clearing an address someone no
        # longer has -- so this checks whether the field was sent rather than
        # whether it is set, the same way contractor_id does below.
        if payload.email:
            clash = (
                db.query(User)
                .filter(User.email == payload.email, User.id != user.id)
                .first()
            )
            if clash is not None:
                raise HTTPException(
                    400, "Another account already uses that email address"
                )
        user.email = payload.email
    if payload.role_id is not None and payload.role_id != user.role_id:
        _guard_role_change(db, user, payload.role_id)
        user.role_id = payload.role_id
        # A different role is a different set of permissions, and tokens carry
        # the role they were minted with. Re-issue rather than let a session
        # keep acting under the old one.
        user.token_version += 1
    # contractor_id needs special handling: None is a valid value here
    # (clearing the contractor when a user's role changes away from
    # Contractor). "is not None" would silently ignore that clear, so we
    # check whether the field was explicitly sent instead.
    if "contractor_id" in payload.model_fields_set:
        user.contractor_id = payload.contractor_id
    if payload.sees_all_provinces is not None:
        user.sees_all_provinces = payload.sees_all_provinces
    if payload.province_ids is not None:
        _set_provinces(db, user, payload.province_ids)

    # Applied last, and through the shared helper, so the guards that protect
    # the last administrator run whichever route the change came in by.
    status_moved = False
    if payload.status is not None:
        status_moved = _apply_status(
            db, user, admin, payload.status, payload.status_reason
        )

    db.flush()
    after = _user_snapshot(user)
    changes = _changed(before, after)
    # A status-only edit has already been recorded, with the verb that names
    # what happened. A second "user updated" entry beside it would say less and
    # take up the same space.
    if changes and not (status_moved and set(changes) <= {"status"}):
        record_audit(
            db,
            user_id=admin.id,
            action=(
                audit_actions.USER_ROLE_CHANGED
                if "role_id" in changes
                else audit_actions.USER_UPDATED
            ),
            module="Admin",
            entity_type="User",
            entity_id=user.id,
            old_value=before,
            new_value=after,
            # The field names, so the log line says what was touched without
            # anyone having to open the before/after values to find out.
            reason=f"Updated {user.username}: " + ", ".join(sorted(changes)),
        )
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/status", response_model=UserOut)
def change_user_status(
    user_id: int,
    payload: UserStatusChange,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    """Activate, deactivate or suspend an account.

    A route of its own rather than a corner of the general update, because it
    is the operation an administrator most often comes here to perform and the
    one whose audit entry needs to be unmistakable. Nothing is deleted: see
    ``core/user_status.py``.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")

    _apply_status(db, user, admin, payload.status, payload.reason)
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/reset-password", response_model=AdminPasswordResetResult)
def reset_user_password(
    user_id: int,
    payload: AdminPasswordReset,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    """Set a temporary password on someone else's account.

    The response carries the new password in clear text, once. That is not a
    leak -- it is the only form in which it will ever exist, since what gets
    stored is an Argon2id hash and nothing can reverse it. An administrator who
    loses it before handing it over does another reset.

    Three things happen alongside it, and each matters:

    * ``must_change_password`` is set, so the account can do nothing but
      replace the credential two people now know.
    * ``token_version`` is bumped, which ends every session the account
      currently has. Resetting a password is the standard response to a
      compromised account, and until that line existed it left the attacker's
      token working for another eight hours.
    * Any pending reset request from this person is closed, so the queue in the
      console reflects what has actually been dealt with.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")

    if payload.password is not None:
        # The schema ran the shared policy; this adds the one check it could
        # not, because the target's username is not in that payload.
        try:
            validate_password(payload.password, username=user.username)
        except PasswordError as exc:
            raise HTTPException(400, str(exc)) from None
        new_password = payload.password
    else:
        new_password = generate_temporary_password()

    user.password_hash = hash_password(new_password)
    user.must_change_password = True
    user.token_version += 1

    pending = (
        db.query(PasswordResetRequest)
        .filter(
            PasswordResetRequest.user_id == user.id,
            PasswordResetRequest.status == "Pending",
        )
        .all()
    )
    for req in pending:
        req.status = "Completed"
        req.handled_at = datetime.now(timezone.utc)
        req.handled_by = admin.id

    record_audit(
        db,
        user_id=admin.id,
        action=audit_actions.PASSWORD_RESET,
        module="Admin",
        entity_type="User",
        entity_id=user.id,
        # The fact of the reset, never the value. ``generated`` distinguishes
        # the server's random password from one the administrator chose, which
        # is the difference worth being able to see later.
        new_value={
            "username": user.username,
            "generated": payload.password is None,
            "closed_requests": len(pending),
        },
        reason=payload.reason or f"Password reset by {admin.username}",
    )
    db.commit()

    return AdminPasswordResetResult(
        username=user.username, temporary_password=new_password
    )


@router.get("/users/{user_id}/audit-logs", response_model=AuditLogListOut)
def user_audit_history(
    user_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """Everything this person did, and everything done to their account.

    Both halves, deliberately. ``user_id`` on an audit row is the actor, so
    filtering on it alone would show what someone did and hide the fact that
    an administrator suspended them -- which is the half a reviewer opening
    this screen is most often looking for. The second clause picks up entries
    where this account is the *subject* instead.
    """
    if db.get(User, user_id) is None:
        raise HTTPException(404, "User not found")

    query = db.query(AuditLog).filter(
        or_(
            AuditLog.user_id == user_id,
            (AuditLog.entity_type == "User") & (AuditLog.entity_id == user_id),
        )
    )
    return _audit_page(db, query, limit=limit, offset=offset)


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

    Kept as an alias for ``POST /users/{id}/status`` with Inactive, which is
    what it now does. The verb is the wrong one for what happens, and the route
    that says what it means is the one to prefer; this exists so that an
    older client, or anyone reaching for the obvious REST verb, gets the safe
    behaviour rather than a 405.

    Province assignments are deliberately left in place, so reactivating
    restores the person's original access rather than silently giving them none.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")

    username = user.username
    # ``_apply_status`` is a no-op when the status already matches, which keeps
    # the audit trail pointing at whoever actually did the deactivation rather
    # than moving the timestamp on every repeat call.
    _apply_status(db, user, admin, user_status.INACTIVE, "Deactivated by administrator")
    db.commit()
    return {"status": "ok", "deactivated": username}


# ---------------- Password reset requests ----------------
@router.get("/password-reset-requests", response_model=list[PasswordResetRequestOut])
def list_password_reset_requests(
    status_filter: str = Query(default="Pending", alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """People who said, from the sign-in page, that they cannot get in.

    Defaults to Pending, because that is the only list anybody opens this for.
    """
    rows = (
        db.query(PasswordResetRequest)
        .filter(PasswordResetRequest.status == status_filter)
        .order_by(PasswordResetRequest.requested_at.desc())
        .limit(limit)
        .all()
    )
    users = {
        u.id: u
        for u in db.query(User)
        .filter(User.id.in_({r.user_id for r in rows if r.user_id}))
        .all()
    } if rows else {}

    return [
        PasswordResetRequestOut(
            id=r.id,
            submitted_identifier=r.submitted_identifier,
            user_id=r.user_id,
            user_full_name=users[r.user_id].full_name if r.user_id in users else None,
            username=users[r.user_id].username if r.user_id in users else None,
            requested_at=r.requested_at,
            requested_ip=r.requested_ip,
            status=r.status,
            handled_at=r.handled_at,
            handled_by=r.handled_by,
        )
        for r in rows
    ]


@router.post("/password-reset-requests/{request_id}/dismiss")
def dismiss_password_reset_request(
    request_id: int,
    payload: PasswordResetRequestDecision,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles(ADMIN)),
):
    """Close a request without resetting anything.

    The right answer to a request naming an account nobody recognises, or one
    the person has since resolved themselves. Actioning a request is the reset
    route above, which closes it as a side effect.
    """
    req = db.get(PasswordResetRequest, request_id)
    if req is None:
        raise HTTPException(404, "Request not found")
    if req.status != "Pending":
        raise HTTPException(400, "That request has already been dealt with")

    req.status = "Dismissed"
    req.handled_at = datetime.now(timezone.utc)
    req.handled_by = admin.id
    record_audit(
        db,
        user_id=admin.id,
        action=audit_actions.UPDATED,
        module="Admin",
        entity_type="PasswordResetRequest",
        entity_id=req.id,
        new_value={"status": "Dismissed"},
        reason=payload.reason or "Password reset request dismissed",
    )
    db.commit()
    return {"status": "ok"}


# ---------------- Admin Dashboard ----------------
@router.get("/stats", response_model=AdminStatsOut)
def admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """Headline user/contractor counts for the Admin console overview."""
    active_users_count = db.query(User).filter(User.active).count()
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
            User.active,
            User.sees_all_provinces.is_(False),
            User.id.not_in(users_with_access),
        )
        .count()
    )

    dormant_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    dormant_users = (
        db.query(User)
        .filter(
            User.active,
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


def _audit_page(
    db: Session, query, *, limit: int, offset: int
) -> AuditLogListOut:
    """Count, page and resolve one filtered audit query.

    Shared by the whole-log endpoint and the per-user history, so the two
    cannot drift into presenting the same rows differently. The name lookup is
    one query for the page rather than one per row -- an audit page is the
    place where an N+1 is most likely to go unnoticed and least affordable,
    since this is the fastest-growing table in the platform.
    """
    total_count = query.count()
    rows = query.order_by(AuditLog.id.desc()).offset(offset).limit(limit).all()

    user_ids = {r.user_id for r in rows if r.user_id is not None}
    users_by_id = {}
    if user_ids:
        users_by_id = {
            u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()
        }

    items = [
        AuditLogOut(
            id=r.id,
            user_id=r.user_id,
            user_full_name=(
                users_by_id[r.user_id].full_name if r.user_id in users_by_id else None
            ),
            username=(
                users_by_id[r.user_id].username if r.user_id in users_by_id else None
            ),
            action=r.action,
            module=r.module,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            created_at=r.created_at,
            old_value=r.old_value,
            new_value=r.new_value,
            reason=r.reason,
            ip_address=r.ip_address,
            result=r.result,
        )
        for r in rows
    ]
    return AuditLogListOut(total_count=total_count, items=items)


@router.get("/audit-logs", response_model=AuditLogListOut)
def list_audit_logs(
    # Bounded, unlike before. audit_logs is the table that grows fastest over a
    # ten-year deployment, and it was the one endpoint that would hand back as
    # much of it as a single request asked for.
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = None,
    module: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    user_id: int | None = None,
    result: str | None = None,
    search: str | None = Query(default=None, max_length=200),
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(ADMIN)),
):
    """Paginated, filterable view of the append-only audit log.

    Read-only, and there is no companion route that is not: nothing in this API
    updates or deletes an audit row, for any role. A record that the platform
    can revise on request is not evidence of anything.
    """
    query = db.query(AuditLog)
    if action is not None:
        query = query.filter(AuditLog.action == action)
    if module is not None:
        query = query.filter(AuditLog.module == module)
    if entity_type is not None:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(AuditLog.entity_id == entity_id)
    if user_id is not None:
        query = query.filter(AuditLog.user_id == user_id)
    if result is not None:
        query = query.filter(AuditLog.result == result)
    if search:
        # Over the free-text reason only. The before/after values are JSON and
        # searching them portably would mean a different query per dialect --
        # the structured filters above are the way to find those.
        query = query.filter(func.lower(AuditLog.reason).like(f"%{search.strip().lower()}%"))
    if date_from is not None:
        query = query.filter(
            AuditLog.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        )
    if date_to is not None:
        query = query.filter(
            AuditLog.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        )

    return _audit_page(db, query, limit=limit, offset=offset)


def _set_provinces(db: Session, user: User, province_ids: list[int]) -> None:
    """Replace the user's province grants with the given list."""
    provinces = (
        db.query(Province).filter(Province.id.in_(province_ids)).all()
        if province_ids
        else []
    )
    user.provinces = provinces
