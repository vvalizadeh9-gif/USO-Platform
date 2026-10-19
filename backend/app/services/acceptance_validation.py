"""ICT and CRA validation (UEP-16): contractor filings waiting to be checked.

The population is exactly the Home queue ``ict_to_validate`` /
``cra_to_validate``: My Work's "remaining" scope narrowed by the ``filled``
tab predicate for one authority (``my_work_query.base_select`` +
``tab_predicate``). So the page header, the Home row and the rail badge are
the same number by construction, and late is decided by the same
``action_queues.sla.is_overdue`` against the SLA policy step ``validate``.

A filing is one pending submission: one village, one authority. They are
grouped by letter (one authority) or by site; the site view also says how
many filings of the *other* authority wait on that site, and its detail
returns both, kept apart by ``authority``. Nothing here mixes the two in a
count.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.digits import to_latin
from app.core.jalali import format_shamsi
from app.models.acceptance import Acceptance
from app.models.acceptance_workflow import (
    AUTHORITIES,
    CLAIM_REJECTED,
    REVIEW_PENDING,
    REVIEW_WITHDRAWN,
    AcceptanceEvidence,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.reference import Contractor, Province, Region, User
from app.models.workitem import Site, Village, WorkItem
from app.services import acceptance_workflow as flow
from app.services import evidence_store
from app.services import my_work_query as query
from app.services import my_work_status as S
from app.services.action_queues import sla
from app.services.action_queues.types import PendingItem, SlaKind
from app.services.my_work_scope import SCOPE_REMAINING
from app.services.tech_parser import parse_technologies

GROUP_LETTER = "letter"
GROUP_SITE = "site"
GROUPS = (GROUP_LETTER, GROUP_SITE)

MAX_LIMIT = 500


class ValidationError(ValueError):
    def __init__(self, message: str, code: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def queue_key(authority: str) -> str:
    return f"{authority.lower()}_to_validate"


def sla_days(db: Session, authority: str) -> int:
    """The SLA the Home queue uses: SLA policies, step ``validate``."""
    key = queue_key(authority)
    return sla.sla_days_by_queue(db, [key])[key]


def other(authority: str) -> str:
    return "CRA" if authority == "ICT" else "ICT"


# --------------------------------------------------------------------------
# The filings
# --------------------------------------------------------------------------
@dataclass
class Filing:
    submission_id: int
    authority: str
    version: int
    village_id: int
    village_code: str | None
    village_name: str | None
    site_id: int
    site_code: str | None
    province_id: int | None
    province_name: str | None
    region_id: int | None
    letter_number: str
    letter_date: date | None
    submitted_at: datetime | None
    started_at: datetime | date | None
    contractor_id: int | None
    contractor_name: str | None
    requested_techs: list[str]
    claims: list[dict] = field(default_factory=list)
    missing_techs: list[str] = field(default_factory=list)
    has_rejection: bool = False
    has_evidence: bool = False
    waiting_days: int = 0
    late: bool = False

    @property
    def needs_attention(self) -> bool:
        return self.has_rejection or bool(self.missing_techs)


def _days(start, now: datetime) -> int:
    begun = sla.as_datetime(start)
    return max((now - begun).days, 0) if begun else 0


def filings(db: Session, user: User, authority: str, *, now: datetime | None = None) -> list[Filing]:
    """Every filing waiting for ``authority`` that this user may validate."""
    now = now or datetime.now(timezone.utc)
    days = sla_days(db, authority)
    since = query.waiting_since(authority)
    contractor_user = select(User.contractor_id).where(
        User.id == AcceptanceSubmission.submitted_by
    ).correlate(AcceptanceSubmission).scalar_subquery()
    stmt = (
        query.base_select(db, user, scope=SCOPE_REMAINING)
        .where(query.tab_predicate(S.TAB_FILLED, authority))
        .join(
            AcceptanceSubmission,
            (AcceptanceSubmission.village_id == Village.id)
            & (AcceptanceSubmission.authority == authority)
            & (AcceptanceSubmission.review_status == REVIEW_PENDING),
        )
        .outerjoin(Province, Site.province_id == Province.id)
        .with_only_columns(
            AcceptanceSubmission.id, AcceptanceSubmission.version,
            Village.id, Village.village_code, Village.village_name,
            Site.id, Site.site_code, Site.province_id, Province.name, Site.region_id,
            AcceptanceSubmission.letter_number, AcceptanceSubmission.letter_date,
            AcceptanceSubmission.submitted_at, since,
            contractor_user, WorkItem.dt_sc_contractor_id, WorkItem.requested_technology,
        )
    )
    rows = db.execute(stmt).all()
    if not rows:
        return []

    contractor_ids = {r[14] or r[15] for r in rows} - {None}
    contractors = dict(db.execute(
        select(Contractor.id, Contractor.name).where(Contractor.id.in_(contractor_ids))
    ).all()) if contractor_ids else {}
    submission_ids = [r[0] for r in rows]
    claims: dict[int, list[dict]] = defaultdict(list)
    for sub_id, tech, status, comment in db.execute(
        select(
            AcceptanceSubmissionTech.submission_id, AcceptanceSubmissionTech.technology,
            AcceptanceSubmissionTech.claimed_status, AcceptanceSubmissionTech.comment,
        ).where(AcceptanceSubmissionTech.submission_id.in_(submission_ids))
    ).all():
        claims[sub_id].append({"tech": tech, "result": status.lower(), "reason": comment})
    with_evidence = set(db.execute(
        select(AcceptanceEvidence.submission_id).where(
            AcceptanceEvidence.submission_id.in_(submission_ids)
        ).distinct()
    ).scalars())
    village_ids = [r[2] for r in rows]
    acceptances: dict[int, list] = defaultdict(list)
    for row in db.execute(
        select(Acceptance.village_id, Acceptance.technology, Acceptance.ict_status, Acceptance.cra_status)
        .where(Acceptance.village_id.in_(village_ids))
    ).all():
        acceptances[row.village_id].append(row)

    out = []
    for (sid, version, vid, vcode, vname, site_id, site_code, prov_id, prov_name, region_id,
         number, letter_date, submitted_at, started, filer_co, dt_co, requested) in rows:
        techs = parse_technologies(requested)
        own_claims = sorted(claims.get(sid, []), key=lambda c: techs.index(c["tech"]) if c["tech"] in techs else 9)
        claimed = {c["tech"] for c in own_claims}
        to_file = flow.techs_to_file_from(techs, acceptances.get(vid, []), authority)
        contractor_id = filer_co or dt_co
        out.append(Filing(
            submission_id=sid, authority=authority, version=version or 0,
            village_id=vid, village_code=vcode, village_name=vname,
            site_id=site_id, site_code=site_code, province_id=prov_id, province_name=prov_name,
            region_id=region_id, letter_number=number, letter_date=letter_date,
            submitted_at=submitted_at, started_at=started,
            contractor_id=contractor_id, contractor_name=contractors.get(contractor_id),
            requested_techs=techs, claims=own_claims,
            missing_techs=[t for t in to_file if t not in claimed],
            has_rejection=any(c["result"] == CLAIM_REJECTED.lower() for c in own_claims),
            has_evidence=sid in with_evidence,
            waiting_days=_days(sla.effective_start(started), now),
            late=sla.is_overdue(PendingItem(vid, started), SlaKind.CONFIGURED, days, now),
        ))
    return out


# --------------------------------------------------------------------------
# Filters and groups
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Filters:
    late: bool = False
    has_rejection: bool = False
    contractor_id: int | None = None
    province_id: int | None = None
    region_id: int | None = None
    q: str | None = None


def _matches(f: Filing, flt: Filters) -> bool:
    if flt.late and not f.late:
        return False
    if flt.has_rejection and not f.has_rejection:
        return False
    if flt.contractor_id is not None and f.contractor_id != flt.contractor_id:
        return False
    if flt.province_id is not None and f.province_id != flt.province_id:
        return False
    if flt.region_id is not None and f.region_id != flt.region_id:
        return False
    if flt.q and flt.q.strip():
        needle = to_latin(flt.q).strip().lower()
        hay = " ".join(str(x or "") for x in (
            f.letter_number, f.site_code, f.village_code, f.contractor_name,
        )).lower()
        if needle not in to_latin(hay):
            return False
    return True


def group_key(f: Filing, group: str) -> str:
    return f.letter_number if group == GROUP_LETTER else str(f.site_id)


@dataclass
class Group:
    key: str
    kind: str
    label: str
    filings: list[Filing]
    other_waiting: int = 0

    @property
    def waiting_days(self) -> int:
        return max(f.waiting_days for f in self.filings)

    @property
    def oldest(self):
        return min(sla.effective_start(f.started_at) for f in self.filings)

    def summary(self) -> dict:
        fs = self.filings
        contractors = {(f.contractor_id, f.contractor_name) for f in fs}
        cid, cname = sorted(contractors, key=lambda c: str(c[1]))[0]
        dates = [f.letter_date for f in fs if f.letter_date]
        letter_date = min(dates) if dates else None
        return {
            "key": self.key,
            "kind": self.kind,
            "label": self.label,
            "contractor": {"id": cid, "name": cname},
            "contractors": len(contractors),
            "province": fs[0].province_name,
            "letter_date": letter_date,
            "letter_date_shamsi": format_shamsi(letter_date),
            "waiting_days": self.waiting_days,
            "late": any(f.late for f in fs),
            "villages": len(fs),
            "rejected": sum(1 for f in fs if f.has_rejection),
            "letters": len({f.letter_number for f in fs}),
            "other_waiting": self.other_waiting,
        }


def build_groups(items: list[Filing], group: str, *, others: list[Filing] | None = None) -> list[Group]:
    by_key: dict[str, list[Filing]] = defaultdict(list)
    for f in items:
        by_key[group_key(f, group)].append(f)
    other_by_site: dict[int, int] = defaultdict(int)
    for f in others or []:
        other_by_site[f.site_id] += 1
    groups = [
        Group(
            key=key, kind=group,
            label=fs[0].letter_number if group == GROUP_LETTER else (fs[0].site_code or key),
            filings=fs,
            other_waiting=other_by_site.get(fs[0].site_id, 0) if group == GROUP_SITE else 0,
        )
        for key, fs in by_key.items()
    ]
    # Longest waiting first.
    return sorted(groups, key=lambda g: (g.oldest, g.label))


@dataclass
class ListResult:
    authority: str
    counts: dict
    groups: list[dict]
    next_cursor: str | None
    sla_days: int
    contractors: list[dict]
    provinces: list[dict]
    regions: list[dict]


def _options(db: Session, items: list[Filing]) -> tuple[list[dict], list[dict], list[dict]]:
    contractors = sorted(
        {(f.contractor_id, f.contractor_name) for f in items if f.contractor_id},
        key=lambda c: str(c[1]),
    )
    provinces = sorted(
        {(f.province_id, f.province_name) for f in items if f.province_id},
        key=lambda p: str(p[1]),
    )
    region_ids = {f.region_id for f in items if f.region_id}
    regions = sorted(db.execute(
        select(Region.id, Region.name).where(Region.id.in_(region_ids))
    ).all(), key=lambda r: r[1]) if region_ids else []
    return (
        [{"id": i, "name": n} for i, n in contractors],
        [{"id": i, "name": n} for i, n in provinces],
        [{"id": i, "name": n} for i, n in regions],
    )


def _offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        offset = int(cursor)
    except ValueError:
        raise ValidationError("This page link no longer matches the list", "invalid_cursor") from None
    if offset < 0:
        raise ValidationError("This page link no longer matches the list", "invalid_cursor")
    return offset


def list_groups(
    db: Session, user: User, authority: str, group: str, flt: Filters,
    *, cursor: str | None = None, limit: int = 200,
) -> ListResult:
    if group not in GROUPS:
        raise ValidationError("group must be letter or site", "invalid_group")
    if not 1 <= limit <= MAX_LIMIT:
        raise ValidationError(f"limit must be 1 to {MAX_LIMIT}", "invalid_limit")
    everything = filings(db, user, authority)
    shown = [f for f in everything if _matches(f, flt)]
    others = filings(db, user, other(authority)) if group == GROUP_SITE else []
    groups = build_groups(shown, group, others=others)
    offset = _offset(cursor)
    page = groups[offset: offset + limit]
    contractors, provinces, regions = _options(db, everything)
    return ListResult(
        authority=authority,
        counts={
            # The header and Home number: every filing waiting, unfiltered.
            "waiting": len(everything),
            "late": sum(1 for f in everything if f.late),
            # What the filters leave, per view; each equals its rows.
            "filtered": len(shown),
            "letter": len({group_key(f, GROUP_LETTER) for f in shown}),
            "site": len({group_key(f, GROUP_SITE) for f in shown}),
            "has_rejection": sum(1 for f in shown if f.has_rejection),
        },
        groups=[g.summary() for g in page],
        next_cursor=str(offset + limit) if offset + limit < len(groups) else None,
        sla_days=sla_days(db, authority),
        contractors=contractors,
        provinces=provinces,
        regions=regions,
    )


# --------------------------------------------------------------------------
# One group
# --------------------------------------------------------------------------
def _evidence(db: Session, submission_ids: list[int]) -> dict[tuple[str, str], list]:
    """Evidence per letter, once per file content."""
    return db.execute(
        select(
            AcceptanceEvidence.id, AcceptanceEvidence.submission_id, AcceptanceEvidence.sha256,
            AcceptanceEvidence.original_filename, AcceptanceEvidence.stored_path,
            AcceptanceEvidence.size_bytes,
        ).where(AcceptanceEvidence.submission_id.in_(submission_ids))
        .order_by(AcceptanceEvidence.id)
    ).all()


def _duplicate_use(db: Session, authority: str, number: str, mine: list[Filing]) -> dict:
    """Other villages carrying the same authority and letter number: filed by
    another contractor, or by this one in an earlier round."""
    own_villages = {f.village_id for f in mine}
    own_pending = {f.submission_id for f in mine}
    contractor_ids = {f.contractor_id for f in mine}
    filer = select(User.contractor_id).where(
        User.id == AcceptanceSubmission.submitted_by
    ).correlate(AcceptanceSubmission).scalar_subquery()
    rows = db.execute(
        select(AcceptanceSubmission.id, AcceptanceSubmission.village_id,
               AcceptanceSubmission.review_status, filer)
        .where(
            AcceptanceSubmission.authority == authority,
            AcceptanceSubmission.letter_number == number,
            AcceptanceSubmission.review_status != REVIEW_WITHDRAWN,
        )
    ).all()
    villages, contractors = set(), set()
    for sid, vid, status, co in rows:
        if sid in own_pending or vid in own_villages:
            continue
        # The same contractor's other pending villages on the letter are this
        # letter, filed in two sittings -- not a reuse.
        if status == REVIEW_PENDING and co in contractor_ids:
            continue
        villages.add(vid)
        if co is not None and co not in contractor_ids:
            contractors.add(co)
    return {"villages": len(villages), "contractors": len(contractors)}


def filing_out(f: Filing) -> dict:
    return {
        "submission_id": f.submission_id,
        "authority": f.authority,
        "version": f.version,
        "village_id": f.village_id,
        "village_code": f.village_code,
        "village_name": f.village_name,
        "site_id": f.site_id,
        "site_code": f.site_code,
        "letter_number": f.letter_number,
        "letter_date": f.letter_date,
        "letter_date_shamsi": format_shamsi(f.letter_date),
        "requested_techs": f.requested_techs,
        "claims": f.claims,
        "missing_techs": f.missing_techs,
        "has_rejection": f.has_rejection,
        "has_evidence": f.has_evidence,
        "waiting_days": f.waiting_days,
        "late": f.late,
    }


def _order(fs: list[Filing]) -> list[Filing]:
    """Rejected or incomplete filings first, then longest waiting, then code."""
    return sorted(fs, key=lambda f: (
        not f.needs_attention, sla.effective_start(f.started_at), f.village_code or "",
    ))


def _letters(db: Session, fs: list[Filing]) -> list[dict]:
    by_letter: dict[tuple[str, str], list[Filing]] = defaultdict(list)
    for f in fs:
        by_letter[(f.authority, f.letter_number)].append(f)
    evidence = _evidence(db, [f.submission_id for f in fs])
    files_by_sub: dict[int, list] = defaultdict(list)
    for row in evidence:
        files_by_sub[row.submission_id].append(row)
    out = []
    for (authority, number), mine in by_letter.items():
        seen: dict[str, dict] = {}
        for f in mine:
            for row in files_by_sub.get(f.submission_id, []):
                if row.sha256 in seen:
                    continue
                kind = evidence_store.kind_for(row.stored_path)
                seen[row.sha256] = {
                    "id": row.id,
                    "filename": row.original_filename,
                    "kind": kind,
                    "content_type": evidence_store.media_type_for(row.stored_path),
                    "size_bytes": row.size_bytes,
                    "pages": None,
                }
        dates = [f.letter_date for f in mine if f.letter_date]
        letter_date = min(dates) if dates else None
        out.append({
            "authority": authority,
            "letter_number": number,
            "letter_date": letter_date,
            "letter_date_shamsi": format_shamsi(letter_date),
            "villages": len(mine),
            "without_evidence": sum(1 for f in mine if not f.has_evidence),
            "evidence": list(seen.values()),
            "duplicate_use": _duplicate_use(db, authority, number, mine),
        })
    return sorted(out, key=lambda letter: (AUTHORITIES.index(letter["authority"]), letter["letter_number"]))


def group_detail(db: Session, user: User, authority: str, group: str, key: str) -> dict:
    """One letter (this authority only) or one site (both, kept apart)."""
    if group not in GROUPS:
        raise ValidationError("group must be letter or site", "invalid_group")
    mine = [f for f in filings(db, user, authority) if group_key(f, group) == key]
    theirs: list[Filing] = []
    if group == GROUP_SITE:
        theirs = [f for f in filings(db, user, other(authority)) if group_key(f, group) == key]
    if not mine and not theirs:
        raise ValidationError("Nothing is waiting here", "not_found", status=404)
    head = (mine or theirs)[0]
    summary = Group(key=key, kind=group, label=head.letter_number if group == GROUP_LETTER else (head.site_code or key),
                    filings=mine or theirs, other_waiting=len(theirs)).summary()
    return {
        "authority": authority,
        "group": summary,
        "sla_days": sla_days(db, authority),
        "filings": [filing_out(f) for f in _order(mine)],
        "other": {
            "authority": other(authority),
            "sla_days": sla_days(db, other(authority)),
            "filings": [filing_out(f) for f in _order(theirs)],
        } if group == GROUP_SITE else None,
        "letters": _letters(db, mine + theirs),
    }


# --------------------------------------------------------------------------
# Evidence access
# --------------------------------------------------------------------------
def evidence_record(db: Session, user: User, evidence_id: int) -> tuple[AcceptanceEvidence, AcceptanceSubmission]:
    """An evidence row the user may see -- the same scope as its filing. Not
    found and not yours are the same 404."""
    record = db.get(AcceptanceEvidence, evidence_id)
    submission = db.get(AcceptanceSubmission, record.submission_id) if record else None
    if submission is None or not flow.may_see_village(db, user, submission.village_id):
        raise ValidationError("Evidence not found", "not_found", status=404)
    return record, submission


def letter_files(db: Session, user: User, authority: str, letter_number: str) -> list[AcceptanceEvidence]:
    """Every distinct file on a letter, across the villages this user may see."""
    visible = flow.visible_villages(user, db).with_only_columns(Village.id)
    rows = db.execute(
        select(AcceptanceEvidence)
        .join(AcceptanceSubmission, AcceptanceEvidence.submission_id == AcceptanceSubmission.id)
        .where(
            AcceptanceSubmission.authority == authority,
            AcceptanceSubmission.letter_number == letter_number,
            AcceptanceSubmission.village_id.in_(visible),
        )
        .order_by(AcceptanceEvidence.id)
    ).scalars().all()
    seen: dict[str, AcceptanceEvidence] = {}
    for row in rows:
        seen.setdefault(row.sha256, row)
    return list(seen.values())
