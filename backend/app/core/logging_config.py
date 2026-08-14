"""Application logging.

There was no logging configuration anywhere before this. When something went
wrong in production the only trace was whatever uvicorn happened to print, which
for an unhandled exception is a stack trace with no indication of who was
signed in or what they were doing.

Two decisions worth knowing about:

**Everything goes to stdout.** Not to a file. The container's job is to produce
a stream of lines; Docker captures it, so ``docker logs`` works, and any log
collector added later reads the same stream without the application changing.
Writing to a file inside a container means the logs disappear when it is
replaced.

**Never log a password, a token, or a whole request body.** A CPM import body is
fifteen thousand rows of real village data, and a login body contains a
password. What is recorded is the method, the path, the status, how long it
took, and who was signed in -- enough to find the problem, not enough to leak
anything. Query strings are dropped as well, since they end up in logs that get
copied around.
"""
import json
import logging
import sys
import time
import uuid
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.security import decode_access_token

settings = get_settings()

# Attributes the standard library puts on every LogRecord. Anything else was
# added by the caller through `extra=`, so it belongs in the JSON output.
_STANDARD_FIELDS = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | {"asctime", "message", "taskName"}


class JsonFormatter(logging.Formatter):
    """One JSON object per line, which is what log collectors expect."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for key, value in record.__dict__.items():
            if key not in _STANDARD_FIELDS and not key.startswith("_"):
                payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """Readable single lines, for watching `docker logs` by eye."""

    def __init__(self) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        extras = {
            k: v
            for k, v in record.__dict__.items()
            if k not in _STANDARD_FIELDS and not k.startswith("_")
        }
        if extras:
            line += " | " + " ".join(f"{k}={v}" for k, v in extras.items())
        return line


def configure_logging() -> None:
    """Send application logs to stdout in the configured format."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter() if settings.log_format.lower() == "json" else TextFormatter()
    )

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())

    # uvicorn installs its own handlers; clearing them stops every line being
    # printed twice, once in its format and once in ours.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True

    # SQLAlchemy logs every statement at INFO, which at this volume drowns
    # everything else. Warnings and above still come through.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def _acting_user_id(request) -> int | None:
    """Who is making this request, from their token.

    Read straight from the JWT rather than the database, because this runs on
    every request including the failing ones, and a log line must never be the
    thing that opens a database connection. Returns None for anonymous requests
    and for tokens that do not validate.
    """
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    claims = decode_access_token(header.split(" ", 1)[1].strip())
    if not claims:
        return None
    try:
        return int(claims.get("sub"))
    except (TypeError, ValueError):
        return None


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log the outcome of every request, and every unhandled exception.

    Each request gets a short id which appears on both the error line and the
    request line, so a stack trace can be tied to the request that caused it
    even on a busy server.
    """

    def __init__(self, app) -> None:
        super().__init__(app)
        self._logger = logging.getLogger("uep.request")

    async def dispatch(self, request, call_next):
        request_id = uuid.uuid4().hex[:12]
        started = time.perf_counter()

        # Deliberately not request.url.query: query strings carry filter values
        # and would end up in copied-around log files.
        context = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "user_id": _acting_user_id(request),
        }

        try:
            response = await call_next(request)
        except Exception:
            self._logger.exception(
                "Unhandled exception",
                extra={
                    **context,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            # Re-raised so FastAPI still returns its 500. The point here is that
            # the failure is recorded with enough context to investigate, not to
            # change what the caller sees.
            raise

        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        # Server errors are warnings-and-above so they surface at any log level;
        # ordinary traffic sits at INFO and can be turned off with LOG_LEVEL.
        level = logging.ERROR if response.status_code >= 500 else logging.INFO
        self._logger.log(
            level,
            "%s %s -> %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                **context,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        response.headers["X-Request-ID"] = request_id
        return response
