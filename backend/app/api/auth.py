"""Authentication endpoints."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rate_limit import client_ip, login_rate_limiter
from app.core.deps import get_current_user
from app.core.passwords import PasswordError, validate_password
from app.core.security import (
    create_access_token,
    create_captcha_challenge,
    hash_password,
    verify_captcha,
    verify_password,
    verify_password_or_dummy,
)
from app.models.reference import User
from app.schemas import CaptchaChallenge, PasswordChange, TokenResponse, UserOut
from app.services.audit import record_audit

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/captcha", response_model=CaptchaChallenge)
def get_captcha() -> CaptchaChallenge:
    """Issue a new "a + b" math captcha challenge for the login form."""
    return CaptchaChallenge(**create_captcha_challenge())


@router.post("/login", response_model=TokenResponse)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    captcha_token: str = Form(...),
    captcha_answer: int = Form(...),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Validate the captcha, then the credentials, and return a JWT plus the user profile.

    Failed attempts are counted per username and per source address; too many in
    a short time locks that username (or that address) out for a while. Counting
    only failures, and clearing on success, keeps this invisible to people who
    know their password.
    """
    ip = client_ip(request)
    retry_after = login_rate_limiter.check(db, form.username, ip)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many failed sign-in attempts. Please wait about "
                f"{max(1, retry_after // 60)} minute(s) and try again."
            ),
            headers={"Retry-After": str(retry_after)},
        )

    if not verify_captcha(db, captcha_token, captcha_answer):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Captcha answer is incorrect or has expired",
        )
    user = db.query(User).filter(User.username == form.username).one_or_none()
    if not verify_password_or_dummy(
        form.password, user.password_hash if user else None
    ):
        # Counted here, not on the captcha branch above: a wrong captcha is a
        # human mistyping, and locking someone out for it would be a nuisance
        # with no security benefit.
        login_rate_limiter.record_failure(db, form.username, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )

    login_rate_limiter.record_success(db, form.username, ip)
    # Lazily ensure this Shamsi month has a KPI snapshot (for month-over-month
    # deltas). Failure here must never block login, so guard it.
    try:
        from app.services.snapshots import ensure_current_month_snapshot

        ensure_current_month_snapshot(db)
    except Exception:  # pragma: no cover - snapshot is best-effort
        db.rollback()

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    token = create_access_token(
        user.id, {"role": user.role.name, "ver": user.token_version}
    )
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def read_me(user: User = Depends(get_current_user)) -> UserOut:
    """The signed-in user, as the server currently sees them.

    The frontend restores its cached ``uep_user`` from localStorage on load and
    trusts it, including the role. Editing that cached object in developer
    tools makes the interface *show* administrator screens -- it grants no
    actual access, because every endpoint re-checks the role server-side, but
    the buttons appear. This endpoint is what lets the frontend revalidate
    instead of trusting the cache, and it also answers "am I still signed in"
    without a side effect.
    """
    return UserOut.model_validate(user)


@router.post("/me/password")
def change_my_password(
    request: Request,
    payload: PasswordChange,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change your own password.

    There was no route for this. Only an Admin could change anyone's password,
    which means every password in the platform was set by, and known to, an
    administrator -- the wrong shape for a system that will see a decade of
    staff turnover.

    The current password is required even though the caller is already
    authenticated: it is what stops a borrowed unlocked laptop becoming a
    permanent takeover of the account.
    """
    # Throttled on the same counters as login. Without this the endpoint is an
    # unlimited oracle for the account's current password: someone holding a
    # stolen token already has the session, but confirming the password is what
    # lets them try it on the user's other systems.
    ip = client_ip(request)
    retry_after = login_rate_limiter.check(db, user.username, ip)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many attempts. Please wait about "
                f"{max(1, retry_after // 60)} minute(s) and try again."
            ),
            headers={"Retry-After": str(retry_after)},
        )

    if not verify_password(payload.current_password, user.password_hash):
        login_rate_limiter.record_failure(db, user.username, ip)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your current password is not correct",
        )
    login_rate_limiter.record_success(db, user.username, ip)
    # The schema ran the policy; this adds the one check it could not, because
    # the username is not in that payload.
    try:
        validate_password(payload.new_password, username=user.username)
    except PasswordError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new password must be different from the current one",
        )

    user.password_hash = hash_password(payload.new_password)
    # Ends every other session this account has, including the one an attacker
    # would be holding -- which is the point of changing it.
    user.token_version += 1
    record_audit(
        db, user_id=user.id, module="Auth", entity_type="User",
        entity_id=user.id, reason="Password changed by the account holder",
    )
    db.commit()

    # The caller's own token was just invalidated along with the rest, so hand
    # back a fresh one rather than signing them out for succeeding.
    token = create_access_token(
        user.id, {"role": user.role.name, "ver": user.token_version}
    )
    return {"status": "ok", "access_token": token, "token_type": "bearer"}
