"""What counts as an acceptable password, and what deliberately does not.

The policy was `min_length=8` and nothing else. What replaced it is length, a
common-password blocklist and a username check -- and explicitly *not* a
character-class rule, for the reason in app/core/passwords.py: told to include
four classes, people write "Password1!", which satisfies every rule and is
among the first hundred guesses anyone makes.

Run with:  cd backend && pytest tests/test_password_policy.py -q
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("APP_ENV", "development")

from app.core.passwords import (  # noqa: E402
    MAX_BYTES,
    MIN_LENGTH,
    PasswordError,
    validate_password,
)


def test_a_long_memorable_phrase_is_accepted():
    """The shape the policy is trying to encourage."""
    assert validate_password("the quiet village at dawn")


@pytest.mark.parametrize("short", ["", "a", "Passw0rd!", "Short1!x"])
def test_too_short_is_refused(short):
    assert len(short) < MIN_LENGTH
    with pytest.raises(PasswordError, match="at least"):
        validate_password(short)


def test_the_message_says_what_to_do():
    """Someone choosing a password is mid-task, not reading an error log."""
    with pytest.raises(PasswordError) as exc:
        validate_password("tooshort")
    assert str(MIN_LENGTH) in str(exc.value)


# ---------------------------------------------------------------------------
# Common passwords, including the substitutions people reach for
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "common",
    ["password1234", "Password1234", "P@ssw0rd1234", "qwertyuiop12",
     "administrator", "letmein12345", "changeme1234", "PASSWORD!!!!"],
)
def test_common_passwords_are_refused(common):
    with pytest.raises(PasswordError, match="commonly used"):
        validate_password(common)


def test_leet_substitutions_do_not_make_a_common_password_uncommon():
    """P@ssw0rd and password are the same guess."""
    with pytest.raises(PasswordError, match="commonly used"):
        validate_password("P@ssw0rd!!!!")


def test_trailing_digits_do_not_either():
    with pytest.raises(PasswordError, match="commonly used"):
        validate_password("welcome202020")


# ---------------------------------------------------------------------------
# Built from the username
# ---------------------------------------------------------------------------
def test_a_password_built_from_the_username_is_refused():
    with pytest.raises(PasswordError, match="username"):
        validate_password("maryam2024567", username="maryam")


def test_an_unrelated_password_passes_the_username_check():
    assert validate_password("the quiet village", username="maryam")


def test_the_username_check_is_skipped_when_there_is_no_username():
    """Two call sites have no username in the payload; they must still work."""
    assert validate_password("a perfectly fine phrase")


# ---------------------------------------------------------------------------
# bcrypt's byte limit, which is a correctness matter rather than policy
# ---------------------------------------------------------------------------
def test_a_password_past_bcrypts_limit_is_refused_rather_than_truncated():
    """Silently truncating means two different passwords become one password."""
    too_long = "a" * (MAX_BYTES + 1)
    with pytest.raises(PasswordError, match="too long"):
        validate_password(too_long)


def test_the_limit_is_bytes_not_characters():
    """Persian is two bytes per character, and the message has to say so.

    A 40-character Persian passphrase is already over bcrypt's limit while a
    40-character Latin one is not. Refusing one and accepting the other without
    explaining why would be baffling for this platform's users in particular.
    """
    persian = "رمز" * 13  # 39 characters, 78 bytes
    assert len(persian) < MAX_BYTES < len(persian.encode("utf-8"))
    with pytest.raises(PasswordError, match="two bytes per character"):
        validate_password(persian)


def test_a_persian_phrase_within_the_limit_is_accepted():
    persian = "رمز عبور طولانی"
    assert len(persian.encode("utf-8")) <= MAX_BYTES
    assert validate_password(persian)


# ---------------------------------------------------------------------------
# What the policy deliberately does NOT require
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "no_composition",
    [
        "correct horse battery",   # no digit, no symbol, no uppercase
        "alllowercaseletters",     # letters only
        "استقرار سایت روستایی",     # no Latin characters at all
    ],
)
def test_composition_rules_are_not_imposed(no_composition):
    """A long phrase with no digit or symbol is a good password, not a bad one.

    If someone later "fixes" this by adding a character-class requirement, this
    test is the argument against it -- see app/core/passwords.py.
    """
    assert validate_password(no_composition)
