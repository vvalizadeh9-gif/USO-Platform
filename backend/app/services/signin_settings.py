"""Sign-in page settings (UEP-26): rules for reading, validating and saving.

The row is edited in Admin > Sign-in page. Two views of it exist:

* :func:`public_view` -- what ``GET /auth/signin-settings`` returns to anyone,
  signed in or not: the support contact and, only while it is switched on and
  inside its window, the notice text. Nothing else, never a user's name.
* :func:`admin_view` -- the full row for the Admin page, with who saved it.

Strings are stored trimmed; an empty string is stored as NULL so "not set"
has one spelling.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.signin_settings import SINGLETON_ID, SignInSettings

#: field -> (label for messages, maximum length)
TEXT_LIMITS: dict[str, tuple[str, int]] = {
    "support_name": ("Team or person", 80),
    "support_hours": ("Working hours", 80),
    "support_email": ("Email", 254),
    "support_phone": ("Phone or extension", 40),
    "notice_text": ("Message", 140),
}

#: The fields an Admin edits, in the order they are audited.
EDITABLE = (*TEXT_LIMITS, "notice_enabled", "notice_from", "notice_to")

# Deliberately plain: one @, no spaces, a dot in the domain. Deliverability is
# not ours to judge; catching a typo like "name@company" is.
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

EMAIL_MESSAGE = "Enter an email like name@company.com."
NOTICE_REQUIRED = "Enter the message to show on the sign-in page."
WINDOW_ORDER = "Hide after must be later than Show from."


class InvalidSettings(ValueError):
    """A value the Admin page should not have sent; the message says which."""


@dataclass(frozen=True)
class SettingsInput:
    support_name: str | None = None
    support_hours: str | None = None
    support_email: str | None = None
    support_phone: str | None = None
    notice_enabled: bool = False
    notice_text: str | None = None
    notice_from: datetime | None = None
    notice_to: datetime | None = None


def _aware(value: datetime | None) -> datetime | None:
    """Treat a naive timestamp (SQLite hands those back) as UTC."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def get_row(db: Session) -> SignInSettings:
    """The one row; created when a database somehow lacks it."""
    row = db.get(SignInSettings, SINGLETON_ID)
    if row is None:
        row = SignInSettings(id=SINGLETON_ID, notice_enabled=False)
        db.add(row)
        db.flush()
    return row


def notice_is_live(row: SignInSettings, now: datetime) -> bool:
    """Switched on, has text, and now is inside the window (an empty end is open)."""
    if not row.notice_enabled or not row.notice_text:
        return False
    start, end = _aware(row.notice_from), _aware(row.notice_to)
    if start is not None and now < start:
        return False
    if end is not None and now > end:
        return False
    return True


def public_view(row: SignInSettings, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    return {
        "support": {
            "name": row.support_name,
            "hours": row.support_hours,
            "email": row.support_email,
            "phone": row.support_phone,
        },
        "notice": {"text": row.notice_text} if notice_is_live(row, now) else None,
    }


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value else None


def snapshot(row: SignInSettings) -> dict:
    """The editable fields, JSON-ready: the audit entry's before and after."""
    out: dict = {}
    for name in EDITABLE:
        value = getattr(row, name)
        out[name] = _iso(value) if isinstance(value, datetime) else value
    return out


def admin_view(row: SignInSettings) -> dict:
    editor = row.editor
    return {
        **snapshot(row),
        "updated_by": row.updated_by,
        "updated_by_name": editor.full_name if editor else None,
        "updated_at": _iso(row.updated_at) if row.updated_by else None,
    }


def validate(data: SettingsInput) -> SettingsInput:
    """Trim, check lengths, email, the notice and its window. Raises
    :class:`InvalidSettings` with the sentence the page shows."""
    cleaned = {name: _clean(getattr(data, name)) for name in TEXT_LIMITS}
    for name, (label, limit) in TEXT_LIMITS.items():
        value = cleaned[name]
        if value is not None and len(value) > limit:
            raise InvalidSettings(f"{label} can be at most {limit} characters.")
    if cleaned["support_email"] and not _EMAIL.match(cleaned["support_email"]):
        raise InvalidSettings(EMAIL_MESSAGE)
    if data.notice_enabled and not cleaned["notice_text"]:
        raise InvalidSettings(NOTICE_REQUIRED)
    start, end = _aware(data.notice_from), _aware(data.notice_to)
    if start is not None and end is not None and end <= start:
        raise InvalidSettings(WINDOW_ORDER)
    return SettingsInput(
        **cleaned, notice_enabled=data.notice_enabled, notice_from=start, notice_to=end,
    )


def save(db: Session, data: SettingsInput, user_id: int) -> tuple[SignInSettings, dict, dict]:
    """Validate and apply. Returns (row, before, after); the caller audits and
    commits. ``updated_at`` is set explicitly so it moves even when only the
    editor changed."""
    clean = validate(data)
    row = get_row(db)
    before = snapshot(row)
    for name in EDITABLE:
        setattr(row, name, getattr(clean, name))
    row.updated_by = user_id
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return row, before, snapshot(row)
