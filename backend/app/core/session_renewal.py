"""The sliding session: an idle timeout, inside an absolute one.

A sign-in lasts ``access_token_expire_minutes`` (30) from the last time the
person did something, and never more than ``session_absolute_timeout_minutes``
(8 hours) from when they signed in. That is the shape OWASP's Session
Management Cheat Sheet recommends: the idle timeout ends a session left open on
an unattended desk, and the absolute one bounds how long a stolen cookie could
be kept alive by using it.

Each request made with the session cookie re-issues it with a fresh idle
deadline, so a person at work is never signed out mid-task. Three kinds of
request do not:

* **Background refreshes.** The shell re-reads its counts every minute
  whether anyone is there or not. Those requests carry ``X-UEP-Background``;
  if they renewed the session, an open tab would never time out at all.
* **Bearer clients.** API clients hold their own token and get no cookie.
* **A token minted under a minute ago.** It would buy at most a minute, for a
  Set-Cookie on every response.

The renewed token keeps the claims it had, ``auth_time`` included, so the
absolute deadline still counts from the sign-in. Whether the user is still
active, or their password has changed, is checked by ``core/deps.py`` on every
request as before; renewing a token cannot outlive either.
"""
from datetime import datetime, timedelta, timezone

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token
from app.core.session_cookies import bearer_token, session_token, set_session_cookies

settings = get_settings()

#: The header the frontend sets on requests nobody asked for.
BACKGROUND_HEADER = "x-uep-background"

#: A token younger than this is not renewed.
RENEW_AFTER = timedelta(minutes=1)

# Claims the server adds itself on every token; everything else is carried over.
_MINTED = {"sub", "exp", "iat", "auth_time"}


def renewed_token(token: str, now: datetime | None = None) -> tuple[str, int] | None:
    """A replacement for ``token`` and its lifetime in seconds, or None.

    None when it is invalid, too young to be worth renewing, or past its
    absolute deadline.
    """
    claims = decode_access_token(token)
    if claims is None or "sub" not in claims:
        return None
    now = now or datetime.now(timezone.utc)
    issued = datetime.fromtimestamp(int(claims.get("iat", 0)), tz=timezone.utc)
    if now - issued < RENEW_AFTER:
        return None
    # Tokens from before auth_time existed count from when they were issued.
    signed_in = datetime.fromtimestamp(int(claims.get("auth_time", claims.get("iat", 0))), tz=timezone.utc)
    deadline = signed_in + timedelta(minutes=settings.session_absolute_timeout_minutes)
    expires = min(now + timedelta(minutes=settings.access_token_expire_minutes), deadline)
    lifetime = int((expires - now).total_seconds())
    if lifetime <= 0:
        return None
    extra = {k: v for k, v in claims.items() if k not in _MINTED}
    extra["auth_time"] = int(signed_in.timestamp())
    return create_access_token(claims["sub"], extra, expires_at=expires), lifetime


class SessionRenewalMiddleware(BaseHTTPMiddleware):
    """Slide the session cookie's idle deadline on every request made in it."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        token = session_token(request)
        if (
            token is None
            or bearer_token(request) is not None
            or request.headers.get(BACKGROUND_HEADER)
            or response.status_code == 401
            # Signing in, out, or changing a password set the cookie already.
            or any(
                h.startswith(f"{settings.session_cookie_name}=")
                for h in response.headers.getlist("set-cookie")
            )
        ):
            return response
        renewed = renewed_token(token)
        if renewed is None:
            return response
        new_token, lifetime = renewed
        set_session_cookies(
            response,
            request,
            new_token,
            max_age=lifetime,
            csrf_token=request.cookies.get(settings.csrf_cookie_name),
        )
        return response
