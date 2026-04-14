"""
FastAPI dependency injection.
All authenticated routes use these dependencies to get the current user.

Token resolution order:
  1. Authorization: Bearer <token> header  — API clients, mobile apps
  2. access_token HttpOnly cookie          — web frontend (cookie-auth mode)

This dual approach ensures backward compatibility during the localStorage → cookie
migration. Once the frontend is fully migrated, the header fallback can be kept for
future API integrations (it does not weaken security when cookies are in use).
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

    Token resolution: Authorization header → access_token cookie.
    """
    # Prefer Authorization header (API clients); fall back to HttpOnly cookie (web)
    if authorization:
        token = extract_token_from_header(authorization)
    elif cookie_token := request.cookies.get("access_token"):
        token = cookie_token
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
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
            p.kyc_expires_at,
            p.kyc_attempt_count,
            p.current_kyc_submission_id,
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
    Dependency that ensures the user is a buyer with an active (approved, non-expired) KYC.
    Use on purchase, bid, and finance endpoints.

    Checks:
      1. User has 'buyer' role (403 if not)
      2. kyc_status == 'approved'
      3. kyc_expires_at is NULL (never expires until set) OR > NOW()
    """
    from datetime import datetime, timezone

    async def _check(current_user: dict = Depends(require_roles("buyer"))) -> dict:
        if "buyer" in current_user.get("roles", []):
            kyc_status = current_user.get("kyc_status")
            kyc_expires_at = current_user.get("kyc_expires_at")

            if kyc_status != "approved":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "KYC verification required. "
                        "Please complete your identity verification before proceeding."
                    ),
                )

            if kyc_expires_at is not None:
                now = datetime.now(timezone.utc)
                if isinstance(kyc_expires_at, datetime) and kyc_expires_at < now:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=(
                            "Your KYC approval has expired. "
                            "Please submit updated documents for re-verification."
                        ),
                    )

        return current_user

    return _check


# ── Typed aliases for common dependencies ─────────────────────────────────────
# These make route signatures cleaner and self-documenting.

CurrentUser      = Annotated[dict, Depends(get_current_user)]
AdminUser        = Annotated[dict, Depends(require_roles("admin"))]
FinanceUser      = Annotated[dict, Depends(require_roles("finance_admin"))]
AnyAdmin         = Annotated[dict, Depends(require_roles("admin", "finance_admin"))]
VerAgent         = Annotated[dict, Depends(require_roles("verification_agent"))]
BuyerAgent       = Annotated[dict, Depends(require_roles("buyer_agent"))]
SellerUser       = Annotated[dict, Depends(require_roles("seller"))]
BuyerUser        = Annotated[dict, Depends(require_roles("buyer"))]              # buyer, no KYC gate
KycAgentOrAdmin  = Annotated[dict, Depends(require_roles("buyer_agent", "admin"))]
VerAgentOrAdmin  = Annotated[dict, Depends(require_roles("verification_agent", "admin"))]
KycBuyer         = Annotated[dict, Depends(require_kyc())]                       # buyer with approved KYC
DbConn           = Annotated[asyncpg.Connection, Depends(get_db)]
