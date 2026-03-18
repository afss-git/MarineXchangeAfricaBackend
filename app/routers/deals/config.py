"""
Phase 5 — Deal configuration endpoints.

GET    /deals/payment-accounts                    — list payment accounts
POST   /deals/payment-accounts                    — create payment account
PATCH  /deals/payment-accounts/{id}               — update payment account
DELETE /deals/payment-accounts/{id}               — deactivate (soft delete)

GET    /deals/rate-schedules                       — list rate schedules
POST   /deals/rate-schedules                       — create rate schedule
PATCH  /deals/rate-schedules/{id}                  — update rate schedule

GET    /deals/buyers/{buyer_id}/credit-profile     — get buyer credit profile
PUT    /deals/buyers/{buyer_id}/credit-profile     — set buyer credit profile
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, status

from app.deps import AdminUser, AnyAdmin, DbConn
from app.schemas.deals import (
    BuyerCreditProfileResponse,
    BuyerCreditProfileSet,
    PaymentAccountCreate,
    PaymentAccountResponse,
    PaymentAccountUpdate,
    RateScheduleCreate,
    RateScheduleResponse,
    RateScheduleUpdate,
)
from app.services import deal_service

router = APIRouter(tags=["Deals — Configuration"])


# ── Payment Accounts ──────────────────────────────────────────────────────────

@router.get(
    "/payment-accounts",
    response_model=list[PaymentAccountResponse],
    summary="List payment accounts",
)
async def list_payment_accounts(
    db: DbConn,
    current_user: AnyAdmin,
    include_inactive: bool = False,
):
    return await deal_service.list_payment_accounts(db, include_inactive)


@router.post(
    "/payment-accounts",
    response_model=PaymentAccountResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a payment account",
)
async def create_payment_account(
    db: DbConn,
    current_user: AdminUser,
    payload: PaymentAccountCreate,
):
    return await deal_service.create_payment_account(db, payload, current_user)


@router.patch(
    "/payment-accounts/{account_id}",
    response_model=PaymentAccountResponse,
    summary="Update a payment account",
)
async def update_payment_account(
    account_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    payload: PaymentAccountUpdate,
):
    return await deal_service.update_payment_account(db, account_id, payload, current_user)


@router.delete(
    "/payment-accounts/{account_id}",
    response_model=PaymentAccountResponse,
    summary="Deactivate a payment account (soft delete)",
)
async def deactivate_payment_account(
    account_id: UUID,
    db: DbConn,
    current_user: AdminUser,
):
    return await deal_service.deactivate_payment_account(db, account_id, current_user)


# ── Rate Schedules ────────────────────────────────────────────────────────────

@router.get(
    "/rate-schedules",
    response_model=list[RateScheduleResponse],
    summary="List rate schedules",
)
async def list_rate_schedules(
    db: DbConn,
    current_user: AnyAdmin,
    include_inactive: bool = False,
):
    return await deal_service.list_rate_schedules(db, include_inactive)


@router.post(
    "/rate-schedules",
    response_model=RateScheduleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a rate schedule",
)
async def create_rate_schedule(
    db: DbConn,
    current_user: AdminUser,
    payload: RateScheduleCreate,
):
    return await deal_service.create_rate_schedule(db, payload, current_user)


@router.patch(
    "/rate-schedules/{schedule_id}",
    response_model=RateScheduleResponse,
    summary="Update a rate schedule",
)
async def update_rate_schedule(
    schedule_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    payload: RateScheduleUpdate,
):
    return await deal_service.update_rate_schedule(db, schedule_id, payload, current_user)


# ── Buyer Credit Profiles ─────────────────────────────────────────────────────

@router.get(
    "/buyers/{buyer_id}/credit-profile",
    response_model=BuyerCreditProfileResponse,
    summary="Get buyer credit profile",
)
async def get_buyer_credit_profile(
    buyer_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
):
    profile = await deal_service.get_buyer_credit_profile(db, buyer_id)
    if not profile:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Credit profile not found for this buyer.")
    return profile


@router.put(
    "/buyers/{buyer_id}/credit-profile",
    response_model=BuyerCreditProfileResponse,
    summary="Set buyer credit profile (upsert)",
)
async def set_buyer_credit_profile(
    buyer_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
    payload: BuyerCreditProfileSet,
):
    return await deal_service.set_buyer_credit_profile(db, buyer_id, payload, current_user)
