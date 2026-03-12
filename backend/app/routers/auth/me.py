"""
Authenticated user profile endpoints.

GET  /auth/me          — get current user profile
GET  /auth/me/roles    — get current user's roles
"""
from __future__ import annotations

from fastapi import APIRouter

from app.deps import CurrentUser
from app.schemas.auth import UserProfileResponse
from app.services.auth_service import build_profile_response

router = APIRouter(tags=["Auth — Profile"])


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Get current user profile",
    description=(
        "Returns the authenticated user's profile including roles, KYC status, "
        "and account details. Works for all role types."
    ),
)
async def get_me(current_user: CurrentUser):
    return build_profile_response(current_user)


@router.get(
    "/me/roles",
    summary="Get current user's roles",
    description="Returns a list of roles assigned to the current user.",
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
