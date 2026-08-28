"""Security primitives: password hashing and JWT token handling.

Tokens are signed with PyJWT. The previous library, python-jose 3.3.0, carries
published advisories for algorithm confusion (a token can ask to be verified
with an algorithm the server did not intend) and for a decompression
denial-of-service. The token payload is unchanged, so tokens issued before the
switch still validate and nothing about existing sessions changes.
"""
import random
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import get_settings

settings = get_settings()

CAPTCHA_TTL_MINUTES = 5

# bcrypt directly, not through passlib.
#
# passlib has had no release since 2020. It reads a private attribute of the
# bcrypt package that was removed in bcrypt 4.1, which is why bcrypt was pinned
# back to 4.0.1 here -- a security-relevant dependency held at an old version by
# an unmaintained wrapper. It also imports the stdlib ``crypt`` module, deleted
# in Python 3.12+, and the backend Dockerfile already notes that Python 3.12
# reaches end of life inside this platform's expected lifetime.
#
# The hash format is unchanged: passlib's bcrypt backend produces exactly what
# bcrypt.hashpw produces ($2b$, 12 rounds), and each verifies the other's
# output. Every existing password keeps working, and nothing about stored data
# changes.
_BCRYPT_ROUNDS = 12


class _SpentCaptchas:
    """Remembers which captcha challenges have already been answered.

    Held in memory, for the same reason and with the same limitation as the
    login throttle: there is one backend container, so one process sees every
    login. A restart forgets the set, which at worst lets a handful of tokens
    be reused once; if UEP is ever run as more than one backend, this and
    ``core/rate_limit.py`` move to Redis together.

    Entries are dropped once their token has expired anyway, so the set stays
    bounded by the number of captchas issued in five minutes.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._spent: dict[str, float] = {}

    def claim(self, jti: str | None, expires_at: float | None) -> bool:
        """Record *jti* as used. Returns False if it already was."""
        if not jti:
            # A challenge minted before this existed. Accept it rather than
            # locking out anyone holding a login page across the deploy.
            return True
        now = time.time()
        with self._lock:
            for spent, expiry in list(self._spent.items()):
                if expiry <= now:
                    del self._spent[spent]
            if jti in self._spent:
                return False
            self._spent[jti] = float(
                expires_at or now + CAPTCHA_TTL_MINUTES * 60
            )
            return True

    def reset(self) -> None:
        """Forget everything. For tests."""
        with self._lock:
            self._spent.clear()


_spent_captchas = _SpentCaptchas()


def _bcrypt_safe(password: str) -> bytes:
    """Truncate to bcrypt's 72-byte limit to avoid backend errors.

    Kept explicit rather than left to the library: bcrypt 5 raises on an
    over-long password where 4 truncated silently, and a user with a long
    passphrase should not stop being able to sign in because a dependency
    changed its mind about how to handle them.
    """
    return password.encode("utf-8")[:72]


def hash_password(plain_password: str) -> str:
    """Return a bcrypt hash for the given plaintext password."""
    return bcrypt.hashpw(
        _bcrypt_safe(plain_password), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    ).decode("ascii")


# What a bcrypt hash looks like: a version tag, a two-digit cost, then exactly
# 53 characters of radix-64 salt and digest. Checked before the hash is handed
# to the library, because a malformed value does not merely raise there -- some
# shapes panic inside bcrypt's Rust extension, and a PanicException does not
# inherit from Exception, so no ordinary ``except`` catches it. One corrupted
# password_hash row would take the worker down instead of failing one login.
_BCRYPT_HASH = re.compile(r"^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if the plaintext matches the stored hash.

    Returns False rather than raising for anything that is not a bcrypt hash.
    passlib used to absorb that case; calling bcrypt directly means absorbing
    it here.
    """
    if not hashed_password or not _BCRYPT_HASH.match(hashed_password):
        return False
    try:
        return bcrypt.checkpw(
            _bcrypt_safe(plain_password), hashed_password.encode("ascii")
        )
    except (ValueError, TypeError):
        return False


# A real bcrypt hash of a value nothing can be, computed once at import.
# ``verify_password_or_dummy`` below burns the same work on it when there is no
# user, so that a wrong username and a wrong password take the same time.
_DUMMY_HASH = hash_password("uep-no-such-user")


def verify_password_or_dummy(plain_password: str, hashed_password: str | None) -> bool:
    """Verify, doing the same work when there is no hash to check against.

    Login previously short-circuited on an unknown username, returning in
    microseconds where a known username took the full bcrypt comparison. The
    response body was identical, but the response *time* said whether the
    account existed, which is the first thing a password-guessing run wants to
    know. Hashing against a fixed dummy costs the same and says nothing.
    """
    if hashed_password is None:
        verify_password(plain_password, _DUMMY_HASH)
        return False
    return verify_password(plain_password, hashed_password)


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


def verify_captcha(token: str, answer: int) -> bool:
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
    return _spent_captchas.claim(claims.get("jti"), claims.get("exp"))
