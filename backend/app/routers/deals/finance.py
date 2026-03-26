"""
Phase 5 — Finance Admin deal endpoints.

GET    /deals/payments                               — list all pending-verification payments
POST   /deals/{deal_id}/payments/{payment_id}/verify — verify or dispute a recorded payment
POST   /deals/{deal_id}/installments/{n}/waive       — waive an installment
POST   /deals/{deal_id}/mark-defaulted               — mark financing deal as defaulted
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, status

from app.deps import AnyAdmin, DbConn, FinanceUser
from app.schemas.deals import (
    DealPaymentResponse,
    DealResponse,
    InstallmentResponse,
    VerifyPaymentRequest,
)
from app.services import deal_service

router = APIRouter(tags=["Deals — Finance Admin"])


@router.get(
    "/payments",
    response_model=list[DealPaymentResponse],
    summary="List all payments pending verification",
)
async def list_pending_payments(
    db: DbConn,
    current_user: AnyAdmin,
):
    return await deal_service.list_pending_payments(db)


@router.post(
    "/{deal_id}/payments/{payment_id}/verify",
    response_model=DealPaymentResponse,
    summary="Verify or dispute a recorded payment",
)
async def verify_payment(
    deal_id: UUID,
    payment_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
    payload: VerifyPaymentRequest,
):
    return await deal_service.verify_payment(db, deal_id, payment_id, payload, current_user)


@router.post(
    "/{deal_id}/installments/{installment_number}/waive",
    response_model=InstallmentResponse,
    summary="Waive an installment",
)
async def waive_installment(
    deal_id: UUID,
    installment_number: int,
    db: DbConn,
    current_user: AnyAdmin,
    reason: str = Body(..., embed=True),
):
    return await deal_service.waive_installment(db, deal_id, installment_number, reason, current_user)


@router.post(
    "/{deal_id}/mark-defaulted",
    response_model=DealResponse,
    summary="Mark a financing deal as defaulted",
)
async def mark_deal_defaulted(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
    reason: str = Body(..., embed=True),
):
    return await deal_service.mark_deal_defaulted(db, deal_id, reason, current_user)
