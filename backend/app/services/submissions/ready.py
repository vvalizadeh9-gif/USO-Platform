"""What is ready to send to ICT HQ, grouped by site, with one reason each.

A village is Ready when it is in the universe (live, pure هدف, drive test
done) and has no active submission item: not in a draft, not sent, not found
in Mojri. A village marked "Send again" from Follow up has had its item
superseded, so it is Ready again by the same rule.

Its reason, first match wins (UEP-21 §3.3):

1. ``resend``         it was sent before and marked Send again
2. ``became_target``  its key was sighted as non-هدف by an earlier CPM import
3. ``new_dt``         its site's drive test was approved in the app, and none
                      of the site's villages has an active item yet (the whole
                      site goes)
4. ``missed``         everything else -- typically DT done by the first CPM
                      import and never sent
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.models.reference import User
from app.models.submission import (
    REASON_BECAME_TARGET,
    REASON_MISSED,
    REASON_NEW_DT,
    REASON_RESEND,
    SubmissionItem,
)
from app.models.workitem import DriveTest, Village, WorkItem
from app.services.mojri_tracker import match_key
from app.services.submissions import scope, sightings

#: The side panel's order.
REASONS = (REASON_NEW_DT, REASON_MISSED, REASON_BECAME_TARGET, REASON_RESEND)

APPROVED = "Approved"


@dataclass(frozen=True)
class ReadyVillage:
    village_id: int
    village_code: str | None
    village_name: str | None
    work_item_id: int
    site_type: str | None
    site_code: str | None
    province: str | None
    cra_region: str | None
    dt_date: date | None
    reason: str
    #: When it became ready: the latest of first seen, DT done and Send again.
    ready_since: date | None


def active_item_exists():
    return exists().where(
        SubmissionItem.village_id == Village.id, SubmissionItem.superseded_at.is_(None)
    )


def _resent(db: Session, village_ids: list[int]) -> dict[int, datetime]:
    """Villages with a sent item superseded by Send again, and when."""
    if not village_ids:
        return {}
    rows = db.execute(
        select(SubmissionItem.village_id, func.max(SubmissionItem.superseded_at))
        .where(
            SubmissionItem.village_id.in_(village_ids),
            SubmissionItem.superseded_at.isnot(None),
            SubmissionItem.sent_at.isnot(None),
        )
        .group_by(SubmissionItem.village_id)
    ).all()
    return dict(rows)


def _approved_in_app(db: Session, work_item_ids: set[int]) -> set[int]:
    if not work_item_ids:
        return set()
    return set(
        db.execute(
            select(DriveTest.work_item_id).where(
                DriveTest.work_item_id.in_(work_item_ids),
                DriveTest.is_active.is_(True),
                DriveTest.status == APPROVED,
            )
        ).scalars()
    )


def _with_active_items(db: Session, work_item_ids: set[int]) -> set[int]:
    if not work_item_ids:
        return set()
    return set(
        db.execute(
            select(Village.work_item_id)
            .join(SubmissionItem, SubmissionItem.village_id == Village.id)
            .where(
                Village.work_item_id.in_(work_item_ids),
                SubmissionItem.superseded_at.is_(None),
            )
        ).scalars()
    )


def _as_date(value: datetime | date | None) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    return value


def _reason(row, resent: dict, sighted: set, new_dt_sites: set[int]) -> str:
    if row.village_id in resent:
        return REASON_RESEND
    if match_key(row.site_code, row.site_type, row.village_code) in sighted:
        return REASON_BECAME_TARGET
    if row.work_item_id in new_dt_sites:
        return REASON_NEW_DT
    return REASON_MISSED


def ready_villages(db: Session, user: User) -> list[ReadyVillage]:
    """Every Ready village in the user's scope, with its reason."""
    stmt = scope.village_select(Village.first_seen_at, WorkItem.dt_date_gregorian).where(
        scope.universe(db), ~active_item_exists()
    )
    rows = db.execute(scope.in_scope(stmt, db, user)).all()
    sites = {r.work_item_id for r in rows}
    resent = _resent(db, [r.village_id for r in rows])
    sighted = sightings.known_keys(db)
    new_dt_sites = _approved_in_app(db, sites) - _with_active_items(db, sites)
    out = []
    for r in rows:
        since = [d for d in (_as_date(r.first_seen_at), r.dt_date_gregorian,
                             _as_date(resent.get(r.village_id))) if d is not None]
        out.append(
            ReadyVillage(
                village_id=r.village_id, village_code=r.village_code,
                village_name=r.village_name, work_item_id=r.work_item_id,
                site_type=r.site_type, site_code=r.site_code, province=r.province,
                cra_region=r.cra_region, dt_date=r.dt_date_gregorian,
                reason=_reason(r, resent, sighted, new_dt_sites),
                ready_since=max(since) if since else None,
            )
        )
    return out


def reason_counts(villages: list[ReadyVillage]) -> dict[str, int]:
    counts = Counter(v.reason for v in villages)
    return {"all": len(villages), **{reason: counts.get(reason, 0) for reason in REASONS}}


def target_totals(db: Session, work_item_ids: set[int]) -> dict[int, int]:
    """Each site's live pure هدف villages: the "of N" in "2 of 2"."""
    if not work_item_ids:
        return {}
    rows = db.execute(
        select(Village.work_item_id, func.count(Village.id))
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .where(scope.universe(db), Village.work_item_id.in_(work_item_ids))
        .group_by(Village.work_item_id)
    ).all()
    return dict(rows)


def _village_row(v: ReadyVillage) -> dict:
    return {"id": v.village_id, "code": v.village_code, "name": v.village_name,
            "reason": v.reason}


def group_by_site(villages: list[ReadyVillage], totals: dict[int, int]) -> list[dict]:
    """Rows are sites (work items); each carries its Ready villages."""
    by_site: dict[int, list[ReadyVillage]] = defaultdict(list)
    for v in villages:
        by_site[v.work_item_id].append(v)
    sites = []
    for work_item_id, group in by_site.items():
        first = group[0]
        sites.append({
            "work_item_id": work_item_id,
            "site_code": first.site_code,
            "site_type": first.site_type,
            "province": first.province,
            "cra_region": first.cra_region,
            "dt_date": first.dt_date,
            "villages_ready": len(group),
            "villages_total": totals.get(work_item_id, len(group)),
            "villages": [_village_row(v) for v in sorted(group, key=lambda x: x.village_code or "")],
        })
    sites.sort(key=lambda s: (s["site_code"] or "", s["site_type"] or ""))
    return sites


def filtered(villages: list[ReadyVillage], reason: str | None, since: date | None) -> list[ReadyVillage]:
    out = villages
    if reason and reason != "all":
        out = [v for v in out if v.reason == reason]
    if since is not None:
        out = [v for v in out if v.ready_since is not None and v.ready_since >= since]
    return out


def ready_list(
    db: Session, user: User, reason: str | None = None, since: date | None = None
) -> dict:
    villages = ready_villages(db, user)
    shown = filtered(villages, reason, since)
    totals = target_totals(db, {v.work_item_id for v in shown})
    return {
        "counts": reason_counts(villages),
        "sites": group_by_site(shown, totals),
        "villages": len(shown),
    }
