"""UEP Home's reads. Every rule is in ``services/home.py`` and, for the lists
behind its numbers (UEP-27), ``services/home_items.py``."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core import audit_actions
from app.core.access import Feature as F, require_access
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas.home import (
    DoneListOut,
    HomeSummaryOut,
    MeHomeOut,
    PipByContractorOut,
    QueueItemsOut,
)
from app.services import home, home_export, home_items, system_status
from app.services.action_queues.board import NotOnBoard
from app.services.audit import record_audit

router = APIRouter(tags=["home"])

#: UEP-25: every export also needs the "Export to Excel" feature.
EXPORTER = Depends(require_access(F.EXPORTS))

#: The most items one page of a list returns. The export has no cap.
MAX_PAGE_SIZE = 1000

StatusParam = Literal["all", "late", "due_soon", "on_time", "no_date"]
GroupParam = Literal["none", "province", "contractor"]


def _forbidden(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, str(exc))


@router.get("/home/summary", response_model=HomeSummaryOut)
def home_summary(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> HomeSummaryOut:
    """Everything the Home page shows, in one response.

    The roles that own pending work, and Regional Managers; a Viewer or Admin
    gets 403, not an empty page.
    """
    try:
        return HomeSummaryOut(**home.summary_for(db, user))
    except NotOnBoard as exc:
        raise _forbidden(exc) from None


@router.get("/me/home", response_model=MeHomeOut)
def me_home(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MeHomeOut:
    """Home in one round-trip: the summary (cached per user, emptied by every
    commit), plus system status and the version for the footer. The shell's
    rail counts and notification badge read this same response."""
    try:
        summary = home.summary_for(db, user)
    except NotOnBoard as exc:
        raise _forbidden(exc) from None
    return MeHomeOut(
        **summary, system=system_status.status(db), version=system_status.APP_VERSION
    )


# --------------------------------------------------------------------------
# UEP-27: the lists behind Home's numbers
# --------------------------------------------------------------------------
def _queue(user: User, queue_key: str):
    try:
        return home_items.home_queue(user, queue_key)
    except NotOnBoard as exc:
        raise _forbidden(exc) from None
    except home_items.UnknownQueue:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not one of your Home queues") from None


def _selection(status_: StatusParam, q: str, group: GroupParam) -> home_items.Selection:
    return home_items.Selection(status=None if status_ == "all" else status_, q=q, group=group)


@router.get("/me/queues/{queue_key}/items", response_model=QueueItemsOut)
def queue_items(
    queue_key: str,
    status_: StatusParam = Query("all", alias="status"),
    q: str = Query("", max_length=100, description="Site, village, province or contractor."),
    group: GroupParam = "none",
    page: int = Query(1, ge=1),
    size: int = Query(200, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> QueueItemsOut:
    """One Home queue's items, as its row counts them, inside the user's own
    scope: late first (oldest first), then due, on time and no date."""
    queue = _queue(user, queue_key)
    picked = home_items.select_rows(
        home_items.queue_rows(db, user, queue), _selection(status_, q, group)
    )
    start = (page - 1) * size
    return QueueItemsOut(
        queue_key=queue.key, label=queue.short_label, unit=queue.unit, url=queue.url,
        holder=queue.holder, total=len(picked.rows), counts_by_status=picked.counts_by_status,
        group=group, groups=picked.groups, page=page, size=size,
        items=picked.rows[start:start + size],
    )


def _filter_text(sel: home_items.Selection) -> str:
    parts = []
    if sel.status:
        parts.append(f"{home_export.STATUS_LABELS[sel.status]} only")
    if sel.q.strip():
        parts.append(f'matching "{sel.q.strip()}"')
    if sel.group != "none":
        parts.append(f"grouped by {sel.group}")
    return ", ".join(parts)


def _send(db: Session, user: User, *, title: str, sheets, filter_text: str, audit: dict) -> Response:
    """Write the workbook, audit the export, send the file."""
    about = home_export.About(
        title=title, filter_text=filter_text,
        exported_by=f"{user.full_name} ({user.username})",
    )
    rows = sum(len(s.rows) for s in sheets)
    # Built first: the audit records a file that was actually handed out.
    file = home_export.build(sheets, about)
    record_audit(
        db, user_id=user.id, action=audit_actions.HOME_EXPORT, module="home",
        entity_type="home_list", entity_id=None,
        new_value={**audit, "rows": rows, "filter": filter_text},
    )
    db.commit()
    try:
        return Response(
            content=file.read(), media_type=home_export.XLSX_MEDIA_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="{home_export.filename(title)}"',
                "X-Row-Count": str(rows),
            },
        )
    finally:
        file.close()


@router.get("/me/queues/{queue_key}/export.xlsx", dependencies=[EXPORTER])
def queue_export(
    queue_key: str,
    status_: StatusParam = Query("all", alias="status"),
    q: str = Query("", max_length=100),
    group: GroupParam = "none",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Every item of the list with the panel's filter, search and grouping
    (a sheet per group when grouped) -- not just the rows on screen."""
    queue = _queue(user, queue_key)
    sel = _selection(status_, q, group)
    picked = home_items.select_rows(home_items.queue_rows(db, user, queue), sel)
    rows = [home_export.item_cells(r) for r in picked.rows]
    if group == "none":
        sheets = [home_export.Sheet(queue.short_label, home_export.ITEM_COLUMNS, rows)]
    else:
        sheets = [
            home_export.Sheet(g["key"], home_export.ITEM_COLUMNS,
                              [r for r in rows if home_items.group_of(r, group) == g["key"]])
            for g in picked.groups
        ]
    return _send(db, user, title=queue.short_label, sheets=sheets,
                 filter_text=_filter_text(sel), audit={"queue": queue.key})


@router.get("/me/done", response_model=DoneListOut)
def my_done(
    period: Literal["week"] = "week",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DoneListOut:
    """What this user finished since Saturday (Tehran), newest first."""
    try:
        since, rows = home_items.done_rows(db, user)
    except NotOnBoard as exc:
        raise _forbidden(exc) from None
    return DoneListOut(period=period, since=since, total=len(rows), items=rows)


@router.get("/me/pip/by-contractor", response_model=PipByContractorOut)
def pip_by_contractor(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> PipByContractorOut:
    """Each contractor's delivered sites against their PIP this month. PM and
    Viewer only."""
    try:
        return PipByContractorOut(**home_items.pip_rows(db, user))
    except PermissionError as exc:
        raise _forbidden(exc) from None


@router.get("/me/home/export.xlsx", dependencies=[EXPORTER])
def summary_export(
    panel: Literal["summary", "done", "pip"],
    queues: str = Query("", max_length=1000, description="Comma-separated queue keys (summary)."),
    title: str = Query("Summary", max_length=80),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """A summary panel as Excel, one row per line. The rows are built here,
    from the user's own Home, never taken from the browser."""
    try:
        if panel == "done":
            _, rows = home_items.done_rows(db, user)
            sheets = [home_export.Sheet("Done this week", home_export.DONE_COLUMNS,
                                        [home_export.done_cells(r) for r in rows])]
            title = "Done this week"
        elif panel == "pip":
            data = home_items.pip_rows(db, user)
            sheets = [home_export.Sheet("Contractor PIP", home_export.PIP_COLUMNS, data["rows"])]
            title = "Contractor PIP"
        else:
            wanted = [k for k in queues.split(",") if k]
            tickets = {
                t["queue_key"]: t
                for g in home.summary_for(db, user)["groups"] for t in g["tickets"]
            }
            rows = [tickets[k] for k in wanted if k in tickets]
            sheets = [home_export.Sheet(title, home_export.SUMMARY_COLUMNS, rows)]
    except (NotOnBoard, PermissionError) as exc:
        raise _forbidden(exc) from None
    return _send(db, user, title=title, sheets=sheets, filter_text="",
                 audit={"panel": panel, "queues": queues or None})



