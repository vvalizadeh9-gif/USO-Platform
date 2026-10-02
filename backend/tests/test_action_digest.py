"""The daily digest: snapshot every board, email each user once.

* running twice on one day sends one email per user, and replaces rather than
  duplicates the snapshot;
* a failed send is recorded with its reason, and the next run retries it;
* opted-out users, users with no email address and users with nothing
  pending get nothing, and the reason is logged;
* Thursday and Friday write the snapshot but send no email;
* the email carries Shamsi dates in Persian digits and absolute links.
"""
import os
import sys
from datetime import date, datetime, timezone

import pytest

os.environ["DATABASE_URL"] = "sqlite:////tmp/uep_action_digest_pytest.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
from sqlalchemy import JSON, func, select  # noqa: E402

_pg.JSONB = JSON

from app.core import user_status  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.action_center import ActionDailySnapshot, DigestLog  # noqa: E402
from app.services import action_digest  # noqa: E402
from app.services import cpm_columns as C  # noqa: E402
from app.services.mailer import Message  # noqa: E402
from tests.conftest import create_schema  # noqa: E402

SATURDAY = date(2026, 10, 3)
THURSDAY = date(2026, 10, 8)
NOW = datetime(2026, 10, 3, 4, 0, tzinfo=timezone.utc)


class FakeMailer:
    def __init__(self, fail: bool = False):
        self.sent: list[Message] = []
        self.fail = fail

    def send(self, message: Message) -> None:
        if self.fail:
            raise ConnectionRefusedError("relay unreachable")
        self.sent.append(message)


@pytest.fixture(scope="module")
def db():
    if os.path.exists("/tmp/uep_action_digest_pytest.db"):
        os.remove("/tmp/uep_action_digest_pytest.db")
    create_schema()
    from app.core.bootstrap import init_db

    init_db()
    session = SessionLocal()
    try:
        _seed(session)
        yield session
    finally:
        session.close()


def _seed(db):
    from app.models.reference import Contractor, Province, Role, User
    from app.models.workitem import Site, Village, WorkItem

    contractor = Contractor(name="Digest Co", type="drive_test")
    db.add(contractor)
    db.flush()
    roles = {r.name: r for r in db.query(Role).all()}
    province = db.query(Province).order_by(Province.id).first()

    def user(username, role, email, **kw):
        db.add(User(
            username=username, password_hash="x", first_name=username.title(),
            family_name="Digest", role_id=roles[role].id, email=email,
            status=user_status.ACTIVE, **kw,
        ))

    # Three contractors' worth of the same pending village, in four states.
    user("d_sends", "Contractor", "sends@example.com", contractor_id=contractor.id)
    user("d_optout", "Contractor", "optout@example.com", contractor_id=contractor.id,
         email_digest_enabled=False)
    user("d_noemail", "Contractor", None, contractor_id=contractor.id)
    user("d_empty", "PM", "pm@example.com", sees_all_provinces=False)
    user("d_viewer", "Viewer", "viewer@example.com", sees_all_provinces=True)

    site = Site(site_code="DIG-1", province_id=province.id)
    db.add(site)
    db.flush()
    wi = WorkItem(
        site_id=site.id, site_type="Greenfield", requested_technology="4G",
        last_stage=C.STAGE_PERM_ONAIR, dt_status="Done",
        dt_sc_contractor_id=contractor.id, dt_date_gregorian=date(2026, 9, 1),
    )
    db.add(wi)
    db.flush()
    db.add(Village(work_item_id=wi.id, village_code="DIG-V1", target_classification="هدف"))
    db.commit()


def _log(db):
    from app.models.reference import User

    return dict(
        db.execute(
            select(User.username, DigestLog.status).join(User, DigestLog.user_id == User.id)
        ).all()
    )


def _snapshot_rows(db, day):
    return db.scalar(
        select(func.count(ActionDailySnapshot.id)).where(ActionDailySnapshot.snapshot_date == day)
    )


def test_a_failed_send_is_recorded_then_retried(db):
    report = action_digest.run(db, FakeMailer(fail=True), day=SATURDAY, now=NOW)
    assert report.outcomes["failed"] == 1
    row = db.execute(select(DigestLog).where(DigestLog.status == "failed")).scalar_one()
    assert "relay unreachable" in row.error and row.sent_at is None

    mailer = FakeMailer()
    action_digest.run(db, mailer, day=SATURDAY, now=NOW)
    assert [m.to for m in mailer.sent] == ["sends@example.com"]
    assert _log(db)["d_sends"] == "sent"


def test_running_twice_sends_nothing_more(db):
    before = _snapshot_rows(db, SATURDAY)
    mailer = FakeMailer()
    report = action_digest.run(db, mailer, day=SATURDAY, now=NOW)
    assert mailer.sent == []
    assert report.outcomes == {"already_handled": report.snapshots}
    assert _snapshot_rows(db, SATURDAY) == before > 0
    assert db.scalar(select(func.count(DigestLog.id)).where(DigestLog.digest_date == SATURDAY)) == 4


def test_who_is_skipped_and_why(db):
    log = _log(db)
    assert log["d_optout"] == "skipped_opted_out"
    assert log["d_noemail"] == "skipped_no_email"
    assert log["d_empty"] == "skipped_empty"
    assert "d_viewer" not in log, "a Viewer has no Action Center, so no digest"


def test_the_snapshot_records_each_queue(db):
    from app.models.reference import User

    uid = db.query(User).filter(User.username == "d_sends").one().id
    rows = {
        r.queue_key: (r.count, r.overdue)
        for r in db.query(ActionDailySnapshot).filter_by(user_id=uid, snapshot_date=SATURDAY)
    }
    assert rows["ict_to_file"] == (1, 0)
    assert rows["cra_to_file"] == (1, 0)
    assert rows["dt_todo"] == (0, 0)


def test_no_email_on_a_thursday_but_the_snapshot_is_written(db):
    mailer = FakeMailer()
    report = action_digest.run(db, mailer, day=THURSDAY, now=NOW)
    assert mailer.sent == [] and report.outcomes == {}
    assert report.snapshots == 4  # the four users with an Action Center
    assert _snapshot_rows(db, THURSDAY) > 0


def test_the_email_reads_in_shamsi_with_persian_digits_and_absolute_links(db, monkeypatch):
    from app.core.config import get_settings
    from app.models.reference import User
    from app.services.action_queues import board as boards
    from app.services.action_queues.context import QueueContext
    from app.services.action_queues.registry import queues_for

    monkeypatch.setattr(get_settings(), "app_base_url", "https://uep.example.ir/")
    user = db.query(User).filter(User.username == "d_sends").one()
    summaries = boards.queue_summaries(QueueContext(db, user, NOW), queues_for("Contractor"))
    message = action_digest.render(user, SATURDAY, summaries)

    # Two villages to file (one per authority), and four monthly plan streams
    # unfiled past the day-3 deadline.
    assert message.subject == "UEP Action Center — 6 pending, 4 overdue"
    assert "۱۴۰۵/۰۷/۱۱" in message.text  # 3 October 2026
    assert "since ۱۴۰۵/۰۷/۰۱" in message.text  # floored to the tracking epoch
    assert "due ۱۴۰۵/۰۷/۰۳" in message.text  # the plan deadline, day 3
    assert "https://uep.example.ir/my-work?authority=ICT&tab=not_filed" in message.text
    assert "https://uep.example.ir/action-center" in message.html
    assert "Rejected" not in message.text, "zero-count tickets are left out"


def test_the_digest_weekdays_are_saturday_to_wednesday():
    days = [date(2026, 10, d) for d in range(3, 10)]  # Sat 3 .. Fri 9
    assert [action_digest.is_digest_day(d) for d in days] == [
        True, True, True, True, True, False, False,
    ]


def test_the_command_runs_end_to_end(db, capsys):
    from app.jobs import daily_digest

    assert daily_digest.main(["--date", "2026-10-09", "--no-email"]) == 0
    assert '"day": "2026-10-09"' in capsys.readouterr().out
    assert _snapshot_rows(db, date(2026, 10, 9)) > 0
