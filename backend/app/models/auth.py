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

from sqlalchemy import DateTime, ForeignKey, Index, String
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


class PasswordResetRequest(Base):
    """Someone signed out saying they cannot get in.

    This platform has no outbound mail. The usual "we sent you a link" reset is
    therefore not available, and inventing one -- an SMTP server, a token
    table, a public endpoint that mints credentials -- would be the largest new
    attack surface in the system, added for a handful of internal users who all
    know their administrator personally.

    So the request is a message, not a credential. Someone who cannot sign in
    says so from the login page; an administrator sees it in the console, checks
    by whatever means they already use that the person is who they say, and
    issues a temporary password through the ordinary admin reset. Nothing here
    grants anything, which is what makes it safe to leave reachable without
    authentication.

    ``user_id`` is nullable and the submitted identifier is stored as typed:
    the endpoint answers identically whether or not the account exists -- it
    must not become a way to test which usernames are real -- so a request for
    an unknown name is recorded rather than rejected, and an administrator can
    see that someone has been guessing.
    """

    __tablename__ = "password_reset_requests"
    __table_args__ = (
        # The console's only read: the pending ones, newest first.
        Index("ix_password_reset_requests_status_time", "status", "requested_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    # What the person typed. Not trusted to be a username, or to exist.
    submitted_identifier: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    requested_ip: Mapped[str | None] = mapped_column(String(64))

    # "Pending", "Completed" or "Dismissed". Completed is set by the admin
    # password reset; Dismissed is an administrator saying "this was not a real
    # request", which is the right answer to a name nobody recognises.
    status: Mapped[str] = mapped_column(
        String(20), default="Pending", nullable=False
    )
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
