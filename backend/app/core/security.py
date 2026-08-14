"""Security primitives: password hashing and JWT token handling."""
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
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
    """Decode and validate a JWT. Returns claims dict or None if invalid."""
    try:
        return jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except JWTError:
        return None


def create_captcha_challenge() -> dict[str, Any]:
    """Generate a simple "a + b" math captcha.

    The two numbers are signed (with an expiry) into a JWT so verification
    needs no server-side session storage - the client echoes the token back
    alongside its answer on login.
    """
    a, b = random.randint(1, 9), random.randint(1, 9)
    expire = datetime.now(timezone.utc) + timedelta(minutes=CAPTCHA_TTL_MINUTES)
    token = jwt.encode(
        {"a": a, "b": b, "exp": expire}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )
    return {"token": token, "num1": a, "num2": b}


def verify_captcha(token: str, answer: int) -> bool:
    """Return True if ``answer`` solves the challenge encoded in ``token``."""
    try:
        claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return False
    return claims.get("a", -1) + claims.get("b", -2) == answer
