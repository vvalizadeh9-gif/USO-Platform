"""Authentication endpoints."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    create_captcha_challenge,
    verify_captcha,
    verify_password,
)
from app.models.reference import User
from app.schemas import CaptchaChallenge, TokenResponse, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/captcha", response_model=CaptchaChallenge)
def get_captcha() -> CaptchaChallenge:
    """Issue a new "a + b" math captcha challenge for the login form."""
    return CaptchaChallenge(**create_captcha_challenge())


@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    captcha_token: str = Form(...),
    captcha_answer: int = Form(...),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Validate the captcha, then the credentials, and return a JWT plus the user profile."""
    if not verify_captcha(captcha_token, captcha_answer):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Captcha answer is incorrect or has expired",
        )
    user = db.query(User).filter(User.username == form.username).one_or_none()
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled"
        )
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

    token = create_access_token(user.id, {"role": user.role.name})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))
