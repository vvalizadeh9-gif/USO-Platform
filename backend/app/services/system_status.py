"""The footer's "All systems normal": whether the database answers."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

#: The version every page footer shows.
APP_VERSION = "1.0.0"


def status(db: Session) -> dict:
    try:
        db.execute(text("SELECT 1"))
        state = "normal"
    except SQLAlchemyError:
        state = "degraded"
    return {"status": state, "checked_at": datetime.now(timezone.utc)}
