"""
JWT validation and password policy enforcement.
All token validation uses the Supabase JWT secret — tokens are issued by Supabase Auth.
"""
from __future__ import annotations

import re
from typing import Any

from jose import JWTError, jwt
from fastapi import HTTPException, status

from app.config import settings

# ── Constants ─────────────────────────────────────────────────────────────────

ALGORITHM = "HS256"
JWT_AUDIENCE = "authenticated"

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
    Returns the decoded payload on success.
    Raises HTTP 401 on any failure — never exposes internal error details.
    """
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=[ALGORITHM],
            audience=JWT_AUDIENCE,
            options={"verify_exp": True},
        )
    except JWTError:
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
