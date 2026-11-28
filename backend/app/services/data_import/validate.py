"""The row rules (§5.3), and grouping drive test values per work item (§5.1).

Drive test columns describe a *site*, so they are gathered over every row of
the work item: per column, the one non-empty value. Villages that disagree
refuse that site's drive test; their ICT / CRA cells are still checked on
their own.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from app.services import mojri_tracker

from . import columns as C
from .current import Universe, Value
from .reader import BadDate, RawRow, as_text, parse_date

AUTHORITIES = ("ICT", "CRA")


@dataclass
class Row:
    raw: RawRow
    key_text: str
    work_item_id: int | None = None
    village_ids: list[int] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    dt_refused: bool = False
    #: authority -> field -> canonical value, only for an authority whose
    #: cells passed every rule.
    acc: dict[str, dict[str, str]] = field(default_factory=dict)
    #: Authorities whose letter number was blank and became NO-LETTER.
    no_letter: set[str] = field(default_factory=set)

    def error(self, column: str | None, message: str) -> None:
        self.errors.append({"field": column, "message": message})

    @property
    def status(self) -> str:
        if any(e.get("scope") != "dt" for e in self.errors):
            return "error"
        if self.dt_refused:
            return "dt_refused"
        return "ok"


@dataclass
class Site:
    work_item_id: int
    label: str
    #: field -> canonical value (only the non-empty ones).
    values: dict[str, str] = field(default_factory=dict)
    rows: list[Row] = field(default_factory=list)
    refused: str | None = None


@dataclass
class Checked:
    rows: list[Row]
    sites: dict[int, Site]
    warnings: list[str]


def _key_text(raw: RawRow) -> str:
    return " · ".join(raw.text(k) or "—" for k in C.KEY_COLUMNS)


def check(read_rows: list[RawRow], universe: Universe, dt_now: dict[int, dict[str, Value]],
          today: date) -> Checked:
    rows: list[Row] = []
    seen: dict[tuple, list[Row]] = defaultdict(list)

    for raw in read_rows:
        if raw.text("site_id").upper().startswith(C.EXAMPLE_PREFIX):
            continue
        row = Row(raw, _key_text(raw))
        rows.append(row)
        key = mojri_tracker.match_key(raw.cells.get("site_id"), raw.cells.get("site_type"),
                                      raw.cells.get("village_code"))
        if key is None:
            row.error(None, "Site ID, Site type and Village code are all required")
            continue
        seen[key].append(row)
        villages = universe.by_key.get(key)
        if not villages:
            others = universe.site_types.get((key[0], key[2]), set())
            if others:
                found = " / ".join(sorted(others))
                row.error(None, f"Site/village not found as {raw.text('site_type')}. "
                                f"Found as {found}, not {raw.text('site_type')}")
            else:
                row.error(None, "Site/village not found in UEP")
            continue
        row.work_item_id = villages[0].work_item_id
        row.village_ids = [v.id for v in villages]

    for dupes in seen.values():
        if len(dupes) > 1:
            numbers = ", ".join(str(r.raw.row_no) for r in dupes)
            for r in dupes:
                r.error(None, f"Duplicate row (rows {numbers})")
                r.work_item_id = None

    sites = _group_sites(rows, universe, dt_now, today)
    for row in rows:
        if row.work_item_id is not None and not any(e.get("scope") != "dt" for e in row.errors):
            _check_acceptance(row, universe, sites, dt_now, today)

    warnings = sorted({w for r in rows for w in r.warnings})
    return Checked(rows, sites, warnings)


# --------------------------------------------------------------------------
# Drive test, per work item
# --------------------------------------------------------------------------
def _dt_cell(row: Row, key: str, universe: Universe, today: date) -> str | None:
    raw_value = row.raw.cells.get(key)
    text = as_text(raw_value)
    if not text:
        return None
    if key in C.DATE_FIELDS:
        day = parse_date(raw_value, today)
        return day.isoformat() if day else None
    if key == "dt_contractor":
        cid = universe.contractors.get(text.casefold())
        if cid is None:
            raise BadDate(f'"{text}" is not a known contractor')
        return universe.contractor_names[cid]
    if key == "dt_result":
        for v in C.DT_RESULTS:
            if v.casefold() == text.casefold():
                return v
        raise BadDate(f'"{text}" is not a known DT result (Done or Problematic)')
    if key == "problem_category":
        name = universe.problem_categories.get(text.casefold())
        if name is None:
            raise BadDate(f'"{text}" is not a known problem category')
        return name
    if key == "dt_comment" and len(text) > C.MAX_COMMENT:
        row.warnings.append(f"A comment longer than {C.MAX_COMMENT} characters was cut")
        return text[: C.MAX_COMMENT]
    return text


def _group_sites(rows: list[Row], universe: Universe, dt_now, today: date) -> dict[int, Site]:
    sites: dict[int, Site] = {}
    values: dict[int, dict[str, dict[str, list[int]]]] = defaultdict(lambda: defaultdict(dict))
    for row in rows:
        if row.work_item_id is None:
            continue
        wi = universe.work_items[row.work_item_id]
        site = sites.get(wi.id)
        if site is None:
            site = sites[wi.id] = Site(wi.id, f"{wi.site_code} {wi.site_type}")
        site.rows.append(row)
        for key in C.DT_FIELDS:
            try:
                value = _dt_cell(row, key, universe, today)
            except BadDate as exc:
                row.error(key, str(exc))
                site.refused = site.refused or f"{C.label(key)}: {exc}"
                continue
            if value is not None:
                values[wi.id][key].setdefault(value, []).append(row.raw.row_no)

    for wid, site in sites.items():
        for key, found in values[wid].items():
            if len(found) > 1:
                shown = ", ".join(sorted(found))
                site.refused = site.refused or (
                    f"Villages of {site.label} have different {C.label(key)}: {shown}"
                )
            elif found:
                site.values[key] = next(iter(found))
        if site.refused is None and site.values:
            site.refused = _site_rule(site, universe, dt_now.get(wid, {}))
        if site.refused:
            site.values = {}
            for row in site.rows:
                row.dt_refused = True
                if not any(e.get("field") in C.DT_FIELDS for e in row.errors):
                    row.errors.append({"field": "dt", "scope": "dt",
                                       "message": f"Drive test refused for this site: {site.refused}"})
                else:
                    for e in row.errors:
                        if e.get("field") in C.DT_FIELDS:
                            e["scope"] = "dt"
    return sites


def _site_rule(site: Site, universe: Universe, now: dict[str, Value]) -> str | None:
    v = site.values
    wi = universe.work_items[site.work_item_id]
    if not wi.requested:
        return "Technology not requested: CPM requested no technology for this site"
    order = [k for k in ("assignment_date", "dt_date", "ssv_date", "dt_approved_date") if v.get(k)]
    for first, second in zip(order, order[1:], strict=False):
        if v[first] > v[second]:
            return ("Dates out of order: Assignment ≤ DT date ≤ SSV submission ≤ DT approved "
                    f"({C.label(first)} {v[first]} is after {C.label(second)} {v[second]})")
    result = v.get("dt_result")
    if result == C.DT_PROBLEMATIC and not v.get("problem_category"):
        return "Problem category required when DT result is Problematic"
    if result == C.DT_DONE and not (v.get("dt_date") or now.get("dt_date", Value(None)).value):
        return "DT date required when DT result is Done"
    if v.get("assignment_date") and not (v.get("dt_contractor") or now.get("dt_contractor", Value(None)).value):
        return "DT contractor required with an assignment date"
    effective = result or now.get("dt_result", Value(None)).value
    if v.get("problem_category") and effective != C.DT_PROBLEMATIC:
        return "Problem category is only for DT result Problematic"
    return None


def site_dt_done(site: Site | None, now: dict[str, Value]) -> bool:
    """Done in this file (and not refused), or Done in UEP."""
    if site is not None and site.refused is None and site.values.get("dt_result") == C.DT_DONE:
        return True
    if site is not None and site.values.get("dt_result") == C.DT_PROBLEMATIC:
        return False
    return now.get("dt_result", Value(None)).value == C.DT_DONE


# --------------------------------------------------------------------------
# ICT / CRA, per village
# --------------------------------------------------------------------------
def _check_acceptance(row: Row, universe: Universe, sites: dict[int, Site], dt_now, today: date) -> None:
    wi = universe.work_items[row.work_item_id]
    for authority in AUTHORITIES:
        cells = {f: row.raw.cells.get(C.acc_key(authority, f)) for f in C.ACC_FIELDS}
        if all(not as_text(v) for v in cells.values()):
            continue
        before = len(row.errors)
        parsed: dict[str, str] = {}

        result = as_text(cells["result"])
        if result:
            match = next((r for r in C.ACC_RESULTS if r.casefold() == result.casefold()), None)
            if match is None:
                row.error(C.acc_key(authority, "result"),
                          f'"{result}" is not a known {authority} result (Approved or Rejected)')
            else:
                parsed["result"] = match
        number = as_text(cells["letter_number"])
        if number:
            parsed["letter_number"] = number[:120]
        try:
            day = parse_date(cells["letter_date"], today)
            if day:
                parsed["letter_date"] = day.isoformat()
        except BadDate as exc:
            row.error(C.acc_key(authority, "letter_date"), str(exc))
        category = as_text(cells["rejection_category"])
        if category:
            cat = universe.rejection_categories.get(category.casefold())
            if cat is None:
                row.error(C.acc_key(authority, "rejection_category"),
                          f'"{category}" is not a known rejection category')
            else:
                parsed["rejection_category"] = cat.label
        comment = as_text(cells["comment"])
        if comment:
            if len(comment) > C.MAX_COMMENT:
                row.warnings.append(f"A comment longer than {C.MAX_COMMENT} characters was cut")
                comment = comment[: C.MAX_COMMENT]
            parsed["comment"] = comment

        res = parsed.get("result")
        if res and parsed.get("letter_date") and not parsed.get("letter_number"):
            # A historical verdict with no letter number: the agreed placeholder.
            parsed["letter_number"] = C.NO_LETTER
            row.no_letter.add(authority)
        if res and not parsed.get("letter_date"):
            row.error(C.acc_key(authority, "letter_date"), f"{authority}: letter date required")
        if not res and (parsed.get("letter_number") or parsed.get("letter_date")):
            row.error(C.acc_key(authority, "result"),
                      f"{authority}: result required with a letter")
        if res == C.ACC_REJECTED and not parsed.get("rejection_category"):
            row.error(C.acc_key(authority, "rejection_category"),
                      f"{authority}: rejection category required when Rejected")
        if parsed.get("rejection_category") and res != C.ACC_REJECTED:
            row.error(C.acc_key(authority, "rejection_category"),
                      f"{authority}: rejection category is only for Rejected")
        if not wi.requested:
            row.error(C.acc_key(authority, "result"),
                      "Technology not requested: CPM requested no technology for this site")
        elif res and not site_dt_done(sites.get(wi.id), dt_now.get(wi.id, {})):
            row.error(C.acc_key(authority, "result"), "Drive test not done for this site")

        if len(row.errors) == before:
            row.acc[authority] = parsed
        else:
            row.no_letter.discard(authority)
