"""
Phase 5 — Admin deal management endpoints.

GET    /deals                              — list all deals (filters: status, buyer_id, deal_type, page, page_size)
POST   /deals                              — create deal
GET    /deals/{deal_id}                    — deal detail
PATCH  /deals/{deal_id}                    — update terms (draft only)
POST   /deals/{deal_id}/second-approve     — second admin approval
POST   /deals/{deal_id}/send-offer         — send offer to buyer
POST   /deals/{deal_id}/mark-accepted      — mark deal as accepted offline (bypass portal)
POST   /deals/{deal_id}/cancel             — cancel deal
POST   /deals/{deal_id}/record-payment     — record offline payment (multipart)
POST   /deals/{deal_id}/send-reminder      — manually trigger notification to buyer
GET    /deals/{deal_id}/schedule           — installment schedule
"""
from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, UploadFile, status

from app.deps import AdminUser, AnyAdmin, DbConn
from app.schemas.deals import (
    CancelDealRequest,
    DealPaymentResponse,
    DealResponse,
    DealUpdate,
    InstallmentScheduleResponse,
    MarkAcceptedRequest,
    RecordPaymentRequest,
    SecondApproveRequest,
    SendOfferRequest,
    SendReminderRequest,
)
from app.services import deal_service

router = APIRouter(tags=["Deals — Admin"])


@router.get(
    "/{deal_id}",
    response_model=DealResponse,
    summary="Get deal detail",
)
async def get_deal(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
):
    return await deal_service.get_deal(db, deal_id, current_user)


@router.patch(
    "/{deal_id}",
    response_model=DealResponse,
    summary="Update deal terms (draft only)",
)
async def update_deal_terms(
    deal_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    payload: DealUpdate,
):
    return await deal_service.update_deal_terms(db, deal_id, payload, current_user)


@router.post(
    "/{deal_id}/second-approve",
    response_model=DealResponse,
    summary="Second admin approval for high-value deals",
)
async def second_approve_deal(
    deal_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    payload: SecondApproveRequest,
):
    return await deal_service.second_approve_deal(db, deal_id, payload.notes, current_user)


@router.post(
    "/{deal_id}/send-offer",
    response_model=DealResponse,
    summary="Send deal offer to buyer",
)
async def send_deal_offer(
    deal_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    payload: SendOfferRequest = SendOfferRequest(),
):
    return await deal_service.send_deal_offer(db, deal_id, current_user)


@router.post(
    "/{deal_id}/mark-accepted",
    response_model=DealResponse,
    summary="Mark deal as accepted offline (transitions offer_sent → in_progress)",
)
async def mark_deal_accepted(
    deal_id: UUID,
    body: MarkAcceptedRequest,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Use when the buyer has confirmed acceptance outside the portal
    (phone call, email, WhatsApp, etc.).

    Records the reason in admin_notes and advances the deal to in_progress
    so that payment can be recorded immediately.
    """
    return await deal_service.mark_deal_accepted_offline(db, deal_id, current_user, body.notes)


@router.post(
    "/{deal_id}/cancel",
    response_model=DealResponse,
    summary="Cancel a deal",
)
async def cancel_deal(
    deal_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    payload: CancelDealRequest,
):
    return await deal_service.cancel_deal(db, deal_id, payload.reason, current_user)


@router.post(
    "/{deal_id}/record-payment",
    response_model=DealPaymentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record an offline payment (multipart: JSON + optional proof file)",
)
async def record_payment(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
    payload_json: str = Form(..., alias="payload", description="JSON body: RecordPaymentRequest"),
    proof_file: UploadFile | None = File(default=None),
):
    data = json.loads(payload_json)
    payload = RecordPaymentRequest(**data)
    return await deal_service.record_payment(db, deal_id, payload, proof_file, current_user)


@router.post(
    "/{deal_id}/send-reminder",
    summary="Manually send a payment reminder to the buyer",
)
async def send_manual_reminder(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
    payload: SendReminderRequest,
):
    return await deal_service.send_manual_reminder(
        db, deal_id, payload.message_type, payload.custom_message, current_user
    )


@router.get(
    "/{deal_id}/schedule",
    response_model=InstallmentScheduleResponse,
    summary="Get installment schedule for a financing deal",
)
async def get_installment_schedule(
    deal_id: UUID,
    db: DbConn,
    current_user: AnyAdmin,
):
    return await deal_service.get_installment_schedule(db, deal_id, current_user)
