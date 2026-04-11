"""
Internal / staff authentication endpoints.
These are NOT publicly advertised — accessed only by internal teams.

POST /auth/internal/bootstrap           — one-time first-admin bootstrap (secret-gated)
POST /auth/admin/login                  — admin login
POST /auth/admin/logout                 — admin logout
POST /auth/finance-admin/login          — finance admin login
POST /auth/finance-admin/logout         — finance admin logout
POST /auth/internal/create-agent        — admin creates agent accounts
POST /auth/internal/create-admin        — admin creates admin/finance-admin accounts
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.deps import AdminUser, CurrentUser, DbConn, get_db, require_roles
from app.schemas.auth import (
    AuthTokenResponse,
    BootstrapAdminRequest,
    CreateAdminRequest,
    CreateAgentRequest,
    CreateStaffResponse,
    LoginRequest,
    MessageResponse,
    UserProfileResponse,
)
from app.services.auth_service import (
    build_profile_response,
    create_first_admin,
    create_internal_user,
    login_user,
    logout_user,
)

router = APIRouter(tags=["Auth — Internal"])


# ── Bootstrap (one-time, secret-gated) ───────────────────────────────────────

@router.post(
    "/internal/bootstrap",
    response_model=UserProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Bootstrap first admin account [One-time use]",
    description=(
        "Creates the very first admin account when no admin exists in the system.\n\n"
        "**Security gates (all three must pass):**\n"
        "1. `ADMIN_BOOTSTRAP_SECRET` must be set in server `.env`\n"
        "2. `X-Bootstrap-Secret` header must match that secret (constant-time compare)\n"
        "3. Zero admin profiles must exist in the database\n\n"
        "**Procedure:**\n"
        "1. Generate a long random secret: `openssl rand -hex 32`\n"
        "2. Add `ADMIN_BOOTSTRAP_SECRET=<secret>` to `.env` and restart the server\n"
        "3. Call this endpoint once with the secret in the header\n"
        "4. Remove `ADMIN_BOOTSTRAP_SECRET` from `.env` and restart — endpoint is now permanently locked\n\n"
        "The endpoint is disabled (returns 404) when `ADMIN_BOOTSTRAP_SECRET` is empty."
    ),
)
async def bootstrap_first_admin(
    payload: BootstrapAdminRequest,
    request: Request,
    db: DbConn,
    x_bootstrap_secret: Annotated[str | None, Header()] = None,
):
    # Gate 1: secret must be configured on the server — if not set, behave as 404
    # (don't reveal whether the endpoint exists but is locked)
    if not settings.ADMIN_BOOTSTRAP_SECRET:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found.",
        )

    # Gate 2: constant-time comparison — prevents timing-based secret enumeration
    provided = x_bootstrap_secret or ""
    if not secrets.compare_digest(provided, settings.ADMIN_BOOTSTRAP_SECRET):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid bootstrap secret.",
        )

    # Gate 3: permanently self-lock once any admin exists
    existing_admin_count = await db.fetchval(
        "SELECT COUNT(*) FROM public.profiles WHERE 'admin' = ANY(roles)"
    )
    if existing_admin_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Bootstrap is disabled. An admin account already exists. "
                "Use POST /auth/internal/create-admin to add more admins."
            ),
        )

    profile = await create_first_admin(
        db=db,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        phone=payload.phone,
        country=payload.country,
        request=request,
    )

    # We don't have the email field on the profile row — fetch it
    email_row = await db.fetchval(
        "SELECT email FROM auth.users WHERE id = $1", profile["id"]
    )

    return build_profile_response({**profile, "email": email_row or payload.email})


# ── Admin Login / Logout ──────────────────────────────────────────────────────

@router.post(
    "/admin/login",
    response_model=AuthTokenResponse,
    summary="Admin login",
    description=(
        "Authenticates a platform admin. "
        "Validates 'admin' role. "
        "Admin sessions have stricter rate limiting applied at the Cloudflare layer."
    ),
)
async def admin_login(
    payload: LoginRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    return await login_user(
        db=db,
        email=payload.email,
        password=payload.password,
        required_role="admin",
        request=request,
    )


@router.post("/admin/logout", response_model=MessageResponse, summary="Admin logout")
async def admin_logout(
    current_user: CurrentUser,
    request: Request,
    db: DbConn,
):
    await logout_user(
        db=db,
        token=current_user["_raw_token"],
        user=current_user,
        request=request,
    )
    return MessageResponse(message="Logged out successfully.")


# ── Finance Admin Login / Logout ──────────────────────────────────────────────

@router.post(
    "/finance-admin/login",
    response_model=AuthTokenResponse,
    summary="Finance Admin login",
)
async def finance_admin_login(
    payload: LoginRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    return await login_user(
        db=db,
        email=payload.email,
        password=payload.password,
        required_role="finance_admin",
        request=request,
    )


@router.post("/finance-admin/logout", response_model=MessageResponse, summary="Finance Admin logout")
async def finance_admin_logout(
    current_user: CurrentUser,
    request: Request,
    db: DbConn,
):
    await logout_user(
        db=db,
        token=current_user["_raw_token"],
        user=current_user,
        request=request,
    )
    return MessageResponse(message="Logged out successfully.")


# ── Agent Login / Logout ──────────────────────────────────────────────────────

@router.post(
    "/agent/login",
    response_model=AuthTokenResponse,
    summary="Agent login (verification_agent or buyer_agent)",
)
async def agent_login(
    payload: LoginRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    # Agents can be verification_agent OR buyer_agent
    # We accept either — the profile will carry the specific role
    return await login_user(
        db=db,
        email=payload.email,
        password=payload.password,
        required_role=None,                 # role check done after — see auth_service
        required_role_any=["verification_agent", "buyer_agent"],
        request=request,
    )


@router.post("/agent/logout", response_model=MessageResponse, summary="Agent logout")
async def agent_logout(
    current_user: CurrentUser,
    request: Request,
    db: DbConn,
):
    await logout_user(
        db=db,
        token=current_user["_raw_token"],
        user=current_user,
        request=request,
    )
    return MessageResponse(message="Logged out successfully.")


# ── Internal User Creation (Admin Only) ───────────────────────────────────────

@router.post(
    "/internal/create-agent",
    response_model=CreateStaffResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create agent account [Admin only]",
    description=(
        "Creates a verification_agent or buyer_agent account. "
        "Returns the profile and a one-time invite link for the staff member to set their password."
    ),
)
async def create_agent(
    payload: CreateAgentRequest,
    current_user: AdminUser,
    request: Request,
    db: DbConn,
):
    profile, invite_link, email_sent = await create_internal_user(
        db=db,
        email=payload.email,
        full_name=payload.full_name,
        company_name=None,
        company_reg_no=None,
        phone=payload.phone,
        country=payload.country,
        roles=[payload.agent_type],
        created_by=UUID(str(current_user["id"])),
        invited_by_name=current_user.get("full_name") or "Harbours360 Admin",
        request=request,
    )

    await write_audit_log(
        db,
        actor_id=current_user["id"],
        actor_roles=current_user["roles"],
        action=AuditAction.AUTH_SIGNUP,
        resource_type="profile",
        resource_id=str(profile["id"]),
        new_state={"roles": [payload.agent_type], "email": payload.email},
        metadata={
            "created_by": str(current_user["id"]),
            "ip": current_user["_client_ip"],
            "invite_email_sent": email_sent,
        },
    )

    return CreateStaffResponse(profile=build_profile_response(profile), invite_link=invite_link, email_sent=email_sent)


@router.post(
    "/internal/create-admin",
    response_model=CreateStaffResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create admin or finance_admin account [Admin only]",
    description=(
        "Creates an admin or finance_admin account. "
        "Returns the profile and a one-time invite link for the staff member to set their password."
    ),
)
async def create_admin_user(
    payload: CreateAdminRequest,
    current_user: AdminUser,
    request: Request,
    db: DbConn,
):
    profile, invite_link, email_sent = await create_internal_user(
        db=db,
        email=payload.email,
        full_name=payload.full_name,
        company_name=None,
        company_reg_no=None,
        phone=payload.phone,
        country=payload.country,
        roles=[payload.role],
        created_by=UUID(str(current_user["id"])),
        invited_by_name=current_user.get("full_name") or "Harbours360 Admin",
        request=request,
    )

    await write_audit_log(
        db,
        actor_id=current_user["id"],
        actor_roles=current_user["roles"],
        action=AuditAction.AUTH_SIGNUP,
        resource_type="profile",
        resource_id=str(profile["id"]),
        new_state={"roles": [payload.role], "email": payload.email},
        metadata={
            "created_by": str(current_user["id"]),
            "ip": current_user["_client_ip"],
            "internal_account": True,
            "invite_email_sent": email_sent,
        },
    )

    return CreateStaffResponse(profile=build_profile_response(profile), invite_link=invite_link, email_sent=email_sent)


