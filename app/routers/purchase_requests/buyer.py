"""
Phase 7 — Buyer purchase-request endpoints.

GET    /purchase-requests/my                                    — list my requests
GET    /purchase-requests/{id}                                  — view one request
POST   /purchase-requests                                       — submit new request
DELETE /purchase-requests/{id}                                  — cancel (submitted only)
GET    /purchase-requests/{id}/document-requests                — list doc requests for my PR
POST   /purchase-requests/{id}/document-requests/{req_id}/fulfill — upload to fulfill a request
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, File, Query, UploadFile

from app.deps import BuyerUser, DbConn
from app.schemas.purchase_requests import (
    PRDocRequestResponse,
    PurchaseRequestCreate,
    PurchaseRequestListResponse,
    PurchaseRequestResponse,
)
from app.services import purchase_request_service

router = APIRouter(tags=["Purchase Requests — Buyer"])


@router.post(
    "/",
    response_model=PurchaseRequestResponse,
    status_code=201,
    summary="Submit a purchase request",
)
async def submit_purchase_request(
    body: PurchaseRequestCreate,
    db: DbConn,
    current_user: BuyerUser,
):
    """
    Submit a purchase request for a live product.

    - Any verified buyer account can submit — KYC is not required.
    - Admin will assign a due-diligence agent to verify the buyer.
    - Only one active request per listing per buyer.
    - purchase_type: `direct_purchase` or `financed`.
    """
    return await purchase_request_service.create_purchase_request(db, current_user, body)


@router.get(
    "/my",
    response_model=PurchaseRequestListResponse,
    summary="List my purchase requests",
)
async def list_my_requests(
    db: DbConn,
    current_user: BuyerUser,
    status: Optional[str] = Query(default=None, description="Filter by status"),
):
    return await purchase_request_service.list_buyer_requests(
        db, current_user["id"], status_filter=status
    )


@router.get(
    "/{request_id}",
    response_model=PurchaseRequestResponse,
    summary="View one of my purchase requests",
)
async def get_my_request(
    request_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
):
    return await purchase_request_service.get_buyer_request(db, current_user["id"], request_id)


@router.delete(
    "/{request_id}",
    response_model=PurchaseRequestResponse,
    summary="Cancel a submitted purchase request",
)
async def cancel_request(
    request_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
    reason: Optional[str] = Query(default=None, max_length=500),
):
    """Cancel is only allowed when the request is still in 'submitted' status."""
    return await purchase_request_service.cancel_purchase_request(
        db, current_user, request_id, reason
    )


@router.get(
    "/{request_id}/document-requests",
    response_model=list[PRDocRequestResponse],
    summary="List document requests for my purchase request",
)
async def list_my_pr_doc_requests(
    request_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
):
    return await purchase_request_service.buyer_list_pr_doc_requests(
        db, current_user["id"], request_id
    )


@router.post(
    "/{request_id}/document-requests/{doc_req_id}/fulfill",
    response_model=PRDocRequestResponse,
    status_code=201,
    summary="Upload a document to fulfill a pending request",
)
async def fulfill_pr_doc_request(
    request_id: UUID,
    doc_req_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
    file: UploadFile = File(...),
):
    return await purchase_request_service.buyer_fulfill_pr_doc_request(
        db, current_user["id"], doc_req_id, file
    )
