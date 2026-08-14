"""Audit logging and notification helpers.

These are the side-effect handlers for domain events. Keeping them in one
place means every workflow service records history consistently.
"""
from sqlalchemy.orm import Session

from app.models.acceptance import AuditLog, Notification


def record_audit(
    db: Session,
    *,
    user_id: int | None,
    module: str,
    entity_type: str,
    entity_id: int | None,
    old_value: dict | None = None,
    new_value: dict | None = None,
    reason: str | None = None,
    ip_address: str | None = None,
) -> None:
    """Append an immutable audit entry. Caller commits the transaction."""
    db.add(
        AuditLog(
            user_id=user_id,
            module=module,
            entity_type=entity_type,
            entity_id=entity_id,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
            ip_address=ip_address,
        )
    )


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
        .filter(Role.name.in_(role_names), User.active.is_(True))
        .all()
    )
    for u in users:
        notify(
            db, user_id=u.id, type=type, message=message,
            entity_type=entity_type, entity_id=entity_id,
        )
