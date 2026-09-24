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

### How a cell is read

Per authority, per village, for **each technology that village actually
requested**:

* a recognised positive token → that technology is in the tracker;
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
from dataclasses import dataclass, field

from fastapi import HTTPException
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import func, select
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
from app.services.tech_parser import parse_technologies

#: The two authorities whose tracker registration is recorded. Deliberately the
#: same two as acceptance and no third: Mojri is the *keeper* of the tracker,
#: not an authority in it.
AUTHORITIES = ("ict", "cra")

#: Every technology the template carries a column for. A village gets answers
#: only for the ones it requested; the rest are ignored on the way back in.
TEMPLATE_TECHS = ("2G", "3G", "4G")

#: Reference columns for the human cleaning the file, then the one column the
#: importer actually reads, then the cells to fill.
REFERENCE_COLUMNS = ("site_id", "village_id", "site_type")
TECH_COLUMNS = tuple(
    f"{authority}_{tech.lower()}"
    for authority in AUTHORITIES
    for tech in TEMPLATE_TECHS
)
TEMPLATE_COLUMNS = (*REFERENCE_COLUMNS, *TECH_COLUMNS)

APPROVED_VERDICT = "Approved"

_HEADER_FILL = PatternFill("solid", fgColor="D9E2F3")
_HEADER_FONT = Font(bold=True)
_MAX_EXCEPTIONS = 200


# ----- The template -------------------------------------------------------


def template_filename(period: tuple[int, int] | None = None) -> str:
    """``mojri_template_1404_06.xlsx`` — the Shamsi period it was cut for.

    Shamsi because the reporting period this reconciliation belongs to is a
    Shamsi month, and the person filing it names the month in Shamsi. The
    conversion is ``core/jalali`` and never the browser.
    """
    year, month = period or current_shamsi_period()
    return f"mojri_template_{year}_{month:02d}.xlsx"


def eligible_villages(db: Session) -> list[Village]:
    """Villages worth tracking: the ones **we** have already approved.

    At least one authority approved. A village we have not accepted cannot be
    behind in somebody else's tracker yet, and putting it in the template would
    ask the team to fill in a row that means nothing.
    """
    stmt = (
        select(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(
            Village.deleted_at.is_(None),
            WorkItem.deleted_at.is_(None),
            (Village.ict_status == APPROVED_VERDICT)
            | (Village.cra_status == APPROVED_VERDICT),
        )
        .options(selectinload(Village.work_item).selectinload(WorkItem.site))
        .order_by(Village.id)
    )
    return list(db.execute(stmt).scalars().all())


def build_template(db: Session) -> bytes:
    """The fill-in workbook: one row per eligible village, cells blank.

    ``site_id`` and ``site_type`` are there for the person matching rows
    against Mojri's own file, which is organised by site. They are reference
    only — the importer reads ``village_id`` and nothing else, because one site
    routinely serves several villages and acceptance is per village.

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
            village.id,
            work_item.site_type if work_item else "",
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


# ----- Reading a filled template ------------------------------------------


@dataclass
class ParsedRow:
    """One row of the filled template, as read."""

    row_number: int
    village_id: int | None
    #: authority -> status, only for rows that matched a village.
    statuses: dict[str, str] = field(default_factory=dict)
    problem: str | None = None


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
    """
    header = {}
    for index, cell in enumerate(next(sheet.iter_rows(min_row=1, max_row=1)), start=1):
        name = tokens.normalize(cell.value)
        if name:
            header[name.replace(" ", "_")] = index
    return header


def _read_cell(sheet, row_number: int, column: int | None) -> str:
    """One technology cell, as a status.

    Returns one of the three statuses for this single technology; the village's
    status per authority is rolled up from these by :func:`_roll_up`.
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
    if token in tokens.APPROVED_TOKENS:
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


def _parse(db: Session, content: bytes) -> tuple[list[ParsedRow], dict[int, Village]]:
    """Every row of the file, read against what each village actually requested.

    Pure: opens the workbook, looks villages up, and returns. Nothing is
    written, which is what lets :func:`preview` and :func:`commit` share it and
    lets the preview be honest about what confirming would do.
    """
    workbook = _open(content)
    sheet = workbook.active
    header = _header_map(sheet)
    if "village_id" not in header:
        raise HTTPException(
            400,
            "That file has no village_id column. The importer matches on "
            "village_id, so it cannot read a file without one.",
        )

    raw_ids: list[tuple[int, int | None]] = []
    for row_number in range(2, sheet.max_row + 1):
        value = sheet.cell(row=row_number, column=header["village_id"]).value
        if value is None or str(value).strip() == "":
            continue
        try:
            raw_ids.append((row_number, int(str(value).strip())))
        except ValueError:
            raw_ids.append((row_number, None))

    wanted = {village_id for _, village_id in raw_ids if village_id is not None}
    villages = {
        village.id: village
        for village in db.execute(
            select(Village)
            .where(Village.id.in_(wanted or {-1}), Village.deleted_at.is_(None))
            .options(selectinload(Village.work_item))
        ).scalars()
    }

    seen: dict[int, int] = {}
    rows: list[ParsedRow] = []
    for row_number, village_id in raw_ids:
        if village_id is None:
            rows.append(
                ParsedRow(row_number, None, problem="village_id is not a number")
            )
            continue
        village = villages.get(village_id)
        if village is None:
            rows.append(
                ParsedRow(row_number, village_id, problem="No village with that id")
            )
            continue
        if village_id in seen:
            # Two rows claiming the same village. Not resolved by taking the
            # last one: if they disagree, the last one wins silently and the
            # other claim is lost. Named instead, and neither is written.
            rows.append(
                ParsedRow(
                    row_number,
                    village_id,
                    problem=f"Repeated village_id (already on row {seen[village_id]})",
                )
            )
            continue
        seen[village_id] = row_number

        work_item = village.work_item
        requested = parse_technologies(
            work_item.requested_technology if work_item else None
        )
        statuses = {}
        for authority in AUTHORITIES:
            statuses[authority] = _roll_up(
                [
                    _read_cell(sheet, row_number, header.get(f"{authority}_{tech.lower()}"))
                    for tech in TEMPLATE_TECHS
                    if tech in requested
                ]
            )
        rows.append(ParsedRow(row_number, village_id, statuses=statuses))

    return rows, villages


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
    rows, _villages = _parse(db, content)
    return _summarise(db, rows, filename, digest_of(content))


def _summarise(db: Session, rows: list[ParsedRow], filename: str, digest: str) -> dict:
    """The preview payload, from rows already parsed.

    Separate from :func:`preview` so that :func:`commit` summarises and writes
    the *same* parse rather than reading the file twice and hoping the two
    readings agree.
    """
    existing = _current_statuses(db)

    matched = [row for row in rows if row.problem is None]
    exceptions = [
        {
            "row": row.row_number,
            "village_id": row.village_id,
            "reason": row.problem,
        }
        for row in rows
        if row.problem is not None
    ]

    summary = {}
    for authority in AUTHORITIES:
        counts = {IN_TRACKER: 0, NEEDS_LOOK: 0, NOT_IN_TRACKER: 0}
        moving_in = 0
        moving_look = 0
        for row in matched:
            status = row.statuses[authority]
            counts[status] += 1
            before = getattr(existing.get(row.village_id), f"{authority}_status", None)
            if status != before:
                if status == IN_TRACKER:
                    moving_in += 1
                elif status == NEEDS_LOOK:
                    moving_look += 1
        summary[authority] = {
            "in_tracker": counts[IN_TRACKER],
            "needs_look": counts[NEEDS_LOOK],
            "not_in_tracker": counts[NOT_IN_TRACKER],
            "moving_to_in_tracker": moving_in,
            "moving_to_needs_look": moving_look,
        }

    # Villages the tracker had and this file does not mention. Never reverted:
    # a row filtered out of a spreadsheet is not evidence that a registration
    # was withdrawn.
    in_file = {row.village_id for row in matched}
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
                    "village": _village_label(
                        db.get(Village, village_id), village_id
                    ),
                    "authorities": [authority.upper() for authority in missing],
                }
            )
    disappeared.sort(key=lambda item: item["village_id"])

    return {
        "filename": filename,
        # What Confirm must send back, so the file that is written is provably
        # the file that was previewed.
        "digest": digest,
        "total_rows": len(rows),
        "matched": len(matched),
        "unmatched": len(exceptions),
        "exceptions": exceptions[:_MAX_EXCEPTIONS],
        "exceptions_truncated": max(0, len(exceptions) - _MAX_EXCEPTIONS),
        "authorities": summary,
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
    """
    actual = digest_of(content)
    if digest != actual:
        raise HTTPException(
            400,
            "That file is not the one that was previewed. Preview it again and "
            "confirm from the result.",
        )

    rows, _villages = _parse(db, content)
    result = _summarise(db, rows, filename, actual)

    run = MojriImportRun(
        filename=filename,
        imported_by=getattr(user, "id", None),
        total_rows=result["total_rows"],
        matched_rows=result["matched"],
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
    for row in rows:
        if row.problem is not None:
            continue
        status = existing.get(row.village_id)
        if status is None:
            status = MojriTrackerStatus(village_id=row.village_id)
            db.add(status)
        status.ict_status = row.statuses["ict"]
        status.cra_status = row.statuses["cra"]
        status.source_import_id = run.id
        # Written explicitly rather than left to onupdate: the row may be
        # unchanged in value and still have been confirmed by this month's
        # file, and "when did we last see this" is the question the
        # reconciliation is for.
        status.updated_at = func.now()

    db.flush()
    result["import_run_id"] = run.id
    return result
