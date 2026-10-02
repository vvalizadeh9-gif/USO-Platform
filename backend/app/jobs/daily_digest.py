"""The Action Center's daily run: snapshot every board, then email digests.

    python -m app.jobs.daily_digest              # today, Tehran calendar
    python -m app.jobs.daily_digest --date 2026-10-03
    python -m app.jobs.daily_digest --no-email   # snapshot only

Schedule it once a day (see README, "Action Center digest"). Safe to run
again on the same day: snapshots are replaced and each user gets at most one
email per day. Exits non-zero only if the run itself could not start.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date

from app.core.database import SessionLocal
from app.core.logging_config import configure_logging
from app.services import action_digest
from app.services.mailer import SmtpMailer

log = logging.getLogger("app.jobs.daily_digest")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--date", type=date.fromisoformat, default=None,
                        help="The Gregorian day to run for (default: today in Tehran)")
    parser.add_argument("--no-email", action="store_true",
                        help="Write the snapshot only; send nothing")
    parser.add_argument("--force-email", action="store_true",
                        help="Send even if the day is not a digest weekday")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    args = parse_args(argv)
    send = False if args.no_email else (True if args.force_email else None)
    db = SessionLocal()
    try:
        report = action_digest.run(db, SmtpMailer(), day=args.date, send=send)
    finally:
        db.close()
    log.info("daily digest finished", extra={"report": json.dumps(
        {"day": report.day.isoformat(), "snapshots": report.snapshots, **report.outcomes}
    )})
    print(json.dumps({"day": report.day.isoformat(), "snapshots": report.snapshots,
                      **report.outcomes}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
