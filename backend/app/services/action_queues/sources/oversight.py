"""Work stuck with others, for the PM's and coordinators' Home (UEP-24 F9).

After 75 days of the lab the PM's Home showed nothing for drive tests sitting
with contractors, overdue fixes, ageing rejection baskets or a Mojri tracker
nobody had refreshed. Each queue here reads the list behind an existing
screen, inside the viewer's row scope, so a coordinator sees their regions.

* **DT with contractors** -- the DT In progress list (open assignment, no
  approved drive test), late past the DT SLA on SLA policies.
* **Fixes open** -- every team's open HC remediations, late past ``due_at``.
* **In team baskets** -- rejected villages in a team's rejection basket, late
  after 30 days in it.
* **Mojri tracker** -- one item: the latest Mojri file, late once it is older
  than the follow-up days. Home words its count as days since that upload.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta

from app.core import jalali
from app.core.deps import TEAM_BASKET_ROLES
from app.models.acceptance_case import STATE_REJECTED
from app.services import hc_queues
from app.services.action_queues.context import QueueContext
from app.services.action_queues.sources import cases
from app.services.action_queues.sources.lifecycle import fixes
from app.services.action_queues.types import OwnerRef, PendingItem

#: Days a rejected village may sit in a team basket before it is late.
TEAM_BASKET_LATE_DAYS = 30

#: The Mojri tracker row's one item.
MOJRI_ITEM = "mojri-tracker"


def dt_with_contractors(ctx: QueueContext) -> list[PendingItem]:
    """Sites a contractor still owes a drive test for, sent-back ones too,
    clocked from the assignment (the DT In progress tab)."""
    rows = hc_queues.dt_in_progress(ctx.db, ctx.user, ctx.work_items)
    return [
        PendingItem(r["work_item_id"], r["assigned_at"], owner=ctx.contractor(r["contractor_id"]))
        for r in rows
    ]


def fixes_open(ctx: QueueContext) -> list[PendingItem]:
    """Every team's open fixes in scope (the Remediation tab)."""
    return fixes(ctx)


def team_baskets(ctx: QueueContext) -> list[PendingItem]:
    """Rejected villages in any team's basket, in the viewer's scope."""
    out = []
    for row in cases._rows(ctx):
        if row.state != STATE_REJECTED or row.basket_role not in TEAM_BASKET_ROLES:
            continue
        start = cases.at_noon(row.state_since)
        out.append(PendingItem(
            row.case_id, start,
            due_at=start + timedelta(days=TEAM_BASKET_LATE_DAYS) if start else None,
            owner=OwnerRef("category", None, row.basket_owner or row.basket_role),
        ))
    return out


def mojri_clock(ctx: QueueContext):
    from app.services.submissions import follow_up

    return follow_up.clock(ctx.db, ctx.now.astimezone(jalali.TEHRAN).date())


def mojri_tracker(ctx: QueueContext) -> list[PendingItem]:
    """One item, the tracker itself: started on the latest file's date, due
    once ``follow_up_days`` have passed. No row before the first upload:
    there is no age to show."""
    c = mojri_clock(ctx)
    if c.file_date is None:
        return []
    start = datetime.combine(c.file_date, time.min, tzinfo=jalali.TEHRAN)
    return [PendingItem(MOJRI_ITEM, start, due_at=start + timedelta(days=c.days + 1))]


def mojri_meta(ctx: QueueContext) -> dict:
    """What Home shows on the row: days since the upload, and whether stale."""
    c = mojri_clock(ctx)
    return {"age_days": c.age_days, "stale": c.stale, "follow_up_days": c.days,
            "as_of": c.file_date}
