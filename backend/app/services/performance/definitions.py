"""Every Roles Performance measure, defined once.

Every tab and every export reads this module, and no tab counts a measure its
own way. A second definition of "ICT approved" is how two screens end up
disagreeing about the same number. What each measure is *dated by* lives in
``facts.py``; this module says what it is, what unit it counts, whether lower
is better, and from which month it was recorded.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.kpi import LOW_SAMPLE_DT_DONE, pct

#: Approvals, activity, full config and the problematic flows have no
#: trustworthy dates before Mehr 1405: before it, UEP did not record them.
#: Earlier months read "Not recorded", never 0.
RECORDED_FROM: tuple[int, int] = (1405, 7)

SITES = "sites"
VILLAGES = "villages"

__all__ = ["LOW_SAMPLE_DT_DONE", "pct"]


@dataclass(frozen=True)
class Measure:
    """One countable event.

    ``recorded_from`` is None where a real date exists for any month (on air
    from the CPM launch date, DT done from the CPM DT date). ``villages_too``
    marks the two measures counted in sites *and* villages.
    """

    key: str
    label: str
    unit: str
    recorded_from: tuple[int, int] | None = RECORDED_FROM
    lower_is_better: bool = False
    villages_too: bool = False

    def is_recorded(self, year: int, month: int) -> bool:
        return self.recorded_from is None or (year, month) >= self.recorded_from


ON_AIR = Measure("on_air", "On air", SITES, recorded_from=None, villages_too=True)
DT_DONE = Measure("dt_done", "DT done", SITES, recorded_from=None, villages_too=True)
ICT_APPROVED = Measure("ict_approved", "ICT approved", VILLAGES)
CRA_APPROVED = Measure("cra_approved", "CRA approved", VILLAGES)
#: The later of the two approvals, once both are in.
FULLY_APPROVED = Measure("fully_approved", "Fully approved", VILLAGES)
#: A confirmed ``Ready`` health check, dated by confirmation (``reviewed_at``).
FULL_CONFIG = Measure("full_config", "Became full config", SITES)
#: A confirmed ``NotReady`` whose previous confirmed result was ``Ready``.
FELL_BACK = Measure("fell_back", "Fell back", SITES, lower_is_better=True)
PROBLEM_RESOLVED = Measure("problem_resolved", "Resolved", SITES)
PROBLEM_NEW = Measure("problem_new", "New problems", SITES, lower_is_better=True)

MEASURES: dict[str, Measure] = {
    m.key: m
    for m in (
        ON_AIR,
        DT_DONE,
        ICT_APPROVED,
        CRA_APPROVED,
        FULLY_APPROVED,
        FULL_CONFIG,
        FELL_BACK,
        PROBLEM_RESOLVED,
        PROBLEM_NEW,
    )
}


@dataclass(frozen=True)
class Section:
    """One card on the Month tab. ``block`` is what one block is worth."""

    key: str
    title: str
    block: int
    block_unit: str
    measures: tuple[Measure, ...]


MONTH_SECTIONS: tuple[Section, ...] = (
    Section("delivery", "Project delivery", 5, SITES, (ON_AIR, DT_DONE)),
    Section(
        "acceptance",
        "Acceptance",
        10,
        VILLAGES,
        (ICT_APPROVED, CRA_APPROVED, FULLY_APPROVED),
    ),
    Section("full_config", "Full config", 5, SITES, (FULL_CONFIG, FELL_BACK)),
    Section("problematic", "Problematic", 5, SITES, (PROBLEM_RESOLVED, PROBLEM_NEW)),
)


# ----- Rates ----------------------------------------------------------------
#
# On air % and DT done % divide by the scope's villages. ICT % and CRA %
# divide by DT-done villages, because a village whose drive test is unfinished
# was never eligible for acceptance. Fully accepted % divides by villages.


@dataclass(frozen=True)
class Rate:
    key: str
    label: str
    count: str
    base: str


RATES: dict[str, Rate] = {
    r.key: r
    for r in (
        Rate("on_air", "On air", "villages_on_air", "villages"),
        Rate("dt_done", "DT done", "villages_dt_done", "villages"),
        Rate("ict", "ICT approved", "ict_approved", "villages_dt_done"),
        Rate("cra", "CRA approved", "cra_approved", "villages_dt_done"),
        Rate("fully", "Fully accepted", "fully_approved", "villages"),
    )
}
