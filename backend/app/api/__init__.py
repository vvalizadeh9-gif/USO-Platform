"""Aggregate all routers under a single /api/v1 router."""
from fastapi import APIRouter

from app.api import (
    acceptance,
    admin,
    auth,
    drive_test,
    health_check,
    misc,
    work_items,
    workflow,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(work_items.router)
api_router.include_router(workflow.router)
api_router.include_router(health_check.router)
api_router.include_router(drive_test.router)
api_router.include_router(acceptance.router)
api_router.include_router(admin.router)
api_router.include_router(misc.router)
