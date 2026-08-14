"""Parse CPM's concatenated technology strings into a clean list.

CPM stores requested technologies as a single joined string, e.g.
"2G3G4G", "2G4G", "3G". The health check must ask the subcontractor about
exactly (and only) the requested technologies for each site, so we split
these consistently in one place.
"""
from __future__ import annotations

# Recognised technology tokens, longest-first isn't needed since each is 2 chars.
KNOWN_TECHNOLOGIES = ("2G", "3G", "4G", "5G")


def parse_technologies(raw: str | None) -> list[str]:
    """Split a concatenated tech string into an ordered list of technologies.

    "2G3G4G" -> ["2G", "3G", "4G"]
    "2G4G"   -> ["2G", "4G"]
    None/""  -> []
    Unknown fragments are ignored rather than raising, so bad data degrades
    gracefully instead of blocking a whole health check.
    """
    if not raw:
        return []
    text = str(raw).upper().replace(" ", "").replace("/", "").replace(",", "")
    found: list[str] = []
    i = 0
    while i < len(text):
        chunk = text[i : i + 2]
        if chunk in KNOWN_TECHNOLOGIES:
            if chunk not in found:
                found.append(chunk)
            i += 2
        else:
            i += 1  # skip an unrecognised character
    return found
