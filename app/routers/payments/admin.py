"""
Phase 9 — Admin Payment Lifecycle Router.

Prefix: /payments/admin  (mounted under /api/v1)

Endpoints:
  POST   /deals/{deal_id}/schedule          — create payment schedule (auto or manual)
  GET    /deals/{deal_id}/schedule          — get schedule with all items
  DELETE /deals/{deal_id}/schedule          — delete schedule (only if no verified payments)
  GET    /deals/{deal_id}/payments          — list all payment records for a deal
  GET    /deals/{deal_id}/payments/{item_id} — list records for a specific schedule item
  POST   /payments/{record_id}/verify       — verify a payment record
  POST   /payments/{record_id}/reject       — reject a payment record
  POST   /schedule-items/{item_id}/waive    — waive a schedule item
  GET    /deals/{deal_id}/summary           — deal payment summary
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from app.deps import AdminUser, AnyAdmin, DbConn
from app.schemas.payments import (
    CreateScheduleAuto,
    CreateScheduleManual,
    DealPaymentSummary,
    PaymentRecordOut,
    PaymentScheduleOut,
    RejectPaymentBody,
    ScheduleItemOut,
    VerifyPaymentBody,
    WaiveItemBody,
)
from app.services import payment_service

router = APIRouter(tags=["Payments — Admin"])


# ── Schedule management ───────────────────────────────────────────────────────

@router.post(
    "/deals/{deal_id}/schedule",
    response_model=PaymentScheduleOut,
    status_code=201,
    summary="Create payment schedule for a deal (auto or manual)",
)
async def create_schedule(
    deal_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    body: CreateScheduleAuto | CreateScheduleManual,
):
    return await payment_service.admin_create_schedule(db, deal_id, body, current_user)


@router.get(
    "/deals/{deal_id}/schedule",
    response_model=PaymentScheduleOut,
    summary="Get payment schedule for a deal",
)
async def get_schedule(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
):
    return await payment_service.admin_get_schedule(db, deal_id)


@router.delete(
    "/deals/{deal_id}/schedule",
    summary="Delete payment schedule (only if no verified payments exist)",
)
async def delete_schedule(
    deal_id: UUID,
    db: DbConn,
    current_user: AdminUser,
):
    return await payment_service.admin_delete_schedule(db, deal_id, current_user)


# ── Payment record management ─────────────────────────────────────────────────

@router.get(
    "/deals/{deal_id}/payments",
    response_model=list[PaymentRecordOut],
    summary="List all payment records for a deal",
)
async def list_payment_records(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
):
    return await payment_service.admin_list_payment_records(db, deal_id)


@router.get(
    "/deals/{deal_id}/payments/items/{item_id}",
    response_model=list[PaymentRecordOut],
    summary="List payment records for a specific schedule item",
)
async def list_item_payment_records(
    deal_id: UUID,
    item_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
):
    return await payment_service.admin_list_payment_records(db, deal_id, item_id=item_id)


@router.post(
    "/payments/{record_id}/verify",
    response_model=PaymentRecordOut,
    summary="Verify a buyer payment record",
)
async def verify_payment(
    record_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
    body: VerifyPaymentBody,
):
    return await payment_service.admin_verify_payment(db, record_id, body, current_user)


@router.post(
    "/payments/{record_id}/reject",
    response_model=PaymentRecordOut,
    summary="Reject a buyer payment record (buyer can resubmit)",
)
async def reject_payment(
    record_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
    body: RejectPaymentBody,
):
    return await payment_service.admin_reject_payment(db, record_id, body, current_user)


@router.post(
    "/schedule-items/{item_id}/waive",
    response_model=ScheduleItemOut,
    summary="Waive a schedule item (admin only — counts as paid for auto-completion)",
)
async def waive_item(
    item_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    body: WaiveItemBody,
):
    return await payment_service.admin_waive_item(db, item_id, body, current_user)


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get(
    "/deals/{deal_id}/summary",
    response_model=DealPaymentSummary,
    summary="Get payment summary for a deal",
)
async def get_deal_payment_summary(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
):
    return await payment_service.get_deal_payment_summary(db, deal_id)
