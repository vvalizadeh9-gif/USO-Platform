"""My Work: the acceptance work surface (docs/design/my-work-api.md).

This module resolves the caller, translates between the wire and the
services, and maps rule failures onto one error body. It holds no rules: the
vocabulary and tabs are ``my_work_status``, the population is
``my_work_query``, the history is ``acceptance_rounds``, and filing and
deciding are ``acceptance_letters`` on top of ``acceptance_workflow``.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import ADMIN, get_current_user, require_roles
from app.core.jalali import format_shamsi
from app.models.reference import User
from app.models.workitem import Site, Village, WorkItem
from app.schemas.my_work import (
    AuthorityTotals,
    CarriedOut,
    ClaimOut,
    CpmFacts,
    LastReasonOut,
    LetterFiled,
    LetterIn,
    LetterReviewed,
    LetterReviewIn,
    MyWorkList,
    MyWorkRow,
    ResolvedCode,
    ResolveRequest,
    ResolveResult,
    RoundOut,
    SameLetterOut,
    ScanOut,
    ScanUploaded,
    SideDetailOut,
    SideOut,
    SuggestedVillage,
    Suggestions,
    TabCount,
    VillageOutcomeOut,
)
from app.schemas.action_center import (
    AuthorityRequestIn,
    AuthorityRequestOutcome,
    AuthorityRequestResult,
)
from app.services import acceptance_letters as letters
from app.services import acceptance_requests as authority_requests
from app.services import acceptance_workflow as flow
from app.services import evidence_store, scan_tokens
from app.services import my_work_detail as detail
from app.services import my_work_query as query
from app.services import my_work_status as S
from app.services.my_work_scope import SCOPE_REMAINING, SCOPES

router = APIRouter(prefix="/acceptance", tags=["my-work"])

require_filer = require_roles(*S.FILING_ROLES)
require_decider = require_roles(*S.DECIDING_ROLES)


def require_worker(user: User = Depends(get_current_user)) -> User:
    """Anyone but Admin: the systems role does no operational work."""
    if user.role.name == ADMIN:
        raise HTTPException(403, "You do not have permission to perform this action")
    return user


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------
def _error(status: int, code: str, message: str, errors: list | None = None) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "errors": errors or []})


def _letter_error(exc: letters.LetterError) -> HTTPException:
    errors = [
        {k: v for k, v in vars(e).items() if v is not None} for e in exc.errors
    ]
    code = "conflict" if exc.status_code == 409 else "letter_invalid"
    return _error(exc.status_code, code, exc.message, errors)


def _scope(scope: str) -> str:
    if scope not in SCOPES:
        raise _error(400, "invalid_scope", f"scope must be one of {', '.join(SCOPES)}")
    return scope


# --------------------------------------------------------------------------
# The list
# --------------------------------------------------------------------------
def _ids(raw: str | None) -> tuple[int, ...] | None:
    if raw is None:
        return None
    try:
        ids = tuple(dict.fromkeys(int(x) for x in raw.split(",") if x.strip()))
    except ValueError:
        raise _error(400, "invalid_ids", "ids must be comma-separated numbers") from None
    if len(ids) > query.MAX_LIMIT:
        raise _error(400, "invalid_ids", f"At most {query.MAX_LIMIT} ids")
    return ids


def _side_out(facts: query.SideFacts) -> SideOut:
    return SideOut(**vars(facts))


def _row_out(row: query.RowFacts) -> MyWorkRow:
    data = {k: v for k, v in vars(row).items() if k != "sides"}
    return MyWorkRow(
        **data,
        dt_date_shamsi=format_shamsi(row.dt_date),
        sides={a: _side_out(s) for a, s in row.sides.items()},
    )


@router.get("/my-work", response_model=MyWorkList)
def my_work(
    scope: str = SCOPE_REMAINING,
    tab: str | None = None,
    authority: str | None = Query(None, description="ICT|CRA"),
    q: str | None = None,
    sort: str = query.SORT_LONGEST,
    cursor: str | None = None,
    limit: int = 100,
    ids: str | None = Query(None, description="Comma-separated village ids; overrides the tab"),
    db: Session = Depends(get_db),
    user: User = Depends(require_worker),
) -> MyWorkList:
    """The village list, every tab's count and the per-authority totals,
    from one select. ``limit=0`` returns the counts alone (the sidebar)."""
    scope = _scope(scope)
    view = S.view_for(user.role.name)
    tab = tab or S.tabs_for(view, universe=scope == "universe")[0]
    request = query.ListRequest(
        scope=scope, tab=tab, authority=authority.upper() if authority else None,
        q=q, sort=sort, cursor=cursor, limit=limit, ids=_ids(ids),
    )
    try:
        result = query.list_my_work(db, user, request)
    except query.QueryError as exc:
        raise _error(400, exc.code, str(exc)) from None
    return MyWorkList(
        scope=scope, tab=tab, view=result.view, read_only=result.read_only,
        tabs=[TabCount(key=k, count=c) for k, c in result.tabs],
        authority_totals=AuthorityTotals(kind=result.totals_kind, **result.totals),
        total=result.total,
        rows=[_row_out(r) for r in result.rows],
        next_cursor=result.next_cursor,
        long_wait_days=S.LONG_WAIT_DAYS,
    )


# --------------------------------------------------------------------------
# One village
# --------------------------------------------------------------------------
def load_village(db: Session, user: User, village_id: int) -> Village:
    """A village this user may see, or 404 -- the same answer for both cases."""
    village = db.execute(
        flow.visible_villages(user, db)
        .where(Village.id == village_id)
        .options(
            selectinload(Village.acceptances),
            selectinload(Village.work_item).selectinload(WorkItem.site).selectinload(Site.province),
            selectinload(Village.work_item).selectinload(WorkItem.dt_sc_contractor),
        )
    ).scalar_one_or_none()
    if village is None:
        raise HTTPException(404, "Village not found")
    return village


def _facts(village: Village) -> CpmFacts:
    work_item = village.work_item
    site = work_item.site if work_item else None
    return CpmFacts(
        work_item_id=work_item.id if work_item else None,
        site_id=site.id if site else None,
        site_code=site.site_code if site else None,
        province_name=site.province.name if site and site.province else None,
        village_code=village.village_code,
        village_name=village.village_name,
        requested_technologies=flow.requested_technologies(village),
        dt_date=work_item.dt_date_gregorian if work_item else None,
        dt_date_shamsi=format_shamsi(work_item.dt_date_gregorian) if work_item else None,
    )


def _names(db: Session, user_ids: set) -> dict[int, str]:
    ids = {i for i in user_ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all())


def _round_out(r, names: dict[int, str]) -> RoundOut:
    return RoundOut(
        submission_id=r.submission_id, round_no=r.round_no,
        letter_number=r.letter_number, letter_date=r.letter_date,
        letter_date_shamsi=format_shamsi(r.letter_date), result=r.result,
        source=r.source,
        submitted_by_name=names.get(r.submitted_by), submitted_at=r.submitted_at,
        reviewed_by_name=names.get(r.reviewed_by), reviewed_at=r.reviewed_at,
        return_reason=r.return_reason,
        claims=[ClaimOut(**vars(c)) for c in r.claims],
        scan=ScanOut(evidence_id=r.scan[0], filename=r.scan[1]) if r.scan else None,
    )


def _side_detail_out(side: detail.SideDetail, names: dict[int, str]) -> SideDetailOut:
    h = side.history
    return SideDetailOut(
        **{**vars(side.facts), "to_file": h.to_file},
        carry_over=[CarriedOut(**vars(c)) for c in h.carry_over],
        last_reason=LastReasonOut(**vars(h.last_reason)) if h.last_reason else None,
        same_letter=(
            SameLetterOut(letter_number=side.same_letter[0], count=side.same_letter[1])
            if side.same_letter else None
        ),
        history=[_round_out(r, names) for r in h.history],
    )


def village_fields(db: Session, user: User, village: Village) -> dict:
    """The My Work fields of ``GET /villages/{id}``, merged into its response."""
    sides = detail.side_details(db, village, user)
    names = _names(db, {
        uid for s in sides.values() for r in s.history.history
        for uid in (r.submitted_by, r.reviewed_by)
    })
    contractor = village.work_item.dt_sc_contractor if village.work_item else None
    return {
        "village_id": village.id,
        "facts": _facts(village),
        "contractor_name": contractor.name if contractor else None,
        "sides": {a: _side_detail_out(s, names) for a, s in sides.items()},
    }


@router.get("/villages/{village_id}/suggestions", response_model=Suggestions)
def village_suggestions(
    village_id: int,
    authority: str = Query(..., description="ICT|CRA"),
    scope: str = SCOPE_REMAINING,
    db: Session = Depends(get_db),
    user: User = Depends(require_worker),
) -> Suggestions:
    """Same-site villages whose ``authority`` side this user can file now."""
    authority = authority.upper()
    if authority not in ("ICT", "CRA"):
        raise _error(400, "invalid_authority", "authority must be ICT or CRA")
    village = load_village(db, user, village_id)
    site = village.work_item.site
    return Suggestions(
        site_id=site.id, site_code=site.site_code,
        villages=[
            SuggestedVillage(village_id=i, village_code=c, village_name=n, status=s)
            for i, c, n, s in detail.suggestions(db, user, village, authority, scope=_scope(scope))
        ],
    )


@router.post("/villages/resolve", response_model=ResolveResult)
def resolve_villages(
    payload: ResolveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_worker),
) -> ResolveResult:
    """Pasted village codes to the villages in this user's list."""
    total, matched, unmatched = detail.resolve_codes(db, user, payload.codes, scope=payload.scope)
    return ResolveResult(
        total=total,
        matched=[ResolvedCode(code=c, village_id=v) for c, v in matched],
        unmatched=unmatched,
    )


# --------------------------------------------------------------------------
# Filing and deciding
# --------------------------------------------------------------------------
@router.post("/scans", response_model=ScanUploaded, status_code=201)
def upload_scan(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_filer),
) -> ScanUploaded:
    """Store one scanned letter and return the token a letter names it by."""
    try:
        content = evidence_store.read_capped(file.file)
        scan_id, scan = scan_tokens.issue(file.filename or "", content, user_id=user.id)
    except evidence_store.EvidenceError as exc:
        raise _error(400, "scan_invalid", str(exc), [{"field": "file", "code": "scan_invalid"}]) from None
    return ScanUploaded(
        scan_id=scan_id, filename=scan.filename, content_type=scan.content_type,
        size_bytes=scan.size_bytes, expires_at=datetime.fromisoformat(scan.expires_at),
    )


def _outcomes(results) -> list[VillageOutcomeOut]:
    return [VillageOutcomeOut(**vars(r)) for r in results]


@router.post("/letters", response_model=LetterFiled, status_code=201)
def file_letter(
    payload: LetterIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_filer),
) -> LetterFiled:
    """One letter for one authority and 1-500 villages, all or nothing.

    A contractor's rounds are pending; a coordinator's or PM's are recorded
    decided, reviewed by them.
    """
    filing = letters.LetterFiling(
        authority=payload.authority,
        letter_number=payload.letter_number,
        letter_date=payload.letter_date,
        scan_id=payload.scan_id,
        items=tuple(
            letters.LetterItem(
                village_id=i.village_id,
                claims=tuple(letters.ClaimInput(c.tech, c.result, c.reason) for c in i.claims),
            )
            for i in payload.items
        ),
    )
    try:
        outcome = letters.file_letter(db, user, filing)
    except letters.LetterError as exc:
        db.rollback()
        raise _letter_error(exc) from None
    db.commit()
    return LetterFiled(
        authority=outcome.authority, letter_number=outcome.letter_number,
        decided=outcome.decided, count=len(outcome.results),
        results=_outcomes(outcome.results),
    )


@router.post("/letters/review", response_model=LetterReviewed)
def review_letter(
    payload: LetterReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_decider),
) -> LetterReviewed:
    """Confirm or return pending rounds -- one, or every one on a letter."""
    try:
        outcome = letters.review_letter(
            db, user, authority=payload.authority, decision=payload.decision,
            letter_number=payload.letter_number, submission_ids=payload.submission_ids,
            reason=payload.reason,
        )
    except letters.LetterError as exc:
        db.rollback()
        raise _letter_error(exc) from None
    db.commit()
    return LetterReviewed(
        decision=outcome.decision, count=len(outcome.results),
        results=_outcomes(outcome.results),
    )


@router.post("/authority-requests", response_model=AuthorityRequestResult, status_code=201)
def send_to_authority(
    payload: AuthorityRequestIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_filer),
) -> AuthorityRequestResult:
    """Record that a request letter went to ICT or CRA for these villages.

    From then until the authority's answer is filed the side is listed under
    "With authority", and a PM sees it on the Action Center's follow-up ticket.
    Villages already with the authority, or not in a state that needs asking,
    are reported per village rather than failing the whole request.
    """
    try:
        outcomes = authority_requests.record_requests(
            db, user, village_ids=payload.village_ids, authority=payload.authority,
            letter_number=payload.letter_number, letter_date=payload.letter_date,
        )
    except authority_requests.RequestError as exc:
        db.rollback()
        raise _error(422, exc.code, str(exc)) from None
    db.commit()
    return AuthorityRequestResult(
        recorded=sum(o.recorded for o in outcomes),
        outcomes=[AuthorityRequestOutcome(**vars(o)) for o in outcomes],
    )
