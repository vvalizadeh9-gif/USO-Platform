"""Check the three assumptions the Gap & Performance road view is built on.

Read-only. It writes nothing, changes nothing, and can be run on production at
any time::

    docker compose exec backend python -m app.scripts.gap_road_precheck

The road draws the acceptance pipeline as four sequential stretches --
ICT approval, CRA approval, Mojri tracker registration, depreciation -- and
counts villages stopped on each. Three things have to be true for those counts
to mean what the page says they mean, and **none of the three is enforced by
the schema**, so each is measured here rather than assumed:

**1. ICT approval precedes CRA approval.** The two authorities are deliberately
parallel in this platform (ARCHITECTURE.md §5), so a village can be
CRA-approved with no ICT approval. The road still places such a village exactly
once -- stopped on the ICT stretch, which is what it is -- and it is never
counted as having reached the CRA stretch. So the page stays arithmetically
sound however large this number is. But if it is more than a handful, the
*shape* of the road is telling the reader something false about the programme
and the design should be revisited before anyone acts on it.

**2. Every village has a province.** A CPM ``استان`` cell matching none of the
canonical 31 leaves ``sites.province_id`` NULL, and those villages then have no
regional manager, no coordinator and no CRA region either.

**3. Every province has a current row in ``province_mapping``.** Startup opens
one for all 31, so this should be empty; a reassignment that closed a row
without opening a new one is what would show up here.

Villages in cases 2 and 3 are shown on the page as their own named rows
("Unknown province", "Unmapped province"), which is what keeps every lens
adding up to the same country total. This script says how many there are.

The same three figures travel in every ``GET /gaps/road`` response, under
``data_quality``, so the page can flag them on each load. This script exists to
answer the question before the page is opened, and to answer it in one place a
person can paste into an email.
"""
from __future__ import annotations

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.core.province_directory import PROVINCE_DIRECTORY
from app.models.kpi import ProvinceMapping
from app.models.reference import Province
from app.models.workitem import Site, Village, WorkItem
from app.services import kpi

#: Above this, assumption 1 is not "a handful" any more.
HANDFUL = 20


def _target_villages(db):
    """Every pure هدف village on a live work item -- the population the road
    counts, read exactly as ``services/gaps.py`` reads it."""
    return (
        select(Village)
        .join(WorkItem, Village.work_item_id == WorkItem.id)
        .join(Site, WorkItem.site_id == Site.id)
        .where(
            Village.deleted_at.is_(None),
            WorkItem.deleted_at.is_(None),
            Village.target_classification.in_(kpi.target_values(db) or [""]),
        )
    )


def _count(db, stmt) -> int:
    return db.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()


def main() -> int:
    db = SessionLocal()
    try:
        approved = kpi.APPROVED
        done = kpi.dt_done_values(db) or [""]

        total = _count(db, _target_villages(db))
        dt_done = _count(
            db, _target_villages(db).where(WorkItem.dt_status.in_(done))
        )

        # ----- 1. ICT before CRA -----
        cra_without_ict = _count(
            db,
            _target_villages(db).where(
                Village.cra_status == approved, Village.ict_status != approved
            ),
        )

        # ----- 2. villages with no province -----
        no_province = _count(
            db, _target_villages(db).where(Site.province_id.is_(None))
        )
        no_contractor = _count(
            db, _target_villages(db).where(WorkItem.dt_sc_contractor_id.is_(None))
        )

        # ----- 3. provinces with no current mapping row -----
        mapped = set(
            db.execute(
                select(ProvinceMapping.province_fa).where(
                    ProvinceMapping.effective_to.is_(None)
                )
            ).scalars()
        )
        known = {row.fa for row in PROVINCE_DIRECTORY}
        in_use = set(
            db.execute(
                select(Province.name)
                .join(Site, Site.province_id == Province.id)
                .distinct()
            ).scalars()
        )
        unmapped_in_use = sorted(in_use - mapped)
        unmapped_any = sorted(known - mapped)

        # A province with two open rows would make every lens count it twice.
        # The partial unique index forbids it; this checks the index is there
        # and doing its job rather than trusting that it is.
        duplicates = [
            (name, count)
            for name, count in db.execute(
                select(ProvinceMapping.province_fa, func.count())
                .where(ProvinceMapping.effective_to.is_(None))
                .group_by(ProvinceMapping.province_fa)
                .having(func.count() > 1)
            ).all()
        ]

        history = db.execute(
            select(func.count()).select_from(
                select(ProvinceMapping.id)
                .where(ProvinceMapping.effective_to.is_not(None))
                .subquery()
            )
        ).scalar_one()

        print("Gap & Performance road view -- pre-checks")
        print("=" * 60)
        print(f"Target villages on live work items      {total:>8,}")
        print(f"  of which drive test done              {dt_done:>8,}")
        print()
        print("1. Does ICT approval always precede CRA approval?")
        print(f"   CRA-approved with no ICT approval     {cra_without_ict:>8,}")
        if cra_without_ict == 0:
            print("   -> The assumption holds on this data.")
        elif cra_without_ict <= HANDFUL:
            print(
                "   -> A handful. Each is counted once, as stopped on the ICT\n"
                "      stretch, which is what it is. Nothing to change."
            )
        else:
            print(
                f"   -> MORE THAN A HANDFUL ({cra_without_ict}). The arithmetic still\n"
                "      balances -- each of these villages is counted exactly once,\n"
                "      as stopped before ICT -- but a road drawn ICT-then-CRA is\n"
                "      describing the programme wrongly at this volume. Report the\n"
                "      number to the product owner before anyone acts on the page."
            )
        print()
        print("2. Does every village have a province and a contractor?")
        print(f"   villages with no province             {no_province:>8,}")
        print(f"   villages with no DT SC contractor     {no_contractor:>8,}")
        print(
            "   -> Shown as their own rows ('Unknown province', 'Unassigned'),\n"
            "      which is what keeps every lens summing to the country total."
        )
        print()
        print("3. Does every province have a current owner?")
        print(f"   provinces in use with no mapping row  {len(unmapped_in_use):>8,}")
        if unmapped_in_use:
            print(f"      {', '.join(unmapped_in_use)}")
            print("   -> Their villages appear as 'Unmapped province'.")
        if unmapped_any:
            print(f"   canonical provinces never mapped      {len(unmapped_any):>8,}")
        if duplicates:
            print("   !! TWO OPEN MAPPING ROWS for:")
            for name, count in duplicates:
                print(f"      {name}: {count} open rows -- every lens counts it twice")
        else:
            print("   one open mapping row per province: yes")
        print(f"   closed (historical) mapping rows      {history:>8,}")
        print(
            "   -> The road has no month dimension: every figure on it is current\n"
            "      standing, so it reads the current row only. History matters to\n"
            "      'vs last month', which needs a snapshot job that does not exist\n"
            "      yet and is not part of this page."
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
