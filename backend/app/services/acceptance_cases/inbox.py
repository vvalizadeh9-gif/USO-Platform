"""The Filing inbox (§3.1 left column): one authority's open cases.

Two groups -- waiting with the contractors, rejected in the team baskets --
each oldest in basket first. Approved cases leave the inbox. The tab counts
are ``counts.tab_counts`` over the viewer's whole inbox, so they equal the
rail and Home; search and the Baskets filter narrow the rows only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.digits import to_latin
from app.models.acceptance_case import STATE_REJECTED, STATE_WAITING
from app.models.reference import User

from . import counts, rules
from .scope import CaseRow


class InboxError(ValueError):
    pass


@dataclass(frozen=True)
class Filters:
    q: str | None = None
    basket: str | None = None
    bucket: str | None = None


def search_terms(q: str | None) -> list[str]:
    """Words of a search, digits Latin. Many words read as pasted codes."""
    return [t for t in re.split(r"[\s,;]+", to_latin(q or "").strip().lower()) if t]


def matches_search(row: CaseRow, terms: list[str]) -> bool:
    if not terms:
        return True
    keys = [str(row.village_id), row.village_code or "", row.site_code or ""]
    keys = [to_latin(k).lower() for k in keys if k]
    if len(terms) > 1:
        # Pasted codes: an exact code match, any of them.
        return any(t in keys for t in terms)
    term = terms[0]
    name = to_latin(row.village_name or "").lower()
    return any(term in k for k in keys) or term in name


def matches_filters(row: CaseRow, flt: Filters, terms: list[str]) -> bool:
    if flt.basket and row.basket_key != flt.basket:
        return False
    if flt.bucket == rules.COL_NO_COMMENT and not row.stale:
        return False
    if flt.bucket in rules.BUCKET_KEYS and row.bucket != flt.bucket:
        return False
    return matches_search(row, terms)


def row_out(r: CaseRow) -> dict:
    sub = (f"{r.village_code or r.village_id} · {r.basket_owner}" if r.state == STATE_WAITING
           else f"{r.category_label or 'Needs category'} · {r.basket_owner}")
    return {
        "case_id": r.case_id,
        "village_id": r.village_id,
        "village_code": r.village_code,
        "village_name": r.village_name,
        "site_code": r.site_code,
        "state": r.state,
        "category": r.category_label,
        "basket_key": r.basket_key,
        "basket_owner": r.basket_owner,
        "sub": sub,
        "days_in_basket": r.days_in_basket,
        "over_sla": r.over_sla,
        "stale": r.stale,
        "in_validation": r.in_validation,
    }


def _ordered(rows: list[CaseRow]) -> list[CaseRow]:
    return sorted(rows, key=lambda r: (-r.days_in_basket, r.village_name or "", r.case_id))


def build(db: Session, user: User, authority: str, tab: str, flt: Filters) -> dict:
    if tab not in counts.TABS:
        raise InboxError(f"tab must be one of {', '.join(counts.TABS)}")
    c = counts.clock(db)
    everything = counts.open_cases(db, user, c, authority)
    terms = search_terms(flt.q)
    shown = [r for r in everything if counts.in_tab(r, tab) and matches_filters(r, flt, terms)]
    waiting = _ordered([r for r in shown if r.state == STATE_WAITING])
    rejected = _ordered([r for r in shown if r.state == STATE_REJECTED])
    tally = counts.tab_counts(everything)
    groups = []
    if tab != counts.TAB_REJECTED:
        groups.append({"key": STATE_WAITING, "label": f"Waiting for {authority} · contractors",
                       "count": len(waiting), "rows": [row_out(r) for r in waiting]})
    if tab != counts.TAB_WAITING:
        groups.append({"key": STATE_REJECTED, "label": "Rejected · team baskets",
                       "count": len(rejected), "rows": [row_out(r) for r in rejected]})
    return {
        "authority": authority,
        "tab": tab,
        "counts": tally,
        "shown": len(waiting) + len(rejected),
        "groups": groups,
        "sla_days": c.sla_days,
        "fresh_days": c.fresh_days,
        "filters": {"q": flt.q, "basket": flt.basket, "bucket": flt.bucket},
    }
