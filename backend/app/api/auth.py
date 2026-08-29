"""Authentication endpoints, and the audit trail they leave behind.

Every event in this module is recorded: a successful sign-in, a refused one, a
sign-out, a password change, and a request for a reset. The refused ones are
the reason the audit log has a ``result`` column at all -- a trail that holds
only what worked cannot show anybody trying to get in.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core import audit_actions, user_status
from app.core.database import get_db
from app.core.rate_limit import client_ip, login_rate_limiter
from app.core.deps import get_current_user_allowing_password_change
from app.core.passwords import PasswordError, validate_password
from app.core.security import (
    create_access_token,
    create_captcha_challenge,
    hash_password,
    needs_rehash,
    verify_captcha,
    verify_password,
    verify_password_or_dummy,
)
from app.models.auth import PasswordResetRequest
from app.models.reference import User
from app.schemas import (
    CaptchaChallenge,
    PasswordChange,
    PasswordResetRequestIn,
    TokenResponse,
    UserOut,
)
from app.services.audit import record_audit, record_audit_now

router = APIRouter(prefix="/auth", tags=["auth"])

# The module every entry in this file is filed under, so the audit screen can
# show "everything that happened at the front door" as one filter.
_MODULE = "Auth"


@router.get("/captcha", response_model=CaptchaChallenge)
def get_captcha() -> CaptchaChallenge:
    """Issue a new "a + b" math captcha challenge for the login form."""
    return CaptchaChallenge(**create_captcha_challenge())


def _record_failed_login(
    db: Session, *, username: str, user: User | None, reason: str
) -> None:
    """Record a sign-in that was refused, and commit it.

    Committed on its own, through ``record_audit_now``, because the endpoint
    raises immediately afterwards: an entry left pending in a session that
    never commits is an entry that was never written, and these are exactly the
    ones worth having.

    ``user_id`` is set when the username matched a real account and left null
    when it did not. That distinction is the useful one when reading the log
    later: repeated failures against one account look different from someone
    working through a list of names, and both are visible here.
    """
    record_audit_now(
        db,
        user_id=user.id if user else None,
        action=audit_actions.LOGIN_FAILED,
        module=_MODULE,
        entity_type="User",
        entity_id=user.id if user else None,
        # The attempted username, so a failure against an account that does not
        # exist still says which name was tried. Never the password, or
        # anything derived from it.
        new_value={"username": username},
        reason=reason,
        result=audit_actions.FAILURE,
    )


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
        _record_failed_login(
            db,
            username=form.username,
            user=user,
            reason=(
                "Incorrect password"
                if user
                else "No account with that username"
            ),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user_status.may_sign_in(user.status):
        # The password was right. Recorded as a failure with the status named,
        # because "the credentials of a suspended account are in use" is a
        # thing an administrator reviewing this log needs to see.
        _record_failed_login(
            db,
            username=form.username,
            user=user,
            reason=f"Account status is {user.status}",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=user_status.sign_in_refusal(user.status),
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

    # The one moment the plaintext is in hand and known to be correct, which is
    # the only moment a stored hash can be upgraded without asking anybody for
    # anything. Applies to the bcrypt hashes written before the move to
    # Argon2id, and to any Argon2id hash whose cost is below the current
    # setting -- so raising the parameters in core/security.py takes effect on
    # its own as people sign in.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(form.password)

    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.LOGIN_SUCCESS,
        module=_MODULE,
        entity_type="User",
        entity_id=user.id,
    )
    db.commit()
    db.refresh(user)

    token = create_access_token(
        user.id, {"role": user.role.name, "ver": user.token_version}
    )
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/logout")
def logout(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_allowing_password_change),
):
    """Record that this person signed out.

    The token itself is not revoked, and deliberately so. Revocation here means
    bumping ``token_version``, which invalidates *every* session the account
    has -- so signing out of the office desktop would also sign the same person
    out on their phone, which is not what the button says. Tokens are
    short-lived, and the client discards the one it holds; an administrator who
    genuinely needs to end every session has the password reset, which does
    exactly that and says so.

    What this endpoint is for is the audit trail. "Logout" is one of the
    authentication events the log is required to carry, and without a call
    there is nothing to record it from -- a session that simply stops being
    used leaves no trace of when its holder stopped working.
    """
    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.LOGOUT,
        module=_MODULE,
        entity_type="User",
        entity_id=user.id,
    )
    db.commit()
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def read_me(
    user: User = Depends(get_current_user_allowing_password_change),
) -> UserOut:
    """The signed-in user, as the server currently sees them.

    The frontend restores its cached ``uep_user`` from localStorage on load and
    trusts it, including the role. Editing that cached object in developer
    tools makes the interface *show* administrator screens -- it grants no
    actual access, because every endpoint re-checks the role server-side, but
    the buttons appear. This endpoint is what lets the frontend revalidate
    instead of trusting the cache, and it also answers "am I still signed in"
    without a side effect.

    Reachable while ``must_change_password`` is set, because it is how the
    frontend learns that the flag is set at all.
    """
    return UserOut.model_validate(user)


@router.post("/me/password")
def change_my_password(
    request: Request,
    payload: PasswordChange,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_allowing_password_change),
):
    """Change your own password.

    There was no route for this. Only an Admin could change anyone's password,
    which means every password in the platform was set by, and known to, an
    administrator -- the wrong shape for a system that will see a decade of
    staff turnover.

    The current password is required even though the caller is already
    authenticated: it is what stops a borrowed unlocked laptop becoming a
    permanent takeover of the account. That holds for someone working off a
    temporary password too -- they were given it, so they can type it, and
    requiring it means an administrator's reset does not leave a window in
    which an unattended browser can be turned into a permanent account.
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
        record_audit_now(
            db,
            user_id=user.id,
            action=audit_actions.PASSWORD_CHANGED,
            module=_MODULE,
            entity_type="User",
            entity_id=user.id,
            reason="Current password was not correct",
            result=audit_actions.FAILURE,
        )
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
    # Whatever an administrator handed over has now been replaced by something
    # only this person knows, which is the whole point of the flag.
    user.must_change_password = False
    # Ends every other session this account has, including the one an attacker
    # would be holding -- which is the point of changing it.
    user.token_version += 1
    record_audit(
        db,
        user_id=user.id,
        action=audit_actions.PASSWORD_CHANGED,
        module=_MODULE,
        entity_type="User",
        entity_id=user.id,
        reason="Password changed by the account holder",
    )
    db.commit()

    # The caller's own token was just invalidated along with the rest, so hand
    # back a fresh one rather than signing them out for succeeding.
    token = create_access_token(
        user.id, {"role": user.role.name, "ver": user.token_version}
    )
    return {"status": "ok", "access_token": token, "token_type": "bearer"}


@router.post("/password-reset-request")
def request_password_reset(
    request: Request,
    payload: PasswordResetRequestIn,
    db: Session = Depends(get_db),
):
    """Tell the administrators that you cannot get in.

    This platform sends no mail, so there is no "we have emailed you a link".
    Building one would mean an SMTP server, a token table and an unauthenticated
    endpoint that mints credentials -- the largest new attack surface in the
    system, for a few dozen internal users who all know their administrator. So
    this records a request and grants nothing at all; an administrator verifies
    the person by the means they already use and issues a temporary password
    from the console.

    The response is identical whether or not the identifier matches an account.
    An unauthenticated endpoint that answers "no such user" is a way to
    enumerate who works here, and this one is deliberately reachable by anybody
    who can load the login page.
    """
    identifier = payload.identifier.strip()
    ip = client_ip(request)

    user = (
        db.query(User)
        .filter((User.username == identifier) | (User.email == identifier))
        .one_or_none()
    )

    # Recorded even when nothing matched: an administrator seeing a run of
    # requests for names that do not exist is seeing someone probing, and that
    # is worth knowing.
    db.add(
        PasswordResetRequest(
            submitted_identifier=identifier[:255],
            user_id=user.id if user else None,
            requested_at=datetime.now(timezone.utc),
            requested_ip=ip,
            status="Pending",
        )
    )
    record_audit(
        db,
        user_id=user.id if user else None,
        action=audit_actions.PASSWORD_RESET_REQUESTED,
        module=_MODULE,
        entity_type="User",
        entity_id=user.id if user else None,
        new_value={"identifier": identifier[:255]},
        reason="Password reset requested from the sign-in page",
        # A request for an account nobody has is not a thing that succeeded.
        result=audit_actions.SUCCESS if user else audit_actions.FAILURE,
    )
    db.commit()

    return {
        "status": "ok",
        "detail": (
            "If that account exists, an administrator has been notified and "
            "will be in touch to reset the password."
        ),
    }
