"""Aggregate all routers under a single /api/v1 router."""
from fastapi import APIRouter

from app.api import (
    acceptance,
    action_center,
    admin,
    auth,
    drive_test,
    gaps,
    health_check,
    kpi,
    misc,
    mojri,
    monthly_plan,
    my_work,
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
api_router.include_router(my_work.router)
api_router.include_router(kpi.router)
api_router.include_router(gaps.router)
api_router.include_router(mojri.router)
api_router.include_router(monthly_plan.router)
api_router.include_router(admin.router)
api_router.include_router(misc.router)
api_router.include_router(action_center.router)
