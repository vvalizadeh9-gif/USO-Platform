"""The vocabulary every Action Center consumer shares.

A :class:`QueueDefinition` is the one place a queue is described: its stage,
label, the screen it opens, who acts on it, how its SLA is measured and how
its items are fetched. The board, the per-owner breakdown, the daily snapshot
and the digest all read the registry built from these, so adding a queue is
adding one definition.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.services.action_queues.context import QueueContext


class Stage(str, Enum):
    """The board's columns, in lifecycle order."""

    HC = "hc"
    DT = "dt"
    ICT = "ict"
    CRA = "cra"
    PLANS = "plans"


STAGE_ORDER: tuple[Stage, ...] = (Stage.HC, Stage.DT, Stage.ICT, Stage.CRA, Stage.PLANS)

STAGE_LABELS: dict[Stage, str] = {
    Stage.HC: "Health Check",
    Stage.DT: "Drive Test",
    Stage.ICT: "ICT Acceptance",
    Stage.CRA: "CRA Acceptance",
    Stage.PLANS: "Plans & Data",
}


class HomeGroup(str, Enum):
    """Home's three cards. Coarser than the board's stages: the health check
    is the step before a drive test, and ICT and CRA are one acceptance."""

    ROLLOUT = "drive_test"
    ACCEPTANCE = "acceptance"
    PLANS = "plans"


HOME_GROUP_ORDER: tuple[HomeGroup, ...] = (HomeGroup.ROLLOUT, HomeGroup.ACCEPTANCE, HomeGroup.PLANS)

HOME_GROUP_LABELS: dict[HomeGroup, str] = {
    HomeGroup.ROLLOUT: "Drive test",
    HomeGroup.ACCEPTANCE: "Acceptance",
    HomeGroup.PLANS: "Plans",
}

STAGE_GROUP: dict[Stage, HomeGroup] = {
    Stage.HC: HomeGroup.ROLLOUT,
    Stage.DT: HomeGroup.ROLLOUT,
    Stage.ICT: HomeGroup.ACCEPTANCE,
    Stage.CRA: HomeGroup.ACCEPTANCE,
    Stage.PLANS: HomeGroup.PLANS,
}


# Who a board is for. Three are role names; a problem owner is any role
# flagged ``is_category_owner``, so it gets a name of its own here.
PM = "PM"
COORDINATOR = "Coordinator"
CONTRACTOR = "Contractor"
PROBLEM_OWNER = "ProblemOwner"
BOARD_ROLES = frozenset({PM, COORDINATOR, CONTRACTOR, PROBLEM_OWNER})


class SlaKind(str, Enum):
    """How an item's lateness is measured.

    * ``CONFIGURED`` -- days since its clock started, against the queue's SLA
      in ``action_queue_sla`` (14 unless an administrator changed it);
    * ``CATEGORY``   -- the fix's own due date, set from its problem
      category's SLA when the fix was opened;
    * ``DEADLINE``   -- a calendar deadline carried on the item.
    """

    CONFIGURED = "configured"
    CATEGORY = "category"
    DEADLINE = "deadline"


DateKind = Literal["since", "due"]


@dataclass(frozen=True)
class OwnerRef:
    """Who holds an item: a contractor, a coordinator, a category or a role."""

    type: Literal["contractor", "coordinator", "category", "role"]
    id: int | None
    name: str


@dataclass(frozen=True)
class PendingItem:
    """One thing waiting in a queue.

    ``entity_id`` is the row the queue lists (a task, a village, a plan); a
    plan not yet filed has no row, so it is a string key instead.
    """

    entity_id: int | str
    started_at: datetime | None
    due_at: datetime | None = None
    owner: OwnerRef | None = None


@dataclass(frozen=True)
class QueueDefinition:
    key: str
    stage: Stage
    #: The action, verb first ("Review DT results"): the board's card and
    #: Home's buttons.
    label: str
    #: The queue as a noun ("DT review"): a row on Home, where the card
    #: already says which part of the lifecycle it is.
    short_label: str
    url: str
    roles: frozenset[str]
    sla: SlaKind
    date_kind: DateKind
    fetch: Callable[[QueueContext], list[PendingItem]]
