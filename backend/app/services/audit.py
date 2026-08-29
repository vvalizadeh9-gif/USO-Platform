"""Audit logging and notification helpers.

These are the side-effect handlers for domain events. Keeping them in one
place means every workflow service records history consistently.
"""
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.request_context import current_client_ip
from app.models.acceptance import AuditLog, Notification


def record_audit(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    module: str,
    entity_type: str,
    entity_id: int | None,
    old_value: dict | None = None,
    new_value: dict | None = None,
    reason: str | None = None,
    ip_address: str | None = None,
    result: str = audit_actions.SUCCESS,
) -> None:
    """Append an immutable audit entry. Caller commits the transaction.

    ``action`` is required, and comes from ``core/audit_actions.py``. It is the
    column that says what happened, and it has no sensible default: an entry
    whose verb was guessed is worse than one that was never written, because it
    reads as fact. Making it a keyword with no default is what forces each new
    call site to decide.

    ``ip_address`` defaults to the address of the request being handled. It was
    a parameter no caller ever passed, so every row in the audit trail recorded
    who and never from where -- on a platform whose deactivation logic is
    explicitly designed around a ten-year accountability trail. Taking it from
    the request context means the ~30 call sites do not each have to remember,
    which is the only way it stays true.

    ``result`` says whether the action succeeded. It defaults to Success
    because that is what almost every call site is recording; the ones that
    matter -- a refused sign-in, a guard that said no -- pass Failure, and are
    the reason the column exists.
    """
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            module=module,
            entity_type=entity_type,
            entity_id=entity_id,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
            ip_address=ip_address or current_client_ip(),
            result=result,
        )
    )


def record_audit_now(db: Session, **kwargs) -> None:
    """Write one audit entry and commit it, independently of the caller's work.

    For the entries that must survive the request failing. A refused sign-in is
    the case that matters: the endpoint records the attempt and then raises a
    401, and an ordinary ``record_audit`` leaves that row pending in a session
    nobody will ever commit -- so the log would hold every successful login and
    no failed ones, which is precisely backwards.

    Rolls back first, so a session already poisoned by the failure being
    recorded can still write the row.
    """
    db.rollback()
    record_audit(db, **kwargs)
    db.commit()


def notify(
    db: Session,
    *,
    user_id: int,
    type: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
) -> None:
    """Create an in-app notification for a single user."""
    db.add(
        Notification(
            user_id=user_id,
            type=type,
            message=message,
            related_entity_type=entity_type,
            related_entity_id=entity_id,
        )
    )


def notify_roles(
    db: Session,
    *,
    role_names: list[str],
    type: str,
    message: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
) -> None:
    """Create the same notification for all active users in given roles."""
    from app.models.reference import Role, User

    users = (
        db.query(User)
        .join(Role, User.role_id == Role.id)
        .filter(Role.name.in_(role_names), User.active)
        .all()
    )
    for u in users:
        notify(
            db, user_id=u.id, type=type, message=message,
            entity_type=entity_type, entity_id=entity_id,
        )
