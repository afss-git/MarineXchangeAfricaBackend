"""
Internal / staff authentication endpoints.
These are NOT publicly advertised — accessed only by internal teams.

POST /auth/admin/login          — admin login
POST /auth/admin/logout         — admin logout
POST /auth/finance-admin/login  — finance admin login
POST /auth/finance-admin/logout — finance admin logout

POST /auth/internal/create-agent        — admin creates agent accounts
POST /auth/internal/create-admin        — admin creates admin/finance-admin accounts
"""
from __future__ import annotations

import secrets
import string
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.audit import AuditAction, write_audit_log
from app.deps import AdminUser, CurrentUser, DbConn, get_db, require_roles
from app.schemas.auth import (
    AuthTokenResponse,
    CreateAdminRequest,
    CreateAgentRequest,
    LoginRequest,
    MessageResponse,
    UserProfileResponse,
)
from app.services.auth_service import (
    build_profile_response,
    create_internal_user,
    login_user,
    logout_user,
)

router = APIRouter(tags=["Auth — Internal"])


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
    response_model=UserProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create agent account [Admin only]",
    description=(
        "Creates a verification_agent or buyer_agent account. "
        "A temporary password is generated and sent to the agent's email. "
        "Agent must change password on first login."
    ),
)
async def create_agent(
    payload: CreateAgentRequest,
    current_user: AdminUser,
    request: Request,
    db: DbConn,
):
    temp_password = _generate_temp_password()

    profile = await create_internal_user(
        db=db,
        email=payload.email,
        temp_password=temp_password,
        full_name=payload.full_name,
        company_name=None,
        company_reg_no=None,
        phone=payload.phone,
        country=payload.country,
        roles=[payload.agent_type],
        created_by=UUID(str(current_user["id"])),
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
        },
    )

    return build_profile_response(profile)


@router.post(
    "/internal/create-admin",
    response_model=UserProfileResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create admin or finance_admin account [Admin only]",
    description=(
        "Creates an admin or finance_admin account. "
        "Only existing admins can create new admin accounts. "
        "This action is fully audited."
    ),
)
async def create_admin_user(
    payload: CreateAdminRequest,
    current_user: AdminUser,
    request: Request,
    db: DbConn,
):
    temp_password = _generate_temp_password()

    profile = await create_internal_user(
        db=db,
        email=payload.email,
        temp_password=temp_password,
        full_name=payload.full_name,
        company_name=None,
        company_reg_no=None,
        phone=payload.phone,
        country=payload.country,
        roles=[payload.role],
        created_by=UUID(str(current_user["id"])),
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
        },
    )

    return build_profile_response(profile)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _generate_temp_password(length: int = 20) -> str:
    """
    Generates a cryptographically secure temporary password.
    Satisfies the platform's password policy (upper, lower, digit, special).
    """
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        # Ensure policy compliance
        if (
            any(c.isupper() for c in pwd)
            and any(c.islower() for c in pwd)
            and any(c.isdigit() for c in pwd)
            and any(c in "!@#$%^&*()" for c in pwd)
        ):
            return pwd
