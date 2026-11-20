"""Insights > Acceptance baskets (§3.2, §5.6): every basket against time in
basket, so the PM sees who holds what, for how long, and who gives no updates.

Rows are baskets (contractors waiting; the rejection team baskets; Parked),
columns the four age buckets of days in basket, then No comment and Total.
Every figure counts ``counts.open_cases`` -- the inbox's own rows.
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.acceptance_case import BASKET_CONTRACTOR, BASKET_PM, AcceptanceRejectionCategory
from app.models.reference import User

from . import counts, history, rules
from .scope import CaseRow

AUTHORITY_BOTH = "both"
AUTHORITY_CHOICES = ("ict", "cra", AUTHORITY_BOTH)
COLUMNS = (*rules.BUCKET_KEYS, rules.COL_NO_COMMENT, rules.COL_TOTAL)
COLUMN_LABELS = {**rules.BUCKET_LABELS, rules.COL_NO_COMMENT: "No comment", rules.COL_TOTAL: "Total"}

GROUP_WAITING = "Contractors · waiting"
GROUP_REJECTED = "Rejected · team baskets"
GROUP_PARKED = "Parked"


class BasketsError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def require_reader(user: User) -> None:
    """PM, coordinators (own regions) and Viewer only (§4.4)."""
    if user.role.name not in ("PM", "Coordinator", "Viewer"):
        raise BasketsError("Acceptance baskets is not available for this role", status=403)


def authority_filter(raw: str | None) -> str | None:
    value = (raw or AUTHORITY_BOTH).lower()
    if value not in AUTHORITY_CHOICES:
        raise BasketsError("authority must be ict, cra or both")
    return None if value == AUTHORITY_BOTH else value.upper()


def in_column(row: CaseRow, column: str) -> bool:
    if column == rules.COL_TOTAL:
        return True
    if column == rules.COL_NO_COMMENT:
        return row.stale
    return row.bucket == column


def cells(rows: list[CaseRow]) -> dict[str, int]:
    return {col: sum(1 for r in rows if in_column(r, col)) for col in COLUMNS}


def _team_baskets(db: Session) -> list[tuple[str, str]]:
    """(key, label) per team category, in the categories' order."""
    cats = db.execute(
        select(AcceptanceRejectionCategory).where(AcceptanceRejectionCategory.active.is_(True))
        .order_by(AcceptanceRejectionCategory.sort)
    ).scalars()
    return [
        (f"team:{c.basket_role}", c.label) for c in cats
        if c.basket_role not in (BASKET_CONTRACTOR, BASKET_PM)
    ]


def basket_rows(db: Session, rows: list[CaseRow]) -> list[dict]:
    """The grid's rows, grouped, each with its cells."""
    by_key: dict[str, list[CaseRow]] = defaultdict(list)
    for r in rows:
        by_key[r.basket_key].append(r)

    def entry(key: str, label: str, group: str, kind: str) -> dict:
        return {"key": key, "label": label, "group": group, "kind": kind, "cells": cells(by_key.get(key, []))}

    contractors = sorted(
        (k for k in by_key if k.startswith("contractor:")),
        key=lambda k: (-len(by_key[k]), by_key[k][0].basket_owner or ""),
    )
    out = [entry(k, by_key[k][0].basket_owner, GROUP_WAITING, "contractor") for k in contractors]
    out += [entry(k, label, GROUP_REJECTED, "team") for k, label in _team_baskets(db)]
    out.append(entry(rules.KEY_REJECTED_CONTRACTOR, "Contractors (rejected)", GROUP_REJECTED, "contractor"))
    if by_key.get(rules.KEY_NEEDS_CATEGORY):
        out.append(entry(rules.KEY_NEEDS_CATEGORY, "Needs category", GROUP_REJECTED, "team"))
    out.append(entry(rules.KEY_PARKED, "PM", GROUP_PARKED, "team"))
    return out


def default_cell(grid_rows: list[dict]) -> dict | None:
    """The largest over-3-months cell (§3.2), else the largest cell."""
    def best(columns) -> tuple[int, str, str] | None:
        found = [(r["cells"][c], r["key"], c) for r in grid_rows for c in columns if r["cells"][c]]
        return max(found, key=lambda f: f[0]) if found else None

    pick = best(rules.BUCKET_KEYS[1:]) or best(rules.BUCKET_KEYS[:1])
    return {"basket": pick[1], "column": pick[2]} if pick else None


def grid(db: Session, user: User, authority: str | None) -> dict:
    require_reader(user)
    c = counts.clock(db)
    rows = counts.open_cases(db, user, c, authority)
    grid_rows = basket_rows(db, rows)
    return {
        "authority": (authority or AUTHORITY_BOTH).lower(),
        "open": len(rows),
        "no_comment": sum(1 for r in rows if r.stale),
        "columns": [{"key": col, "label": COLUMN_LABELS[col], "total": sum(1 for r in rows if in_column(r, col))}
                    for col in COLUMNS],
        "rows": grid_rows,
        "default": default_cell(grid_rows),
        "sla_days": c.sla_days,
        "fresh_days": c.fresh_days,
    }


def cell(db: Session, user: User, basket: str, column: str, authority: str | None) -> dict:
    require_reader(user)
    if column not in COLUMNS:
        raise BasketsError(f"bucket must be one of {', '.join(COLUMNS)}")
    c = counts.clock(db)
    rows = [r for r in counts.open_cases(db, user, c, authority)
            if r.basket_key == basket and in_column(r, column)]
    rows.sort(key=lambda r: (-r.days_in_basket, r.case_id))
    comments = history.latest_comment(db, [r.case_id for r in rows])
    label = next((g["label"] for g in basket_rows(db, rows) if g["key"] == basket), basket)
    return {
        "basket": basket,
        "label": label,
        "column": column,
        "column_label": COLUMN_LABELS[column],
        "count": len(rows),
        "no_comment": sum(1 for r in rows if r.stale),
        "items": [_item(r, comments.get(r.case_id)) for r in rows],
    }


def _item(r: CaseRow, comment: dict | None) -> dict:
    return {
        "case_id": r.case_id, "village_id": r.village_id, "authority": r.authority,
        "village_name": r.village_name, "village_code": r.village_code,
        "days_in_basket": r.days_in_basket, "stale": r.stale, "comment_age": r.comment_age,
        "comment": None if r.stale else comment,
    }

