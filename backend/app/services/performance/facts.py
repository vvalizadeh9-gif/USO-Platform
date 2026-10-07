"""The dated facts every Roles Performance tab counts. Loaded once per request.

This is the read model behind :mod:`definitions`: it says what each measure
is **dated by**, and nothing else does.

=====================  ==================================================
On air                 the CPM launch date (``launch_date_gregorian``, else
                       the parsed ``launch_date_shamsi``); failing both, the
                       first non-backfilled ``lifecycle_status_history`` row.
                       A village takes its site's date.
DT done                ``work_items.dt_date_gregorian`` (CPM).
ICT / CRA approved     ``reviewed_at`` of the last validated round, for a
                       village approved today. Once approved, nothing more
                       can be filed, so the last validated round is the one
                       that approved it.
Fully approved         the later of the two.
Became full config     ``hc_tasks.reviewed_at`` of a confirmed ``Ready``
                       that follows anything but ``Ready``.
Fell back              ``reviewed_at`` of a confirmed ``NotReady`` whose
                       previous confirmed result was ``Ready``.
Problematic new /      the transitions in
resolved               :func:`drive_test_analytics.problem_events`, the
                       function the monthly snapshot itself is built on.
=====================  ==================================================

"Today" (the Area tab) is read from the same rows: a village is on air when
its site is, DT done when its site is, approved when its cached status says
so. One load, so a figure on Month and the same figure on Area cannot come
from two different readings.

Everything is a live read. At about 4.4k villages it is a few queries and a
few milliseconds of Python; :func:`load` is the one function a materialised
view would replace.
"""
from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field, fields
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance_workflow import (
    AUTHORITY_CRA,
    AUTHORITY_ICT,
    REVIEW_VALIDATED,
    AcceptanceSubmission,
)
from app.models.performance import (
    ENTITY_SITE,
    ENTITY_VILLAGE,
    STATUS_ON_AIR,
    LifecycleStatusHistory,
)
from app.models.reference import Contractor, Province
from app.models.workitem import Village, WorkItem
from app.services import dt_universe, kpi
from app.services import drive_test_analytics as dta
from app.services.performance import definitions as D
from app.services.performance.periods import Window, tehran_day

APPROVED = kpi.APPROVED
READY = "Ready"
NOT_READY = "NotReady"


@dataclass(frozen=True, slots=True)
class Fact:
    """One dated event, credited to a (province, contractor) cell."""

    measure: str
    unit: str
    day: date
    province_fa: str | None
    contractor: str | None


@dataclass(slots=True)
class SiteNow:
    """One live work item ("site") as it stands today."""

    id: int
    province_fa: str | None
    contractor: str | None
    on_air: bool
    dt_done: bool
    problematic: bool
    on_air_day: date | None
    dt_day: date | None


@dataclass(slots=True)
class VillageNow:
    """One live target village as it stands today."""

    id: int
    site: SiteNow
    ict: bool
    cra: bool
    ict_day: date | None
    cra_day: date | None

    @property
    def fully(self) -> bool:
        return self.ict and self.cra

    @property
    def fully_day(self) -> date | None:
        if not self.fully or self.ict_day is None or self.cra_day is None:
            return None
        return max(self.ict_day, self.cra_day)


@dataclass
class Cell:
    """Today's counters for one (province, contractor) cell. Every Area figure
    is a sum of these, so a region agrees with its provinces and the rows
    agree with the total."""

    villages: int = 0
    villages_on_air: int = 0
    villages_dt_done: int = 0
    ict_approved: int = 0
    cra_approved: int = 0
    fully_approved: int = 0
    not_on_air: int = 0
    waiting_dt: int = 0
    ict_open: int = 0
    cra_open: int = 0
    sites: int = 0
    sites_on_air: int = 0
    sites_dt_done: int = 0
    problematic: int = 0

    @property
    def remaining(self) -> int:
        """Villages not yet approved by both ICT and CRA."""
        return self.villages - self.fully_approved

    def add(self, other: Cell) -> None:
        for f in fields(self):
            setattr(self, f.name, getattr(self, f.name) + getattr(other, f.name))


CellKey = tuple[str | None, str | None]


@dataclass
class Facts:
    sites: list[SiteNow]
    villages: list[VillageNow]
    events: list[Fact]
    #: On-air sites that carry no date at all: counted today, in no month.
    undated_on_air: int = 0
    _cells: dict[CellKey, Cell] | None = field(default=None, repr=False)

    def cells(self) -> dict[CellKey, Cell]:
        """Today's counters, grouped by (province, contractor)."""
        if self._cells is None:
            self._cells = _fold_cells(self.sites, self.villages)
        return self._cells

    def dated(
        self, measure: str, unit: str, window: Window | None = None
    ) -> Iterator[Fact]:
        for fact in self.events:
            if fact.measure == measure and fact.unit == unit and (
                window is None or fact.day in window
            ):
                yield fact


def load(db: Session) -> Facts:
    """Every live site and target village, and every dated event."""
    province_names = dict(db.execute(select(Province.id, Province.name)).all())
    contractor_names = dict(db.execute(select(Contractor.id, Contractor.name)).all())
    first_seen = _first_seen_on_air(db)

    rows = dt_universe.load_all(db)
    sites: dict[int, SiteNow] = {}
    events: list[Fact] = []
    undated = 0
    for row in rows:
        site = _site_now(row, province_names, contractor_names, first_seen)
        sites[row.id] = site
        if site.on_air and site.on_air_day is None:
            undated += 1
        events.extend(_site_events(row, site))

    approvals = _approval_days(db)
    villages = []
    for vid, work_item_id, ict_status, cra_status in _target_villages(db):
        site = sites.get(work_item_id)
        if site is None:
            continue
        village = VillageNow(
            id=vid,
            site=site,
            ict=ict_status == APPROVED,
            cra=cra_status == APPROVED,
            ict_day=approvals.get((vid, AUTHORITY_ICT)) if ict_status == APPROVED else None,
            cra_day=approvals.get((vid, AUTHORITY_CRA)) if cra_status == APPROVED else None,
        )
        villages.append(village)
        events.extend(_village_events(village, first_seen))

    return Facts(sites=list(sites.values()), villages=villages, events=events,
                 undated_on_air=undated)


# ----- Sites ----------------------------------------------------------------


def launch_day(row) -> date | None:
    """The CPM launch date: the Gregorian cell first, the typed Shamsi text as
    the fallback, skipped when it does not parse (as ``onair_month`` does)."""
    if row.launch_date_gregorian is not None:
        return row.launch_date_gregorian
    if row.launch_date_shamsi:
        try:
            return jalali.parse_shamsi(row.launch_date_shamsi)
        except ValueError:
            return None
    return None


def _site_now(row, province_names, contractor_names, first_seen) -> SiteNow:
    on_air = dta.is_onair(row)
    dt_done = dta.is_dt_done(row)
    province_id = row.site.province_id if row.site is not None else None
    on_air_day = None
    if on_air:
        on_air_day = launch_day(row) or first_seen.get((ENTITY_SITE, row.id))
    return SiteNow(
        id=row.id,
        province_fa=province_names.get(province_id),
        contractor=contractor_names.get(row.dt_sc_contractor_id),
        on_air=on_air,
        dt_done=dt_done,
        problematic=dta.is_problematic(row),
        on_air_day=on_air_day,
        dt_day=row.dt_date_gregorian if dt_done else None,
    )


def _site_events(row, site: SiteNow) -> Iterator[Fact]:
    def fact(measure: str, day: date) -> Fact:
        return Fact(measure, D.SITES, day, site.province_fa, site.contractor)

    if site.on_air_day is not None:
        yield fact(D.ON_AIR.key, site.on_air_day)
    if site.dt_day is not None:
        yield fact(D.DT_DONE.key, site.dt_day)
    for day, measure in _config_transitions(row.hc_tasks):
        yield fact(measure, day)
    for day, measure in _problem_transitions(row):
        yield fact(measure, day)


def _config_transitions(tasks: Iterable) -> Iterator[tuple[date, str]]:
    """Became full config / fell back, from the confirmed results in order."""
    confirmed = sorted(
        (t for t in tasks
         if t.reviewed_at is not None and t.overall_result in (READY, NOT_READY)),
        key=lambda t: (t.reviewed_at, t.id),
    )
    previous = None
    for task in confirmed:
        day = tehran_day(task.reviewed_at)
        if task.overall_result == READY and previous != READY:
            yield day, D.FULL_CONFIG.key
        elif task.overall_result == NOT_READY and previous == READY:
            yield day, D.FELL_BACK.key
        previous = task.overall_result


def _problem_transitions(row) -> Iterator[tuple[date, str]]:
    """New / resolved problems: each change of state in ``problem_events``."""
    problematic = False
    for day, _tie, now_problematic in dta.problem_events(row):
        if now_problematic == problematic:
            continue
        problematic = now_problematic
        yield day, (D.PROBLEM_NEW.key if now_problematic else D.PROBLEM_RESOLVED.key)


def _first_seen_on_air(db: Session) -> dict[tuple[str, int], date]:
    """The fallback on-air dates. Backfilled rows are not dates (see model)."""
    rows = db.execute(
        select(
            LifecycleStatusHistory.entity_type,
            LifecycleStatusHistory.entity_id,
            LifecycleStatusHistory.first_seen_at,
        ).where(
            LifecycleStatusHistory.status == STATUS_ON_AIR,
            LifecycleStatusHistory.backfilled.is_(False),
        )
    ).all()
    return {(kind, entity_id): tehran_day(seen) for kind, entity_id, seen in rows}


# ----- Villages -------------------------------------------------------------


def _target_villages(db: Session):
    targets = kpi.target_values(db)
    return db.execute(
        select(Village.id, Village.work_item_id, Village.ict_status, Village.cra_status)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .where(
            Village.deleted_at.is_(None),
            WorkItem.deleted_at.is_(None),
            Village.target_classification.in_(targets or [""]),
        )
    ).all()


def _approval_days(db: Session) -> dict[tuple[int, str], date]:
    """``(village_id, authority) -> day`` of the last validated round."""
    rows = db.execute(
        select(
            AcceptanceSubmission.village_id,
            AcceptanceSubmission.authority,
            func.max(AcceptanceSubmission.reviewed_at),
        )
        .where(
            AcceptanceSubmission.review_status == REVIEW_VALIDATED,
            AcceptanceSubmission.reviewed_at.is_not(None),
        )
        .group_by(AcceptanceSubmission.village_id, AcceptanceSubmission.authority)
    ).all()
    return {(vid, authority): tehran_day(at) for vid, authority, at in rows}


def _village_events(village: VillageNow, first_seen) -> Iterator[Fact]:
    site = village.site

    def fact(measure: str, day: date) -> Fact:
        return Fact(measure, D.VILLAGES, day, site.province_fa, site.contractor)

    if site.on_air:
        day = site.on_air_day or first_seen.get((ENTITY_VILLAGE, village.id))
        if day is not None:
            yield fact(D.ON_AIR.key, day)
    if site.dt_day is not None:
        yield fact(D.DT_DONE.key, site.dt_day)
    if village.ict_day is not None:
        yield fact(D.ICT_APPROVED.key, village.ict_day)
    if village.cra_day is not None:
        yield fact(D.CRA_APPROVED.key, village.cra_day)
    if village.fully_day is not None:
        yield fact(D.FULLY_APPROVED.key, village.fully_day)


# ----- Today ----------------------------------------------------------------


def _fold_cells(sites: list[SiteNow], villages: list[VillageNow]) -> dict[CellKey, Cell]:
    cells: dict[CellKey, Cell] = {}

    def cell(site: SiteNow) -> Cell:
        return cells.setdefault((site.province_fa, site.contractor), Cell())

    for site in sites:
        c = cell(site)
        c.sites += 1
        c.sites_on_air += site.on_air
        c.sites_dt_done += site.dt_done
        c.problematic += site.problematic
    for village in villages:
        site = village.site
        c = cell(site)
        c.villages += 1
        c.villages_on_air += site.on_air
        c.villages_dt_done += site.dt_done
        c.ict_approved += village.ict
        c.cra_approved += village.cra
        c.fully_approved += village.fully
        c.not_on_air += not site.on_air
        c.waiting_dt += site.on_air and not site.dt_done
        c.ict_open += site.dt_done and not village.ict
        c.cra_open += site.dt_done and not village.cra
    return cells


def total(cells: Iterable[Cell]) -> Cell:
    out = Cell()
    for c in cells:
        out.add(c)
    return out
