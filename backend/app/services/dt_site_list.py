"""The sites behind a figure on the Drive Test dashboard.

Every number on that dashboard is now a link, and this module is what the
link opens: the exact list of sites the figure counted. The one property that
matters is stated once here and asserted in ``tests/test_dt_site_list.py``:

    the number of rows must equal the number that was clicked.

That is why this is a new endpoint rather than another filter on
``/work-items``. The two screens do not define the buckets the same way, and
neither definition is wrong for its own purpose:

* **Problematic.** The dashboard counts ``dt_status == 'Problematic'`` *or*
  ``current_stage == Problematic``. The work queue filters ``current_stage``
  alone, because that is the stage a person acts on there. A site flagged by
  a CPM import keeps whatever stage its own workflow gives it, so on the
  repository's sample data every one of the dashboard's problematic sites is
  missing from that queue.
* **Ongoing.** Ongoing is on-air only. The queue has no on-air filter, so it
  answers with sites the dashboard never counted.

``/work-items`` is left exactly as it is: its stage semantics serve other
screens. This module instead reuses the dashboard's own predicates from
``drive_test_analytics`` -- ``is_onair``, ``is_problematic``, ``is_ongoing``,
``effective_contractor_id``, ``effective_problem_category``, ``age_band``,
``assignment_date``, ``dated_into`` -- so there is no second copy of any of
them to drift.

**Scope first, filters after.** The rows come from
``DriveTestAnalytics.onair_items()``, which is ``apply_work_item_scope``
followed by the province narrowing, exactly as the dashboard loads them.
Everything in this module runs after that and can only remove rows, which is
what makes the filters safe to accept from a URL.

**A known limit.** The shared load is bulk (see :func:`_bulk`: fixes,
categories, owner roles, villages, health-check rounds, drive tests and
evidence counts are one batched query each, and the query count does not grow
with the number of rows), but the filtering, sorting and pagination then
happen in Python over the whole scoped set. At the current data size -- a few
thousand on-air sites -- that is comfortably fast and much simpler to keep
honest than a second SQL implementation of predicates that live in Python.
If the programme grows by an order of magnitude, this is the place to look.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import jalali
from app.models.health_check import HcRemediation, HcTask
from app.models.reference import Contractor, ProblemCategory, Province, Role
from app.models.workitem import DriveTest, Village, WorkItem
from app.services.drive_test_analytics import (
    AGE_BAND_LABEL_BY_KEY,
    NO_ASSIGNMENT_DATE,
    NO_PROBLEM_DATE,
    ONGOING_STAGE_ORDER,
    STAGE_OTHER,
    DriveTestAnalytics,
    age_band,
    problematic_since,
    resolve_age_band,
    assignment_date,
    dated_into,
    effective_contractor_id,
    effective_problem_category,
    is_ongoing,
    is_problematic,
    own_contractor_id,
)

#: Which dashboard figure the list is opening.
#:
#: ``remaining`` is ongoing + problematic, which is what the Remaining line on
#: the dashboard adds up. ``assigned`` is done + ongoing, the contractor
#: scorecard's book of work: problematic sites are deliberately outside it,
#: because they were never committed to the company (see
#: ``_contractor_scorecard``), and the scorecard's rate divides by it.
#: ``delivered`` is the plan-and-delivery figure for one Shamsi month and is
#: the only bucket that needs a period.
BUCKETS = (
    "onair", "done", "ongoing", "problematic", "remaining", "assigned", "delivered",
)
DEFAULT_BUCKET = "onair"

#: The categories filter accepts this for sites with no category of any kind,
#: matching what ``effective_problem_category`` returns for them.
UNCATEGORIZED = "Uncategorized"

#: ``contractor_id=none`` means the sites no company can be tied to -- the
#: scorecard's unattributed row. A word rather than an empty value, because an
#: empty value in a URL reads as "filter absent" and would silently widen the
#: list to every contractor.
UNATTRIBUTED = "none"

#: Row buckets, as the ``bucket`` column of a row reports them.
BUCKET_DONE = "Done"
BUCKET_ONGOING = "Ongoing"
BUCKET_PROBLEMATIC = "Problematic"

#: The columns that may be sorted on, mapped to the row key they read.
#:
#: A whitelist rather than "whatever the caller names", because a sort key is
#: an attribute lookup and an open one is an invitation. An unknown key is a
#: 422, not a silent fall back to the default: a list sorted differently from
#: what was asked looks sorted, which is the failure mode worth refusing.
SORT_KEYS: tuple[str, ...] = (
    "site_code",
    "province",
    "contractor",
    "bucket",
    "current_stage",
    "launch_date",
    "days_since_launch",
    "days_since_assignment",
    "days_problematic",
    "oldest_open_fix_days",
    "max_days_late",
    "hc_round",
    "dt_execution_date",
    "dt_approved_at",
    "dt_evidence_count",
)

#: The default sort per bucket, as ``(key, descending)`` pairs read in order.
#:
#: Each one puts the row a reader opened the list to find at the top: the
#: latest fix for a problematic list, the longest-untested site for an ongoing
#: one, the most recent drive test for a completed one. ``onair`` has no such
#: row -- it is the whole programme -- so it sorts by site code, which is the
#: only order a reader can navigate by eye.
DEFAULT_SORTS: dict[str, tuple[tuple[str, bool], ...]] = {
    # Longest-stuck first. This list is opened to find out who to ask about
    # what, and the site that has been a problem for four months is the one
    # that question is about -- it used to sort under whichever fix happened
    # to be furthest past its due date, which ranks the paperwork rather than
    # the problem. The fix clocks stay as tie-breaks, for the CPM-flagged
    # sites that carry no problematic clock at all.
    "problematic": (
        ("days_problematic", True),
        ("max_days_late", True),
        ("oldest_open_fix_days", True),
    ),
    # Longest-held first, on the same clock the age bands run on, so the top
    # of a list opened from "more than 2 months" is the site that band is
    # really about. A site nobody has been assigned has no clock and sorts
    # last rather than first.
    "ongoing": (("days_since_assignment", True),),
    "remaining": (("days_since_assignment", True),),
    "assigned": (("days_since_assignment", True),),
    "done": (("dt_execution_date", True),),
    "delivered": (("dt_execution_date", True),),
    "onair": (("site_code", False),),
}


class SiteListError(ValueError):
    """An invalid parameter or an invalid combination of them.

    Raised rather than ignored, always. A filter that is silently dropped
    produces a list that looks right and is not -- and the whole point of this
    screen is that its length can be trusted against the figure that opened
    it.
    """


@dataclass(frozen=True)
class Filters:
    """One validated request. Every field here has already been checked."""

    bucket: str = DEFAULT_BUCKET
    category: str | None = None
    #: The concrete bands to match, already resolved -- a retired key can
    #: stand for more than one, so this is a tuple rather than a key.
    age_band_keys: tuple[str, ...] = ()
    stage: str | None = None
    contractor_id: int | None = None
    #: True when ``contractor_id=none`` was asked for: the unattributed sites.
    #: Distinct from ``contractor_id is None``, which means no filter at all.
    unattributed: bool = False
    province_id: int | None = None
    year: int | None = None
    month: int | None = None
    overdue: bool = False
    owner_role_id: int | None = None
    sort: tuple[tuple[str, bool], ...] = ()
    #: What was actually applied, echoed back to the screen for its pills.
    applied: dict = field(default_factory=dict)


# --------------------------------------------------------------- validation
def parse_filters(
    db: Session,
    user,
    *,
    bucket: str | None = None,
    category: str | None = None,
    age_band: str | None = None,
    stage: str | None = None,
    contractor_id: str | None = None,
    province_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    overdue: str | None = None,
    owner_role_id: int | None = None,
    sort: str | None = None,
) -> Filters:
    """Validate a query string into a :class:`Filters`, or raise.

    Combinations are checked as well as values. ``age_band`` with
    ``problematic`` is refused rather than ignored, because problematic sites
    have no aging on this dashboard at all (nothing records when a site
    *became* problematic -- see ``DriveTestAnalytics.breakdowns``), so a band
    applied there would answer a question the figure never asked.

    A contractor account's ``contractor_id`` is forced to their own company
    instead of being rejected. Rejecting it would confirm that the id they
    named exists; this hands them their own rows, which is the same answer
    ``/pip/revisions`` gives for the same reason.
    """
    bucket = (bucket or DEFAULT_BUCKET).strip()
    if bucket not in BUCKETS:
        raise SiteListError(
            f"bucket must be one of: {', '.join(BUCKETS)}"
        )

    applied: dict[str, str] = {"bucket": bucket}

    if category is not None:
        if bucket != "problematic":
            raise SiteListError("category applies to the problematic bucket only")
        category = category.strip()
        if not _is_known_category(db, category):
            raise SiteListError(f"unknown category: {category}")
        applied["category"] = category

    band_keys: tuple[str, ...] = ()
    if age_band is not None:
        # Two buckets age, on two different clocks -- see ``_age_clock``. The
        # rest do not: a band on a Done list would be asking how long a
        # finished thing has been unfinished.
        if bucket not in AGEING_BUCKETS:
            raise SiteListError(
                "age_band applies to the "
                f"{' and '.join(AGEING_BUCKETS)} buckets only"
            )
        requested = age_band.strip()
        band_keys = resolve_age_band(requested)
        # The two "no clock" keys are not interchangeable: they name different
        # absences, and accepting either on either bucket would return an
        # empty list that looks like a real answer.
        unclocked = NO_ASSIGNMENT_DATE if bucket == "ongoing" else NO_PROBLEM_DATE
        wrong_bucket = {NO_ASSIGNMENT_DATE, NO_PROBLEM_DATE} - {unclocked}
        if not band_keys or requested in wrong_bucket:
            allowed = ", ".join([*AGE_BAND_LABEL_BY_KEY, unclocked])
            raise SiteListError(f"age_band must be one of: {allowed}")
        # The key as asked for, not as resolved: the pill should read back
        # what the reader clicked, and a retired key resolves to two bands
        # that have no single label between them.
        applied["age_band"] = requested

    if stage is not None:
        if bucket != "ongoing":
            raise SiteListError("stage applies to the ongoing bucket only")
        stage = stage.strip()
        if stage not in ONGOING_STAGE_ORDER and stage != STAGE_OTHER:
            allowed = ", ".join([*ONGOING_STAGE_ORDER, STAGE_OTHER])
            raise SiteListError(f"stage must be one of: {allowed}")
        applied["stage"] = stage

    resolved_contractor, unattributed = _resolve_contractor(user, contractor_id)
    if unattributed:
        applied["contractor_id"] = UNATTRIBUTED
    elif resolved_contractor is not None:
        applied["contractor_id"] = str(resolved_contractor)

    if province_id is not None:
        applied["province_id"] = str(province_id)

    if bucket == "delivered":
        if year is None or month is None:
            raise SiteListError("delivered needs a year and a month")
    elif year is not None or month is not None:
        raise SiteListError("year and month apply to the delivered bucket only")
    if year is not None:
        if not 1300 <= year <= 1500:
            raise SiteListError("year must be a Shamsi year")
        if not 1 <= (month or 0) <= 12:
            raise SiteListError("month must be a Shamsi month, 1-12")
        applied["year"] = str(year)
        applied["month"] = str(month)

    overdue_flag = False
    if overdue is not None:
        lowered = overdue.strip().lower()
        if lowered not in ("true", "false"):
            raise SiteListError("overdue must be true or false")
        overdue_flag = lowered == "true"
        if overdue_flag:
            applied["overdue"] = "true"

    if owner_role_id is not None:
        if db.get(Role, owner_role_id) is None:
            raise SiteListError(f"unknown owner_role_id: {owner_role_id}")
        applied["owner_role_id"] = str(owner_role_id)

    order = _parse_sort(sort, bucket)
    if sort:
        applied["sort"] = sort

    return Filters(
        bucket=bucket,
        category=category,
        age_band_keys=band_keys,
        stage=stage,
        contractor_id=resolved_contractor,
        unattributed=unattributed,
        province_id=province_id,
        year=year,
        month=month,
        overdue=overdue_flag,
        owner_role_id=owner_role_id,
        sort=order,
        applied=applied,
    )


def _resolve_contractor(user, raw: str | None) -> tuple[int | None, bool]:
    """``(contractor id, unattributed)``, with a contractor account forced.

    A contractor is their own filter. Whatever the URL says, they get their
    own rows -- the same rule ``_plan_scope_items`` applies to the plan
    figures, enforced here so a crafted link cannot reach another company's
    workload through this endpoint either.
    """
    own = own_contractor_id(user)
    if own is not None:
        return own, False
    if raw is None:
        return None, False
    value = raw.strip()
    if value.lower() == UNATTRIBUTED:
        return None, True
    try:
        return int(value), False
    except ValueError:
        raise SiteListError(
            f"contractor_id must be a number or '{UNATTRIBUTED}'"
        ) from None


def _is_known_category(db: Session, name: str) -> bool:
    """Whether a category name is one this platform can produce.

    Three sources, because ``effective_problem_category`` has three: the
    validated categories an Admin maintains, the CPM workbook's free text
    (which is whatever the field team typed, and is still a real bucket on the
    dashboard), and ``Uncategorized`` for a site with neither. Checked against
    the data rather than a hardcoded list, so a category an Admin adds is
    filterable the moment it is used, with no release.
    """
    if name == UNCATEGORIZED:
        return True
    known = db.execute(select(ProblemCategory.name)).scalars().all()
    if name in set(known):
        return True
    cpm = db.execute(
        select(WorkItem.dt_problem_category).where(
            WorkItem.dt_problem_category.is_not(None)
        ).distinct()
    ).scalars().all()
    return name in set(cpm)


def _parse_sort(raw: str | None, bucket: str) -> tuple[tuple[str, bool], ...]:
    """``-days_since_launch,site_code`` into ``(("days_since_launch", True), ...)``."""
    if not raw:
        return DEFAULT_SORTS[bucket]
    order: list[tuple[str, bool]] = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        descending = token.startswith("-")
        key = token[1:] if descending else token
        if key not in SORT_KEYS:
            raise SiteListError(
                f"unknown sort key: {key}. Sortable columns are: "
                f"{', '.join(SORT_KEYS)}"
            )
        order.append((key, descending))
    return tuple(order) or DEFAULT_SORTS[bucket]


# ------------------------------------------------------------------- rows
def build_rows(db: Session, user, filters: Filters) -> list[dict]:
    """Every row matching *filters*, sorted, before pagination.

    Scope first (the analytics load), then the bucket, then the filters, then
    the sort. The caller slices for a page; the length of what comes back here
    is the ``total`` the screen shows and the figure the reader clicked.
    """
    analytics = DriveTestAnalytics(db, user, province_id=filters.province_id)
    items = analytics.onair_items()

    items = [w for w in items if _in_bucket(w, filters)]
    if filters.province_id is not None:
        # Belt and braces: ``DriveTestAnalytics`` has already narrowed the
        # query to this province. Repeating it costs one comparison per row
        # and means a future change to the loader cannot silently widen the
        # list past what the URL asked for.
        items = [
            w for w in items
            if w.site is not None and w.site.province_id == filters.province_id
        ]
    items = [w for w in items if _matches_contractor(w, filters)]
    if filters.category is not None:
        items = [
            w for w in items if effective_problem_category(w) == filters.category
        ]

    today = date.today()
    if filters.age_band_keys:
        clock = _age_clock(filters.bucket)
        items = [
            w
            for w in items
            if _in_age_band(w, filters.age_band_keys, today, clock)
        ]
    if filters.stage is not None:
        items = [w for w in items if _in_stage(w, filters.stage)]

    context = _bulk(db, items)
    if filters.overdue:
        items = [w for w in items if _has_overdue_fix(w, context)]
    if filters.owner_role_id is not None:
        items = [
            w for w in items
            if any(
                fix["owner_role_id"] == filters.owner_role_id
                for fix in context["fixes"].get(w.id, ())
            )
        ]

    rows = [_row(w, context, today) for w in items]
    return _sorted(rows, filters.sort)


def _in_bucket(wi: WorkItem, filters: Filters) -> bool:
    """Which dashboard figure this work item is behind.

    Every bucket is a subset of on-air, which the loader has already applied.
    ``remaining`` is spelled as ongoing-or-problematic rather than as "not
    done", so that it is the sum of the two lists a reader can also open
    separately -- the Remaining line on the dashboard makes exactly that claim
    about exactly those two states. ``assigned`` is the other pairing, done
    plus ongoing, for the same reason on the scorecard.
    """
    bucket = filters.bucket
    if bucket == "onair":
        return True
    if bucket == "done":
        return wi.dt_status == "Done"
    if bucket == "ongoing":
        return is_ongoing(wi)
    if bucket == "problematic":
        return is_problematic(wi)
    if bucket == "remaining":
        return is_ongoing(wi) or is_problematic(wi)
    if bucket == "assigned":
        # The scorecard's denominator, spelled the same way it is there:
        # finished plus still held, with problematic sites outside it.
        return wi.dt_status == "Done" or is_ongoing(wi)
    # delivered
    return wi.dt_status == "Done" and dated_into(wi, filters.year, filters.month)


def _matches_contractor(wi: WorkItem, filters: Filters) -> bool:
    cid = effective_contractor_id(wi)
    if filters.unattributed:
        return cid is None
    if filters.contractor_id is None:
        return True
    return cid == filters.contractor_id


#: The two buckets that carry an age, and the clock each one runs on.
#:
#: They are different measurements sharing one set of bands: an ongoing site
#: is aged from the day a contractor was given it, a problematic one from the
#: day it last entered the state. Both return ``None`` where the platform
#: never dated the thing being measured, which is what the "no clock" keys
#: below are for.
AGE_CLOCKS = {
    "ongoing": assignment_date,
    "problematic": problematic_since,
}
AGEING_BUCKETS = tuple(AGE_CLOCKS)


def _age_clock(bucket: str):
    """Which date this bucket's bands are measured from."""
    return AGE_CLOCKS[bucket]


def _in_age_band(wi: WorkItem, keys: tuple[str, ...], today: date, clock) -> bool:
    """Whether this site falls in any of the bands asked for.

    Through ``age_band`` and the bucket's own clock, which is what the bands
    themselves are computed with -- so a list opened from a bar holds exactly
    the sites that bar counted.

    Several keys rather than one because a retired band resolves to the bands
    that replaced it -- see ``resolve_age_band``.
    """
    label = age_band(clock(wi), today)
    for key in keys:
        if key in (NO_ASSIGNMENT_DATE, NO_PROBLEM_DATE):
            if label is None:
                return True
        elif label == AGE_BAND_LABEL_BY_KEY[key]:
            return True
    return False


def _in_stage(wi: WorkItem, stage: str) -> bool:
    if stage == STAGE_OTHER:
        return wi.current_stage not in ONGOING_STAGE_ORDER
    return wi.current_stage == stage


def _has_overdue_fix(wi: WorkItem, context: dict) -> bool:
    return any(
        fix["days_late"] is not None and fix["days_late"] > 0
        for fix in context["fixes"].get(wi.id, ())
    )


# ------------------------------------------------------------- bulk loading
def _bulk(db: Session, items: list[WorkItem]) -> dict:
    """Everything the rows need, in a fixed number of queries.

    One batched query each for open fixes (with their category and owner role
    names joined, so neither is a per-row lookup), villages, the latest
    health-check round, drive tests, contractor names and province names. The
    count does not move when the row count does, which is what
    ``test_query_count_is_flat`` asserts.
    """
    ids = [w.id for w in items]
    now = datetime.now(timezone.utc)

    fixes: dict[int, list[dict]] = {}
    villages: dict[int, list[str]] = {}
    rounds: dict[int, int] = {}
    drive_tests: dict[int, DriveTest] = {}

    if ids:
        rows = db.execute(
            select(
                HcRemediation.work_item_id,
                HcRemediation.opened_at,
                HcRemediation.due_at,
                HcRemediation.owner_role_id,
                ProblemCategory.name,
                Role.name,
            )
            .join(
                ProblemCategory,
                HcRemediation.problem_category_id == ProblemCategory.id,
            )
            .outerjoin(Role, HcRemediation.owner_role_id == Role.id)
            .where(
                HcRemediation.work_item_id.in_(ids),
                HcRemediation.closed_at.is_(None),
            )
        ).all()
        for wid, opened_at, due_at, role_id, category, role in rows:
            fixes.setdefault(wid, []).append(
                {
                    "opened_days": _days_since(opened_at, now),
                    "days_late": _days_since(due_at, now),
                    "owner_role_id": role_id,
                    "category": category,
                    "owner": role,
                }
            )

        for wid, name in db.execute(
            select(Village.work_item_id, Village.village_name).where(
                Village.work_item_id.in_(ids), Village.deleted_at.is_(None)
            )
        ).all():
            if name:
                villages.setdefault(wid, []).append(name)

        for wid, round_no in db.execute(
            select(HcTask.work_item_id, func.max(HcTask.round_no))
            .where(HcTask.work_item_id.in_(ids))
            .group_by(HcTask.work_item_id)
        ).all():
            rounds[wid] = round_no

        # The active drive test, newest first so the last one written wins --
        # the same choice ``work_item_rows.active_drive_test`` makes.
        for dt in (
            db.execute(
                select(DriveTest)
                .where(DriveTest.work_item_id.in_(ids), DriveTest.is_active.is_(True))
                .order_by(DriveTest.id)
            )
            .scalars()
            .all()
        ):
            drive_tests[dt.work_item_id] = dt

    contractor_ids = {
        cid for cid in (effective_contractor_id(w) for w in items) if cid is not None
    }
    contractors: dict[int, str] = {}
    if contractor_ids:
        contractors = {
            c.id: c.name
            for c in db.execute(
                select(Contractor).where(Contractor.id.in_(contractor_ids))
            ).scalars().all()
        }

    province_ids = {
        w.site.province_id
        for w in items
        if w.site is not None and w.site.province_id is not None
    }
    provinces: dict[int, str] = {}
    if province_ids:
        provinces = {
            p.id: p.name
            for p in db.execute(
                select(Province).where(Province.id.in_(province_ids))
            ).scalars().all()
        }

    return {
        "fixes": fixes,
        "villages": villages,
        "rounds": rounds,
        "drive_tests": drive_tests,
        "contractors": contractors,
        "provinces": provinces,
    }


def _days_since(moment: datetime | None, now: datetime) -> int | None:
    """Whole days from *moment* until now, or None when there is no moment.

    Naive timestamps are read as UTC: Postgres stores these tz-aware, but
    SQLite and rows written before the timezone migration can be naive, and
    subtracting one from an aware ``now`` would raise rather than answer.
    """
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (now - moment).days


def _row(wi: WorkItem, context: dict, today: date) -> dict:
    """One work item, flattened into a list row."""
    fixes = context["fixes"].get(wi.id, [])
    contractor_id = effective_contractor_id(wi)
    province_id = wi.site.province_id if wi.site is not None else None

    launch = wi.launch_date_gregorian
    # Two clocks, and the row carries both because they answer two questions:
    # how long the site has been live and untested, and how long the company
    # holding it now has held it. The band is the second, because that is what
    # the dashboard's bands are.
    assigned_on = assignment_date(wi)
    band = age_band(assigned_on, today)

    # The third clock, and the one a site gets named in a meeting over: how
    # long this site has been a problem. Null on a site that is not one, and
    # on a CPM-flagged site whose status carries no date -- see
    # ``problematic_since``.
    problem_since = problematic_since(wi)

    drive_test = context["drive_tests"].get(wi.id)
    approved_at = None
    if drive_test is not None and drive_test.status == "Approved":
        reviewed = drive_test.coordinator_reviewed_at
        approved_at = jalali.format_shamsi(reviewed.date()) if reviewed else None

    # The DT date the whole dashboard dates work by, with the in-flight drive
    # test's own execution date as a fallback for a site whose approval has
    # not yet written the column.
    execution = wi.dt_date_gregorian
    if execution is None and drive_test is not None:
        execution = drive_test.execution_date

    opened = [f["opened_days"] for f in fixes if f["opened_days"] is not None]
    late = [f["days_late"] for f in fixes if f["days_late"] is not None and f["days_late"] > 0]

    return {
        "work_item_id": wi.id,
        "site_code": wi.site.site_code if wi.site is not None else None,
        "villages": ", ".join(context["villages"].get(wi.id, [])) or None,
        "province": context["provinces"].get(province_id),
        "contractor": context["contractors"].get(contractor_id),
        "bucket": _row_bucket(wi),
        "current_stage": wi.current_stage,
        "launch_date": jalali.format_shamsi(launch),
        "days_since_launch": (today - launch).days if launch is not None else None,
        "assignment_date": jalali.format_shamsi(assigned_on),
        "days_since_assignment": (
            (today - assigned_on).days if assigned_on is not None else None
        ),
        "age_band": band,
        "problematic_since": jalali.format_shamsi(problem_since),
        "days_problematic": (
            (today - problem_since).days if problem_since is not None else None
        ),
        "problem_age_band": age_band(problem_since, today),
        "problem_categories": _categories(wi, fixes),
        "fix_owners": sorted({f["owner"] for f in fixes if f["owner"]}),
        # Null, never estimated: a site flagged by a CPM import has no in-app
        # fix and therefore no date to count from.
        "oldest_open_fix_days": max(opened) if opened else None,
        "max_days_late": max(late) if late else None,
        "hc_round": context["rounds"].get(wi.id),
        "dt_execution_date": jalali.format_shamsi(execution),
        "dt_approved_at": approved_at,
        "dt_evidence_count": len(drive_test.evidence) if drive_test is not None else 0,
    }


def _row_bucket(wi: WorkItem) -> str:
    """Done, Ongoing or Problematic, by the dashboard's own order.

    Problematic is read before Done for the same reason the KPI cards do:
    the three are a partition of on-air, and ``is_ongoing`` is defined as
    neither of the other two.
    """
    if is_problematic(wi):
        return BUCKET_PROBLEMATIC
    if wi.dt_status == "Done":
        return BUCKET_DONE
    return BUCKET_ONGOING


def _categories(wi: WorkItem, fixes: list[dict]) -> list[str]:
    """Why this site is problematic, preferring the open fixes' own categories.

    An open fix names the category somebody is actually working, which is a
    stronger fact than the site-level one and can be several at once -- a site
    fails for more than one reason routinely. With no open fix the row falls
    back to ``effective_problem_category``, which is what the dashboard
    counted it under, and a site that is not problematic at all gets nothing
    rather than the "Uncategorized" that function returns for everything.
    """
    if fixes:
        return sorted({f["category"] for f in fixes if f["category"]})
    if is_problematic(wi):
        return [effective_problem_category(wi)]
    return []


# ---------------------------------------------------------------- sorting
def _sorted(rows: list[dict], order: tuple[tuple[str, bool], ...]) -> list[dict]:
    """Sort by the requested columns, with missing values always last.

    Last in both directions, deliberately. A site with no launch date is not
    the newest site and not the oldest one; it is a site whose age nobody
    recorded, and floating it to the top of a descending sort would put the
    least informative rows where the most urgent ones belong. Ties break on
    site code and then on id, so the same query returns the same page order
    every time -- pagination over an unstable sort silently drops and repeats
    rows between pages.
    """
    # The tie-break goes on first and the requested keys are applied over it
    # from least to most significant. Python's sort is stable, so each pass
    # keeps the order the previous one established wherever it finds a tie.
    ranked = sorted(rows, key=lambda r: (r["site_code"] or "", r["work_item_id"]))
    for key, descending in reversed(order):
        present = [r for r in ranked if r.get(key) is not None]
        missing = [r for r in ranked if r.get(key) is None]
        present.sort(key=lambda r: r[key], reverse=descending)
        ranked = present + missing
    return ranked
