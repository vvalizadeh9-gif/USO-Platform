"""Security primitives: password hashing and JWT token handling.

Tokens are signed with PyJWT. The previous library, python-jose 3.3.0, carries
published advisories for algorithm confusion (a token can ask to be verified
with an algorithm the server did not intend) and for a decompression
denial-of-service. The token payload is unchanged, so tokens issued before the
switch still validate and nothing about existing sessions changes.

Passwords are hashed with **Argon2id**. See the block above
:func:`hash_password` for why, and for how the bcrypt hashes written before
this change keep working.
"""
import random
import re
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exceptions
from argon2.low_level import Type as Argon2Type
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.models.auth import SpentCaptcha

settings = get_settings()

CAPTCHA_TTL_MINUTES = 5

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
#
# Argon2id, with bcrypt kept only to read what is already stored.
#
# bcrypt is not broken, and the platform ran on it for years. What it cannot do
# is cost an attacker *memory*. bcrypt's work factor buys CPU time only, and the
# machines that crack password hashes are GPUs and FPGAs with thousands of cores
# and very little memory per core -- exactly the shape bcrypt does not defend
# against. Argon2id is the current answer to that: it is the winner of the
# Password Hashing Competition, the algorithm OWASP names first, and its cost is
# tuned in memory as well as time, which is what makes a rented GPU farm an
# expensive way to attack it.
#
# The three parameters below are OWASP's minimum recommendation for Argon2id
# (19 MiB, two passes, one lane), rounded up on memory. They are deliberately
# named constants rather than inline numbers, because the correct values move
# with hardware and someone will need to raise them; ``needs_rehash`` below is
# what makes raising them safe, since it re-hashes each password the next time
# its owner signs in rather than requiring a reset.
#
# Every password set before this change is a bcrypt hash. Those must keep
# verifying or the platform locks out everyone at once, so ``verify_password``
# dispatches on the hash's own prefix and still understands both. A successful
# login against a bcrypt hash quietly rewrites it as Argon2id (see
# ``needs_rehash`` and its one caller in api/auth.py), so the old format drains
# away on its own as people sign in, with nothing for an administrator to do
# and nobody asked to choose a new password.
_ARGON2_TIME_COST = 2  # passes over memory
_ARGON2_MEMORY_COST = 64 * 1024  # KiB, i.e. 64 MiB
_ARGON2_PARALLELISM = 1  # lanes

_hasher = PasswordHasher(
    time_cost=_ARGON2_TIME_COST,
    memory_cost=_ARGON2_MEMORY_COST,
    parallelism=_ARGON2_PARALLELISM,
    hash_len=32,
    salt_len=16,
    type=Argon2Type.ID,
)

# Legacy only. Nothing writes bcrypt any more; this is the cost the hashes in
# the database were written with, kept so the constant that documents them does
# not disappear with the code that produced them.
_BCRYPT_ROUNDS = 12


def claim_captcha(db, jti: str | None, expires_at: float | None) -> bool:
    """Record a captcha challenge as used. Returns False if it already was.

    In the database, not in process memory, for the same reason as the login
    throttle next door: a restart used to forget every spent challenge, and a
    second backend container would not see the first one's. The primary key on
    ``spent_captchas`` is what enforces single use -- a read-then-write check
    cannot make that guarantee under concurrency.
    """
    if not jti:
        # A challenge minted before this existed. Accept it rather than locking
        # out anyone holding a login page across the deploy.
        return True

    now = datetime.now(timezone.utc)
    expiry = (
        datetime.fromtimestamp(expires_at, tz=timezone.utc)
        if expires_at
        else now + timedelta(minutes=CAPTCHA_TTL_MINUTES)
    )

    # Expired rows can no longer refuse anything, so they are only taking up
    # space. Pruned on write; the table is small and only grows on a successful
    # captcha answer.
    db.execute(delete(SpentCaptcha).where(SpentCaptcha.expires_at < now))

    db.add(SpentCaptcha(jti=jti, expires_at=expiry))
    try:
        db.flush()
    except IntegrityError:
        # Already claimed. Roll back only this statement's effect, so the
        # caller's session stays usable for the 400 it is about to raise.
        db.rollback()
        return False
    db.commit()
    return True


def _bcrypt_safe(password: str) -> bytes:
    """Truncate to bcrypt's 72-byte limit to avoid backend errors.

    Legacy path only: no new hash is written with bcrypt. Kept explicit rather
    than left to the library, because bcrypt 5 raises on an over-long password
    where 4 truncated silently, and a user with a long passphrase should not
    stop being able to sign in -- once -- because a dependency changed its mind
    about how to handle them. Their next successful login rewrites the hash as
    Argon2id, which has no such limit.
    """
    return password.encode("utf-8")[:72]


def hash_password(plain_password: str) -> str:
    """Return an Argon2id hash for the given plaintext password."""
    return _hasher.hash(plain_password)


# What a bcrypt hash looks like: a version tag, a two-digit cost, then exactly
# 53 characters of radix-64 salt and digest. Checked before the hash is handed
# to the library, because a malformed value does not merely raise there -- some
# shapes panic inside bcrypt's Rust extension, and a PanicException does not
# inherit from Exception, so no ordinary ``except`` catches it. One corrupted
# password_hash row would take the worker down instead of failing one login.
_BCRYPT_HASH = re.compile(r"^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$")

# Argon2's own prefix. Only used to route a hash to the right verifier; the
# library does the real parsing, and rejects anything it cannot read.
_ARGON2_PREFIX = "$argon2"


def _verify_bcrypt(plain_password: str, hashed_password: str) -> bool:
    """Verify against a hash written before the move to Argon2id."""
    if not _BCRYPT_HASH.match(hashed_password):
        return False
    try:
        return bcrypt.checkpw(
            _bcrypt_safe(plain_password), hashed_password.encode("ascii")
        )
    except (ValueError, TypeError):
        return False


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if the plaintext matches the stored hash.

    Understands both formats the database can hold: Argon2id, which is what
    every hash written from now on is, and bcrypt, which is what every hash
    written before the switch is. Which one a value is, is decided by the value
    itself, so no flag column has to stay in step with the data.

    Returns False rather than raising for anything unreadable. One corrupted
    ``password_hash`` row should fail that one login, not the worker.
    """
    if not hashed_password:
        return False
    if hashed_password.startswith(_ARGON2_PREFIX):
        try:
            return _hasher.verify(hashed_password, plain_password)
        except (argon2_exceptions.VerificationError, argon2_exceptions.InvalidHash):
            return False
    return _verify_bcrypt(plain_password, hashed_password)


def needs_rehash(hashed_password: str) -> bool:
    """True if this stored hash should be rewritten after a successful login.

    Two cases: a bcrypt hash from before the switch, and an Argon2id hash whose
    cost parameters are below the ones configured now. Both are answered here
    rather than at the call site, so raising the parameters above is the only
    edit a future upgrade needs.

    Only ever act on this when the password has just been verified -- it is the
    one moment the plaintext is in hand and can be re-hashed without asking
    anybody for anything.
    """
    if not hashed_password:
        return False
    if not hashed_password.startswith(_ARGON2_PREFIX):
        return True
    try:
        return _hasher.check_needs_rehash(hashed_password)
    except argon2_exceptions.InvalidHash:
        # Unreadable, so it cannot be verified against either. Nothing to
        # upgrade; the login it belongs to has already failed.
        return False


# A real Argon2id hash of a value nothing can be, computed once at import.
# ``verify_password_or_dummy`` below burns the same work on it when there is no
# user, so that a wrong username and a wrong password take the same time.
_DUMMY_HASH = hash_password("uep-no-such-user")


def verify_password_or_dummy(plain_password: str, hashed_password: str | None) -> bool:
    """Verify, doing the same work when there is no hash to check against.

    Login previously short-circuited on an unknown username, returning in
    microseconds where a known username took the full comparison. The response
    body was identical, but the response *time* said whether the account
    existed, which is the first thing a password-guessing run wants to know.
    Hashing against a fixed dummy costs the same and says nothing.
    """
    if hashed_password is None:
        verify_password(plain_password, _DUMMY_HASH)
        return False
    return verify_password(plain_password, hashed_password)


# The alphabet a generated temporary password is drawn from. No ``l``/``1`` or
# ``O``/``0``, and no punctuation: an administrator reads these aloud down a
# phone line or copies them into a chat message, and a character that can be
# mistaken for another turns one reset into three. Length is what carries the
# strength here, not the character set -- and the password is single-use in
# practice, because the account it belongs to must change it at next sign-in.
_TEMPORARY_ALPHABET = "".join(
    c for c in string.ascii_letters + string.digits if c not in "lI1O0"
)


def generate_temporary_password(length: int = 16) -> str:
    """Return a random password for an administrator to hand to one person.

    ``secrets``, not ``random``: this value is a credential, and the module
    next door that mints captchas is seeded well enough for arithmetic and not
    for this.
    """
    return "".join(secrets.choice(_TEMPORARY_ALPHABET) for _ in range(length))


def create_access_token(subject: str | int, extra_claims: dict[str, Any] | None = None) -> str:
    """Create a signed JWT access token.

    Args:
        subject: The user id placed in the ``sub`` claim.
        extra_claims: Optional additional claims (e.g. role).
    """
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
        # When this token was minted. Not used for expiry -- ``exp`` does that
        # -- but it is what makes a token auditable after the fact, and it is
        # one line now against a schema change later.
        "iat": datetime.now(timezone.utc),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT. Returns claims dict or None if invalid.

    ``algorithms`` is pinned to the one algorithm this application signs with,
    so a token cannot ask to be verified some other way.
    """
    try:
        return jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        return None


def create_captcha_challenge() -> dict[str, Any]:
    """Generate a simple "a + b" math captcha.

    The two numbers are signed (with an expiry) into a JWT so verification
    needs no server-side session storage - the client echoes the token back
    alongside its answer on login.

    Signed with ``settings.captcha_key``, which is deliberately not the
    access-token key: captcha tokens are handed to every anonymous visitor who
    loads the login page, and there is no reason for the key that mints admin
    sessions to also be the key on the most widely distributed token the
    application issues.
    """
    a, b = random.randint(1, 9), random.randint(1, 9)
    expire = datetime.now(timezone.utc) + timedelta(minutes=CAPTCHA_TTL_MINUTES)
    token = jwt.encode(
        {"a": a, "b": b, "exp": expire, "jti": secrets.token_urlsafe(9)},
        settings.captcha_key,
        algorithm=settings.jwt_algorithm,
    )
    return {"token": token, "num1": a, "num2": b}


def verify_captcha(db, token: str, answer: int) -> bool:
    """Return True if ``answer`` solves the challenge encoded in ``token``.

    Each challenge is accepted once. Without that a solved token authorised
    unlimited attempts for its full five-minute life, so a guessing run solved
    one sum and then never saw a captcha again. The login throttle in
    ``core/rate_limit.py`` remains the real defence -- this just stops the
    captcha being free to bypass.
    """
    try:
        claims = jwt.decode(
            token, settings.captcha_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        return False
    if claims.get("a", -1) + claims.get("b", -2) != answer:
        return False
    return claim_captcha(db, claims.get("jti"), claims.get("exp"))
