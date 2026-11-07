"""The central permission map: who may open which area of UEP.

Reads ``access_matrix.json`` (the same file the frontend ships as
``src/lib/accessMatrix.json``), so the menus, launcher, route guards and API
all answer from one table. Row scope (which sites, provinces or villages) is a
separate matter, decided in ``services/visibility.py`` and ``services/kpi.py``;
this module only says whether a role may use an area at all.

One helper for endpoints, :func:`require_access`, and one for code that needs
the answer as a value, :func:`allows`.
"""
from __future__ import annotations

import json
from collections.abc import Callable
from enum import StrEnum
from functools import cache
from pathlib import Path

from fastapi import Depends, HTTPException, status

from app.core.deps import get_current_user
from app.models.reference import User

MATRIX_PATH = Path(__file__).with_name("access_matrix.json")

FORBIDDEN = "You do not have permission to perform this action"


class Area(StrEnum):
    """Every area the matrix names. A typo is an AttributeError, not a silent
    "nobody may"."""

    ROLES_PERFORMANCE = "roles_performance"
    LIFECYCLE_GAPS = "lifecycle_gaps"
    #: The "ICT vs CRA vs Mojri tracker" card on Lifecycle Gaps, its figures
    #: and its exports.
    MOJRI_SECTION = "mojri_section"
    #: Insights > Drive test dashboard and Acceptance dashboard.
    INSIGHTS_DASHBOARDS = "insights_dashboards"
    EXPLORER = "explorer"
    #: Explorer and header search read every site rather than the caller's
    #: usual row scope. Read only: it grants no write anywhere.
    EXPLORER_ALL_SITES = "explorer_all_sites"
    #: Acceptance > Filing (My Work).
    ACCEPTANCE_WORKSPACE = "acceptance_workspace"
    #: Monthly plan: the month's queue of contractor plans.
    MONTHLY_PLAN_QUEUE = "monthly_plan_queue"
    #: Monthly plan > Internal PIP and History.
    INTERNAL_PIP = "internal_pip"


@cache
def _matrix() -> dict:
    with MATRIX_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def offered_roles(area: Area) -> tuple[str, ...]:
    """The roles shown this area in navigation."""
    return tuple(_matrix()["areas"][area.value]["offered"])


def allowed_roles(area: Area) -> tuple[str, ...]:
    """The roles that may use this area: offered plus direct-only."""
    entry = _matrix()["areas"][area.value]
    return (*entry["offered"], *entry["direct"])


def allows(role_name: str, area: Area) -> bool:
    """Whether ``role_name`` may use ``area``."""
    return role_name in allowed_roles(area)


def landing_for(role_name: str) -> str:
    """'region', 'work', or 'standard' (the landing every other role has)."""
    return _matrix()["landings"].get(role_name, "standard")


def check(user: User, area: Area) -> None:
    """403 unless the user's role may use ``area``."""
    if not allows(user.role.name, area):
        raise HTTPException(status.HTTP_403_FORBIDDEN, FORBIDDEN)


def require_access(area: Area) -> Callable[[User], User]:
    """FastAPI dependency: the current user, refused with 403 outside ``area``."""

    def guard(current_user: User = Depends(get_current_user)) -> User:
        check(current_user, area)
        return current_user

    return guard
