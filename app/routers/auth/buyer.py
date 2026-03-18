"""
Buyer authentication endpoints.

POST /auth/buyer/signup   — public registration
POST /auth/buyer/login    — login, validates buyer role
POST /auth/buyer/logout   — invalidate session
POST /auth/buyer/add-seller-role — add seller capabilities to existing buyer
"""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from supabase import AClient

from app.core.audit import AuditAction, write_audit_log
from app.deps import CurrentUser, DbConn, get_db
from app.schemas.auth import (
    AddSellerRoleRequest,
    AuthTokenResponse,
    BuyerSignupRequest,
    LoginRequest,
    MessageResponse,
    UserProfileResponse,
)
from app.services.auth_service import (
    build_profile_response,
    create_user_with_profile,
    login_user,
    logout_user,
)

router = APIRouter(prefix="/buyer", tags=["Auth — Buyer"])


@router.post(
    "/signup",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register as a buyer",
    description=(
        "Creates a new buyer account. "
        "Email confirmation is required before login. "
        "KYC verification is required before submitting purchase requests or bidding."
    ),
)
async def buyer_signup(
    payload: BuyerSignupRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    await create_user_with_profile(
        db=db,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        company_name=payload.company_name,
        company_reg_no=None,
        phone=payload.phone,
        country=payload.country,
        roles=["buyer"],
        request=request,
    )

    return MessageResponse(
        message="Account created successfully.",
        detail=(
            "Please check your email to verify your account. "
            "After verification, complete KYC to start transacting."
        ),
    )


@router.post(
    "/login",
    response_model=AuthTokenResponse,
    summary="Buyer login",
    description="Authenticates a buyer. Validates that the account has the 'buyer' role.",
)
async def buyer_login(
    payload: LoginRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    return await login_user(
        db=db,
        email=payload.email,
        password=payload.password,
        required_role="buyer",
        request=request,
    )


@router.post(
    "/logout",
    response_model=MessageResponse,
    summary="Buyer logout",
    description="Invalidates the current session token.",
)
async def buyer_logout(
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


@router.post(
    "/add-seller-role",
    response_model=UserProfileResponse,
    summary="Add seller role to buyer account",
    description=(
        "Allows a registered buyer to also become a seller. "
        "Company details are required for the seller role. "
        "This supports maritime companies that both buy and sell assets."
    ),
)
async def add_seller_role(
    payload: AddSellerRoleRequest,
    current_user: CurrentUser,
    request: Request,
    db: DbConn,
):
    user_id = UUID(str(current_user["id"]))

    # Check buyer role
    if "buyer" not in current_user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only available to buyer accounts.",
        )

    # Check not already a seller
    if "seller" in current_user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your account already has the seller role.",
        )

    async with db.transaction():
        old_roles = list(current_user["roles"])
        new_roles = old_roles + ["seller"]

        await db.execute(
            """
            UPDATE public.profiles
            SET
                roles = $1,
                company_name = COALESCE($2, company_name),
                company_reg_no = COALESCE($3, company_reg_no),
                updated_at = NOW()
            WHERE id = $4
            """,
            new_roles,
            payload.company_name,
            payload.company_reg_no,
            user_id,
        )

        await db.execute(
            """
            INSERT INTO audit.role_changes (user_id, old_roles, new_roles, changed_by, reason)
            VALUES ($1, $2, $3, $4, $5)
            """,
            user_id,
            old_roles,
            new_roles,
            user_id,
            "buyer_added_seller_role_self_service",
        )

        await write_audit_log(
            db,
            actor_id=user_id,
            actor_roles=current_user["roles"],
            action=AuditAction.AUTH_ROLE_ADDED,
            resource_type="profile",
            resource_id=str(user_id),
            old_state={"roles": old_roles},
            new_state={"roles": new_roles},
            metadata={
                "ip": current_user["_client_ip"],
                "user_agent": current_user["_user_agent"],
            },
        )

    updated_profile = await db.fetchrow(
        """
        SELECT p.*, u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1
        """,
        user_id,
    )

    return build_profile_response(updated_profile)
