"""
Seller authentication endpoints.

POST /auth/seller/signup         — public registration (company required)
POST /auth/seller-buyer/signup   — registration as both seller and buyer
POST /auth/seller/login          — login, validates seller role
POST /auth/seller/logout         — invalidate session
"""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, Request, status

from app.deps import CurrentUser, DbConn, get_db
from app.schemas.auth import (
    AuthTokenResponse,
    BuyerSellerSignupRequest,
    LoginRequest,
    MessageResponse,
    SellerSignupRequest,
)
from app.services.auth_service import (
    create_user_with_profile,
    login_user,
    logout_user,
)

router = APIRouter(tags=["Auth — Seller"])


@router.post(
    "/seller/signup",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register as a seller",
    description=(
        "Creates a seller account. "
        "Company name and registration number are required — "
        "sellers list high-value industrial assets on the platform."
    ),
)
async def seller_signup(
    payload: SellerSignupRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    await create_user_with_profile(
        db=db,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        company_name=payload.company_name,
        company_reg_no=payload.company_reg_no,
        phone=payload.phone,
        country=payload.country,
        roles=["seller"],
        request=request,
    )

    return MessageResponse(
        message="Seller account created successfully.",
        detail=(
            "Please check your email to verify your account. "
            "Once verified, you can start listing products for sale."
        ),
    )


@router.post(
    "/seller-buyer/signup",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register as both seller and buyer",
    description=(
        "For maritime companies that both sell and purchase assets. "
        "Creates account with roles=['seller', 'buyer']. "
        "Company details are required. "
        "Buyer capabilities require KYC verification after signup."
    ),
)
async def seller_buyer_signup(
    payload: BuyerSellerSignupRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    await create_user_with_profile(
        db=db,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        company_name=payload.company_name,
        company_reg_no=payload.company_reg_no,
        phone=payload.phone,
        country=payload.country,
        roles=["seller", "buyer"],
        request=request,
    )

    return MessageResponse(
        message="Account created successfully with seller and buyer access.",
        detail=(
            "Please verify your email to activate your account. "
            "Seller features are available immediately after verification. "
            "Buyer features (purchasing, bidding) require additional KYC verification."
        ),
    )


@router.post(
    "/seller/login",
    response_model=AuthTokenResponse,
    summary="Seller login",
    description="Authenticates a seller. Validates that the account has the 'seller' role.",
)
async def seller_login(
    payload: LoginRequest,
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
):
    return await login_user(
        db=db,
        email=payload.email,
        password=payload.password,
        required_role="seller",
        request=request,
    )


@router.post(
    "/seller/logout",
    response_model=MessageResponse,
    summary="Seller logout",
)
async def seller_logout(
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
