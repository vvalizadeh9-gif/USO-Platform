"""The vocabulary of actions the audit log records.

``audit_logs`` carried who, which module, which record, and the before/after
values -- but never a plain statement of *what happened*. Reading a row meant
inferring the verb from a free-text ``reason`` an English speaker wrote in
passing, or from the shape of ``new_value``. The frontend had a hundred-line
switch doing exactly that inference, and it was wrong for any event nobody had
thought to add a branch for.

An explicit ``action`` fixes that at the source. It is what makes the log
filterable ("show me every failed sign-in last week"), and it is the column an
auditor reads first.

Constants rather than free strings, because the value of this column is that
the same event is always spelled the same way. ``PASSWORD_RESET`` written once
as "password_reset" and once as "Password Reset" is two events as far as any
filter or count is concerned, and nothing would ever have told anyone.

The naming is UPPER_SNAKE: machine-stable, and never shown raw -- the frontend
maps each to a sentence, and falls back to a readable de-underscored form for
one it does not know, so adding an action here does not require a frontend
change to stay legible.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
LOGIN_SUCCESS = "LOGIN_SUCCESS"
LOGIN_FAILED = "LOGIN_FAILED"
LOGOUT = "LOGOUT"
PASSWORD_CHANGED = "PASSWORD_CHANGED"
PASSWORD_RESET = "PASSWORD_RESET"
PASSWORD_RESET_REQUESTED = "PASSWORD_RESET_REQUESTED"

# ---------------------------------------------------------------------------
# Account lifecycle
# ---------------------------------------------------------------------------
USER_CREATED = "USER_CREATED"
USER_UPDATED = "USER_UPDATED"
USER_ACTIVATED = "USER_ACTIVATED"
USER_DEACTIVATED = "USER_DEACTIVATED"
USER_SUSPENDED = "USER_SUSPENDED"
USER_REACTIVATED = "USER_REACTIVATED"
USER_ROLE_CHANGED = "USER_ROLE_CHANGED"
USER_ACCESS_CHANGED = "USER_ACCESS_CHANGED"

# ---------------------------------------------------------------------------
# Operational data, across the rest of the portal
# ---------------------------------------------------------------------------
CREATED = "CREATED"
UPDATED = "UPDATED"
DELETED = "DELETED"
IMPORTED = "IMPORTED"
SUBMITTED = "SUBMITTED"
APPROVED = "APPROVED"
REJECTED = "REJECTED"
RETURNED = "RETURNED"
ASSIGNED = "ASSIGNED"
REVIEWED = "REVIEWED"
DATA_WIPED = "DATA_WIPED"

# ---------------------------------------------------------------------------
# Result / status of the recorded attempt
# ---------------------------------------------------------------------------
#: The action did what it set out to do.
SUCCESS = "Success"
#: The action was attempted and refused -- a wrong password, a guard that said
#: no. Recording these is the point: an audit log that only holds what worked
#: cannot show a break-in attempt, which is the first thing anyone reviewing it
#: is looking for.
FAILURE = "Failure"

RESULTS: tuple[str, ...] = (SUCCESS, FAILURE)


def status_change_action(new_status: str, previous_status: str | None = None) -> str:
    """The action that best describes moving an account to ``new_status``.

    Reactivation and activation are the same transition seen from different
    sides, and the requirements name both, so the previous status is what
    separates them: coming back from Inactive or Suspended is a *re*activation,
    while an account that was already Active being set Active again is not an
    event worth a distinct verb.
    """
    from app.core import user_status

    if new_status == user_status.SUSPENDED:
        return USER_SUSPENDED
    if new_status == user_status.INACTIVE:
        return USER_DEACTIVATED
    if new_status == user_status.ACTIVE:
        if previous_status in (user_status.INACTIVE, user_status.SUSPENDED):
            return USER_REACTIVATED
        return USER_ACTIVATED
    return USER_UPDATED
