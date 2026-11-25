"""The footer's status line. Since UEP-25 it reads the System health verdict
(services/system_health.summary), so the footer, Admin Overview and the
System health page always say the same thing."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

#: The version every page footer shows.
APP_VERSION = "1.0.0"


def status(db: Session) -> dict:
    from app.services import system_health

    verdict = system_health.summary(db)
    return {"status": verdict.status, "headline": verdict.headline,
            "checked_at": datetime.now(timezone.utc)}
