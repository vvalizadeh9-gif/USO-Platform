"""Security primitives: password hashing and JWT token handling.

Tokens are signed with PyJWT. The previous library, python-jose 3.3.0, carries
published advisories for algorithm confusion (a token can ask to be verified
with an algorithm the server did not intend) and for a decompression
denial-of-service. The token payload is unchanged, so tokens issued before the
switch still validate and nothing about existing sessions changes.
"""
import random
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

settings = get_settings()

CAPTCHA_TTL_MINUTES = 5

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _bcrypt_safe(password: str) -> str:
    """Truncate to bcrypt's 72-byte limit to avoid backend errors."""
    return password.encode("utf-8")[:72].decode("utf-8", "ignore")


def hash_password(plain_password: str) -> str:
    """Return a bcrypt hash for the given plaintext password."""
    return _pwd_context.hash(_bcrypt_safe(plain_password))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if the plaintext matches the stored hash."""
    return _pwd_context.verify(_bcrypt_safe(plain_password), hashed_password)


def create_access_token(subject: str | int, extra_claims: dict[str, Any] | None = None) -> str:
    """Create a signed JWT access token.

    Args:
        subject: The user id placed in the ``sub`` claim.
        extra_claims: Optional additional claims (e.g. role).
    """
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload: dict[str, Any] = {"sub": str(subject), "exp": expire}
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
        {"a": a, "b": b, "exp": expire},
        settings.captcha_key,
        algorithm=settings.jwt_algorithm,
    )
    return {"token": token, "num1": a, "num2": b}


def verify_captcha(token: str, answer: int) -> bool:
    """Return True if ``answer`` solves the challenge encoded in ``token``."""
    try:
        claims = jwt.decode(
            token, settings.captcha_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        return False
    return claims.get("a", -1) + claims.get("b", -2) == answer
