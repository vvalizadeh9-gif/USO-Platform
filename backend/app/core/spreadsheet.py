"""Spreadsheet cells that stay data (CSV/formula injection, OWASP).

A cell whose text begins with ``=``, ``+``, ``-``, ``@`` (or a tab or carriage
return, which some readers strip before parsing) is read by Excel and other
spreadsheet programs as a formula. Text that came from users -- a village
name, a contractor's name, a comment -- could then run when the file is
opened. :func:`formula_safe` prefixes such text with an apostrophe, which
every spreadsheet program reads as "this is text".

Numbers, dates and empty cells are returned unchanged.
"""
from __future__ import annotations

FORMULA_PREFIXES: tuple[str, ...] = ("=", "+", "-", "@", "\t", "\r")


def formula_safe(value: object) -> object:
    """``value``, with text that a spreadsheet would run made inert."""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value
