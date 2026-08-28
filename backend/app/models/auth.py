"""Durable state for login throttling and captcha replay.

Both of these used to live in process memory, which was documented and was the
right trade for one backend container. It had two consequences the comments
were honest about: the counters reset whenever the container restarted, and a
second backend would enforce the limits separately, each seeing a fraction of
the attempts.

The first of those is not hypothetical. A deploy restarts the backend, so any
lockout in progress was cleared by the next `docker compose up -d` — and the
one moment you most want a lockout to survive is the one where someone is
working through a password list while a colleague happens to deploy.

Putting them in the database fixes both, and needs no new component: the
database is already there, already backed up, and already the thing every
request talks to. The cost is one small query per login attempt, on an endpoint
that is deliberately slow anyway because it runs bcrypt.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LoginAttempt(Base):
    """One failed sign-in, against a username or a source address.

    Successes are never recorded, and a success deletes the rows for that key,
    so someone who knows their password never accumulates anything. Rows are
    pruned as they age out of the window.
    """

    __tablename__ = "login_attempts"
    __table_args__ = (
        # Every read is "attempts for this key since this moment", so the index
        # carries both columns in that order.
        Index("ix_login_attempts_key_time", "key", "attempted_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Either "user:<username>" or "ip:<address>" — the two counters answer
    # different questions and are stored the same way.
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class SpentCaptcha(Base):
    """A captcha challenge that has already been answered correctly.

    The primary key is what enforces single use: a second attempt to claim the
    same challenge violates it, which is a guarantee a read-then-write check
    cannot make. Rows are deleted once the token they refer to has expired
    anyway, so the table stays bounded by the number of captchas issued in five
    minutes.
    """

    __tablename__ = "spent_captchas"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
