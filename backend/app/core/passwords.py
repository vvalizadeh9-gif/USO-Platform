"""What counts as an acceptable password.

The policy was ``min_length=8`` and nothing else. This replaces it, and it is
worth saying what it deliberately does *not* do: there is no rule requiring an
uppercase letter, a digit and a symbol.

Composition rules of that kind are what NIST SP 800-63B stopped recommending,
because of what they produce in practice. Told to include four character
classes, people write ``Password1!`` — which satisfies every rule and is among
the first hundred guesses any attacker makes. The rules feel like security and
measurably move users towards a small, predictable set of shapes.

What actually helps is length, and refusing the passwords that are already on
every guessing list. That is what this does.

Three checks:

* **Length.** Twelve characters minimum. The single most useful lever, and the
  one composition rules distract from.
* **Not a known-common password.** A short embedded list, matched after
  normalising case and the digit-for-letter substitutions people reach for
  (``P@ssw0rd`` and ``password`` are the same guess). This is not a breach
  corpus -- that needs a service call this deployment cannot make, on a server
  with no route to the public internet -- but it catches the passwords that are
  tried first.
* **Not built from the username.** ``maryam`` / ``maryam2024`` is the other
  thing people do when told to pick something longer.

And an upper bound, which is a resource matter rather than a policy one.
Argon2id reads the whole password, however long, and hashing is deliberately
expensive in memory and time -- so an unbounded field is a way to make the
server do arbitrary work per request, on the one endpoint that is reachable
without signing in. The ceiling is generous enough that no passphrase anyone
actually types will meet it.

The limit is in **bytes**, not characters, because Persian text is two bytes
per character in UTF-8; saying "characters" would mean a Persian passphrase and
a Latin one of the same visible length were measured differently, and the
message explains which it is.

This used to be 72 bytes, which was bcrypt's own limit rather than a choice:
bcrypt ignores everything past it, so two different long passwords were the
same password as far as the hash was concerned. Argon2id has no such limit, and
the ceiling is now set where a resource bound belongs instead. The old hashes
are unaffected -- see ``core/security.py``.
"""
from __future__ import annotations

MIN_LENGTH = 12

# A resource bound, not a property of the hash. See the module docstring.
MAX_BYTES = 256

# The shapes that get tried first. Deliberately short -- a long list here would
# be a poor substitute for a breach corpus, and the value is in catching
# "password123" and "qwerty", not in being comprehensive.
_COMMON = {
    "password", "passwort", "welcome", "qwerty", "qwertyuiop", "azerty",
    "letmein", "iloveyou", "monkey", "dragon", "sunshine", "princess",
    "football", "baseball", "superman", "trustno", "admin", "administrator",
    "root", "changeme", "secret", "default", "test", "guest", "user",
    "abcdef", "asdfgh", "zxcvbn", "master", "shadow", "michael", "jennifer",
    "computer", "internet", "samsung", "google", "facebook", "whatever",
    "freedom", "starwars", "iran", "tehran", "uso", "uep",
}

# What people substitute when a rule demands a digit or a symbol. Folding these
# means "P@ssw0rd" is recognised as "password" rather than counted as different.
_LEET = str.maketrans({"@": "a", "4": "a", "3": "e", "1": "i",
                       "0": "o", "$": "s", "5": "s", "7": "t"})

# What gets tacked on the end to satisfy a length or "must contain a digit"
# rule. Stripped before folding, not after -- otherwise "Password1234" folds to
# "passwordi2ea" and the trailing digits are no longer digits to strip.
_PADDING = "0123456789!@#$%^&*_-. "


class PasswordError(ValueError):
    """A password that must be refused, with a message meant for the person."""


def _forms(value: str) -> set[str]:
    """Every way this password might be a common one wearing a disguise.

    Returns a set rather than one canonical string because the disguises do not
    compose in a single order. "Password1234" needs its tail stripped before
    anything else; "P@ssw0rd" needs its substitutions folded; "P@ssw0rd1234"
    needs the tail stripped *then* the substitutions folded, because folding
    first turns the digits into letters that can no longer be stripped. Trying
    each form is simpler than finding an order that works for all of them, and
    it does not quietly fail on the next variation.
    """
    lowered = value.lower()
    seeds = {lowered, lowered.rstrip(_PADDING)}
    seeds |= {seed.translate(_LEET) for seed in set(seeds)}

    forms: set[str] = set()
    for seed in seeds:
        alnum = "".join(c for c in seed if c.isalnum())
        forms.add(alnum)
        forms.add(alnum.rstrip("0123456789"))
        forms.add("".join(c for c in seed if c.isalpha()))
    return {form for form in forms if form}


def _normalise(value: str) -> str:
    """One canonical form, for the username comparison."""
    lowered = value.lower().translate(_LEET)
    return "".join(c for c in lowered if c.isalnum()).rstrip("0123456789")


def validate_password(password: str, *, username: str | None = None) -> str:
    """Return the password, or raise :class:`PasswordError` saying what is wrong.

    Messages say what to do, not merely what was refused: someone choosing a
    password is mid-task, and "must be at least 12 characters" is actionable
    where "invalid password" is not.
    """
    if len(password) < MIN_LENGTH:
        raise PasswordError(
            f"Use at least {MIN_LENGTH} characters. Length is what makes a "
            "password hard to guess — a short phrase you will remember beats a "
            "short word with symbols in it."
        )

    encoded = len(password.encode("utf-8"))
    if encoded > MAX_BYTES:
        raise PasswordError(
            f"That is too long — the limit is {MAX_BYTES} bytes and this is "
            f"{encoded}. Persian text counts as two bytes per character, so "
            f"roughly {MAX_BYTES // 2} Persian characters or {MAX_BYTES} Latin "
            "ones."
        )

    if _forms(password) & _COMMON:
        raise PasswordError(
            "That is one of the most commonly used passwords, so it is among "
            "the first an attacker tries. Please choose something else."
        )

    if username:
        normalised = _normalise(password)
        folded_user = _normalise(username)
        if folded_user and (folded_user in normalised or normalised in folded_user):
            raise PasswordError(
                "The password must not be built from the username — it is the "
                "first thing anyone targeting this account will try."
            )

    return password
