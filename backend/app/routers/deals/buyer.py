"""
Phase 5 — Buyer deal endpoints.

GET  /deals/my                         — list buyer's own deals (BuyerUser)
GET  /deals/portal/{token}             — view deal by portal token (no auth)
POST /deals/portal/{token}/request-otp — request acceptance OTP (no auth)
POST /deals/portal/{token}/accept      — accept deal with OTP (no auth)
GET  /deals/{deal_id}/schedule         — view own deal schedule (BuyerUser)
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.rate_limit import limiter
from app.deps import BuyerUser, CurrentUser, DbConn, SellerUser
from app.schemas.deals import (
    AcceptDealRequest,
    DealListResponse,
    DealPortalResponse,
    DealResponse,
    InstallmentScheduleResponse,
    RequestOtpResponse,
)
from app.services import deal_service

router = APIRouter(tags=["Deals — Buyer"])


@router.get(
    "/my",
    response_model=list[DealListResponse],
    summary="List my deals",
)
async def list_my_deals(
    db: DbConn,
    current_user: BuyerUser,
    deal_status: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    filters = {
        "status": deal_status,
        "page": page,
        "page_size": page_size,
    }
    return await deal_service.list_deals(db, filters, current_user)


@router.get(
    "/my-sales",
    response_model=list[DealListResponse],
    summary="List deals where I am the seller",
)
async def list_my_sales(
    db: DbConn,
    current_user: SellerUser,
    deal_status: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    filters = {"status": deal_status, "page": page, "page_size": page_size}
    return await deal_service.list_seller_deals(db, filters, current_user)


@router.get(
    "/portal/{token}",
    response_model=DealPortalResponse,
    summary="View deal portal (no auth required)",
)
async def get_deal_portal(
    token: str,
    db: DbConn,
):
    return await deal_service.get_deal_by_portal_token(db, token)


@router.post(
    "/portal/{token}/request-otp",
    response_model=RequestOtpResponse,
    summary="Request OTP to accept deal (no auth required)",
)
@limiter.limit("3/minute;10/hour")
async def request_deal_otp(
    token: str,
    request: Request,
    db: DbConn,
):
    return await deal_service.request_deal_otp(db, token)


@router.post(
    "/portal/{token}/accept",
    response_model=DealPortalResponse,
    summary="Accept deal with OTP (no auth required)",
)
@limiter.limit("5/minute;20/hour")
async def accept_deal(
    token: str,
    payload: AcceptDealRequest,
    request: Request,
    db: DbConn,
):
    client_ip = getattr(request.state, "client_ip", request.client.host if request.client else "unknown")
    result = await deal_service.accept_deal(db, token, payload.otp, client_ip)
    # Return portal view after acceptance
    return await deal_service.get_deal_by_portal_token(db, token)


@router.get(
    "/{deal_id}/schedule",
    response_model=InstallmentScheduleResponse,
    summary="View own deal installment schedule (BuyerUser)",
)
async def get_my_deal_schedule(
    deal_id: UUID,
    db: DbConn,
    current_user: CurrentUser,
):
    return await deal_service.get_installment_schedule(db, deal_id, current_user)
