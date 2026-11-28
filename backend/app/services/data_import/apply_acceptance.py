"""Confirm, acceptance half (§6.3): per village and authority with a result.

A new validated round (source ``Import``) for every requested technology,
projected into ``acceptances`` by the workflow's own ``_project``; the cached
statuses rebuilt by ``recompute_authority_statuses``, exactly like a normal
validation; then the village's case moves through the case transitions, so a
rejection lands in its category's basket (UEP-22). Earlier rounds are never
touched: a conflict decided "Use file" is simply the next round.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models.acceptance_case import (
    STATE_REJECTED,
    STATE_WAITING,
    AcceptanceCase,
)
from app.models.acceptance_workflow import (
    REVIEW_VALIDATED,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.workitem import Village
from app.services import acceptance_workflow as flow
from app.services.acceptance_cases import sync, transitions
from app.services.acceptance_cases.transitions import Letter

from . import columns as C
from .context import Ctx, noon
from .current import Universe

SOURCE_IMPORT = "Import"
LETTER_FIELDS = ("result", "letter_number", "letter_date", "rejection_category")


@dataclass
class Plan:
    row_id: int
    village_ids: list[int]
    authority: str
    new: dict[str, str]


def _projection(village: Village, authority: str) -> dict:
    a = authority.lower()
    return {
        row.technology: [getattr(row, f"{a}_status"), _iso(getattr(row, f"{a}_date")),
                         getattr(row, f"{a}_source")]
        for row in village.acceptances
    }


def _iso(day: date | None) -> str | None:
    return day.isoformat() if day else None


def case_snapshot(case: AcceptanceCase | None) -> dict | None:
    if case is None:
        return None
    return {"state": case.state, "basket_role": case.basket_role,
            "category_id": case.category_id, "state_since": _iso(case.state_since)}


def restore_case(case: AcceptanceCase, snap: dict) -> None:
    case.state = snap["state"]
    case.basket_role = snap["basket_role"]
    case.category_id = snap["category_id"]
    case.state_since = date.fromisoformat(snap["state_since"]) if snap.get("state_since") else case.state_since


def _villages(db, ids) -> dict[int, Village]:
    out = {}
    ids = list(ids)
    for start in range(0, len(ids), 1000):
        chunk = ids[start:start + 1000]
        for v in db.execute(
            select(Village).where(Village.id.in_(chunk)).options(
                selectinload(Village.acceptances), selectinload(Village.work_item),
            )
        ).scalars():
            out[v.id] = v
    return out


def _rounds(db, ids) -> dict[tuple[int, str], int]:
    out = {}
    ids = list(ids)
    for start in range(0, len(ids), 2000):
        chunk = ids[start:start + 2000]
        for vid, authority, top in db.execute(
            select(AcceptanceSubmission.village_id, AcceptanceSubmission.authority,
                   func.max(AcceptanceSubmission.round_no))
            .where(AcceptanceSubmission.village_id.in_(chunk))
            .group_by(AcceptanceSubmission.village_id, AcceptanceSubmission.authority)
        ).all():
            out[(vid, authority)] = top or 0
    return out


def apply_villages(ctx: Ctx, plans: list[Plan], acc_now: dict, universe: Universe) -> None:
    if not plans:
        return
    db = ctx.db
    all_ids = {vid for p in plans for vid in p.village_ids}
    villages = _villages(db, all_ids)
    rounds = _rounds(db, all_ids)

    moves = []      # (row_id, village, authority, target, submission | None)
    for plan in plans:
        now = {k: v.value for k, v in acc_now.get((plan.village_ids[0], plan.authority), {}).items()}
        target = {**now, **plan.new}
        letter_change = bool(set(plan.new) & set(LETTER_FIELDS)) and target.get("result")
        for vid in plan.village_ids:
            village = villages.get(vid)
            if village is None or village.work_item is None:
                continue
            submission = None
            if letter_change:
                submission = _new_round(ctx, plan, village, target, rounds)
            moves.append((plan.row_id, village, plan.authority, target, submission,
                          "comment" in plan.new))
            ctx.touched_villages.add(vid)

    db.flush()
    flow.recompute_authority_statuses(db, list({m[1].id: m[1] for m in moves}.values()))
    db.flush()
    _move_cases(ctx, moves, universe)


def _new_round(ctx: Ctx, plan: Plan, village: Village, target: dict, rounds: dict) -> AcceptanceSubmission:
    db = ctx.db
    result = target["result"]
    category = target.get("rejection_category")
    reason = None
    if result == C.ACC_REJECTED:
        reason = " · ".join(x for x in (category, target.get("comment")) if x) or category
    claims = [
        {"technology": t, "claimed_status": result, "comment": reason}
        for t in flow.requested_technologies(village)
    ]
    validated = flow._validate_claims(village, claims)
    key = (village.id, plan.authority)
    rounds[key] = rounds.get(key, 0) + 1
    moment = noon(target.get("letter_date"))
    submission = AcceptanceSubmission(
        village_id=village.id, authority=plan.authority, round_no=rounds[key],
        letter_number=target.get("letter_number") or "", letter_date=date.fromisoformat(target["letter_date"])
        if target.get("letter_date") else None,
        source=SOURCE_IMPORT, review_status=REVIEW_VALIDATED,
        submitted_by=ctx.user.id, submitted_at=moment,
        reviewed_by=ctx.user.id, reviewed_at=moment, review_comment=ctx.tag, version=1,
    )
    submission.technologies = [AcceptanceSubmissionTech(**c) for c in validated]
    submission.village = village
    db.add(submission)
    before = _projection(village, plan.authority)
    flow._project(db, submission)
    after = _projection(village, plan.authority)
    ctx.created(plan.row_id, "acceptance_submissions", submission,
                {"village_id": village.id, "authority": plan.authority})
    ctx.changed(plan.row_id, "acceptances", None, f"projection:{plan.authority}", before, after)
    ctx.effects[-1].entity_id = village.id
    return submission


def _move_cases(ctx: Ctx, moves: list, universe: Universe) -> None:
    db = ctx.db
    pairs = {(m[1].id, m[2]) for m in moves}
    if not pairs:
        return
    ids = {vid for vid, _a in pairs}
    existing = {
        (c.village_id, c.authority): case_snapshot(c)
        for c in db.execute(select(AcceptanceCase).where(AcceptanceCase.village_id.in_(ids))).scalars()
    }
    # A village whose drive test this batch made Done enters the case
    # universe now; its cases are created from the rounds just written.
    sync.ensure_cases(db)
    db.flush()
    cases = {
        (c.village_id, c.authority): c
        for c in db.execute(select(AcceptanceCase).where(AcceptanceCase.village_id.in_(ids))).scalars()
    }
    categories = universe.rejection_categories

    for row_id, village, authority, target, submission, has_comment in moves:
        case = cases.get((village.id, authority))
        if case is None:
            continue
        before = existing.get((village.id, authority))
        letter_day = date.fromisoformat(target["letter_date"]) if target.get("letter_date") else None
        if submission is not None:
            side = getattr(village, f"{authority.lower()}_status")
            category = categories.get((target.get("rejection_category") or "").casefold())
            if before is not None:
                transitions.apply_verdict(
                    db, case, ctx.user, side, category=category,
                    letter=Letter(submission.letter_number, letter_day),
                    text=ctx.tagged(target.get("comment")) if has_comment else ctx.tag,
                    meta={"submission_id": submission.id, "import_batch": ctx.batch.number},
                )
            elif side == "Rejected" and category is not None:
                case.state, case.category_id = STATE_REJECTED, category.id
                case.basket_role = category.basket_role
            if letter_day and case.state != STATE_WAITING:
                case.state_since = letter_day
        elif has_comment:
            transitions.comment(db, case, ctx.user, ctx.tagged(target.get("comment")),
                                meta={"import_batch": ctx.batch.number})
        after = case_snapshot(case)
        if after != before:
            ctx.changed(row_id, "acceptance_cases", case, "state", before, after)


def group_plans(changes, rows_by_id) -> list[Plan]:
    grouped: dict[tuple[int, str], dict] = defaultdict(dict)
    meta: dict[tuple[int, str], tuple[int, list[int]]] = {}
    for c in changes:
        authority = "ICT" if c.entity_type == "ict" else "CRA"
        field = c.field.split("_", 1)[1]
        key = (c.entity_id, authority)
        grouped[key][field] = c.new_value
        row = rows_by_id[c.row_id]
        meta.setdefault(key, (row.id, (row.raw or {}).get("_village_ids") or [c.entity_id]))
    return [Plan(meta[k][0], meta[k][1], k[1], fields) for k, fields in grouped.items()]

