"""CSRF protection for the cookie session. See :mod:`app.core.session_cookies`.

Two checks, on every request that can change something:

1. **Origin.** If the browser says which page started the request (``Origin``,
   or failing that ``Referer``) and that page is on another host, refuse it.
   Browsers send ``Origin`` on every cross-origin write, so this alone stops a
   form on another site posting to the API -- including to ``/auth/login``,
   which has no session yet for the token check below to compare against.
   Requests with neither header (scripts, the test client) pass: they are not
   a browser being steered by someone else's page.
2. **Double-submit token.** A write authenticated by the session cookie must
   carry the CSRF cookie's value in the ``X-CSRF-Token`` header. A write
   authenticated by a Bearer header needs no token: no other site can make a
   browser attach that header.
"""
import secrets
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.core.config import get_settings
from app.core.session_cookies import bearer_token, session_token

settings = get_settings()

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

CROSS_SITE_REFUSED = "Requests from another site are not accepted"
TOKEN_REFUSED = "Your session's security token is missing or out of date. Reload the page and try again"


def _hostname(url: str) -> str | None:
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


def _origin_allowed(request: Request) -> bool:
    """False only when the browser names a starting page on another host.

    Compared by host name, not port: nginx forwards ``Host`` without the port,
    and two ports on one host are the same site to a browser's SameSite rules
    anyway. Origins listed exactly in CORS_ORIGINS are allowed as well, for a
    frontend served from a different address than the API; a ``*`` there (a
    development setting) does not switch this check off.
    """
    source = request.headers.get("origin") or request.headers.get("referer")
    if source is None:
        return True
    # A sandboxed frame or a privacy redirect sends the literal "null".
    if source == "null":
        return False
    if source.rstrip("/") in settings.cors_origin_list:
        return True
    source_host = _hostname(source)
    request_host = _hostname(f"//{request.headers.get('host', '')}")
    return source_host is not None and source_host == request_host


def _token_matches(request: Request) -> bool:
    cookie = request.cookies.get(settings.csrf_cookie_name, "")
    header = request.headers.get(settings.csrf_header_name, "")
    return bool(cookie) and bool(header) and secrets.compare_digest(cookie, header)


def csrf_refusal(request: Request) -> str | None:
    """Why this request must be refused, or None if it may proceed."""
    if request.method.upper() in SAFE_METHODS:
        return None
    if not _origin_allowed(request):
        return CROSS_SITE_REFUSED
    if bearer_token(request) is not None or session_token(request) is None:
        return None
    return None if _token_matches(request) else TOKEN_REFUSED


class CsrfMiddleware(BaseHTTPMiddleware):
    """Refuse writes that fail :func:`csrf_refusal` with a 403."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        reason = csrf_refusal(request)
        if reason is not None:
            return JSONResponse(status_code=403, content={"detail": reason})
        return await call_next(request)
