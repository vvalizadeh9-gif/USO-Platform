"""Drive Test Project dashboard endpoints.

``/overview`` returns all KPIs and chart datasets for the current user's
province scope, plus month-over-month deltas from the latest snapshot, plus
the ongoing, problematic and per-province breakdowns that split those totals
up. The breakdowns ride on this endpoint rather than on one of their own
because they are the same totals seen from closer up, computed from the same
cached pass: a second endpoint would re-read the database and could answer
with figures the cards on the same screen disagree with.

``/plan-delivery`` returns one month's commitment against its delivery. It is
a second endpoint rather than more fields on the overview because it answers a
different question over a different period — the overview is a running state
of the whole programme, this is one month closing — and because it is the one
payload on this dashboard that can name a contractor, which is worth keeping
where it can be read in one place.

``/export`` is the delivery workbook: the whole picture -- summary, sites,
open fixes, contractor ledger, provinces -- in one file for an audit or a
meeting, every figure taken from the same service calls the screens use.

``/sites`` and ``/sites/export`` are the drill-through: the list of sites
behind any figure above, and the same list as a spreadsheet. They are a third
endpoint rather than parameters on ``/work-items`` because that screen's
stage filter and this dashboard's buckets are not the same definition — see
the module docstring of ``services/dt_site_list.py``, which has the numbers.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.work_items import MAX_EXPORT_ROWS
from app.core import jalali
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import Province, User
from app.schemas import (
    ChartPoint,
    ContractorAchievementRow,
    ContractorScorecardRow,
    DriveTestFlow,
    DriveTestKpis,
    DriveTestOverview,
    DriveTestSiteList,
    DriveTestSiteRow,
    DriveTestTrend,
    FilterOption,
    FlowBalance,
    FlowMonth,
    KpiWithDelta,
    MonthFlows,
    OngoingBreakdown,
    PlanAndDelivery,
    ProblematicBreakdown,
    ProvinceBreakdownRow,
    ProvinceOption,
    ProvinceProgressPoint,
    TrendPoint,
)
from app.services import (
    dt_site_export,
    dt_site_list,
    dt_trends,
    dt_workbook,
    monthly_plan as plans,
)
from app.services.drive_test_analytics import (
    AGE_BAND_KEYS,
    AGE_BAND_LABEL_BY_KEY,
    NO_ASSIGNMENT_DATE,
    NO_PROBLEM_DATE,
    ONGOING_STAGE_ORDER,
    STAGE_OTHER,
    DriveTestAnalytics,
)
from app.services.snapshots import get_month_over_month
from app.services.visibility import visible_province_ids

router = APIRouter(prefix="/drive-test", tags=["drive-test"])

_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _resolve_province(user: User, province_id: int | None) -> int | None:
    """Validate a requested province against the caller's own scope.

    Returns the id to filter on, or ``None`` for the caller's full scope. A
    province outside the caller's grants is rejected here with a 404 rather
    than silently ignored: quietly widening the answer back to everything
    would show a user national figures they asked to narrow, and quietly
    returning nothing would look like a province with no sites.

    The analytics layer applies the same rule again as a ``WHERE`` on top of
    the scoped query, so this check is the readable error, not the barrier.
    """
    if province_id is None:
        return None
    allowed = visible_province_ids(user)
    if allowed is not None and province_id not in allowed:
        raise HTTPException(404, "Province not found in your scope")
    return province_id


def _province_options(db: Session, user: User) -> list[ProvinceOption]:
    """The provinces this caller may narrow to, alphabetically.

    A contractor is scoped by what is assigned to them rather than by
    geography, so ``visible_province_ids`` returns every province for them the
    same as it does for an unrestricted staff account. Offering the full list
    is still correct: the filter only ever removes rows from what the caller
    could already see, so a province holding none of their sites narrows the
    dashboard to zero rather than revealing anything.
    """
    allowed = visible_province_ids(user)
    stmt = select(Province).order_by(Province.name)
    if allowed is not None:
        if not allowed:
            return []
        stmt = stmt.where(Province.id.in_(allowed))
    return [
        ProvinceOption(id=p.id, name=p.name) for p in db.execute(stmt).scalars().all()
    ]


@router.get("/overview", response_model=DriveTestOverview)
def drive_test_overview(
    province_id: int | None = Query(
        None, description="Narrow every figure to one province inside your scope"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DriveTestOverview:
    """Return the full Drive Test Project dashboard payload for this user."""
    province_id = _resolve_province(user, province_id)
    analytics = DriveTestAnalytics(db, user, province_id=province_id)
    kpis = analytics.compute_kpis()
    # Off the same cached work items the KPIs were counted from, so the
    # breakdowns reconcile to the cards rather than to a second reading of the
    # database taken a moment later.
    breakdowns = analytics.breakdowns()

    # Month-over-month deltas. Use the global snapshot when the user sees all
    # provinces; otherwise fall back to the global one (per-province delta only
    # applies cleanly to single-province users, handled below).
    prev = _previous_totals(db, user, province_id)

    total_onair = kpis["total_onair"]

    def pct(n: int) -> float | None:
        return round(n / total_onair * 100, 1) if total_onair else None

    def delta(key: str) -> int | None:
        return kpis[key] - prev[key] if key in prev else None

    dt_kpis = DriveTestKpis(
        total_onair=KpiWithDelta(value=total_onair, delta=delta("total_onair")),
        total_dt_done=KpiWithDelta(
            value=kpis["total_dt_done"],
            delta=delta("total_dt_done"),
            percent_of_onair=pct(kpis["total_dt_done"]),
        ),
        total_remaining=KpiWithDelta(
            value=kpis["total_remaining"],
            delta=delta("total_remaining"),
            percent_of_onair=pct(kpis["total_remaining"]),
        ),
        total_ongoing=KpiWithDelta(
            value=kpis["total_ongoing"],
            delta=delta("total_ongoing"),
            percent_of_onair=pct(kpis["total_ongoing"]),
        ),
        total_problematic=KpiWithDelta(
            value=kpis["total_problematic"],
            delta=delta("total_problematic"),
            percent_of_onair=pct(kpis["total_problematic"]),
        ),
        # No delta: the monthly snapshot has no column for it, and one
        # derived from the other four would be a month-over-month comparison
        # against figures taken under the old Ongoing definition. A missing
        # delta renders as nothing at all (see KpiBand's DeltaChip), which is
        # the honest answer until this figure has a baseline of its own.
        total_not_started=KpiWithDelta(
            value=kpis["total_not_started"],
            percent_of_onair=pct(kpis["total_not_started"]),
        ),
        current_month_dt_done=KpiWithDelta(
            value=kpis["current_month_dt_done"],
            delta=delta("current_month_dt_done"),
        ),
    )

    year, month = jalali.current_shamsi_period()
    return DriveTestOverview(
        kpis=dt_kpis,
        ongoing_by_contractor=_points(analytics.chart_ongoing_by_contractor()),
        problematic_by_category=_points(analytics.chart_problematic_by_category()),
        dt_done_by_contractor=_points(analytics.chart_dt_done_by_contractor()),
        dt_done_yearly=_points(analytics.chart_dt_done_yearly()),
        dt_done_monthly=analytics.chart_dt_done_monthly(shamsi_year=year),
        progress_by_province=[
            ProvinceProgressPoint(**row)
            for row in analytics.chart_progress_by_province()
        ],
        current_month_label=f"{jalali.month_name(month)} {year}",
        ongoing_breakdown=_ongoing_breakdown(breakdowns["ongoing"]),
        problematic_breakdown=_problematic_breakdown(breakdowns["problematic"]),
        province_breakdown=[
            ProvinceBreakdownRow(**row) for row in breakdowns["provinces"]
        ],
        contractor_scorecard=[
            ContractorScorecardRow(**row) for row in breakdowns["contractors"]
        ],
        generated_at=datetime.now(timezone.utc),
        provinces=_province_options(db, user),
        province_id=province_id,
    )


@router.get("/trend", response_model=DriveTestTrend)
def drive_test_trend(
    months: int = Query(
        dt_trends.DEFAULT_MONTHS, ge=2, le=36, description="How many Shamsi months"
    ),
    province_id: int | None = Query(
        None, description="Narrow the series to one province inside your scope"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DriveTestTrend:
    """The trailing-month series, and the newest month that has a flow ledger.

    A second endpoint rather than more fields on ``/overview`` because it
    reads an entirely different source. The overview counts live work items;
    this reads the monthly snapshot table, which is written on the login path
    and can be older, thinner, or — in a deployment where nobody signed in for
    a month — missing periods outright. Merging the two would put figures of
    two different vintages behind one loading state, and a snapshot table with
    gaps would take the live dashboard down with it.

    ``months`` is capped at 36 rather than unbounded: past three years the
    axis stops being readable long before the query stops being cheap, so the
    limit is about the chart, not the database.
    """
    province_id = _resolve_province(user, province_id)
    if province_id is not None:
        scope: list[int] | None = [province_id]
    else:
        scope = visible_province_ids(user)

    series = dt_trends.month_series(db, scope, months=months)
    flows = dt_trends.latest_flows(series)
    return DriveTestTrend(
        months=[TrendPoint(**point) for point in _trend_payload(series)],
        latest_flows=MonthFlows(**flows) if flows else None,
        province_id=province_id,
    )


@router.get("/flow", response_model=DriveTestFlow)
def drive_test_flow(
    province_id: int | None = Query(
        None, description="Narrow every figure to one province inside your scope"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DriveTestFlow:
    """On-air and DT-done counts by Shamsi month, Farvardin 1404 to now.

    Same auth, role and province scoping as ``/trend`` (``_resolve_province``
    over ``get_current_user`` -- no widened access), but reads live work
    items through :class:`DriveTestAnalytics` the way ``/overview`` does,
    rather than the monthly snapshot table. Read-only: nothing is written.
    """
    province_id = _resolve_province(user, province_id)
    analytics = DriveTestAnalytics(db, user, province_id=province_id)
    flow = analytics.monthly_flow()
    return DriveTestFlow(
        opening=FlowBalance(**flow["opening"]),
        months=[FlowMonth(**point) for point in flow["months"]],
        not_placed=FlowBalance(**flow["not_placed"]),
        province_id=province_id,
    )


def _trend_payload(series: list[dict]) -> list[dict]:
    """Drop the raw flow dict from each point before it becomes a TrendPoint.

    The flows are returned once, on ``latest_flows``, where they are paired
    with the opening balance that makes them a ledger. Repeating them on every
    point would put the same figures on the wire twice in two shapes, and the
    second shape has no opening balance to close against.
    """
    return [{k: v for k, v in point.items() if k != "flows"} for point in series]


@router.get("/plan-delivery", response_model=PlanAndDelivery)
def plan_delivery(
    year: int | None = Query(None, description="Shamsi year; defaults to the current one"),
    month: int | None = Query(None, ge=1, le=12, description="Shamsi month 1-12"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PlanAndDelivery:
    """PIP, Assigned, Actual and Achievement for one Shamsi month.

    Open to every signed-in role, because the answer is already scoped to the
    caller: staff see the contractors their work-item scope reaches, and a
    contractor sees one row — their own — plus an unnamed programme average.
    That narrowing happens in the service's queries, not in this layer.

    The period defaults to the current Shamsi month, which is what the
    dashboard asks for; it is a parameter so the same figures can be read for
    a month that has closed without waiting for the calendar.
    """
    if year is None or month is None:
        year, month = jalali.current_shamsi_period()
    try:
        plans.validate_period(year, month)
    except plans.PlanError as exc:
        raise HTTPException(400, str(exc)) from None

    data = DriveTestAnalytics(db, user).plan_and_delivery(year, month)
    return PlanAndDelivery(
        **{k: v for k, v in data.items() if k != "rows"},
        rows=[ContractorAchievementRow(**row) for row in data["rows"]],
    )


#: The query parameters both site endpoints take, declared once.
#:
#: Two routes with one set of filters written twice is two routes that will
#: one day disagree about what a filter means, and the file a reader downloads
#: would then hold a different list from the screen they downloaded it off.
def _site_params(
    bucket: str | None = Query(
        None,
        description=(
            "Which dashboard figure: "
            + ", ".join(dt_site_list.BUCKETS)
            + f". Defaults to {dt_site_list.DEFAULT_BUCKET}."
        ),
    ),
    category: str | None = Query(
        None, description="Problem category, or Uncategorized. Problematic only."
    ),
    age_band: str | None = Query(
        None,
        description=(
            "An age-band key. Ongoing and problematic only, and each on its "
            "own clock: ongoing ages from the assignment date, problematic "
            "from the day the site last became problematic. Also accepts "
            f"{NO_ASSIGNMENT_DATE} (ongoing) or {NO_PROBLEM_DATE} "
            "(problematic) for the sites each clock cannot speak for."
        ),
    ),
    stage: str | None = Query(None, description="An ongoing stage. Ongoing only."),
    contractor_id: str | None = Query(
        None, description="A contractor id, or 'none' for unattributed sites"
    ),
    province_id: int | None = Query(None, description="Narrow to one province"),
    year: int | None = Query(None, description="Shamsi year; delivered only"),
    month: int | None = Query(None, description="Shamsi month; delivered only"),
    overdue: str | None = Query(
        None, description="true for sites with an open fix past its due date"
    ),
    owner_role_id: int | None = Query(
        None, description="Sites with an open fix owned by this role"
    ),
    sort: str | None = Query(
        None, description="A sortable column, '-' prefixed for descending"
    ),
) -> dict:
    return {
        "bucket": bucket,
        "category": category,
        "age_band": age_band,
        "stage": stage,
        "contractor_id": contractor_id,
        "province_id": province_id,
        "year": year,
        "month": month,
        "overdue": overdue,
        "owner_role_id": owner_role_id,
        "sort": sort,
    }


def _filters(db: Session, user: User, params: dict) -> dt_site_list.Filters:
    """Validate the query string, or answer 422 with a plain message.

    422 rather than a quietly ignored parameter, for every one of them. A
    filter that is dropped in silence produces a list that looks right and is
    not, and this whole screen exists so that a count can be trusted.
    """
    try:
        return dt_site_list.parse_filters(db, user, **params)
    except dt_site_list.SiteListError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/sites", response_model=DriveTestSiteList)
def drive_test_sites(
    params: dict = Depends(_site_params),
    limit: int = Query(100, ge=1, le=500, description="Rows per page, at most 500"),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DriveTestSiteList:
    """The sites behind one figure on the Drive Test dashboard.

    ``total`` is the count before pagination, and it is the figure the reader
    clicked — the endpoint counts through the dashboard's own predicates, over
    the dashboard's own scoped set, so the two cannot come apart.

    Open to every signed-in role because the answer is already scoped to the
    caller: ``apply_work_item_scope`` decides which sites exist for them,
    ``province_id`` can only narrow that, and a contractor account is forced
    to its own company whatever the URL says.
    """
    filters = _filters(db, user, params)
    rows = dt_site_list.build_rows(db, user, filters)
    page = rows[offset : offset + limit]
    return DriveTestSiteList(
        total=len(rows),
        rows=[DriveTestSiteRow(**row) for row in page],
        filters_applied=filters.applied,
        generated_at=datetime.now(timezone.utc),
        age_bands=_age_band_options(filters.bucket),
        ongoing_stages=_ongoing_stage_options(),
    )


#: The "no clock" option each ageing bucket offers, and how it reads.
#:
#: The bands are shared; this is the one place the two clocks differ, so it is
#: the one place the vocabulary has to be asked for by bucket. Serving the
#: wrong one is not cosmetic: ``parse_filters`` refuses each key on the other
#: bucket, so the control would offer a value the next request answers 422 to
#: -- which is the exact drift serving the vocabulary exists to prevent.
_NO_CLOCK_OPTION: dict[str, tuple[str, str]] = {
    "ongoing": (NO_ASSIGNMENT_DATE, "Not assigned yet"),
    "problematic": (NO_PROBLEM_DATE, "No date recorded"),
}


def _age_band_options(bucket: str) -> list[FilterOption]:
    """The age bands this bucket accepts, in age order, plus its no-clock key.

    Straight off the service that validates them, so the control the screen
    builds from this cannot offer a band the next request would reject.

    Empty for a bucket that does not age: a band on a Done list would ask how
    long a finished thing has been unfinished, and ``parse_filters`` says so
    with a 422. An empty list is the honest answer to "what may I filter by
    here", and the screen already hides the control.

    The no-clock key is last because it is not a band — it is the sites the
    bands cannot speak for — and putting it inside the ordered scale would
    read as an age.
    """
    no_clock = _NO_CLOCK_OPTION.get(bucket)
    if no_clock is None:
        return []
    key, label = no_clock
    return [
        FilterOption(key=band, label=AGE_BAND_LABEL_BY_KEY[band])
        for band in AGE_BAND_KEYS
    ] + [FilterOption(key=key, label=label)]


def _ongoing_stage_options() -> list[FilterOption]:
    """The stages an ongoing site can sit in, in workflow order.

    The stage is its own label here: these strings are the vocabulary the
    workflow uses in the screens people act in, and renaming them on the way
    to this one filter would make the two impossible to talk about together.
    """
    return [
        FilterOption(key=stage, label=stage)
        for stage in (*ONGOING_STAGE_ORDER, STAGE_OTHER)
    ]


@router.get("/sites/export")
def export_drive_test_sites(
    params: dict = Depends(_site_params),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The same list as an Excel file: same filters, same scope, same rows.

    The same function builds both, so the file cannot hold a row the screen
    would not have shown. It is not paginated, and beyond ``MAX_EXPORT_ROWS``
    it refuses rather than truncating: a file silently missing its tail is
    read as the whole answer, which is the one outcome worse than no file.
    """
    filters = _filters(db, user, params)
    rows = dt_site_list.build_rows(db, user, filters)
    if len(rows) > MAX_EXPORT_ROWS:
        raise HTTPException(
            400,
            f"That is {len(rows)} rows, more than the {MAX_EXPORT_ROWS} this "
            "export holds. Narrow the filters and try again.",
        )
    content = dt_site_export.build_site_list_export(rows, filters.applied)
    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{dt_site_export.filename(filters.applied)}"'
            )
        },
    )


@router.get("/export")
def export_delivery_workbook(
    province_id: int | None = Query(
        None, description="Narrow the whole file to one province inside your scope"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """The Drive Test delivery workbook for this caller's scope.

    Five sheets, every figure from the same service calls the dashboard and
    the drill-through use, so the file agrees with the screen it was taken
    from. ``province_id`` is resolved the same way ``/overview`` resolves it,
    and the workbook applies it inside ``DriveTestAnalytics`` -- after the
    scope, never instead of it.

    A province outside the caller's scope produces an empty file rather than
    the 404 ``/overview`` answers with. Both refuse to say whether that
    province exists; a workbook that opens and is empty says "nothing here for
    you" in a form the person can read, where a failed download says only that
    something went wrong. It is also what ``/sites`` already does, and this
    file is that list's sibling.

    The service is thin on purpose: this function resolves the province,
    names the file and turns an over-cap workbook into a 400. Everything about
    what is in the file lives in ``services/dt_workbook.py``.
    """
    allowed = visible_province_ids(user)
    in_scope = (
        province_id is None or allowed is None or province_id in allowed
    )
    province = (
        db.get(Province, province_id) if province_id is not None and in_scope else None
    )
    name = province.name if province is not None else None
    # "" matches no province, so an out-of-scope id narrows the file to
    # nothing instead of quietly widening it back to the whole scope.
    filter_name = None if province_id is None else (name or "")
    label = name or (f"Province {province_id}" if province_id is not None else None)

    try:
        content = dt_workbook.build(
            db,
            user,
            province_id=province_id,
            province_name=filter_name,
            scope_label=label,
            max_rows=MAX_EXPORT_ROWS,
        )
    except dt_workbook.WorkbookTooLarge as exc:
        raise HTTPException(400, str(exc)) from None

    return Response(
        content=content,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{dt_workbook.filename(name)}"'
        },
    )


def _previous_totals(db: Session, user: User, province_id: int | None = None) -> dict:
    """Pick the right prior-month snapshot for this user's scope.

    A user who sees everything gets the global snapshot. A user scoped to some
    provinces gets the sum of those provinces' snapshots. A user who has
    narrowed the dashboard to one province gets that province's row alone —
    without this the delta chips would compare one province's current figures
    against the whole scope's baseline, which is the same arithmetic mistake
    the province summing below exists to prevent, one level down.

    Summing matters: this used to hand the *global* snapshot to anyone with
    more than one province, so a user granted three provinces out of
    thirty-one saw current values for three and a baseline for thirty-one. The
    deltas were not merely imprecise, they were arithmetically meaningless --
    and they leaked the national totals to a user scoped away from them.

    Returning ``{}`` where there is no snapshot is deliberate: the caller reads
    ``key in prev`` and renders no delta at all, which is honest about not
    knowing rather than showing a change of zero.
    """
    if province_id is not None:
        return get_month_over_month(db, province_id)

    province_ids = visible_province_ids(user)
    if province_ids is None:
        return get_month_over_month(db, None)
    if not province_ids:
        return {}

    totals: dict = {}
    for province_id in province_ids:
        for key, value in get_month_over_month(db, province_id).items():
            totals[key] = totals.get(key, 0) + value
    return totals


def _ongoing_breakdown(data: dict) -> OngoingBreakdown:
    return OngoingBreakdown(
        total=data["total"],
        by_stage=_points(data["by_stage"]),
        by_contractor=_points(data["by_contractor"]),
        without_contractor=data["without_contractor"],
        by_province=_points(data["by_province"]),
        by_age=_points(data["by_age"]),
        without_assignment_date=data["without_assignment_date"],
    )


def _problematic_breakdown(data: dict) -> ProblematicBreakdown:
    return ProblematicBreakdown(
        total=data["total"],
        by_category=_points(data["by_category"]),
        by_province=_points(data["by_province"]),
        by_age=_points(data["by_age"]),
        without_problem_date=data["without_problem_date"],
    )


def _points(rows: list[dict]) -> list[ChartPoint]:
    """Chart points, carrying the drill-through key where the figure has one.

    ``key`` is what a link to this point's site list travels with. Points that
    have no stable key — a contractor or province row, both of which link by
    id — simply do not carry one.
    """
    return [
        ChartPoint(name=r["name"], value=r["value"], key=r.get("key")) for r in rows
    ]
