"""The header search box: one query across sites, villages, contractors, people."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas.search import SearchGroupOut, SearchHitOut, SearchOut
from app.services import global_search

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=SearchOut)
def search(
    q: str = Query(default="", max_length=global_search.MAX_QUERY_LENGTH),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SearchOut:
    """What the signed-in user may see that matches ``q``, in groups.

    Scoped exactly like the lists it points into (see
    ``services/global_search.py``), so a result is never a way to learn that
    something exists. A query shorter than two characters answers with no
    groups.
    """
    query = global_search.normalise(q)
    groups = global_search.search(db, user, query)
    return SearchOut(
        query=query,
        groups=[
            SearchGroupOut(
                key=g.key,
                label=g.label,
                total=g.total,
                items=[SearchHitOut(id=h.id, title=h.title, subtitle=h.subtitle, route=h.route) for h in g.items],
            )
            for g in groups
        ],
    )
