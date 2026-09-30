"""The acceptance universe, read as plain columns rather than ORM objects.

The Acceptance dashboard's figures and its monthly trend both walk every
in-scope work item, each of its villages, and each village's per-technology
acceptance rows. Loading those as ORM objects meant building on the order of
150,000 of them per request on a programme-sized database -- each carrying
every column and the full identity-map bookkeeping -- to read perhaps ten
fields. That, not the arithmetic, was most of the seconds the page took.

This loads exactly the fields the verdict and figure code reads, in three
queries, into small slotted objects shaped like the ORM ones where it
matters: a village has ``.work_item`` (with ``.requested_technology``) and
``.acceptances`` (with ``.technology``, ``.ict_status`` and so on), so
``acceptance_workflow.authority_verdict`` and friends take them unchanged.
Nothing here decides anything; the rules stay where they were.

One rule *is* stated here: which villages the dashboard's acceptance figures
count (:func:`in_dt_done_universe`), with its SQL twin
(:func:`dt_done_universe`) beside it. Lifecycle Gaps counts over the SQL one,
so the two screens answer "how many drive-tested villages are still waiting
for CRA?" from one definition rather than two that are supposed to agree.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import ColumnElement, and_, select
from sqlalchemy.orm import Session

from app.models.acceptance import Acceptance
from app.models.reference import User
from app.models.workitem import Site, Village, WorkItem
from app.services import cpm_columns as C
from app.services import kpi
from app.services.acceptance_workflow import DT_DONE
from app.services.visibility import apply_work_item_scope


class VillageRow:
    """A village, with its work item and acceptance rows attached."""

    __slots__ = (
        "id",
        "village_name",
        "target_classification",
        "ict_status",
        "cra_status",
        "deleted_at",
        "work_item",
        "acceptances",
    )

    def __init__(
        self,
        id: int,
        village_name: str | None,
        target_classification: str | None,
        ict_status: str,
        cra_status: str,
        deleted_at: datetime | None,
        work_item: WorkItemRow,
    ) -> None:
        self.id = id
        self.village_name = village_name
        self.target_classification = target_classification
        self.ict_status = ict_status
        self.cra_status = cra_status
        self.deleted_at = deleted_at
        self.work_item = work_item
        # Result rows of (technology, ict_status, ict_date, cra_status,
        # cra_date), read by attribute exactly as Acceptance objects were.
        self.acceptances: list = []


class WorkItemRow:
    """A work item, flattened with its site, and its villages attached."""

    __slots__ = (
        "id",
        "site_id",
        "site_code",
        "province_id",
        "dt_sc_contractor_id",
        "dt_status",
        "dt_date_gregorian",
        "last_stage",
        "requested_technology",
        "villages",
    )

    def __init__(
        self,
        id: int,
        site_id: int | None,
        site_code: str | None,
        province_id: int | None,
        dt_sc_contractor_id: int | None,
        dt_status: str | None,
        dt_date_gregorian: date | None,
        last_stage: str | None,
        requested_technology: str | None,
    ) -> None:
        self.id = id
        self.site_id = site_id
        self.site_code = site_code
        self.province_id = province_id
        self.dt_sc_contractor_id = dt_sc_contractor_id
        self.dt_status = dt_status
        self.dt_date_gregorian = dt_date_gregorian
        self.last_stage = last_stage
        self.requested_technology = requested_technology
        self.villages: list[VillageRow] = []


def in_dt_done_universe(work_item: WorkItemRow, village: VillageRow) -> bool:
    """Is this village in the Acceptance dashboard's universe?

    هدف, drive test Done, not soft-deleted -- and nothing about whether the
    site is on air. A site whose drive test is done is waiting on the
    authorities whatever stage CPM last recorded for it.

    Takes the rows :func:`load` returns, which has already dropped deleted
    work items and villages; the deleted check stays so the rule reads whole.
    :func:`dt_done_universe` is its SQL twin, and a test holds the two to the
    same village ids.
    """
    return (
        village.deleted_at is None
        and work_item.dt_status == DT_DONE
        and C.is_pure_target(village.target_classification)
    )


def dt_done_universe(db: Session) -> ColumnElement[bool]:
    """:func:`in_dt_done_universe` as one SQL condition, for pages that count
    in the database (Lifecycle Gaps' cards 1-2).

    Expects ``Village`` joined to ``WorkItem``. The هدف rule is read as the
    distinct classification values ``cpm_columns.is_pure_target`` accepts --
    the same test, applied to values instead of rows.
    """
    return and_(
        Village.deleted_at.is_(None),
        WorkItem.deleted_at.is_(None),
        WorkItem.dt_status == DT_DONE,
        Village.target_classification.in_(kpi.target_values(db) or [""]),
    )


def load(db: Session, user: User) -> list[WorkItemRow]:
    """Every live work item in this user's scope, with villages and acceptances.

    The same rows the ORM load returned: live work items under
    ``apply_work_item_scope``, each with all of its villages, and each of
    those with its acceptance rows (but see below). Deleted villages are dropped here rather
    than by every caller, which skipped them anyway.

    **Acceptance rows are attached only where the drive test is Done.**
    Acceptance cannot start before that, and every caller reads a verdict
    only for those villages -- so the rows for the rest were loaded to be
    ignored, and they are roughly half of the whole table. A village on a
    site whose drive test is not Done has an empty ``acceptances`` list.

    Villages and acceptances
    come in id order, so the result does not depend on how the database
    happens to return a collection.
    """
    scoped = apply_work_item_scope(
        select(WorkItem.id).where(WorkItem.deleted_at.is_(None)), user, db
    )
    # Straight to the connection: these are column reads, and the session's
    # ORM result handling adds nothing to them but time.
    conn = db.connection()

    work_items: dict[int, WorkItemRow] = {}
    for r in conn.execute(
        select(
            WorkItem.id,
            WorkItem.site_id,
            Site.site_code,
            Site.province_id,
            WorkItem.dt_sc_contractor_id,
            WorkItem.dt_status,
            WorkItem.dt_date_gregorian,
            WorkItem.last_stage,
            WorkItem.requested_technology,
        )
        .outerjoin(Site, WorkItem.site_id == Site.id)
        .where(WorkItem.id.in_(scoped))
        .order_by(WorkItem.id)
    ):
        work_items[r.id] = WorkItemRow(
            r.id,
            r.site_id,
            r.site_code,
            r.province_id,
            r.dt_sc_contractor_id,
            r.dt_status,
            r.dt_date_gregorian,
            r.last_stage,
            r.requested_technology,
        )

    live_villages = select(Village.id).where(
        Village.work_item_id.in_(scoped), Village.deleted_at.is_(None)
    )
    villages: dict[int, VillageRow] = {}
    for r in conn.execute(
        select(
            Village.id,
            Village.work_item_id,
            Village.village_name,
            Village.target_classification,
            Village.ict_status,
            Village.cra_status,
        )
        .where(Village.id.in_(live_villages))
        .order_by(Village.id)
    ):
        wi = work_items.get(r.work_item_id)
        if wi is None:
            continue
        village = VillageRow(
            r.id,
            r.village_name,
            r.target_classification,
            r.ict_status,
            r.cra_status,
            None,
            wi,
        )
        villages[r.id] = village
        wi.villages.append(village)

    for r in conn.execute(
        select(
            Acceptance.village_id,
            Acceptance.technology,
            Acceptance.ict_status,
            Acceptance.ict_date,
            Acceptance.cra_status,
            Acceptance.cra_date,
        )
        .where(
            Acceptance.village_id.in_(
                live_villages.join(WorkItem, Village.work_item_id == WorkItem.id).where(
                    WorkItem.dt_status == DT_DONE
                )
            )
        )
        .order_by(Acceptance.id)
    ):
        village = villages.get(r.village_id)
        if village is not None:
            village.acceptances.append(r)

    return list(work_items.values())
