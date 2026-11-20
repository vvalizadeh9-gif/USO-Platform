"""Create every acceptance case the universe is owed, from existing data.

Run once after ``alembic upgrade head`` on the UEP-22 deploy:

    docker compose exec backend python -m app.scripts.backfill_acceptance_cases

Safe to repeat: a case that exists is never touched. Filing, Baskets and Home
keep creating cases for new villages by themselves afterwards.
"""
from __future__ import annotations

from collections import Counter

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.acceptance_case import AcceptanceCase
from app.services.acceptance_cases import sync


def main() -> None:
    db = SessionLocal()
    try:
        created = sync.ensure_cases(db)
        db.commit()
        tally = Counter(db.execute(select(AcceptanceCase.authority, AcceptanceCase.state)).all())
        print(f"Created {created} acceptance cases.")
        for (authority, state), n in sorted(tally.items()):
            print(f"  {authority} {state}: {n}")
        needs = db.scalar(
            select(AcceptanceCase.id).where(
                AcceptanceCase.state == "rejected", AcceptanceCase.category_id.is_(None)
            ).limit(1)
        )
        if needs:
            print("Some rejections need a category: coordinators set them in Filing (Needs category).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
