"""The three states an account can be in, and what each one means.

This replaces a boolean. ``users.active`` answered one question -- may this
person sign in -- and an administrator needs to answer two: whether the account
is in use, and *why* it is not. "Left the company" and "under investigation,
locked pending an answer" were the same row, and the difference is exactly what
someone reading an audit trail a year later needs to know.

Three states, deliberately no more:

``Active``
    Normal. Signs in, receives notifications, appears in the pickers that
    assign work.

``Inactive``
    The person no longer uses the platform -- they left, or changed jobs, or
    the account was created and never taken up. An ordinary, expected end
    state, and the one the old ``active = false`` almost always meant.

``Suspended``
    Access withdrawn deliberately and, usually, temporarily: a compromised
    account, an investigation, a contract on hold. Distinct from Inactive
    because it is a decision someone made about a person who is still around,
    and because it is meant to be reversed.

Neither non-Active state deletes anything. User rows are referenced by
``audit_logs.user_id``, ``hc_tasks.reviewed_by`` and both reviewer columns on
``work_items``; removing one turns "reviewed by Maryam" into "reviewed by
nobody" across the whole history, and over a ten-year platform staff turnover
makes that certain. A status change is the whole of what "deleting" a user
means here.

Strings rather than a database enum: PostgreSQL enums need a migration to add a
value, and the point of this module is that a fourth state should be a small
change. The set is closed at the application edge instead -- schemas validate
against :data:`USER_STATUSES`, so a typo is a 422 rather than a row nobody can
sign in as.
"""
from __future__ import annotations

ACTIVE = "Active"
INACTIVE = "Inactive"
SUSPENDED = "Suspended"

#: Every value ``users.status`` may hold. Order is the order the UI offers.
USER_STATUSES: tuple[str, ...] = (ACTIVE, INACTIVE, SUSPENDED)

#: The statuses that permit signing in. A tuple of one today; named so that the
#: check reads as "may this status sign in" rather than "== Active", which is
#: what a fourth state would otherwise have to hunt down.
SIGN_IN_STATUSES: tuple[str, ...] = (ACTIVE,)

# What the login endpoint tells someone whose account is not Active. Kept here,
# beside the states themselves, so a new state cannot be added without deciding
# what its holder is told -- and phrased to say what to do next, because the
# person reading it cannot do anything about it alone.
_SIGN_IN_REFUSALS = {
    INACTIVE: (
        "This account is inactive and cannot sign in. "
        "Contact an administrator if you need it reopened."
    ),
    SUSPENDED: (
        "This account is suspended. "
        "Contact an administrator to have the suspension reviewed."
    ),
}


def may_sign_in(status: str) -> bool:
    """True if an account in this status is allowed to authenticate."""
    return status in SIGN_IN_STATUSES


def sign_in_refusal(status: str) -> str:
    """What to tell someone whose account is in this status.

    Falls back to a generic message rather than raising: an unrecognised status
    should refuse the login, not turn it into a 500.
    """
    return _SIGN_IN_REFUSALS.get(
        status, "This account cannot sign in. Contact an administrator."
    )
