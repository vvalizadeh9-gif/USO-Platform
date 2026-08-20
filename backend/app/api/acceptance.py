"""Acceptance dashboard endpoint.

One combined endpoint returns the KPIs, ICT-vs-CRA analysis and per-province
status for the current user's province scope, computed over the ICT/CRA
approval data seeded from the CPM execution block (columns AV..BQ).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas import (
    AcceptanceAnalysis,
    AcceptanceKpis,
    AcceptanceOverview,
    ProvinceAcceptanceRow,
)
from app.services.acceptance_analytics import AcceptanceAnalytics

router = APIRouter(prefix="/acceptance", tags=["acceptance"])


@router.get("/overview", response_model=AcceptanceOverview)
def acceptance_overview(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> AcceptanceOverview:
    """Return the full Acceptance dashboard payload for this user's scope."""
    data = AcceptanceAnalytics(db, user).build()
    return AcceptanceOverview(
        kpis=AcceptanceKpis(**data["kpis"]),
        analysis=AcceptanceAnalysis(**data["analysis"]),
        provinces=[ProvinceAcceptanceRow(**row) for row in data["provinces"]],
    )


# ---------------------------------------------------------------------------
# Submission workflow
#
# Appended below the read-only dashboard endpoint above, which is unchanged.
# Everything here goes through services/acceptance_workflow.py: this module
# resolves and authorises, and holds no rules of its own.
# ---------------------------------------------------------------------------
from datetime import datetime, timezone  # noqa: E402

from fastapi import File, Form, HTTPException, Query, Response, UploadFile  # noqa: E402
from sqlalchemy import func, or_, select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from app.core.deps import ADMIN, CONTRACTOR, COORDINATOR, PM, require_roles  # noqa: E402
from app.core.jalali import format_shamsi, parse_shamsi  # noqa: E402
from app.models.acceptance_workflow import (  # noqa: E402
    REVIEW_PENDING,
    REVIEW_RETURNED,
    SOURCE_CONTRACTOR,
    SOURCE_COORDINATOR,
    AcceptanceEvidence,
    AcceptanceSubmission,
)
from app.models.reference import Province, User as UserModel  # noqa: E402
from app.models.workitem import Site, Village, WorkItem  # noqa: E402
from app.schemas import (  # noqa: E402
    AcceptanceReviewRequest,
    AcceptanceSubmissionCreate,
    AcceptanceSubmissionOut,
    AcceptanceSubmissionUpdate,
    AcceptanceUploadLimits,
    AcceptanceVillageDetail,
    AcceptanceVillageList,
    AcceptanceVillageRow,
    EvidenceOut,
    TechnologyClaimOut,
)
from app.services import acceptance_workflow as flow  # noqa: E402
from app.services import evidence_store  # noqa: E402
from app.services.audit import notify_roles, record_audit  # noqa: E402

# Who may put a claim in, and who may turn it into a fact. Admin is absent from
# both on purpose — it is a systems role, and the separation of duties that
# keeps it out of health-check and drive-test decisions applies here too.
_SUBMIT_ROLES = (CONTRACTOR, COORDINATOR, PM)
_REVIEW_ROLES = (COORDINATOR, PM)


def _village_query(user: UserModel, db: Session):
    """Villages this user may see, with everything the rows need loaded."""
    return flow.visible_villages(user, db).options(
        selectinload(Village.acceptances),
        selectinload(Village.work_item).selectinload(WorkItem.site).selectinload(
            Site.province
        ),
        selectinload(Village.work_item).selectinload(WorkItem.villages).selectinload(
            Village.acceptances
        ),
    )


def _load_village(db: Session, user: UserModel, village_id: int) -> Village:
    village = db.execute(
        _village_query(user, db).where(Village.id == village_id)
    ).scalar_one_or_none()
    if village is None:
        # Deliberately the same answer whether the village does not exist or is
        # simply outside this user's scope: a contractor must not be able to
        # discover which site codes belong to someone else by probing ids.
        raise HTTPException(404, "Village not found")
    return village


def _submission_states(db: Session, village_ids: list[int]) -> dict:
    """Per village, which authorities are awaiting review or were returned."""
    if not village_ids:
        return {}
    rows = db.execute(
        select(
            AcceptanceSubmission.village_id,
            AcceptanceSubmission.authority,
            AcceptanceSubmission.review_status,
        ).where(
            AcceptanceSubmission.village_id.in_(village_ids),
            AcceptanceSubmission.review_status.in_([REVIEW_PENDING, REVIEW_RETURNED]),
        )
    ).all()
    states: dict = {}
    for village_id, authority, status in rows:
        bucket = states.setdefault(village_id, {"pending": set(), "returned": set()})
        if status == REVIEW_PENDING:
            bucket["pending"].add(authority)
        else:
            bucket["returned"].add(authority)
    return states


def _last_activity(db: Session, village_ids: list[int]) -> dict:
    """Per village, when its acceptance last moved.

    The most recent of any submission's review or submission time — so a
    village that bounced four times reads "waiting 6 days" against its current
    round, not three hundred days against its first.
    """
    if not village_ids:
        return {}
    rows = db.execute(
        select(
            AcceptanceSubmission.village_id,
            func.max(
                func.coalesce(
                    AcceptanceSubmission.reviewed_at, AcceptanceSubmission.submitted_at
                )
            ),
        )
        .where(AcceptanceSubmission.village_id.in_(village_ids))
        .group_by(AcceptanceSubmission.village_id)
    ).all()
    return {village_id: moment for village_id, moment in rows if moment}


def _days_since(moment) -> int | None:
    if moment is None:
        return None
    # SQLite hands back naive datetimes; treat those as UTC rather than
    # letting the subtraction raise.
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return max((datetime.now(timezone.utc) - moment).days, 0)


def _row(village: Village, states: dict, activity: dict | None = None) -> AcceptanceVillageRow:
    work_item = village.work_item
    site = work_item.site if work_item else None
    state = states.get(village.id, {})
    pending = sorted(state.get("pending", ()))

    # An authority can be submitted when nothing is awaiting review for it and
    # it is not already approved. A returned submission does not block: the
    # contractor is expected to send a corrected round.
    can_submit = [
        authority
        for authority in ("ICT", "CRA")
        if authority not in pending
        and flow.authority_verdict(village, authority) != flow.APPROVED
        and work_item is not None
        and work_item.dt_status == flow.DT_DONE
    ]

    return AcceptanceVillageRow(
        village_id=village.id,
        village_code=village.village_code,
        village_name=village.village_name,
        site_code=site.site_code if site else None,
        work_item_id=village.work_item_id,
        province_name=site.province.name if site and site.province else None,
        requested_technologies=flow.requested_technologies(village),
        ict_verdict=flow.authority_verdict(village, "ICT"),
        cra_verdict=flow.authority_verdict(village, "CRA"),
        verdict=flow.village_verdict(village),
        site_status=flow.site_status(work_item) if work_item else flow.SITE_OPEN,
        waiting_days=_days_since((activity or {}).get(village.id)),
        pending_authorities=pending,
        returned_authorities=sorted(state.get("returned", ())),
        can_submit=can_submit,
    )


def _names(db: Session, user_ids: set[int]) -> dict:
    ids = {i for i in user_ids if i}
    if not ids:
        return {}
    return dict(
        db.execute(
            select(UserModel.id, UserModel.full_name).where(UserModel.id.in_(ids))
        ).all()
    )


def _submission_out(
    submission: AcceptanceSubmission, names: dict, village: Village | None = None
) -> AcceptanceSubmissionOut:
    village = village or submission.village
    work_item = village.work_item if village else None
    site = work_item.site if work_item else None
    return AcceptanceSubmissionOut(
        id=submission.id,
        village_id=submission.village_id,
        authority=submission.authority,
        round_no=submission.round_no,
        letter_number=submission.letter_number,
        letter_date=submission.letter_date,
        letter_date_shamsi=format_shamsi(submission.letter_date),
        source=submission.source,
        review_status=submission.review_status,
        submitted_by_name=names.get(submission.submitted_by),
        submitted_at=submission.submitted_at,
        reviewed_by_name=names.get(submission.reviewed_by),
        reviewed_at=submission.reviewed_at,
        review_comment=submission.review_comment,
        technologies=[
            TechnologyClaimOut.model_validate(t) for t in submission.technologies
        ],
        evidence=[EvidenceOut.model_validate(e) for e in submission.evidence],
        village_name=village.village_name if village else None,
        village_code=village.village_code if village else None,
        site_code=site.site_code if site else None,
        province_name=site.province.name if site and site.province else None,
    )


def _claims(technologies) -> list[dict]:
    return [t.model_dump() for t in technologies]


def _letter_date(raw: str | None):
    try:
        return parse_shamsi(raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/limits", response_model=AcceptanceUploadLimits)
def upload_limits(user: User = Depends(get_current_user)) -> AcceptanceUploadLimits:
    """What the evidence upload box should tell the user it accepts."""
    from app.core.config import get_settings

    return AcceptanceUploadLimits(
        accepted_extensions=evidence_store.ACCEPTED_EXTENSIONS,
        max_file_mb=get_settings().max_upload_mb,
        max_files_per_submission=evidence_store.MAX_FILES_PER_SUBMISSION,
    )


@router.get("/villages", response_model=AcceptanceVillageList)
def list_villages(
    status: str | None = Query(None, description="Approved|Rejected|Pending"),
    province_id: int | None = None,
    search: str | None = None,
    mine_only: bool = Query(
        False, description="Only villages still needing something from me"
    ),
    limit: int = Query(50, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AcceptanceVillageList:
    """The village-by-village acceptance list, scoped to this user.

    Acceptance is the approval of finished drive-test work, so only DT-Done
    sites appear here at all.
    """
    stmt = _village_query(user, db).join(
        WorkItem, Village.work_item_id == WorkItem.id
    ).where(WorkItem.dt_status == flow.DT_DONE)

    if province_id is not None:
        stmt = stmt.join(Site, WorkItem.site_id == Site.id).where(
            Site.province_id == province_id
        )
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.join(Site, WorkItem.site_id == Site.id).where(
            or_(
                Village.village_name.ilike(pattern),
                Village.village_code.ilike(pattern),
                Site.site_code.ilike(pattern),
            )
        )

    villages = db.execute(stmt.order_by(Village.id)).unique().scalars().all()
    village_ids = [v.id for v in villages]
    states = _submission_states(db, village_ids)
    activity = _last_activity(db, village_ids)
    rows = [_row(v, states, activity) for v in villages]

    # Verdicts are derived from the loaded graph rather than stored, so status
    # filtering and the total happen here rather than in SQL.
    if status:
        wanted = status.strip().title()
        rows = [r for r in rows if r.verdict == wanted]
    if mine_only:
        # "Needs me" means different work depending on who is asking. Someone
        # who validates wants their review queue; someone who files letters
        # wants what is unfiled or was sent back to them.
        if user.role.name in _REVIEW_ROLES:
            rows = [r for r in rows if r.pending_authorities]
        else:
            rows = [r for r in rows if r.can_submit or r.returned_authorities]

    total = len(rows)
    return AcceptanceVillageList(total=total, rows=rows[offset : offset + limit])


@router.get("/villages/{village_id}", response_model=AcceptanceVillageDetail)
def village_detail(
    village_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AcceptanceVillageDetail:
    """One village: its current verdicts and every submission ever made for it.

    The full history, both authorities, every round — this is what makes an
    argument about a rejection settleable.
    """
    village = _load_village(db, user, village_id)
    submissions = db.execute(
        select(AcceptanceSubmission)
        .where(AcceptanceSubmission.village_id == village_id)
        .order_by(
            AcceptanceSubmission.authority,
            AcceptanceSubmission.round_no.desc(),
            AcceptanceSubmission.id.desc(),
        )
    ).unique().scalars().all()

    names = _names(
        db,
        {s.submitted_by for s in submissions} | {s.reviewed_by for s in submissions},
    )
    states = _submission_states(db, [village_id])
    return AcceptanceVillageDetail(
        village=_row(village, states, _last_activity(db, [village_id])),
        dt_status=village.work_item.dt_status if village.work_item else None,
        submissions=[_submission_out(s, names, village) for s in submissions],
    )


@router.post("/villages/{village_id}/submissions", response_model=AcceptanceSubmissionOut, status_code=201)
def create_submission(
    village_id: int,
    payload: AcceptanceSubmissionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*_SUBMIT_ROLES)),
) -> AcceptanceSubmissionOut:
    """Record a claimed ICT or CRA verdict for one village."""
    village = _load_village(db, user, village_id)
    source = (
        SOURCE_CONTRACTOR if user.role.name == CONTRACTOR else SOURCE_COORDINATOR
    )
    try:
        submission = flow.submit(
            db,
            village=village,
            authority=payload.authority,
            letter_number=payload.letter_number,
            letter_date=_letter_date(payload.letter_date_shamsi),
            claims=_claims(payload.technologies),
            user=user,
            source=source,
        )
    except flow.WorkflowError as exc:
        raise HTTPException(400, str(exc)) from None

    db.flush()
    record_audit(
        db, user_id=user.id, module="Acceptance",
        entity_type="AcceptanceSubmission", entity_id=submission.id,
        new_value={
            "village_id": village_id,
            "authority": submission.authority,
            "round_no": submission.round_no,
            "letter_number": submission.letter_number,
            "claims": {t.technology: t.claimed_status for t in submission.technologies},
        },
    )
    notify_roles(
        db, role_names=list(_REVIEW_ROLES), type="AcceptanceSubmitted",
        message=(
            f"{submission.authority} acceptance submitted for village "
            f"{village.village_name or village.village_code}"
        ),
        entity_type="AcceptanceSubmission", entity_id=submission.id,
    )
    db.commit()
    db.refresh(submission)
    return _submission_out(submission, _names(db, {user.id}), village)


def _editable(db: Session, user: UserModel, submission_id: int) -> AcceptanceSubmission:
    """Load a submission the caller is allowed to change, or refuse."""
    submission = db.get(AcceptanceSubmission, submission_id)
    if submission is None or not flow.may_see_village(db, user, submission.village_id):
        raise HTTPException(404, "Submission not found")
    # The submitter fixes their own mistakes; staff may correct anyone's.
    if submission.submitted_by != user.id and user.role.name not in _REVIEW_ROLES:
        raise HTTPException(403, "You can only change your own submissions")
    return submission


@router.put("/submissions/{submission_id}", response_model=AcceptanceSubmissionOut)
def update_submission(
    submission_id: int,
    payload: AcceptanceSubmissionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*_SUBMIT_ROLES)),
) -> AcceptanceSubmissionOut:
    """Correct a submission that has not been reviewed yet."""
    submission = _editable(db, user, submission_id)
    before = {t.technology: t.claimed_status for t in submission.technologies}
    try:
        flow.update(
            db,
            submission=submission,
            letter_number=payload.letter_number,
            letter_date=_letter_date(payload.letter_date_shamsi),
            claims=_claims(payload.technologies),
        )
    except flow.WorkflowError as exc:
        raise HTTPException(400, str(exc)) from None

    db.flush()
    record_audit(
        db, user_id=user.id, module="Acceptance",
        entity_type="AcceptanceSubmission", entity_id=submission.id,
        old_value={"claims": before},
        new_value={
            "claims": {t.technology: t.claimed_status for t in submission.technologies},
            "letter_number": submission.letter_number,
        },
    )
    db.commit()
    db.refresh(submission)
    return _submission_out(submission, _names(db, {submission.submitted_by}))


@router.post("/submissions/{submission_id}/withdraw", response_model=AcceptanceSubmissionOut)
def withdraw_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*_SUBMIT_ROLES)),
) -> AcceptanceSubmissionOut:
    """Take back a submission before anyone has reviewed it."""
    submission = _editable(db, user, submission_id)
    try:
        flow.withdraw(db, submission=submission)
    except flow.WorkflowError as exc:
        raise HTTPException(400, str(exc)) from None

    record_audit(
        db, user_id=user.id, module="Acceptance",
        entity_type="AcceptanceSubmission", entity_id=submission.id,
        new_value={"review_status": submission.review_status},
    )
    db.commit()
    db.refresh(submission)
    return _submission_out(submission, _names(db, {submission.submitted_by}))


@router.get("/queue", response_model=list[AcceptanceSubmissionOut])
def review_queue(
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*_REVIEW_ROLES, ADMIN)),
) -> list[AcceptanceSubmissionOut]:
    """Submissions awaiting review, within this user's province scope."""
    visible = flow.visible_villages(user, db).with_only_columns(Village.id)
    submissions = db.execute(
        select(AcceptanceSubmission)
        .where(
            AcceptanceSubmission.review_status == REVIEW_PENDING,
            AcceptanceSubmission.village_id.in_(visible),
        )
        .options(
            selectinload(AcceptanceSubmission.village)
            .selectinload(Village.work_item)
            .selectinload(WorkItem.site)
            .selectinload(Site.province)
        )
        .order_by(AcceptanceSubmission.submitted_at)
        .limit(limit)
    ).unique().scalars().all()

    names = _names(db, {s.submitted_by for s in submissions})
    return [_submission_out(s, names) for s in submissions]


@router.post("/submissions/{submission_id}/review", response_model=AcceptanceSubmissionOut)
def review_submission(
    submission_id: int,
    payload: AcceptanceReviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*_REVIEW_ROLES)),
) -> AcceptanceSubmissionOut:
    """Validate a submission into the record, or return it to the submitter.

    A validation is the moment a claim becomes a fact: it is the only path by
    which anything reaches the ``acceptances`` table.
    """
    submission = db.get(AcceptanceSubmission, submission_id)
    if submission is None or not flow.may_see_village(db, user, submission.village_id):
        raise HTTPException(404, "Submission not found")

    try:
        flow.review(
            db,
            submission=submission,
            decision=payload.decision,
            comment=payload.comment,
            user=user,
        )
    except flow.WorkflowError as exc:
        raise HTTPException(400, str(exc)) from None

    village = submission.village
    record_audit(
        db, user_id=user.id, module="Acceptance",
        entity_type="AcceptanceSubmission", entity_id=submission.id,
        new_value={
            "review_status": submission.review_status,
            "village_verdict": flow.village_verdict(village),
        },
        reason=submission.review_comment,
    )
    if submission.submitted_by:
        from app.services.audit import notify

        notify(
            db, user_id=submission.submitted_by, type="AcceptanceReviewed",
            message=(
                f"{submission.authority} submission for "
                f"{village.village_name or village.village_code} was "
                f"{submission.review_status.lower()}"
            ),
            entity_type="AcceptanceSubmission", entity_id=submission.id,
        )
    db.commit()
    db.refresh(submission)
    return _submission_out(submission, _names(db, {submission.submitted_by, user.id}))


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------
@router.post("/submissions/{submission_id}/evidence", response_model=EvidenceOut, status_code=201)
def upload_evidence(
    submission_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*_SUBMIT_ROLES)),
) -> EvidenceOut:
    """Attach a scanned letter or supporting document to a pending submission."""
    submission = _editable(db, user, submission_id)
    if submission.review_status != REVIEW_PENDING:
        raise HTTPException(400, "Evidence can only be added before review")
    if len(submission.evidence) >= evidence_store.MAX_FILES_PER_SUBMISSION:
        raise HTTPException(
            400,
            f"At most {evidence_store.MAX_FILES_PER_SUBMISSION} files per submission",
        )

    content = file.file.read()
    try:
        stored = evidence_store.store(file.filename or "", content)
    except evidence_store.EvidenceError as exc:
        raise HTTPException(400, str(exc)) from None

    record = AcceptanceEvidence(
        submission_id=submission.id,
        sha256=stored["sha256"],
        stored_path=stored["stored_path"],
        original_filename=(file.filename or "")[:255],
        content_type=file.content_type,
        size_bytes=stored["size_bytes"],
        uploaded_by=user.id,
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return EvidenceOut.model_validate(record)


@router.get("/evidence/{evidence_id}/download")
def download_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download one evidence file, if the caller may see its village."""
    record = db.get(AcceptanceEvidence, evidence_id)
    if record is None:
        raise HTTPException(404, "Evidence not found")
    submission = db.get(AcceptanceSubmission, record.submission_id)
    if submission is None or not flow.may_see_village(db, user, submission.village_id):
        raise HTTPException(404, "Evidence not found")

    path = evidence_store.absolute_path(record.stored_path)
    if not path.exists():
        raise HTTPException(404, "The stored file is missing")

    return Response(
        content=path.read_bytes(),
        media_type=record.content_type or "application/octet-stream",
        headers={
            # Quotes escaped so a filename containing one cannot break out of
            # the header value.
            "Content-Disposition":
                'attachment; filename="'
                + record.original_filename.replace('"', "'")
                + '"'
        },
    )


@router.delete("/evidence/{evidence_id}", status_code=204)
def delete_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles(*_SUBMIT_ROLES)),
) -> Response:
    """Remove an attachment from a submission that is still awaiting review.

    Only the database row goes. The blob on disk is shared by every submission
    that uploaded the same letter, so deleting it here would take the evidence
    away from a hundred other villages.
    """
    record = db.get(AcceptanceEvidence, evidence_id)
    if record is None:
        raise HTTPException(404, "Evidence not found")
    submission = _editable(db, user, record.submission_id)
    if submission.review_status != REVIEW_PENDING:
        raise HTTPException(400, "Evidence can only be removed before review")

    db.delete(record)
    db.commit()
    return Response(status_code=204)
