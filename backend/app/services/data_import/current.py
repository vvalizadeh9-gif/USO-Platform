"""What UEP holds today, loaded in bulk -- the keys, and every value a file
could change, each with where it came from.

Bulk on purpose, like ``cpm_import``: a handful of queries for the whole
universe, never one per row, so a 15,000-village file previews in seconds.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.acceptance_case import (
    EVENT_COMMENT,
    AcceptanceCase,
    AcceptanceCaseEvent,
    AcceptanceRejectionCategory,
)
from app.models.acceptance_workflow import REVIEW_VALIDATED, AcceptanceSubmission
from app.models.data_import import ImportBatch
from app.models.reference import Contractor, ProblemCategory, Province, User
from app.models.workitem import Assignment, DriveTest, Site, Village, WorkItem
from app.services import mojri_tracker, visibility
from app.services.tech_parser import parse_technologies

from . import columns as C

MatchKey = tuple[str, str, str]

#: "Imported · batch #12" in a comment names the batch that wrote it.
_BATCH_IN_TEXT = re.compile(r"Imported · batch #(\d+)")
IMPORT_TAG = "Imported · batch #{n}"


def tehran_day(moment: datetime | date | None) -> date | None:
    if moment is None:
        return None
    if isinstance(moment, datetime):
        if moment.tzinfo is None:
            return moment.date()
        return moment.astimezone(jalali.TEHRAN).date()
    return moment


def iso(day: date | None) -> str | None:
    return day.isoformat() if day else None


def strip_tag(text: str | None) -> str | None:
    """A comment without the ``Imported · batch #n`` tag the import adds."""
    if not text:
        return None
    cleaned = _BATCH_IN_TEXT.sub("", text).strip(" ·")
    return cleaned or None


@dataclass
class VillageRef:
    id: int
    work_item_id: int
    village_code: str | None
    village_name: str | None


@dataclass
class WorkItemRef:
    id: int
    site_code: str
    site_type: str
    province: str | None
    requested: list[str]
    villages: list[VillageRef] = field(default_factory=list)


@dataclass
class Value:
    """One current value and a sentence saying where it came from."""

    value: str | None
    source: str | None = None


@dataclass
class Universe:
    work_items: dict[int, WorkItemRef]
    #: key -> villages (CPM sometimes lists one village twice on a site).
    by_key: dict[MatchKey, list[VillageRef]]
    #: (site, village) -> the site types it exists under, for "Found as Add Tech".
    site_types: dict[tuple[str, str], set[str]]
    contractors: dict[str, int]          # casefolded name -> id (DT contractors)
    contractor_names: dict[int, str]
    problem_categories: dict[str, str]   # casefolded -> canonical name
    rejection_categories: dict[str, AcceptanceRejectionCategory]  # casefolded label/code


def load_universe(db: Session, user: User | None = None) -> Universe:
    """Every live, pure هدف village the user may see, keyed like the Mojri
    template (site code + site type + village code)."""
    stmt = (
        select(
            Village.id, Village.village_code, Village.village_name,
            WorkItem.id, WorkItem.site_type, WorkItem.requested_technology,
            Site.site_code, Province.name,
        )
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .outerjoin(Province, Site.province_id == Province.id)
        .where(*mojri_tracker.live_target_village(db))
    )
    if user is not None:
        stmt = stmt.where(WorkItem.id.in_(visibility.visible_work_item_ids(user, db)))

    work_items: dict[int, WorkItemRef] = {}
    by_key: dict[MatchKey, list[VillageRef]] = defaultdict(list)
    site_types: dict[tuple[str, str], set[str]] = defaultdict(set)
    for vid, vcode, vname, wid, stype, tech, scode, prov in db.execute(stmt).all():
        wi = work_items.get(wid)
        if wi is None:
            wi = work_items[wid] = WorkItemRef(wid, scode or "", stype or "", prov,
                                               parse_technologies(tech))
        ref = VillageRef(vid, wid, vcode, vname)
        wi.villages.append(ref)
        key = mojri_tracker.match_key(scode, stype, vcode)
        if key is not None:
            by_key[key].append(ref)
            site_types[(key[0], key[2])].add(stype or "")

    contractors, names = {}, {}
    for cid, name, ctype in db.execute(
        select(Contractor.id, Contractor.name, Contractor.type).where(Contractor.active)
    ).all():
        names[cid] = name
        if ctype == "drive_test" or name.casefold() not in contractors:
            contractors[name.strip().casefold()] = cid
    # Inactive contractors still name today's values in the preview.
    for cid, name in db.execute(select(Contractor.id, Contractor.name)).all():
        names.setdefault(cid, name)

    problem = {
        n.strip().casefold(): n
        for n in db.execute(select(ProblemCategory.name).where(ProblemCategory.active)).scalars()
    }
    rejection = {}
    for cat in db.execute(
        select(AcceptanceRejectionCategory).where(AcceptanceRejectionCategory.active)
    ).scalars():
        rejection[cat.label.strip().casefold()] = cat
        rejection[cat.code.strip().casefold()] = cat
    return Universe(dict(work_items), dict(by_key), dict(site_types), contractors, names,
                    problem, rejection)


def dt_contractor_names(db: Session) -> list[str]:
    """The DT contractors offered in the template's dropdown."""
    return list(db.execute(
        select(Contractor.name).where(Contractor.active, Contractor.type == "drive_test")
        .order_by(Contractor.name)
    ).scalars())


# --------------------------------------------------------------------------
# Today's values
# --------------------------------------------------------------------------
@dataclass
class Sources:
    users: dict[int, str]
    batches: dict[int, int]   # import_batch_id -> number

    def of_record(self, record, at, by) -> str:
        if getattr(record, "import_batch_id", None):
            n = self.batches.get(record.import_batch_id)
            return f"Import #{n}" if n else "Import"
        who = self.users.get(by) if by else None
        day = tehran_day(at)
        parts = ["in UEP"]
        if who:
            parts.append(f"by {who}")
        text = " ".join(parts)
        return f"{text}, {day:%d %b %Y}" if day else text


def _sources(db: Session) -> Sources:
    users = {uid: name for uid, name in db.execute(select(User.id, User.full_name)).all()}
    batches = dict(db.execute(select(ImportBatch.id, ImportBatch.number)).all())
    return Sources(users, batches)


def _latest_by(rows, key=lambda r: r.work_item_id):
    out = {}
    for r in rows:
        k = key(r)
        if k not in out or r.id > out[k].id:
            out[k] = r
    return out


def dt_values(db: Session, work_item_ids, universe: Universe) -> dict[int, dict[str, Value]]:
    """Per work item, today's value of every drive test column."""
    ids = list(work_item_ids)
    if not ids:
        return {}
    src = _sources(db)
    out: dict[int, dict[str, Value]] = {}
    for chunk_start in range(0, len(ids), 2000):
        chunk = ids[chunk_start:chunk_start + 2000]
        wis = {w.id: w for w in db.execute(select(WorkItem).where(WorkItem.id.in_(chunk))).scalars()}
        assignments = _latest_by(db.execute(
            select(Assignment).where(
                Assignment.work_item_id.in_(chunk), Assignment.is_active,
                Assignment.assignment_type == "official",
            )
        ).scalars())
        tests = _latest_by(db.execute(
            select(DriveTest).where(DriveTest.work_item_id.in_(chunk), DriveTest.is_active)
        ).scalars())
        for wid in chunk:
            wi = wis.get(wid)
            if wi is None:
                continue
            a, t = assignments.get(wid), tests.get(wid)
            out[wid] = _dt_row(wi, a, t, universe, src)
    return out


def _dt_row(wi: WorkItem, a: Assignment | None, t: DriveTest | None,
            universe: Universe, src: Sources) -> dict[str, Value]:
    cpm = "CPM import"
    a_src = src.of_record(a, a.assigned_at, a.assigned_by) if a else None
    t_src = src.of_record(t, t.submitted_at or t.created_at, None) if t else None
    r_src = (src.of_record(t, t.coordinator_reviewed_at, t.coordinator_reviewed_by)
             if t and t.coordinator_reviewed_at else None)

    if a is not None:
        contractor = Value(universe.contractor_names.get(a.contractor_id), a_src)
    elif wi.dt_sc_contractor_id:
        contractor = Value(universe.contractor_names.get(wi.dt_sc_contractor_id), cpm)
    else:
        contractor = Value(None)

    if t is not None and t.execution_date:
        dt_date = Value(iso(t.execution_date), t_src)
    elif wi.dt_date_gregorian:
        dt_date = Value(iso(wi.dt_date_gregorian), cpm if t is None else t_src)
    else:
        dt_date = Value(None)

    status = (wi.dt_status or "").strip().lower()
    result = {"done": C.DT_DONE, "problematic": C.DT_PROBLEMATIC}.get(status)
    approved = t is not None and t.status == "Approved"
    result_src = r_src if (t is not None and t.coordinator_reviewed_at) else cpm

    return {
        "dt_contractor": contractor,
        "assignment_date": Value(iso(tehran_day(a.assigned_at)), a_src) if a else Value(None),
        "dt_date": dt_date,
        "ssv_date": Value(iso(tehran_day(t.submitted_at)), t_src) if t and t.submitted_at else Value(None),
        "dt_result": Value(result, result_src) if result else Value(None),
        "dt_approved_date": (Value(iso(tehran_day(t.coordinator_reviewed_at)), r_src)
                             if approved and t.coordinator_reviewed_at else Value(None)),
        "problem_category": Value(wi.dt_problem_category, result_src) if wi.dt_problem_category else Value(None),
        "dt_comment": Value(strip_tag(t.coordinator_comment), t_src) if t and strip_tag(t.coordinator_comment) else Value(None),
    }


def acceptance_values(db: Session, village_ids) -> dict[tuple[int, str], dict[str, Value]]:
    """Per (village, authority), today's value of every acceptance column."""
    ids = list(village_ids)
    out: dict[tuple[int, str], dict[str, Value]] = {}
    if not ids:
        return out
    src = _sources(db)
    for start in range(0, len(ids), 2000):
        chunk = ids[start:start + 2000]
        statuses = {vid: (ict, cra) for vid, ict, cra in db.execute(
            select(Village.id, Village.ict_status, Village.cra_status).where(Village.id.in_(chunk))
        ).all()}
        subs = {}
        for s in db.execute(
            select(AcceptanceSubmission).where(
                AcceptanceSubmission.village_id.in_(chunk),
                AcceptanceSubmission.review_status == REVIEW_VALIDATED,
            ).order_by(AcceptanceSubmission.round_no, AcceptanceSubmission.id)
        ).scalars():
            subs[(s.village_id, s.authority)] = s
        cases = {(c.village_id, c.authority): c for c in db.execute(
            select(AcceptanceCase).where(AcceptanceCase.village_id.in_(chunk))
        ).scalars()}
        cat_labels = dict(db.execute(
            select(AcceptanceRejectionCategory.id, AcceptanceRejectionCategory.label)
        ).all())
        comments = _latest_comments(db, [c.id for c in cases.values()])

        for vid in chunk:
            ict, cra = statuses.get(vid, (None, None))
            for authority, status in (("ICT", ict), ("CRA", cra)):
                sub = subs.get((vid, authority))
                case = cases.get((vid, authority))
                out[(vid, authority)] = _acc_row(status, sub, case, cat_labels, comments, src)
    return out


def _latest_comments(db: Session, case_ids: list[int]) -> dict[int, str]:
    if not case_ids:
        return {}
    last = (
        select(func.max(AcceptanceCaseEvent.id))
        .where(AcceptanceCaseEvent.case_id.in_(case_ids), AcceptanceCaseEvent.comment.isnot(None),
               AcceptanceCaseEvent.kind == EVENT_COMMENT)
        .group_by(AcceptanceCaseEvent.case_id)
    )
    return dict(db.execute(
        select(AcceptanceCaseEvent.case_id, AcceptanceCaseEvent.comment)
        .where(AcceptanceCaseEvent.id.in_(last))
    ).all())


def submission_source(sub: AcceptanceSubmission, src: Sources) -> str:
    match = _BATCH_IN_TEXT.search(sub.review_comment or "")
    if match:
        return f"Import #{match.group(1)}"
    return src.of_record(sub, sub.reviewed_at, sub.reviewed_by)


def _acc_row(status, sub, case, cat_labels, comments, src) -> dict[str, Value]:
    result = status if status in C.ACC_RESULTS else None
    s_src = submission_source(sub, src) if sub else ("CPM import" if result else None)
    category = cat_labels.get(case.category_id) if case and case.category_id else None
    comment = strip_tag(comments.get(case.id)) if case else None
    return {
        "result": Value(result, s_src) if result else Value(None),
        "letter_number": Value(sub.letter_number, s_src) if sub and result else Value(None),
        "letter_date": Value(iso(sub.letter_date), s_src) if sub and result and sub.letter_date else Value(None),
        "rejection_category": Value(category, s_src) if category and result == C.ACC_REJECTED else Value(None),
        "comment": Value(comment, "in UEP") if comment else Value(None),
    }
