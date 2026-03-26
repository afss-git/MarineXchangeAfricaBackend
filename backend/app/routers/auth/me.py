"""
Authenticated user profile endpoints.

GET    /auth/me              — get current user profile
GET    /auth/me/roles        — get current user's roles
PATCH  /auth/me/profile      — update name, phone, company, country
PATCH  /auth/me/password     — change password (requires current password)
POST   /auth/me/avatar       — upload profile photo
"""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile

from app.deps import CurrentUser, DbConn
from app.schemas.auth import (
    ChangePasswordBody,
    UpdateProfileBody,
    UserProfileResponse,
)
from app.services.auth_service import build_profile_response
from app.services import profile_service

router = APIRouter(tags=["Auth — Profile"])


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Get current user profile",
)
async def get_me(current_user: CurrentUser):
    return build_profile_response(current_user)


@router.get(
    "/me/roles",
    summary="Get current user's roles",
)
async def get_my_roles(current_user: CurrentUser) -> dict:
    return {
        "user_id": str(current_user["id"]),
        "roles": current_user["roles"],
        "is_buyer": "buyer" in current_user["roles"],
        "is_seller": "seller" in current_user["roles"],
        "is_agent": any(
            r in current_user["roles"]
            for r in ("verification_agent", "buyer_agent")
        ),
        "is_admin": "admin" in current_user["roles"],
        "is_finance_admin": "finance_admin" in current_user["roles"],
        "kyc_status": current_user.get("kyc_status"),
    }


@router.patch(
    "/me/profile",
    response_model=UserProfileResponse,
    summary="Update your profile (name, phone, company, country)",
)
async def update_profile(
    body: UpdateProfileBody,
    db: DbConn,
    current_user: CurrentUser,
):
    return await profile_service.update_profile(db, current_user, body)


@router.patch(
    "/me/password",
    summary="Change your password",
)
async def change_password(
    body: ChangePasswordBody,
    db: DbConn,
    current_user: CurrentUser,
) -> dict:
    return await profile_service.change_password(db, current_user, body)


@router.post(
    "/me/avatar",
    response_model=UserProfileResponse,
    summary="Upload a profile avatar (JPEG, PNG, or WebP — max 5 MB)",
)
async def upload_avatar(
    db: DbConn,
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    return await profile_service.upload_avatar(db, current_user, file)
