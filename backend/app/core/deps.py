"""FastAPI dependencies: current user resolution and RBAC guards."""
from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.reference import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Role name constants (avoid magic strings scattered around the code).
ADMIN = "Admin"
PM = "PM"
COORDINATOR = "Coordinator"
REGIONAL = "RegionalManager"
CONTRACTOR = "Contractor"
VIEWER = "Viewer"

# Health-check problem-category owners. Named here for seeding and for the
# frontend's route guards; permission checks use ``Role.is_category_owner``
# rather than these strings so a fifth owner role needs no code change.
CPG_POWER = "CpgPower"
CPG_ROLLOUT_PM = "CpgRolloutPM"
MANAGED_SERVICE = "ManagedService"
NWG_PLANNING = "NwgPlanning"

CATEGORY_OWNER_ROLES = (CPG_POWER, CPG_ROLLOUT_PM, MANAGED_SERVICE, NWG_PLANNING)


def get_current_user_allowing_password_change(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Resolve the authenticated user from the JWT, or raise 401.

    This is the full authentication check and nothing more. Almost nothing
    should depend on it directly -- use :func:`get_current_user`, which adds the
    must-change-password gate on top. The two endpoints that cannot are the
    ones that gate is designed to leave open: reading your own profile, and
    setting a new password. Signing out is the third, because refusing to let
    someone leave would be absurd.
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    claims = decode_access_token(token)
    if claims is None or "sub" not in claims:
        raise credentials_error

    try:
        user_id = int(claims["sub"])
    except (TypeError, ValueError):
        # Cannot happen with a token we signed, but a malformed ``sub`` should
        # be a 401 rather than an unhandled 500.
        raise credentials_error from None

    user = db.get(User, user_id)
    if user is None or not user.active:
        # Covers every non-Active status. An account suspended mid-session
        # stops being able to make requests on the next one, rather than
        # keeping its token until it expires.
        raise credentials_error

    # Credentials changed since this token was minted, so it is no longer
    # valid -- this is what makes resetting a password actually end the
    # sessions someone else is holding. Tokens issued before token_version
    # existed carry no claim and are read as 0, matching the column default,
    # so a deploy does not sign everyone out.
    if int(claims.get("ver", 0)) != user.token_version:
        raise credentials_error
    return user


# What the frontend keys on to send someone to the change-password screen. A
# code rather than the sentence, because the sentence is written for a human
# and will be reworded; this will not.
PASSWORD_CHANGE_REQUIRED = "password_change_required"


def get_current_user(
    user: User = Depends(get_current_user_allowing_password_change),
) -> User:
    """The authenticated user, refused if they still owe a password change.

    An administrator resetting a password produces a credential that two people
    know -- the administrator who generated it and the person they gave it to.
    That is unavoidable for a platform with no outbound mail, and it is fine
    for the seconds it takes to hand over, but an account left running on it
    indefinitely is an account its owner cannot be held to. So the temporary
    password buys exactly enough access to replace itself, and nothing else.

    The 403 carries a machine-readable code so the frontend can route to the
    change-password screen instead of showing a permission error, which is what
    this would otherwise look like from the outside.
    """
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": PASSWORD_CHANGE_REQUIRED,
                "message": (
                    "Your password was reset by an administrator. Please "
                    "choose a new one before continuing."
                ),
            },
        )
    return user


def require_roles(*allowed_roles: str) -> Callable[[User], User]:
    """Return a dependency that permits only the given role names."""

    def guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role.name not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return guard


def require_category_owner(
    current_user: User = Depends(get_current_user),
) -> User:
    """Permit any role flagged as a health-check problem-category owner.

    Checks the flag rather than a list of names so that adding a category (and
    its owning role) stays a data change.
    """
    if not current_user.role.is_category_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )
    return current_user
