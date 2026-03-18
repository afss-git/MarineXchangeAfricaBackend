"""
Phase 9 — Buyer Payment Router.

Prefix: /payments/buyer  (mounted under /api/v1)

Endpoints:
  GET    /deals/{deal_id}/schedule           — view schedule for buyer's own deal
  GET    /deals/{deal_id}/payments           — list buyer's own payment records
  POST   /deals/{deal_id}/items/{item_id}/pay — submit payment record for an installment
  POST   /records/{record_id}/evidence       — upload evidence file for a payment record
  GET    /deals/{deal_id}/summary            — buyer's payment summary
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, File, UploadFile

from app.deps import BuyerUser, DbConn
from app.schemas.payments import (
    DealPaymentSummary,
    EvidenceOut,
    PaymentRecordOut,
    PaymentScheduleOut,
    SubmitPaymentRecord,
)
from app.services import payment_service

router = APIRouter(tags=["Payments — Buyer"])


@router.get(
    "/deals/{deal_id}/schedule",
    response_model=PaymentScheduleOut,
    summary="View payment schedule for your deal",
)
async def get_my_schedule(
    deal_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
):
    return await payment_service.buyer_get_schedule(db, deal_id, current_user["id"])


@router.get(
    "/deals/{deal_id}/payments",
    response_model=list[PaymentRecordOut],
    summary="List your payment records for a deal",
)
async def list_my_payments(
    deal_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
):
    return await payment_service.buyer_list_records(db, deal_id, current_user["id"])


@router.post(
    "/deals/{deal_id}/items/{item_id}/pay",
    response_model=PaymentRecordOut,
    status_code=201,
    summary="Submit payment record for a schedule installment",
)
async def submit_payment(
    deal_id: UUID,
    item_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
    body: SubmitPaymentRecord,
):
    return await payment_service.buyer_submit_payment(db, deal_id, item_id, body, current_user)


@router.post(
    "/records/{record_id}/evidence",
    response_model=EvidenceOut,
    status_code=201,
    summary="Upload evidence file (receipt, bank slip, etc.) for a payment record",
)
async def upload_evidence(
    record_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
    deal_id: UUID,
    file: UploadFile = File(...),
):
    return await payment_service.buyer_upload_evidence(
        db, deal_id, record_id, file, current_user
    )


@router.get(
    "/deals/{deal_id}/summary",
    response_model=DealPaymentSummary,
    summary="Get payment summary for your deal",
)
async def get_my_summary(
    deal_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
):
    # Verify ownership before returning summary
    await payment_service.buyer_get_schedule(db, deal_id, current_user["id"])
    return await payment_service.get_deal_payment_summary(db, deal_id)
