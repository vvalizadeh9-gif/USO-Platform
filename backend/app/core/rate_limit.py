"""Throttling for the login endpoint.

The math captcha on the login form stops a browser being held down on the submit
button. It is not a defence against password guessing: the captcha is solved by
reading two numbers out of the same JSON response that carries the challenge, so
a script gets past it in one extra line. This module is the actual limit.

**Only failed attempts count, and a success clears the record.** A person who
types their password correctly never meets a limit no matter how often they log
in. Someone working through a password list meets it on the sixth guess.

Two counters, because they stop different things:

* **Per username** -- someone guessing one account's password, from anywhere.
* **Per IP address** -- someone spraying one common password across many
  usernames, which no single username counter would ever see.

State is held in memory. That is the right trade for this deployment: there is
one backend container, so one process sees every login attempt. It does mean the
counters reset if the container restarts, which is a real limitation -- an
attacker who could restart the backend would not need to guess passwords anyway.
If UEP is ever run as more than one backend container, this needs to move to
Redis or the database, or each container will enforce the limit separately.
"""
import threading
import time
from dataclasses import dataclass, field

from app.core.config import get_settings

settings = get_settings()


@dataclass
class _Attempts:
    """Failed attempts for one key, and when the lockout ends."""

    timestamps: list[float] = field(default_factory=list)
    locked_until: float = 0.0


class LoginRateLimiter:
    """Counts failed logins per key and locks the key out past a threshold."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: dict[str, _Attempts] = {}

    def _retry_after(self, key: str, limit: int, now: float) -> int:
        """Seconds until *key* may try again, or 0 if it may try now.

        Assumes the caller holds the lock.
        """
        record = self._records.get(key)
        if record is None:
            return 0

        if record.locked_until > now:
            return int(record.locked_until - now) + 1

        # Drop attempts that have aged out of the window.
        cutoff = now - settings.login_attempt_window_seconds
        record.timestamps = [t for t in record.timestamps if t > cutoff]

        if len(record.timestamps) >= limit:
            record.locked_until = now + settings.login_lockout_seconds
            return settings.login_lockout_seconds
        return 0

    def check(self, username: str, ip: str) -> int:
        """Return 0 if this attempt may proceed, else seconds to wait."""
        now = time.monotonic()
        with self._lock:
            return max(
                self._retry_after(
                    f"user:{username.lower()}",
                    settings.login_max_attempts_per_username,
                    now,
                ),
                self._retry_after(
                    f"ip:{ip}", settings.login_max_attempts_per_ip, now
                ),
            )

    def record_failure(self, username: str, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in (f"user:{username.lower()}", f"ip:{ip}"):
                self._records.setdefault(key, _Attempts()).timestamps.append(now)
            self._prune(now)

    def record_success(self, username: str, ip: str) -> None:
        """Clear the counters for a successful login.

        Clearing the IP counter too is deliberate: a shared office address
        should not accumulate towards a lockout because several people there
        each mistyped a password once.
        """
        with self._lock:
            self._records.pop(f"user:{username.lower()}", None)
            self._records.pop(f"ip:{ip}", None)

    def _prune(self, now: float) -> None:
        """Forget keys with nothing left to remember. Caller holds the lock.

        Without this the dictionary would grow forever on a long-running
        process being sprayed with made-up usernames.
        """
        cutoff = now - settings.login_attempt_window_seconds
        for key in [
            k
            for k, r in self._records.items()
            if r.locked_until <= now and not [t for t in r.timestamps if t > cutoff]
        ]:
            del self._records[key]

    def reset(self) -> None:
        """Forget everything. For tests."""
        with self._lock:
            self._records.clear()


login_rate_limiter = LoginRateLimiter()


def client_ip(request) -> str:
    """Best-effort client address.

    nginx sits in front of the backend, so every connection appears to come from
    the proxy. It sets X-Forwarded-For, and the left-most entry is the original
    client. Trusting that header is only safe because nothing but our own nginx
    can reach the backend port -- if the backend were ever exposed directly, a
    caller could forge it and sidestep the per-IP limit. The per-username limit
    does not depend on it.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
