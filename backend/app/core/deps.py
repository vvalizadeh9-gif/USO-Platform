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


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Resolve the authenticated user from the JWT, or raise 401."""
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
        raise credentials_error

    # Credentials changed since this token was minted, so it is no longer
    # valid -- this is what makes resetting a password actually end the
    # sessions someone else is holding. Tokens issued before token_version
    # existed carry no claim and are read as 0, matching the column default,
    # so a deploy does not sign everyone out.
    if int(claims.get("ver", 0)) != user.token_version:
        raise credentials_error
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
