"""
JWT validation and password policy enforcement.
All token validation uses the Supabase JWT secret — tokens are issued by Supabase Auth.
Supports both legacy HS256 (symmetric) and current ES256 (asymmetric JWKS) tokens.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

import httpx
from jose import JWTError, jwt
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

JWT_AUDIENCE = "authenticated"
JWKS_CACHE_TTL = 3600  # re-fetch public keys at most once per hour

# ── JWKS Cache ────────────────────────────────────────────────────────────────

_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0


def _get_jwks() -> dict:
    """Fetch and cache Supabase's public JWKS (used for ES256 tokens)."""
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_cache is None or (now - _jwks_fetched_at) > JWKS_CACHE_TTL:
        url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        try:
            resp = httpx.get(url, timeout=5.0)
            resp.raise_for_status()
            _jwks_cache = resp.json()
            _jwks_fetched_at = now
            logger.debug("JWKS refreshed from %s", url)
        except Exception as e:
            logger.error("Failed to fetch JWKS: %s", e)
            if _jwks_cache is None:
                raise
    return _jwks_cache  # type: ignore[return-value]

# Valid roles in the system
VALID_ROLES = frozenset({
    "buyer",
    "seller",
    "verification_agent",
    "buyer_agent",
    "admin",
    "finance_admin",
})

# Roles that require admin provisioning (no public signup)
INTERNAL_ROLES = frozenset({
    "verification_agent",
    "buyer_agent",
    "admin",
    "finance_admin",
})

# Public roles (self-service signup)
PUBLIC_ROLES = frozenset({"buyer", "seller"})

# Minimum password length for a financial platform
MIN_PASSWORD_LENGTH = 12


# ── JWT Validation ────────────────────────────────────────────────────────────

def decode_supabase_jwt(token: str) -> dict[str, Any]:
    """
    Validates a Supabase-issued JWT.
    - ES256 tokens (current): verified using Supabase's public JWKS endpoint.
    - HS256 tokens (legacy):  verified using SUPABASE_JWT_SECRET.
    Returns the decoded payload on success.
    Raises HTTP 401 on any failure — never exposes internal error details.
    """
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "HS256":
            key = settings.SUPABASE_JWT_SECRET
            algorithms = ["HS256"]
        else:
            # Asymmetric (ES256): look up the matching public key by kid
            kid = header.get("kid")
            jwks = _get_jwks()
            matching = [k for k in jwks.get("keys", []) if k.get("kid") == kid]
            if not matching:
                logger.warning("No JWKS key found for kid=%s", kid)
                raise JWTError(f"No matching public key for kid={kid}")
            key = matching[0]
            algorithms = [alg]

        payload = jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience=JWT_AUDIENCE,
            options={"verify_exp": True},
        )
    except JWTError as e:
        logger.warning("JWT decode failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token: missing subject.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


def extract_token_from_header(authorization: str | None) -> str:
    """
    Extracts the Bearer token from the Authorization header.
    Raises HTTP 401 if header is missing or malformed.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be in 'Bearer <token>' format.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return parts[1]


# ── Password Policy ───────────────────────────────────────────────────────────

class PasswordValidationError(ValueError):
    pass


def validate_password_strength(password: str) -> None:
    """
    Enforces password policy for a high-value financial platform.
    Raises PasswordValidationError with a clear message on failure.
    """
    errors: list[str] = []

    if len(password) < MIN_PASSWORD_LENGTH:
        errors.append(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long.")

    if len(password) > 72:
        errors.append("Password must not exceed 72 characters.")

    if not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter.")

    if not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter.")

    if not re.search(r"\d", password):
        errors.append("Password must contain at least one digit.")

    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]", password):
        errors.append("Password must contain at least one special character.")

    if errors:
        raise PasswordValidationError(" ".join(errors))


# ── Phone Normalization ────────────────────────────────────────────────────────

def normalize_phone(phone: str) -> str:
    """Strip whitespace and common formatting characters from phone numbers."""
    return re.sub(r"[\s\-\(\)\.]+", "", phone.strip())


# ── Role Utilities ────────────────────────────────────────────────────────────

def validate_roles(roles: list[str]) -> None:
    """Ensure all provided roles are valid system roles."""
    invalid = set(roles) - VALID_ROLES
    if invalid:
        raise ValueError(f"Invalid roles: {', '.join(invalid)}")

    if not roles:
        raise ValueError("At least one role must be assigned.")
