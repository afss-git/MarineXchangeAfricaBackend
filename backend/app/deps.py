"""
FastAPI dependency injection.
All authenticated routes use these dependencies to get the current user.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import Depends, Header, HTTPException, Request, status

from app.core.security import decode_supabase_jwt, extract_token_from_header
from app.db.client import get_db


async def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    db: asyncpg.Connection = Depends(get_db),
) -> dict:
    """
    Core authentication dependency.
    Validates the Supabase JWT, loads the user profile from DB.
    Raises HTTP 401 if token is invalid, HTTP 403 if account is inactive.

    Attach to any route that requires authentication:
        current_user: dict = Depends(get_current_user)
    """
    token = extract_token_from_header(authorization)
    payload = decode_supabase_jwt(token)
    user_id: str = payload["sub"]

    profile = await db.fetchrow(
        """
        SELECT
            p.id,
            p.full_name,
            p.company_name,
            p.company_reg_no,
            p.phone,
            p.country,
            p.roles,
            p.kyc_status,
            p.is_active,
            p.created_at,
            u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1
        """,
        UUID(user_id),
    )

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User profile not found. Please contact support.",
        )

    if not profile["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated. Please contact support.",
        )

    # Attach IP and user-agent from middleware (for audit logs)
    return {
        **dict(profile),
        "_client_ip": getattr(request.state, "client_ip", "unknown"),
        "_user_agent": getattr(request.state, "user_agent", ""),
        "_raw_token": token,
    }


async def get_current_user_optional(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    db: asyncpg.Connection = Depends(get_db),
) -> dict | None:
    """
    Optional authentication dependency — returns None if no token provided.
    Use for public endpoints that have enhanced behavior for authenticated users.
    """
    if not authorization:
        return None
    try:
        return await get_current_user(request, authorization, db)
    except HTTPException:
        return None


def require_roles(*roles: str):
    """
    Dependency factory that checks the current user has at least one of the given roles.
    Multi-role users pass if ANY of their roles is in the allowed list.

    Usage:
        @router.get("/admin/products")
        async def list_all(user = Depends(require_roles("admin", "finance_admin"))):
            ...
    """
    async def _check(current_user: dict = Depends(get_current_user)) -> dict:
        user_roles: list[str] = current_user.get("roles", [])
        if not any(r in roles for r in user_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return current_user

    return _check


def require_kyc():
    """
    Dependency that ensures the user is a KYC-verified buyer.
    Use on purchase, bid, and finance endpoints.
    """
    async def _check(current_user: dict = Depends(get_current_user)) -> dict:
        if "buyer" in current_user.get("roles", []):
            if current_user.get("kyc_status") != "verified":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "KYC verification required. "
                        "Please complete your identity verification before proceeding."
                    ),
                )
        return current_user

    return _check


# ── Typed aliases for common dependencies ─────────────────────────────────────
# These make route signatures cleaner and self-documenting.

CurrentUser = Annotated[dict, Depends(get_current_user)]
AdminUser   = Annotated[dict, Depends(require_roles("admin"))]
FinanceUser = Annotated[dict, Depends(require_roles("finance_admin"))]
AnyAdmin    = Annotated[dict, Depends(require_roles("admin", "finance_admin"))]
VerAgent    = Annotated[dict, Depends(require_roles("verification_agent"))]
BuyerAgent  = Annotated[dict, Depends(require_roles("buyer_agent"))]
KycBuyer    = Annotated[dict, Depends(require_kyc())]
DbConn      = Annotated[asyncpg.Connection, Depends(get_db)]
