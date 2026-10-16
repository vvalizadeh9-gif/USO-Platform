"""Errors caught in the browser (UEP-13).

The interface's error screens show an Error ID; this is where that ID reaches
the server log, so a person reading it out over the phone can be matched to a
stack trace. Nothing is stored: one structured log line per report, at
``level=error`` with ``source=client``, carrying who was signed in.

Rate-limited per user in memory (30 a minute). A page stuck in a render loop
must not flood the log; losing a report past the limit is acceptable because
the browser ignores the answer anyway.
"""
import logging
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.core.deps import get_current_user
from app.models.reference import User

router = APIRouter(tags=["client-errors"])
logger = logging.getLogger("uep.client")

RATE_LIMIT = 30
RATE_WINDOW_S = 60.0
STACK_LIMIT = 4096

_lock = threading.Lock()
_recent: dict[int, deque] = defaultdict(deque)


class ClientErrorIn(BaseModel):
    error_id: str = Field(max_length=32)
    route: str | None = Field(default=None, max_length=512)
    message: str | None = Field(default=None, max_length=2000)
    stack: str | None = None
    release: str | None = Field(default=None, max_length=64)
    user_agent: str | None = Field(default=None, max_length=512)


def _allow(user_id: int) -> bool:
    now = time.monotonic()
    with _lock:
        stamps = _recent[user_id]
        while stamps and now - stamps[0] > RATE_WINDOW_S:
            stamps.popleft()
        if len(stamps) >= RATE_LIMIT:
            return False
        stamps.append(now)
        return True


def reset_rate_limit() -> None:
    """For tests."""
    with _lock:
        _recent.clear()


@router.post("/client-errors", status_code=204)
def report_client_error(body: ClientErrorIn, user: User = Depends(get_current_user)):
    if not _allow(user.id):
        raise HTTPException(status_code=429, detail="Too many error reports")
    logger.error(
        "client error %s",
        body.error_id,
        extra={
            "source": "client",
            "error_id": body.error_id,
            "route": body.route,
            "client_message": body.message,
            "stack": (body.stack or "")[:STACK_LIMIT],
            "release": body.release,
            "user_agent": body.user_agent,
            "user_id": user.id,
            "role": user.role.name if user.role else None,
        },
    )
    return Response(status_code=204)
