"""
Authenticated user profile endpoints.

GET    /auth/me              — get current user profile
GET    /auth/me/roles        — get current user's roles
PATCH  /auth/me/profile      — update name, phone, company, country
PATCH  /auth/me/password     — change password (requires current password)
POST   /auth/me/set-password — set password via invite link (no current password)
POST   /auth/me/avatar       — upload profile photo
POST   /auth/refresh         — exchange refresh_token for new access_token
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Cookie, File, HTTPException, Response, UploadFile, status
from typing import Annotated

logger = logging.getLogger(__name__)

from app.core.cookies import set_auth_cookies
from app.deps import CurrentUser, DbConn
from app.schemas.auth import (
    AuthTokenResponse,
    ChangePasswordBody,
    SetPasswordBody,
    UpdateProfileBody,
    UserProfileResponse,
)
from app.services.auth_service import (
    build_profile_response,
    get_supabase_admin_client,
    get_supabase_client,
)
from app.services import profile_service

router = APIRouter(tags=["Auth — Profile"])


@router.post(
    "/refresh",
    response_model=AuthTokenResponse,
    summary="Refresh access token",
    description=(
        "Exchange a valid refresh_token for a new access_token + refresh_token pair.\n\n"
        "Token source: `refresh_token` HttpOnly cookie (set automatically by login).\n\n"
        "On success, new HttpOnly cookies are set (old refresh token is rotated out)."
    ),
)
async def refresh_token(
    response: Response,
    db: DbConn,
    refresh_token_cookie: Annotated[str | None, Cookie(alias="refresh_token")] = None,
) -> AuthTokenResponse:
    from uuid import UUID

    token = refresh_token_cookie
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is required. Please log in again.",
        )

    supabase = await get_supabase_client()
    try:
        resp = await supabase.auth.refresh_session(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is invalid or expired. Please log in again.",
        )

    session = resp.session
    if not session or not session.access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is invalid or expired. Please log in again.",
        )

    user_id = session.user.id
    profile = await db.fetchrow(
        """
        SELECT p.*, u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1
        """,
        UUID(str(user_id)),
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")

    expires_in = session.expires_in or 3600
    result = AuthTokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        token_type="bearer",
        expires_in=expires_in,
        user=build_profile_response({**dict(profile), "email": session.user.email}),
    )
    # Rotate cookies — old refresh token is now invalid
    set_auth_cookies(response, session.access_token, session.refresh_token, expires_in)
    return result


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


@router.post(
    "/me/set-password",
    summary="Set password via invite link",
    description=(
        "Used by staff accounts on first login. The invite access token is sent as "
        "Bearer — no current password is required. Clears the requires_password_change flag."
    ),
)
async def set_password(
    body: SetPasswordBody,
    current_user: CurrentUser,
) -> dict:
    from uuid import UUID
    admin_client = await get_supabase_admin_client()
    try:
        await admin_client.auth.admin.update_user_by_id(
            str(current_user["id"]),
            {"password": body.new_password, "user_metadata": {"requires_password_change": False}},
        )
    except Exception as exc:
        logger.error("Failed to set password for user %s: %s", current_user["id"], exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to set password. Please try again or contact support.",
        )
    return {"message": "Password set successfully. You can now log in with your new password."}


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
