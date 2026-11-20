"""Non-هدف village keys seen by CPM imports (UEP-21 §5.6).

The CPM import drops every row that is not exactly هدف, so ``villages`` never
learns that a village was once اقماری. That memory is what tells two cases
apart when a هدف village appears on a site whose drive test is done:

* **became هدف**: its key was sighted before as non-هدف. The drive test already
  covered it; it is Ready with reason "Became هدف".
* **brand new**: never seen in any CPM file. The drive test did not cover it,
  so the site goes back to drive test.

Keys are stored normalised (``mojri_tracker.match_key``), first sighting only.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.submission import CpmVillageSighting
from app.services.mojri_tracker import MatchKey, match_key

#: (site_code, site_type, village_code, classification) as read from a row.
RawSighting = tuple[object, object, object, str | None]


def known_keys(db: Session) -> set[MatchKey]:
    rows = db.execute(
        select(
            CpmVillageSighting.site_code,
            CpmVillageSighting.site_type,
            CpmVillageSighting.village_code,
        )
    ).all()
    return {tuple(r) for r in rows}  # type: ignore[misc]


def was_sighted(db: Session, key: MatchKey | None) -> bool:
    if key is None:
        return False
    site_code, site_type, village_code = key
    return db.execute(
        select(CpmVillageSighting.id).where(
            CpmVillageSighting.site_code == site_code,
            CpmVillageSighting.site_type == site_type,
            CpmVillageSighting.village_code == village_code,
        )
    ).first() is not None


def record(
    db: Session,
    rows: Iterable[RawSighting],
    seen_at: datetime,
    batch_id: int | None = None,
) -> int:
    """Store the keys not seen before. Returns how many were new.

    Reads the known keys once and adds only the new ones, so a 10,000-row
    file costs one query and one flush.
    """
    known = known_keys(db)
    added = 0
    for site_code, site_type, village_code, classification in rows:
        key = match_key(site_code, site_type, village_code)
        if key is None or key in known:
            continue
        known.add(key)
        db.add(
            CpmVillageSighting(
                site_code=key[0],
                site_type=key[1],
                village_code=key[2],
                classification=(classification or "")[:60] or None,
                first_seen_batch_id=batch_id,
                first_seen_at=seen_at,
            )
        )
        added += 1
    return added
