"""One-time cleanup: merge duplicate Contractor rows that differ only by
whitespace or case (e.g. "Infinitel " vs "infinitel" vs "Infinitel").

This is NOT run automatically — the import fix prevents *new* duplicates,
but existing ones from before the fix need a manual, visible merge. Run
this once, inside the backend container, after deploying the updated code:

    docker compose exec backend python3 -m app.scripts.merge_duplicate_contractors

It's safe to re-run: if there are no duplicates left, it does nothing.
"""
from collections import defaultdict

from app.core.database import SessionLocal
from app.models.reference import Contractor
from app.models.workitem import Assignment, WorkItem


def merge_duplicate_contractors() -> None:
    db = SessionLocal()
    try:
        contractors = db.query(Contractor).order_by(Contractor.id).all()
        groups: dict[str, list[Contractor]] = defaultdict(list)
        for c in contractors:
            key = " ".join(c.name.split()).lower()
            groups[key].append(c)

        merged_count = 0
        for key, rows in groups.items():
            if len(rows) < 2:
                continue
            keeper = rows[0]  # earliest-created row wins as the canonical one
            duplicates = rows[1:]
            dup_ids = [d.id for d in duplicates]
            print(
                f"Merging {[d.name for d in duplicates]!r} into "
                f"'{keeper.name}' (id={keeper.id})"
            )

            # Repoint every reference to the duplicates onto the keeper.
            db.query(WorkItem).filter(
                WorkItem.dt_sc_contractor_id.in_(dup_ids)
            ).update({"dt_sc_contractor_id": keeper.id}, synchronize_session=False)
            db.query(Assignment).filter(
                Assignment.contractor_id.in_(dup_ids)
            ).update({"contractor_id": keeper.id}, synchronize_session=False)

            for d in duplicates:
                db.delete(d)
            merged_count += len(duplicates)

        db.commit()
        print(f"Done. Merged {merged_count} duplicate contractor row(s).")
    finally:
        db.close()


if __name__ == "__main__":
    merge_duplicate_contractors()
