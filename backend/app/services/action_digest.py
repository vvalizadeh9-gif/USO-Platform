"""The daily run: write each user's snapshot, then send each user one digest.

Idempotent by construction, so running it twice in a day (a retried cron, a
manual run) is harmless:

* the snapshot is replaced, not appended -- (date, user, queue) is unique;
* an email is sent only by the run that *claims* the user's ``digest_log``
  row for the day. The row is unique on (user, date); the run whose insert
  wins sends, every other run sees the row and moves on. A row left
  ``failed`` may be claimed again by a later run, which is how a mail outage
  in the morning still gets everyone their digest once it clears.

Started by ``python -m app.jobs.daily_digest`` from cron or a CronJob, never
from inside the API: every API worker would run its own copy and send
duplicates.
"""
from __future__ import annotations

import html
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import jalali, user_status
from app.core.config import get_settings
from app.core.digits import to_persian
from app.models.action_center import (
    DIGEST_FAILED,
    DIGEST_SENDING,
    DIGEST_SENT,
    DIGEST_SKIPPED_EMPTY,
    DIGEST_SKIPPED_NO_EMAIL,
    DIGEST_SKIPPED_OPTED_OUT,
    ActionDailySnapshot,
    DigestLog,
)
from app.models.reference import User
from app.services.action_queues import board as boards
from app.services.action_queues.context import QueueContext, board_role
from app.services.action_queues.registry import queues_for
from app.services.action_queues.sla import TEHRAN
from app.services.action_queues.types import STAGE_LABELS
from app.services.mailer import Mailer, Message

log = logging.getLogger(__name__)

#: Python's weekday() numbers, by the names DIGEST_WEEKDAYS uses.
WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}

MAX_ERROR_LENGTH = 2000


@dataclass
class RunReport:
    day: date
    snapshots: int = 0
    outcomes: dict[str, int] = field(default_factory=dict)

    def count(self, outcome: str) -> None:
        self.outcomes[outcome] = self.outcomes.get(outcome, 0) + 1


# --------------------------------------------------------------------------
# Snapshot
# --------------------------------------------------------------------------
def write_snapshot(
    db: Session, user: User, day: date, summaries: list[boards.QueueSummary]
) -> None:
    """Replace this user's snapshot for ``day``. Caller commits."""
    db.execute(
        delete(ActionDailySnapshot).where(
            ActionDailySnapshot.snapshot_date == day,
            ActionDailySnapshot.user_id == user.id,
        )
    )
    db.add_all(
        ActionDailySnapshot(
            snapshot_date=day, user_id=user.id, queue_key=s.queue.key,
            count=s.count, overdue=s.overdue,
        )
        for s in summaries
    )


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------
def shamsi(value: datetime | date | None) -> str:
    """A date as Persian readers write it: ``۱۴۰۵/۰۷/۰۹``."""
    if value is None:
        return "—"
    day = value.astimezone(TEHRAN).date() if isinstance(value, datetime) else value
    return to_persian(jalali.format_shamsi(day))


def _ticket_date(s: boards.QueueSummary) -> str:
    if s.date_kind == "due":
        return f"due {shamsi(s.earliest_due_at)}"
    return f"since {shamsi(s.oldest_started_at)}"


def render(user: User, day: date, summaries: list[boards.QueueSummary]) -> Message:
    base = get_settings().app_base_url.rstrip("/")
    live = [s for s in summaries if s.count]
    pending = sum(s.count for s in live)
    overdue = sum(s.overdue for s in live)
    today = shamsi(day)

    subject = f"UEP Action Center — {pending} pending, {overdue} overdue"
    lines = [
        f"{user.full_name}, your Action Center for {today}:",
        f"{pending} pending, {overdue} overdue.",
        "",
    ]
    rows = []
    for s in live:
        stage = STAGE_LABELS[s.queue.stage]
        late = f", {s.overdue} overdue" if s.overdue else ""
        link = f"{base}{s.queue.url}"
        lines.append(f"- {stage} · {s.queue.label}: {s.count}{late} ({_ticket_date(s)})  {link}")
        rows.append(
            "<tr>"
            f"<td style='padding:4px 12px 4px 0;color:#5F6B7E'>{html.escape(stage)}</td>"
            f"<td style='padding:4px 12px 4px 0'><a href='{html.escape(link)}'>"
            f"{html.escape(s.queue.label)}</a></td>"
            f"<td style='padding:4px 12px 4px 0;text-align:right;font-weight:600'>{s.count}</td>"
            f"<td style='padding:4px 12px 4px 0;color:#B42F2A'>"
            f"{f'{s.overdue} overdue' if s.overdue else ''}</td>"
            f"<td style='padding:4px 0;font-family:Vazirmatn,Tahoma,sans-serif'>"
            f"{html.escape(_ticket_date(s))}</td>"
            "</tr>"
        )
    lines += ["", f"Open the Action Center: {base}/action-center",
              "You can turn this email off in UEP under your notification settings."]

    body = (
        "<div style='font-family:Inter,Arial,sans-serif;color:#141B2B;font-size:14px'>"
        f"<p style='font-family:Vazirmatn,Tahoma,sans-serif;color:#5F6B7E'>{today}</p>"
        f"<p><strong>{pending} pending</strong>, "
        f"<strong style='color:#B42F2A'>{overdue} overdue</strong></p>"
        f"<table style='border-collapse:collapse'>{''.join(rows)}</table>"
        f"<p><a href='{html.escape(base)}/action-center'>Open the Action Center</a></p>"
        "<p style='color:#5F6B7E;font-size:12px'>You can turn this email off in UEP "
        "under your notification settings.</p></div>"
    )
    return Message(to=user.email or "", subject=subject, text="\n".join(lines), html=body)


# --------------------------------------------------------------------------
# Claiming and sending
# --------------------------------------------------------------------------
def _record(db: Session, user: User, day: date, status: str) -> bool:
    """Insert today's row with ``status``; False if this user already has one."""
    db.add(DigestLog(user_id=user.id, digest_date=day, status=status))
    try:
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def claim(db: Session, user: User, day: date) -> bool:
    """Take the right to send today's digest. Exactly one run gets it.

    A new row is claimed by inserting it; a failed one by moving it back to
    ``sending`` -- a conditional update, so two runs retrying together cannot
    both win.
    """
    if _record(db, user, day, DIGEST_SENDING):
        return True
    result = db.execute(
        update(DigestLog)
        .where(
            DigestLog.user_id == user.id,
            DigestLog.digest_date == day,
            DigestLog.status == DIGEST_FAILED,
        )
        .values(status=DIGEST_SENDING, error=None)
    )
    db.commit()
    return result.rowcount == 1


def _finish(db: Session, user: User, day: date, status: str, error: str | None = None) -> None:
    db.execute(
        update(DigestLog)
        .where(DigestLog.user_id == user.id, DigestLog.digest_date == day)
        .values(
            status=status,
            error=error[:MAX_ERROR_LENGTH] if error else None,
            sent_at=datetime.now(timezone.utc) if status == DIGEST_SENT else None,
        )
    )
    db.commit()


def skip_reason(user: User, summaries: list[boards.QueueSummary]) -> str | None:
    if not user.email_digest_enabled:
        return DIGEST_SKIPPED_OPTED_OUT
    if not user.email:
        return DIGEST_SKIPPED_NO_EMAIL
    if not any(s.count for s in summaries):
        return DIGEST_SKIPPED_EMPTY
    return None


def deliver(
    db: Session, mailer: Mailer, user: User, day: date, summaries: list[boards.QueueSummary]
) -> str | None:
    """Send this user's digest once; the outcome, or None if another run has it."""
    reason = skip_reason(user, summaries)
    if reason is not None:
        return reason if _record(db, user, day, reason) else None
    if not claim(db, user, day):
        return None
    try:
        mailer.send(render(user, day, summaries))
    except Exception as exc:  # noqa: BLE001 -- any failure is recorded, then retried
        log.warning("digest to user %s failed: %s", user.id, exc)
        _finish(db, user, day, DIGEST_FAILED, f"{type(exc).__name__}: {exc}")
        return DIGEST_FAILED
    _finish(db, user, day, DIGEST_SENT)
    return DIGEST_SENT


# --------------------------------------------------------------------------
# The run
# --------------------------------------------------------------------------
def is_digest_day(day: date) -> bool:
    names = [n.strip().lower() for n in get_settings().digest_weekdays.split(",")]
    return day.weekday() in {WEEKDAYS[n] for n in names if n in WEEKDAYS}


def board_users(db: Session) -> list[User]:
    users = db.execute(select(User).where(User.status == user_status.ACTIVE)).scalars()
    return [u for u in users if board_role(u) is not None]


def run(db: Session, mailer: Mailer, *, day: date | None = None,
        now: datetime | None = None, send: bool | None = None) -> RunReport:
    """Snapshot every Action Center user, then email those due a digest.

    ``send`` defaults to whether ``day`` is a digest weekday. One user's
    failure never stops the run: it is logged and recorded, and the next user
    is served.
    """
    day = day or jalali.tehran_today()
    now = now or datetime.now(timezone.utc)
    send = is_digest_day(day) if send is None else send
    report = RunReport(day)

    for user in board_users(db):
        try:
            ctx = QueueContext(db, user, now)
            summaries = boards.queue_summaries(ctx, queues_for(board_role(user)))
            write_snapshot(db, user, day, summaries)
            db.commit()
            report.snapshots += 1
        except Exception:  # noqa: BLE001 -- one user's data must not stop the run
            db.rollback()
            log.exception("action snapshot for user %s failed", user.id)
            report.count("snapshot_failed")
            continue
        if send:
            try:
                outcome = deliver(db, mailer, user, day, summaries)
            except Exception:  # noqa: BLE001 -- e.g. the log row could not be written
                db.rollback()
                log.exception("digest bookkeeping for user %s failed", user.id)
                outcome = "delivery_error"
            report.count(outcome or "already_handled")
    return report
