"""Which site, village and province each pending item is (UEP-27 list panel).

A queue's fetch returns :class:`PendingItem` rows keyed by whatever its own
screen lists -- a work item, an HC task, a drive test, a village, a case, a
plan. Home's list panel needs the same few facts for every one of them, so
this module resolves ids in two steps, in bulk:

1. **anchor** -- per entity kind, one query from the item's id to the work
   item (and village) it is about;
2. **describe** -- one query for every anchored work item (site code,
   province, CRA region, contractor) and one for every village.

The fetchers are untouched: nothing here decides *which* items are pending.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.acceptance import CpmChangeRequest
from app.models.acceptance_case import AcceptanceCase
from app.models.acceptance_workflow import AcceptanceSubmission
from app.models.health_check import HcRemediation, HcTask
from app.models.monthly_plan import ContractorMonthlyPlan
from app.models.reference import Contractor, Province, Region
from app.models.submission import SubmissionItem
from app.models.workitem import Assignment, DriveTest, Site, Village, WorkItem

ItemId = int | str


@dataclass(frozen=True)
class Anchor:
    """What an item is about: a work item, perhaps one village of it, and a
    label of its own where it is not a site or village (a plan)."""

    work_item_id: int | None
    village_id: int | None = None
    label: str | None = None


@dataclass(frozen=True)
class ItemDetail:
    label: str
    work_item_id: int | None = None
    site_id: str | None = None
    village_name: str | None = None
    province: str | None = None
    cra_region: str | None = None
    contractor: str | None = None


AnchorFn = Callable[[Session, list], dict[ItemId, Anchor]]


def _int_ids(ids: Iterable[ItemId]) -> list[int]:
    return [i for i in ids if isinstance(i, int)]


def _pairs(db: Session, stmt) -> dict[ItemId, Anchor]:
    return {row[0]: Anchor(row[1]) for row in db.execute(stmt).all()}


def _work_items(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return {i: Anchor(i) for i in _int_ids(ids)}


def _hc_tasks(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return _pairs(db, select(HcTask.id, HcTask.work_item_id).where(HcTask.id.in_(_int_ids(ids))))


def _remediations(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return _pairs(db, select(HcRemediation.id, HcRemediation.work_item_id)
                  .where(HcRemediation.id.in_(_int_ids(ids))))


def _drive_tests(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return _pairs(db, select(DriveTest.id, DriveTest.work_item_id)
                  .where(DriveTest.id.in_(_int_ids(ids))))


def _villages(db: Session, ids: list) -> dict[ItemId, Anchor]:
    rows = db.execute(
        select(Village.id, Village.work_item_id).where(Village.id.in_(_int_ids(ids)))
    ).all()
    return {vid: Anchor(wid, vid) for vid, wid in rows}


def _via_village(db: Session, stmt) -> dict[ItemId, Anchor]:
    return {iid: Anchor(wid, vid) for iid, vid, wid in db.execute(stmt).all()}


def _submission_items(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return _via_village(db, select(SubmissionItem.id, Village.id, Village.work_item_id)
                        .join(Village, Village.id == SubmissionItem.village_id)
                        .where(SubmissionItem.id.in_(_int_ids(ids))))


def _cases(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return _via_village(db, select(AcceptanceCase.id, Village.id, Village.work_item_id)
                        .join(Village, Village.id == AcceptanceCase.village_id)
                        .where(AcceptanceCase.id.in_(_int_ids(ids))))


def _assignments(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return _pairs(db, select(Assignment.id, Assignment.work_item_id)
                  .where(Assignment.id.in_(_int_ids(ids))))


def _acceptance_submissions(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return _via_village(db, select(AcceptanceSubmission.id, Village.id, Village.work_item_id)
                        .join(Village, Village.id == AcceptanceSubmission.village_id)
                        .where(AcceptanceSubmission.id.in_(_int_ids(ids))))


def _cpm_changes(db: Session, ids: list) -> dict[ItemId, Anchor]:
    rows = db.execute(
        select(CpmChangeRequest.id, CpmChangeRequest.work_item_id, CpmChangeRequest.site_code)
        .where(CpmChangeRequest.id.in_(_int_ids(ids)))
    ).all()
    return {cid: Anchor(wid, label=code) for cid, wid, code in rows}


def _plan_label(contractor: str | None, stream: str, year: int, month: int) -> str:
    return f"{contractor or 'Contractor'} · {stream} plan {year}/{month:02d}"


def _plans(db: Session, ids: list) -> dict[ItemId, Anchor]:
    """Filed plans by id; a stream not yet filed is ``"{contractor}:{stream}:{y}-{m}"``."""
    names = dict(db.execute(select(Contractor.id, Contractor.name)).all())
    out: dict[ItemId, Anchor] = {}
    for plan in db.execute(
        select(ContractorMonthlyPlan).where(ContractorMonthlyPlan.id.in_(_int_ids(ids)))
    ).scalars():
        out[plan.id] = Anchor(None, label=_plan_label(
            names.get(plan.contractor_id), plan.stream, plan.shamsi_year, plan.shamsi_month))
    for key in (i for i in ids if isinstance(i, str)):
        try:
            cid, stream, period = key.split(":")
            year, month = (int(p) for p in period.split("-"))
            out[key] = Anchor(None, label=_plan_label(names.get(int(cid)), stream, year, month))
        except ValueError:
            out[key] = Anchor(None, label=key)
    return out


def _nothing(db: Session, ids: list) -> dict[ItemId, Anchor]:
    return {}


#: Every entity kind a queue may declare. A kind missing here fails the
#: registry test, not a user's click.
ANCHORS: dict[str, AnchorFn] = {
    "work_item": _work_items,
    "hc_task": _hc_tasks,
    "remediation": _remediations,
    "drive_test": _drive_tests,
    "village": _villages,
    "submission_item": _submission_items,
    "case": _cases,
    "plan": _plans,
    "cpm_change": _cpm_changes,
    "none": _nothing,
    # Done rows only (``done.DoneRule.entity``).
    "assignment": _assignments,
    "acceptance_submission": _acceptance_submissions,
}


@dataclass(frozen=True)
class _Site:
    code: str | None
    province: str | None
    region: str | None
    contractor: str | None


def _sites(db: Session, work_item_ids: set[int]) -> dict[int, _Site]:
    if not work_item_ids:
        return {}
    dt_contractor = Contractor.__table__.alias("dt_contractor")
    rows = db.execute(
        select(WorkItem.id, Site.site_code, Province.name, Region.name, dt_contractor.c.name)
        .join(Site, Site.id == WorkItem.site_id)
        .outerjoin(Province, Province.id == Site.province_id)
        .outerjoin(Region, Region.id == Site.region_id)
        .outerjoin(dt_contractor, dt_contractor.c.id == WorkItem.dt_sc_contractor_id)
        .where(WorkItem.id.in_(work_item_ids))
    ).all()
    return {wid: _Site(code, prov, region, contractor) for wid, code, prov, region, contractor in rows}


def _village_names(db: Session, village_ids: set[int]) -> dict[int, tuple[str | None, str | None]]:
    if not village_ids:
        return {}
    rows = db.execute(
        select(Village.id, Village.village_code, Village.village_name)
        .where(Village.id.in_(village_ids))
    ).all()
    return {vid: (code, name) for vid, code, name in rows}


def describe(db: Session, kind: str, ids: list[ItemId]) -> dict[ItemId, ItemDetail]:
    """Every id's :class:`ItemDetail`; an id the database no longer knows gets
    its own id as its label rather than disappearing from the list."""
    anchors = ANCHORS[kind](db, ids)
    sites = _sites(db, {a.work_item_id for a in anchors.values() if a.work_item_id})
    villages = _village_names(db, {a.village_id for a in anchors.values() if a.village_id})
    out: dict[ItemId, ItemDetail] = {}
    for item_id in ids:
        anchor = anchors.get(item_id, Anchor(None))
        site = sites.get(anchor.work_item_id) if anchor.work_item_id else None
        code, name = villages.get(anchor.village_id, (None, None)) if anchor.village_id else (None, None)
        label = anchor.label or (code if anchor.village_id else None) or (site.code if site else None)
        out[item_id] = ItemDetail(
            label=label or str(item_id),
            work_item_id=anchor.work_item_id,
            site_id=site.code if site else None,
            village_name=name,
            province=site.province if site else None,
            cra_region=site.region if site else None,
            contractor=site.contractor if site else None,
        )
    return out
