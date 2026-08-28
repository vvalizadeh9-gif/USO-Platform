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

State lives in the database. It used to live in a dict on the process, which
was the right trade for one container and had two acknowledged costs: the
counters reset whenever the backend restarted, and a second backend would count
separately. The restart case is the one that bit -- a deploy clears a lockout in
progress, and the moment you least want that is the moment someone is working
through a password list while a colleague happens to deploy.

The database needs no new component, is already backed up, and is already on
the path of every request. The cost is one small query per login attempt, on an
endpoint that runs bcrypt anyway.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.auth import LoginAttempt

settings = get_settings()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(moment: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; treat those as UTC."""
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


class LoginRateLimiter:
    """Counts failed logins per key and locks the key out past a threshold."""

    def _retry_after(self, db: Session, key: str, limit: int, now: datetime) -> int:
        """Seconds until *key* may try again, or 0 if it may try now.

        The lockout is derived from the attempts rather than stored separately:
        once ``limit`` failures sit inside the window, the key is locked until
        ``lockout_seconds`` after the most recent one. Deriving it means there
        is one fact in the database, not two that can disagree.
        """
        window_start = now - timedelta(seconds=settings.login_attempt_window_seconds)
        row = db.execute(
            select(func.count(LoginAttempt.id), func.max(LoginAttempt.attempted_at))
            .where(LoginAttempt.key == key, LoginAttempt.attempted_at > window_start)
        ).one()
        count, latest = row[0], _as_aware(row[1])

        if count < limit or latest is None:
            return 0

        unlock_at = latest + timedelta(seconds=settings.login_lockout_seconds)
        remaining = (unlock_at - now).total_seconds()
        return int(remaining) + 1 if remaining > 0 else 0

    def check(self, db: Session, username: str, ip: str) -> int:
        """Return 0 if this attempt may proceed, else seconds to wait."""
        now = _now()
        return max(
            self._retry_after(
                db, f"user:{username.lower()}", settings.login_max_attempts_per_username, now
            ),
            self._retry_after(db, f"ip:{ip}", settings.login_max_attempts_per_ip, now),
        )

    def record_failure(self, db: Session, username: str, ip: str) -> None:
        """Record one failure against both keys. Commits.

        Committed here rather than left to the caller, because the caller's
        next act is to raise a 401 -- and a counter that is rolled back by the
        response it belongs to would never count anything.
        """
        now = _now()
        for key in (f"user:{username.lower()}", f"ip:{ip}"):
            db.add(LoginAttempt(key=key, attempted_at=now))
        self._prune(db, now)
        db.commit()

    def record_success(self, db: Session, username: str, ip: str) -> None:
        """Clear the counters for a successful login. Commits.

        Clearing the IP counter too is deliberate: a shared office address
        should not accumulate towards a lockout because several people there
        each mistyped a password once.
        """
        db.execute(
            delete(LoginAttempt).where(
                LoginAttempt.key.in_([f"user:{username.lower()}", f"ip:{ip}"])
            )
        )
        self._prune(db, _now())
        db.commit()

    def _prune(self, db: Session, now: datetime) -> None:
        """Drop rows too old to affect any decision. Caller commits.

        Anything older than the window plus the lockout can no longer hold a
        key locked, so it is only taking up space. Done opportunistically on
        write rather than on a schedule -- there is no scheduler here, and the
        table is only written on a failed login.
        """
        cutoff = now - timedelta(
            seconds=settings.login_attempt_window_seconds
            + settings.login_lockout_seconds
        )
        db.execute(delete(LoginAttempt).where(LoginAttempt.attempted_at < cutoff))

    def reset(self, db: Session) -> None:
        """Forget everything. For tests."""
        db.execute(delete(LoginAttempt))
        db.commit()


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
