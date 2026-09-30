"""Mojri tracker reconciliation: the template, the preview, and the write.

ICT HQ (Mojri) keeps its own tracker of which villages are registered with it.
That tracker is a third party's spreadsheet, not ours, and it lags behind the
verdicts we have already recorded. This module answers one question per village
per authority — *has Mojri's tracker caught up?* — and it answers it from a file
a person cleaned by hand.

**It reads acceptance and never writes it.** Nothing here touches
``acceptances``, ``villages.ict_status``/``cra_status`` or any submission. A
village's standing with ICT and CRA is decided by the acceptance workflow; this
is a parallel record of somebody else's paperwork.

### Why the round trip is a template, and not a parser

Mojri's raw file is not ours, its layout changes, and it is not worth guessing
at. So the platform hands out a template with one row per village eligible for
tracking and the technology columns blank; the team fills it in from Mojri's
file by hand, outside UEP; and the filled template comes back here. The manual
step is deliberate.

### How a row finds its village

By the **business key** ``(site_code, site_type, village_code)`` — the codes
the team's own tracker uses — and never by ``villages.id``. Nobody filling the
file can know an internal primary key; asking for one produced a file of CPM
village codes that matched nothing, or, worse, matched the unrelated village
whose primary key happened to equal the code. The key is exactly what
identifies a ``villages`` row: a work item is unique per (site, site_type) and a
village belongs to one work item.

* Each part is compared after :func:`normalize_key_part` — trimmed, internal
  spaces collapsed, case-folded, and an integral number compared as the text of
  the integer (``229164``, ``229164.0`` and ``" 229164 "`` are one code). The
  same function reads the file and the database, so the two sides cannot
  disagree about spelling.
* Only live villages are candidates: neither the village nor its work item
  soft-deleted.
* **One key, several villages.** CPM legitimately lists the same village twice
  on one work item, and UEP counts those rows without de-duplication. The
  row's statuses are applied to every live village the key matches, so the
  figure it is read back into moves for all of them.
* **One key, several rows.** Rows that read the same are one answer and are
  accepted. Rows that disagree are listed in the preview and none of them is
  written: taking the last would silently lose the other claim.
* **Legacy headers, for one transition only.** ``site_id`` is read as
  ``site_code`` and ``village_id`` as ``village_code``
  (:data:`LEGACY_HEADER_ALIASES`): the template used to write the site code
  under ``site_id``, and the team's current file carries CPM village codes
  under ``village_id``. The values already are codes; only the names are old.

### How a cell is read

Per authority, per village, for **each technology that village actually
requested**:

* a positive cell (:func:`acceptance_tokens.is_positive`: a recognised yes, or
  the column's own technology name — ``2G`` in the 2G column, the original CPM
  convention) → that technology is in the tracker;
* blank → not in the tracker;
* anything else — an unrecognised word, a note, a cell carrying an Excel
  comment — → **needs a look**.

Then the village's status for that authority is ``in_tracker`` only if every
requested technology reads in_tracker, and ``needs_look`` if any single one
does. Never an average, never a majority: three technologies registered and one
unreadable is a village somebody has to look at, not a village that is 75%
registered.

Two consequences worth stating because both look like omissions:

**A recognised negative token routes to needs_look, not to not_in_tracker.**
``services/acceptance_tokens.py`` knows "no", "رد" and friends, and the CPM
importer turns them into a Rejected verdict. Here they do not become "not in
the tracker": in a registration column those are different facts — "Mojri
refused this" and "Mojri has not got to this yet" — and recording one as the
other would invent a decision nobody made.

**Cells for technologies the village never requested are ignored entirely,
whatever they contain.** A 3G/4G village's 2G column is not "not yet
registered"; it is a column that does not apply. Counting it would report a
permanent gap that can never close.

### Full snapshot, never incremental

Each file is Mojri's tracker as of that month. Villages in the file are written
whole. A village that was in the tracker last import and is **absent** from this
one is a discrepancy the preview names — and is left exactly as it was. A
village silently reverting to "not registered" because somebody filtered a row
out of a spreadsheet is the one failure this feature cannot be allowed to have.

### Nothing writes before Confirm

:func:`preview` opens the file, reads every cell, and returns what would happen.
It writes nothing at all. :func:`commit` re-reads the same file — identified by
its SHA-256, so what is written is provably what was previewed — and is the only
function here that touches the database.
"""
from __future__ import annotations

import hashlib
import io
import re
from collections import defaultdict
from dataclasses import dataclass, field

from fastapi import HTTPException
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.jalali import current_shamsi_period
from app.models.mojri import (
    IN_TRACKER,
    NEEDS_LOOK,
    NOT_IN_TRACKER,
    MojriImportRun,
    MojriTrackerStatus,
)
from app.models.workitem import Site, Village, WorkItem
from app.services import acceptance_tokens as tokens
from app.services import kpi
from app.services.tech_parser import parse_technologies

#: The two authorities whose tracker registration is recorded. Deliberately the
#: same two as acceptance and no third: Mojri is the *keeper* of the tracker,
#: not an authority in it.
AUTHORITIES = ("ict", "cra")

#: Every technology the template carries a column for. A village gets answers
#: only for the ones it requested; the rest are ignored on the way back in.
TEMPLATE_TECHS = ("2G", "3G", "4G")

#: The three columns a row is matched on: the codes the team's own tracker
#: uses. The internal village id is never shown to people.
KEY_COLUMNS = ("site_code", "site_type", "village_code")
#: For the person reading the row; never matched on.
REFERENCE_COLUMNS = ("village_name",)
TECH_COLUMNS = tuple(
    f"{authority}_{tech.lower()}"
    for authority in AUTHORITIES
    for tech in TEMPLATE_TECHS
)
TEMPLATE_COLUMNS = (*KEY_COLUMNS, *REFERENCE_COLUMNS, *TECH_COLUMNS)

#: Old header -> the key column it is read as. Accepted for one transition,
#: because the team's current file uses these headers and its values already
#: are codes. The canonical name wins when a file carries both.
LEGACY_HEADER_ALIASES = {"site_id": "site_code", "village_id": "village_code"}

#: (site_code, site_type, village_code), each normalised.
MatchKey = tuple[str, str, str]

APPROVED_VERDICT = "Approved"

_HEADER_FILL = PatternFill("solid", fgColor="D9E2F3")
_HEADER_FONT = Font(bold=True)
_MAX_EXCEPTIONS = 200
_INTEGRAL_NUMBER = re.compile(r"^\d+(\.0+)?$")
_NO_VILLAGE = "No live UEP village with this site_code, site_type and village_code"


# ----- The template -------------------------------------------------------


def template_filename(period: tuple[int, int] | None = None) -> str:
    """``mojri_template_1404_06.xlsx`` — the Shamsi period it was cut for.

    Shamsi because the reporting period this reconciliation belongs to is a
    Shamsi month, and the person filing it names the month in Shamsi. The
    conversion is ``core/jalali`` and never the browser.
    """
    year, month = period or current_shamsi_period()
    return f"mojri_template_{year}_{month:02d}.xlsx"


def approved_by_either() -> ColumnElement[bool]:
    """At least one authority approved the village (the village roll-up: every
    requested technology approved). A village neither has accepted cannot be
    behind in somebody else's tracker yet."""
    return or_(
        Village.ict_status == APPROVED_VERDICT,
        Village.cra_status == APPROVED_VERDICT,
    )


def live_target_village(db: Session) -> tuple[ColumnElement[bool], ...]:
    """A village the programme still counts: neither it nor its work item
    deleted, and a pure هدف village -- the same target rule as every report.

    Expects ``Village`` joined to ``WorkItem``.
    """
    return (
        Village.deleted_at.is_(None),
        WorkItem.deleted_at.is_(None),
        Village.target_classification.in_(kpi.target_values(db) or [""]),
    )


def comparison_scope(db: Session) -> tuple[ColumnElement[bool], ...]:
    """**The one definition** of the villages compared with Mojri's tracker.

    Every live هدف village at least one authority approved -- on air or not,
    drive-test done or not. The template lists exactly these, and the Lifecycle
    Gaps Mojri card counts exactly these, so the rows a PM fills in and the
    figure they are later read back into cannot disagree. A test holds the two
    equal.

    Expects ``Village`` joined to ``WorkItem``.
    """
    return (*live_target_village(db), approved_by_either())


def eligible_villages(db: Session) -> list[Village]:
    """Villages worth tracking: the ones **we** have already approved, as
    :func:`comparison_scope` defines them.

    A village we have not accepted cannot be behind in somebody else's tracker
    yet, and putting it in the template would ask the team to fill in a row
    that means nothing.
    """
    stmt = (
        select(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(*comparison_scope(db))
        .options(selectinload(Village.work_item).selectinload(WorkItem.site))
        .order_by(Village.id)
    )
    return list(db.execute(stmt).scalars().all())


def build_template(db: Session) -> bytes:
    """The fill-in workbook: one row per eligible village, cells blank.

    Each row carries the key the importer matches on — ``site_code``,
    ``site_type``, ``village_code`` — in the words the team's own tracker uses,
    and ``village_name`` so a person can recognise the row. The internal
    village id is deliberately absent: nobody filling the file can know it, and
    a column that invites them to type something else into it is how the
    importer came to match CPM codes against primary keys.

    A technology the village did not request is marked ``n/a`` rather than left
    blank, so the team is never asked to answer a question that does not apply
    — and so a blank in that cell could never be mistaken for an answer. The
    importer ignores those cells whatever they hold.
    """
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "MojriTracker"
    sheet.append(list(TEMPLATE_COLUMNS))
    for index in range(1, len(TEMPLATE_COLUMNS) + 1):
        cell = sheet.cell(row=1, column=index)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT

    for village in eligible_villages(db):
        work_item = village.work_item
        site = work_item.site if work_item else None
        requested = parse_technologies(work_item.requested_technology if work_item else None)
        row = [
            site.site_code if site else "",
            work_item.site_type if work_item else "",
            village.village_code or "",
            village.village_name or "",
        ]
        for _authority in AUTHORITIES:
            for tech in TEMPLATE_TECHS:
                row.append("" if tech in requested else "n/a")
        sheet.append(row)

    for index in range(1, len(TEMPLATE_COLUMNS) + 1):
        sheet.column_dimensions[get_column_letter(index)].width = 14

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


# ----- The matching key ---------------------------------------------------


def normalize_key_part(value: object | None) -> str | None:
    """One part of a matching key as it is compared, or None when blank.

    Trimmed, internal whitespace collapsed, case-folded. An integral number is
    compared as the text of the integer, because Excel hands back ``229164``,
    ``229164.0`` or ``"229164"`` for the same code depending on how the cell was
    typed -- and drops a leading zero the moment it reads ``0229164`` as a
    number. Used for the file **and** the database, so the two sides cannot
    disagree about spelling.
    """
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = " ".join(str(value).split()).casefold()
    if not text:
        return None
    if _INTEGRAL_NUMBER.match(text):
        text = str(int(text.split(".", 1)[0]))
    return text


def match_key(site_code: object, site_type: object, village_code: object) -> MatchKey | None:
    """The normalised key, or None when any part of it is blank."""
    parts = (
        normalize_key_part(site_code),
        normalize_key_part(site_type),
        normalize_key_part(village_code),
    )
    if any(part is None for part in parts):
        return None
    return parts  # type: ignore[return-value]


def _village_key(village: Village) -> MatchKey | None:
    work_item = village.work_item
    site = work_item.site if work_item else None
    if site is None:
        return None
    return match_key(site.site_code, work_item.site_type, village.village_code)


def _live_villages_by_key(db: Session) -> dict[MatchKey, list[Village]]:
    """Every live village, grouped by its key.

    Live means neither the village nor its work item soft-deleted: a deleted
    village is not one a person can be registering this month. A key can hold
    several villages — CPM lists the same village twice on one work item — and
    every one of them is kept.
    """
    stmt = (
        select(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .where(Village.deleted_at.is_(None), WorkItem.deleted_at.is_(None))
        .options(selectinload(Village.work_item).selectinload(WorkItem.site))
        .order_by(Village.id)
    )
    index: dict[MatchKey, list[Village]] = defaultdict(list)
    for village in db.execute(stmt).scalars():
        key = _village_key(village)
        if key is not None:
            index[key].append(village)
    return index


# ----- Reading a filled template ------------------------------------------


@dataclass
class ParsedRow:
    """One row of the filled template, as read.

    The key parts are kept as typed, for the preview: a person fixing a row
    needs to see what they wrote, not what the importer normalised it to.
    """

    row_number: int
    site_code: str
    site_type: str
    village_code: str
    #: village id -> authority -> status, for every live village the key
    #: matched. Empty when the row has a problem.
    statuses: dict[int, dict[str, str]] = field(default_factory=dict)
    problem: str | None = None

    def as_exception(self) -> dict:
        return {
            "row": self.row_number,
            "site_code": self.site_code,
            "site_type": self.site_type,
            "village_code": self.village_code,
            "reason": self.problem,
        }


def digest_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _open(content: bytes):
    try:
        # data_only, so a formula cell hands back what it evaluated to rather
        # than "=IF(...)" -- which would otherwise read as an unrecognised
        # token and send a correctly-filled village to needs_look.
        #
        # Not read_only: openpyxl does not load cell comments in that mode, and
        # a comment on a cell is one of the things that must route to
        # needs_look. The upload is size-capped before it gets here.
        return load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(
            400,
            "That file could not be read as a workbook. Use the template the "
            "Admin page hands out, filled in and saved as .xlsx.",
        ) from None


def _header_map(sheet) -> dict[str, int]:
    """Column name -> column index, from the first row.

    Read by **name**, not by position — the opposite of the CPM importer, and
    for the opposite reason. CPM's workbook is somebody else's file whose
    Persian headers vary between issues while the positions do not. This one is
    our own template: the names are ours, and a team member who adds a note
    column in the middle of it should not silently shift every answer by one.

    The legacy headers in :data:`LEGACY_HEADER_ALIASES` are read as the key
    columns they stand for, unless the file also carries the canonical name.
    """
    header = {}
    for index, cell in enumerate(next(sheet.iter_rows(min_row=1, max_row=1)), start=1):
        name = tokens.normalize(cell.value)
        if name:
            header.setdefault(name.replace(" ", "_"), index)
    for legacy, canonical in LEGACY_HEADER_ALIASES.items():
        if legacy in header and canonical not in header:
            header[canonical] = header[legacy]
    return header


def _require_key_columns(header: dict[str, int]) -> None:
    missing = [column for column in KEY_COLUMNS if column not in header]
    if missing:
        raise HTTPException(
            400,
            f"That file has no {', '.join(missing)} column. The importer matches "
            "each row on site_code, site_type and village_code, so it cannot "
            "read a file without them.",
        )


def _read_cell(sheet, row_number: int, column: int | None, tech: str) -> str:
    """One technology cell, as a status.

    Returns one of the three statuses for this single technology; the village's
    status per authority is rolled up from these by :func:`_roll_up`. ``tech``
    is the column's own technology, so that ``2G`` written in the 2G column
    reads as registered — and ``3G`` written there does not.
    """
    if column is None:
        # The template has no column for it at all. Not an answer, and not a
        # blank either -- a file missing a column somebody expected to fill is
        # exactly the case a person should see.
        return NEEDS_LOOK
    cell = sheet.cell(row=row_number, column=column)
    if cell.comment is not None:
        return NEEDS_LOOK
    token = tokens.normalize(cell.value)
    if token is None:
        return NOT_IN_TRACKER
    if tokens.is_positive(token, tech):
        return IN_TRACKER
    return NEEDS_LOOK


def _roll_up(per_tech: list[str]) -> str:
    """One authority's status for one village, from its requested technologies.

    ``needs_look`` beats everything, then every-one-registered, then not
    registered. A village with no requested technology recorded at all reads
    needs_look: we do not know what we are looking for, and calling that
    "registered" or "not registered" would both be assertions nobody can back.
    """
    if not per_tech:
        return NEEDS_LOOK
    if NEEDS_LOOK in per_tech:
        return NEEDS_LOOK
    if all(status == IN_TRACKER for status in per_tech):
        return IN_TRACKER
    return NOT_IN_TRACKER


def _read_village(sheet, header: dict[str, int], row_number: int, village: Village) -> dict[str, str]:
    """One row read against what this village actually requested."""
    work_item = village.work_item
    requested = parse_technologies(work_item.requested_technology if work_item else None)
    return {
        authority: _roll_up(
            [
                _read_cell(sheet, row_number, header.get(f"{authority}_{tech.lower()}"), tech)
                for tech in TEMPLATE_TECHS
                if tech in requested
            ]
        )
        for authority in AUTHORITIES
    }


def _as_typed(value: object | None) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _blank_parts(raw: tuple[object, object, object]) -> str:
    blank = [
        column
        for column, value in zip(KEY_COLUMNS, raw, strict=True)
        if normalize_key_part(value) is None
    ]
    return f"{', '.join(blank)} is blank" if len(blank) == 1 else f"{', '.join(blank)} are blank"


def _flag_conflicting_repeats(by_key: dict[MatchKey, list[ParsedRow]]) -> None:
    """Rows repeating a key: one answer if they agree, a problem if not.

    Identical repeats are accepted as one — the same village typed twice is
    not a disagreement. Rows that read differently are all marked, and none of
    them is written: taking the last would silently lose the other claim.
    """
    for repeats in by_key.values():
        if len(repeats) < 2:
            continue
        if all(row.statuses == repeats[0].statuses for row in repeats[1:]):
            continue
        numbers = ", ".join(str(row.row_number) for row in repeats)
        for row in repeats:
            row.statuses = {}
            row.problem = f"Repeated key with different answers (rows {numbers})"


def _parse(db: Session, content: bytes) -> list[ParsedRow]:
    """Every row of the file, matched on its key and read against what each
    matched village actually requested.

    Pure: opens the workbook, looks villages up, and returns. Nothing is
    written, which is what lets :func:`preview` and :func:`commit` share it and
    lets the preview be honest about what confirming would do.
    """
    sheet = _open(content).active
    header = _header_map(sheet)
    _require_key_columns(header)
    key_columns = [header[column] for column in KEY_COLUMNS]
    villages_by_key = _live_villages_by_key(db)

    rows: list[ParsedRow] = []
    by_key: dict[MatchKey, list[ParsedRow]] = defaultdict(list)
    for row_number in range(2, sheet.max_row + 1):
        raw = tuple(sheet.cell(row=row_number, column=column).value for column in key_columns)
        if all(normalize_key_part(value) is None for value in raw):
            continue
        row = ParsedRow(row_number, *(_as_typed(value) for value in raw))
        rows.append(row)
        key = match_key(*raw)
        if key is None:
            row.problem = _blank_parts(raw)
            continue
        villages = villages_by_key.get(key)
        if not villages:
            row.problem = _NO_VILLAGE
            continue
        row.statuses = {
            village.id: _read_village(sheet, header, row_number, village)
            for village in villages
        }
        by_key[key].append(row)

    _flag_conflicting_repeats(by_key)
    return rows


def _statuses_to_write(rows: list[ParsedRow]) -> dict[int, dict[str, str]]:
    """village id -> authority -> status, over every accepted row.

    Identical repeats collapse here: they carry the same statuses for the same
    villages, so merging them is exact.
    """
    merged: dict[int, dict[str, str]] = {}
    for row in rows:
        if row.problem is None:
            merged.update(row.statuses)
    return merged


# ----- Preview ------------------------------------------------------------


def _current_statuses(db: Session) -> dict[int, MojriTrackerStatus]:
    return {
        row.village_id: row
        for row in db.execute(select(MojriTrackerStatus)).scalars()
    }


def _village_label(village: Village | None, village_id: int) -> str:
    if village is None:
        return f"#{village_id}"
    return village.village_name or village.village_code or f"#{village_id}"


def preview(db: Session, content: bytes, filename: str) -> dict:
    """What confirming this file would do. Writes nothing.

    The counts are deliberately about *movement* rather than about totals: a
    reconciliation is read to answer "what changed this month", and a screen
    that only shows the new totals hides a village that moved the wrong way.
    """
    return _summarise(db, _parse(db, content), filename, digest_of(content))


def _authority_counts(
    villages: dict[int, dict[str, str]],
    existing: dict[int, MojriTrackerStatus],
    authority: str,
) -> dict[str, int]:
    counts = {IN_TRACKER: 0, NEEDS_LOOK: 0, NOT_IN_TRACKER: 0}
    moving_in = 0
    moving_look = 0
    for village_id, statuses in villages.items():
        status = statuses[authority]
        counts[status] += 1
        before = getattr(existing.get(village_id), f"{authority}_status", None)
        if status != before:
            if status == IN_TRACKER:
                moving_in += 1
            elif status == NEEDS_LOOK:
                moving_look += 1
    return {
        "in_tracker": counts[IN_TRACKER],
        "needs_look": counts[NEEDS_LOOK],
        "not_in_tracker": counts[NOT_IN_TRACKER],
        "moving_to_in_tracker": moving_in,
        "moving_to_needs_look": moving_look,
    }


def _disappeared(
    db: Session, existing: dict[int, MojriTrackerStatus], in_file: set[int]
) -> list[dict]:
    """Villages the tracker had and this file does not mention. Never
    reverted: a row filtered out of a spreadsheet is not evidence that a
    registration was withdrawn."""
    disappeared = []
    for village_id, status in existing.items():
        if village_id in in_file:
            continue
        missing = [
            authority
            for authority in AUTHORITIES
            if getattr(status, f"{authority}_status") == IN_TRACKER
        ]
        if missing:
            disappeared.append(
                {
                    "village_id": village_id,
                    "village": _village_label(db.get(Village, village_id), village_id),
                    "authorities": [authority.upper() for authority in missing],
                }
            )
    disappeared.sort(key=lambda item: item["village_id"])
    return disappeared


def _summarise(db: Session, rows: list[ParsedRow], filename: str, digest: str) -> dict:
    """The preview payload, from rows already parsed.

    Separate from :func:`preview` so that :func:`commit` summarises and writes
    the *same* parse rather than reading the file twice and hoping the two
    readings agree.

    Counts per authority are per **village**, not per row: one key can match
    several villages, and each of them is a village the Lifecycle Gaps card
    counts.
    """
    existing = _current_statuses(db)
    villages = _statuses_to_write(rows)
    matched_rows = sum(1 for row in rows if row.problem is None)
    exceptions = [row.as_exception() for row in rows if row.problem is not None]
    disappeared = _disappeared(db, existing, set(villages))

    return {
        "filename": filename,
        # What Confirm must send back, so the file that is written is provably
        # the file that was previewed.
        "digest": digest,
        "total_rows": len(rows),
        "matched_rows": matched_rows,
        # Kept for older clients: the same number as matched_rows.
        "matched": matched_rows,
        "villages_matched": len(villages),
        "unmatched": len(exceptions),
        "exceptions": exceptions[:_MAX_EXCEPTIONS],
        "exceptions_truncated": max(0, len(exceptions) - _MAX_EXCEPTIONS),
        "authorities": {
            authority: _authority_counts(villages, existing, authority)
            for authority in AUTHORITIES
        },
        "disappeared": disappeared,
        "disappeared_count": len(disappeared),
    }


# ----- Commit -------------------------------------------------------------


def commit(db: Session, user, content: bytes, filename: str, digest: str) -> dict:
    """Apply a previewed file. The only function here that writes.

    Refuses a file whose digest does not match the one the preview returned.
    Without that, "preview then confirm" guarantees nothing: the second upload
    could be a different file, and the person would have approved numbers that
    were never written.

    Also refuses a file in which no row matched a village. Such a file is
    always a wrong file — the wrong columns, or codes from somewhere else —
    and confirming it would record an import run that changed nothing while
    reading, on the history, as this month's reconciliation.
    """
    actual = digest_of(content)
    if digest != actual:
        raise HTTPException(
            400,
            "That file is not the one that was previewed. Preview it again and "
            "confirm from the result.",
        )

    rows = _parse(db, content)
    result = _summarise(db, rows, filename, actual)
    if result["matched_rows"] == 0:
        raise HTTPException(
            400,
            "None of the rows in that file match a UEP village, so there is "
            "nothing to import. Check the site_code, site_type and "
            "village_code columns.",
        )

    run = MojriImportRun(
        filename=filename,
        imported_by=getattr(user, "id", None),
        total_rows=result["total_rows"],
        matched_rows=result["matched_rows"],
        unmatched_rows=result["unmatched"],
        ict_in_tracker=result["authorities"]["ict"]["in_tracker"],
        ict_needs_look=result["authorities"]["ict"]["needs_look"],
        cra_in_tracker=result["authorities"]["cra"]["in_tracker"],
        cra_needs_look=result["authorities"]["cra"]["needs_look"],
        disappeared=result["disappeared_count"],
    )
    db.add(run)
    db.flush()

    existing = _current_statuses(db)
    for village_id, statuses in _statuses_to_write(rows).items():
        status = existing.get(village_id)
        if status is None:
            status = MojriTrackerStatus(village_id=village_id)
            db.add(status)
        status.ict_status = statuses["ict"]
        status.cra_status = statuses["cra"]
        status.source_import_id = run.id
        # Written explicitly rather than left to onupdate: the row may be
        # unchanged in value and still have been confirmed by this month's
        # file, and "when did we last see this" is the question the
        # reconciliation is for.
        status.updated_at = func.now()

    db.flush()
    result["import_run_id"] = run.id
    return result
