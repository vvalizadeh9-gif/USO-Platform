"""What a hand-typed Excel cell means: the approval vocabulary, in one place.

These two sets were class attributes on ``CpmImportService``, where they read
the ICT/CRA columns of the CPM workbook. The Mojri tracker importer reads the
same kind of cell -- a human typing a yes or a no into a spreadsheet, in
English or Persian, with whatever spelling and spacing they use -- so it reads
the same vocabulary rather than carrying a second copy of it.

Two copies would not fail; they would *drift*. One importer would learn
"تایید شده" and the other would not, and the difference would show up months
later as a village that reads registered on one screen and blank on another,
with nothing to say which is right.

They are deliberately permissive. These cells are not a form with a dropdown --
they are whatever the team typed while cleaning a file by hand.
"""
from __future__ import annotations

#: Values (case-insensitive) that mean yes.
APPROVED_TOKENS = frozenset({
    "approved", "approve", "approval", "accepted", "accept", "ok", "okay",
    "yes", "y", "done", "true", "1", "✓", "✔", "√",
    "تایید", "تأیید", "تاييد", "تایید شده", "تأیید شده", "موافقت", "بله",
})

#: Values (case-insensitive) that mean no.
#:
#: The CPM importer turns these into a Rejected verdict. The Mojri importer
#: deliberately does **not** turn them into "not in the tracker": in a
#: registration column, "rejected" and "not registered yet" are two different
#: facts, and reading one as the other would record a decision nobody made.
#: They route to "needs a look" there — see ``services/mojri_tracker.py``.
REJECTED_TOKENS = frozenset({
    "rejected", "reject", "rej", "no", "n", "false", "0", "✗", "x", "×",
    "رد", "مردود", "عدم تایید", "عدم تأیید",
})

#: Values that plainly mean "somebody has to look at this". Not a rule of its
#: own — anything unrecognised routes the same way — but written down so the
#: intent is testable and so a reader can see what the team actually types.
AMBIGUOUS_TOKENS = frozenset({
    "?", "??", "check", "tbc", "tbd", "maybe", "pending", "unknown",
    "بررسی", "نامشخص", "؟",
})


def normalize(cell: object | None) -> str | None:
    """A cell as a token: trimmed and lowercased, or None when it is blank.

    A cell holding only whitespace is blank. Openpyxl hands back a number for
    a numeric cell, which is why this takes anything and not just a string --
    "1" typed into a spreadsheet arrives as ``1``.
    """
    if cell is None:
        return None
    text = str(cell).strip()
    return text.lower() if text else None
