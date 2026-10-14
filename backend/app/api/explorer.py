"""Explorer: the site record page's one read (GET /explorer/sites/{id}).

Deliberately not ``GET /work-items/{id}``: that response keeps villages out
on purpose (the assignment screens rely on it), and the record page needs
them with their ICT and CRA history. Scope is the work-item scope every list
uses, so a site the caller may not see is a 404, as everywhere else.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.reference import User
from app.schemas.explorer import SiteRecordOut
from app.services.explorer import SiteNotFound, site_record

router = APIRouter(prefix="/explorer", tags=["explorer"])


@router.get("/sites/{work_item_id}", response_model=SiteRecordOut)
def get_site_record(
    work_item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """One site's record: general information, journey and acceptance."""
    try:
        return site_record(db, user, work_item_id)
    except SiteNotFound:
        raise HTTPException(status_code=404, detail="Site not found") from None
