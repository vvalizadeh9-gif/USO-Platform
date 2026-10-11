"""The browser session: an HttpOnly cookie, and the CSRF token that goes with it.

The access token used to be handed to the page in the login response and kept
in localStorage, where every script on the page could read it. One injected
script was then enough to carry the session off to another machine. Now the
browser holds it in a cookie marked HttpOnly, which no script can read, and the
page never sees it at all.

A cookie is sent by the browser on its own, though, which is what CSRF is: a
page on another site making the browser send a request it did not mean to.
Three things stop that, and :mod:`app.core.csrf` enforces the last two:

* **SameSite=Strict.** The browser does not attach the cookie to a request
  that another site started.
* **Origin check.** A write whose ``Origin`` (or ``Referer``) names another
  site is refused, whatever it carries.
* **Double-submit token.** Signing in also sets ``uep_csrf``, a random value
  in a cookie the page *can* read. A write authenticated by the session cookie
  must echo it in the ``X-CSRF-Token`` header. Another site can make the
  browser send the cookie but cannot read it, so it cannot write the header.

API clients and the test suite still send ``Authorization: Bearer``. A header
is never attached by the browser on its own, so those requests carry no CSRF
risk and skip the token check.
"""
import secrets

from fastapi import Request, Response

from app.core.config import get_settings

settings = get_settings()

# The session cookie is only ever needed by the API, so the browser sends it
# nowhere else. The CSRF cookie has to be readable from every page.
_SESSION_PATH = "/api"
_CSRF_PATH = "/"
_SAME_SITE = "strict"


def _is_secure(request: Request) -> bool:
    """Whether to mark the cookies Secure. See ``session_cookie_secure``."""
    if settings.session_cookie_secure is not None:
        return settings.session_cookie_secure
    # nginx terminates TLS and forwards plain HTTP, so the scheme the browser
    # used is in the header, not on the connection.
    forwarded = request.headers.get("x-forwarded-proto", "")
    scheme = forwarded.split(",")[0].strip() or request.url.scheme
    return scheme.lower() == "https"


def set_session_cookies(response: Response, request: Request, token: str) -> None:
    """Start (or renew) a browser session holding ``token``.

    Both cookies live exactly as long as the token does, so the browser drops
    them at the moment the server would refuse them anyway. A fresh CSRF token
    is issued with every new session.
    """
    max_age = settings.access_token_expire_minutes * 60
    secure = _is_secure(request)
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=max_age,
        path=_SESSION_PATH,
        secure=secure,
        httponly=True,
        samesite=_SAME_SITE,
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        secrets.token_urlsafe(32),
        max_age=max_age,
        path=_CSRF_PATH,
        secure=secure,
        # Readable on purpose: the page has to copy it into a header.
        httponly=False,
        samesite=_SAME_SITE,
    )


def clear_session_cookies(response: Response, request: Request) -> None:
    """End the browser session by expiring both cookies."""
    secure = _is_secure(request)
    response.delete_cookie(
        settings.session_cookie_name,
        path=_SESSION_PATH,
        secure=secure,
        httponly=True,
        samesite=_SAME_SITE,
    )
    response.delete_cookie(
        settings.csrf_cookie_name,
        path=_CSRF_PATH,
        secure=secure,
        samesite=_SAME_SITE,
    )


def bearer_token(request: Request) -> str | None:
    """The token from an ``Authorization: Bearer`` header, if there is one."""
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def session_token(request: Request) -> str | None:
    """The token from the session cookie, if there is one."""
    return request.cookies.get(settings.session_cookie_name) or None


def request_token(request: Request) -> str | None:
    """The token this request is authenticated with.

    A Bearer header wins over the cookie: it was put there deliberately by the
    caller, where the cookie may only be a leftover in the browser's jar.
    """
    return bearer_token(request) or session_token(request)
