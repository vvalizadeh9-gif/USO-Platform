"""Who owned a province on a given day, and therefore whom an event credits.

A month's figure goes to whoever owned the province **on the event date**:
the ``province_mapping`` row whose ``[effective_from, effective_to)`` holds
it. Reassigning a province therefore never rewrites history, and a province
that changed hands mid-month credits each owner with their own days.

Two rules close the gaps the table leaves:

* **Before the first row, the first row.** The seed rows open on the day the
  table was created, and the CPM DT dates go back years before that. Crediting
  those years to nobody would make every owner view empty before the deploy,
  so the earliest known owner of a province is credited with the time before
  their row opened. A later reassignment is still exact.
* **Nobody is never dropped.** An event whose province is unknown, has no
  mapping, or whose work item has no DT SC is credited to "Unattributed", so
  owner splits always add up to the row total.

A contractor is credited through the work item's DT SC
(``dt_sc_contractor_id``), as the contractor's scope is defined everywhere
else on the platform.

The lookup is done in Python over the mapping rows (31 provinces, a handful
of rows each) with a binary search per event, which is simpler to read than a
range join and takes microseconds at this size.
"""
from __future__ import annotations

from bisect import bisect_right
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.kpi import ProvinceMapping
from app.services import kpi

UNATTRIBUTED = "Unattributed"


@dataclass(frozen=True)
class Owners:
    """One mapping row: who held one province from ``start`` (to ``end``)."""

    region: str
    coordinator: str
    rm: str
    start: date
    end: date | None

    def name(self, lens: str) -> str:
        return {
            kpi.LENS_REGION: self.region,
            kpi.LENS_COORDINATOR: self.coordinator,
            kpi.LENS_RM: self.rm,
        }[lens]


class Ownership:
    """Every province's owners over time, loaded once per request."""

    def __init__(self, rows: dict[str, list[Owners]]) -> None:
        self._rows = {fa: sorted(spans, key=lambda o: o.start) for fa, spans in rows.items()}
        self._starts = {fa: [o.start for o in spans] for fa, spans in self._rows.items()}

    @classmethod
    def load(cls, db: Session) -> Ownership:
        rows: dict[str, list[Owners]] = {}
        for r in db.execute(
            select(
                ProvinceMapping.province_fa,
                ProvinceMapping.cra_region,
                ProvinceMapping.pso_coordinator,
                ProvinceMapping.regional_manager,
                ProvinceMapping.effective_from,
                ProvinceMapping.effective_to,
            )
        ):
            rows.setdefault(r.province_fa, []).append(
                Owners(r.cra_region, r.pso_coordinator, r.regional_manager,
                       r.effective_from, r.effective_to)
            )
        return cls(rows)

    def at(self, province_fa: str | None, day: date | None) -> Owners | None:
        """The row in force on ``day``; the current row when ``day`` is None."""
        spans = self._rows.get(province_fa) if province_fa else None
        if not spans:
            return None
        if day is None:
            return next((o for o in reversed(spans) if o.end is None), None)
        index = bisect_right(self._starts[province_fa], day) - 1
        # Before the first row opened: the first known owner (module docstring).
        return spans[max(index, 0)]

    def owner(
        self,
        lens: str,
        province_fa: str | None,
        contractor: str | None,
        day: date | None,
    ) -> str:
        """The name one event (or, with ``day=None``, one current cell) is
        credited to under ``lens``. Total: every input gets exactly one."""
        if lens == kpi.LENS_COUNTRY:
            return kpi.COUNTRY_KEY
        if lens == kpi.LENS_CONTRACTOR:
            return contractor or UNATTRIBUTED
        if lens == kpi.LENS_PROVINCE:
            return province_fa or UNATTRIBUTED
        owners = self.at(province_fa, day)
        return owners.name(lens) if owners else UNATTRIBUTED

    def in_scope(self, scope: kpi.Scope, *, dated: bool) -> Callable[..., bool]:
        """A predicate ``(province_fa, contractor, day) -> bool``: does this
        event (``dated``) or current cell (not ``dated``) belong to ``scope``?

        The one way every tab narrows to a scope, so a figure on Month, Area
        and Performance cannot disagree about whose it is.
        """
        if scope.is_country:
            return lambda _p, _c, _d=None: True
        wanted = scope.key.casefold()

        def test(province_fa: str | None, contractor: str | None, day: date | None = None) -> bool:
            name = self.owner(scope.lens, province_fa, contractor, day if dated else None)
            return name.casefold() == wanted

        return test
