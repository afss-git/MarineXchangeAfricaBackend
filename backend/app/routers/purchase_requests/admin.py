"""
Phase 7 — Admin purchase-request endpoints.

GET  /purchase-requests/admin                                       — list all requests
GET  /purchase-requests/admin/{id}                                  — view one request (full detail)
POST /purchase-requests/admin/{id}/assign-agent                     — assign buyer agent
POST /purchase-requests/admin/{id}/approve                          — approve request
POST /purchase-requests/admin/{id}/reject                           — reject request
POST /purchase-requests/admin/{id}/convert                          — convert to DRAFT deal
GET  /purchase-requests/admin/{id}/document-requests                — list agent doc requests
GET  /purchase-requests/admin/document-requests/{doc_req_id}/download — download an uploaded doc
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.deps import AdminUser, DbConn
from app.schemas.purchase_requests import (
    AdminPurchaseRequestDetail,
    AdminPurchaseRequestList,
    ApproveRequestBody,
    AssignAgentRequest,
    ConvertToDealBody,
    ConvertToDealResponse,
    PRDocRequestResponse,
    RejectRequestBody,
)
from app.services import purchase_request_service

router = APIRouter(prefix="/admin", tags=["Purchase Requests — Admin"])


@router.get(
    "",
    response_model=AdminPurchaseRequestList,
    summary="List all purchase requests (Admin)",
)
async def list_all_requests(
    db: DbConn,
    current_user: AdminUser,
    status: Optional[str]  = Query(default=None),
    buyer_id: Optional[UUID] = Query(default=None),
    product_id: Optional[UUID] = Query(default=None),
):
    return await purchase_request_service.admin_list_requests(
        db, status, buyer_id, product_id
    )


@router.get(
    "/document-requests/{doc_req_id}/download",
    summary="Download an uploaded PR document (Admin)",
)
async def admin_download_doc(
    doc_req_id: UUID,
    db: DbConn,
    current_user: AdminUser,
) -> StreamingResponse:
    return await purchase_request_service.admin_download_pr_doc(db, doc_req_id)


@router.get(
    "/{request_id}",
    response_model=AdminPurchaseRequestDetail,
    summary="Get full detail of a purchase request (Admin)",
)
async def get_request_detail(
    request_id: UUID,
    db: DbConn,
    current_user: AdminUser,
):
    return await purchase_request_service.admin_get_request(db, request_id)


@router.post(
    "/{request_id}/assign-agent",
    response_model=AdminPurchaseRequestDetail,
    summary="Assign a buyer agent to a purchase request",
)
async def assign_agent(
    request_id: UUID,
    body: AssignAgentRequest,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Assigns a buyer_agent to perform due diligence on the request.
    Can be called again to reassign (previous assignment status is not overwritten if report submitted).
    """
    return await purchase_request_service.assign_agent(
        db, current_user, request_id, body.agent_id, body.notes
    )


@router.post(
    "/{request_id}/approve",
    response_model=AdminPurchaseRequestDetail,
    summary="Approve a purchase request",
)
async def approve_request(
    request_id: UUID,
    body: ApproveRequestBody,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Approve a purchase request, making it eligible for conversion to a deal.

    - If approving against agent's recommendation, supply `admin_bypass_reason`.
    - Buyer is notified by email and SMS.
    """
    return await purchase_request_service.approve_request(
        db, current_user, request_id, body.admin_notes, body.admin_bypass_reason
    )


@router.post(
    "/{request_id}/reject",
    response_model=AdminPurchaseRequestDetail,
    summary="Reject a purchase request",
)
async def reject_request(
    request_id: UUID,
    body: RejectRequestBody,
    db: DbConn,
    current_user: AdminUser,
):
    """Reject a purchase request. Buyer is notified with the rejection reason."""
    return await purchase_request_service.reject_request(
        db, current_user, request_id, body.admin_notes
    )


@router.post(
    "/{request_id}/convert",
    response_model=ConvertToDealResponse,
    status_code=201,
    summary="Convert an approved request to a DRAFT deal",
)
async def convert_to_deal(
    request_id: UUID,
    body: ConvertToDealBody,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Creates a `draft` deal in `finance.deals` linked to this purchase request.

    - Request must be in `approved` status.
    - Admin sets the final agreed price and deal type (full_payment or financing).
    - The deal is created as `draft` — go to the Deals module to configure terms and send the offer.
    - Buyer is notified that their request has progressed to a formal deal.
    """
    return await purchase_request_service.convert_to_deal(
        db, current_user, request_id,
        body.deal_type, body.agreed_price, body.currency, body.admin_notes,
    )


@router.get(
    "/{request_id}/document-requests",
    response_model=list[PRDocRequestResponse],
    summary="List all agent document requests for a purchase request (Admin)",
)
async def list_doc_requests(
    request_id: UUID,
    db: DbConn,
    current_user: AdminUser,
):
    return await purchase_request_service.admin_list_pr_doc_requests(db, request_id)
