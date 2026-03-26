"""
KYC — Buyer endpoints.

GET    /kyc/me                 — my KYC status dashboard
GET    /kyc/me/documents       — list documents in current draft
POST   /kyc/me/documents       — upload a document
DELETE /kyc/me/documents/{id}  — delete document (draft only)
POST   /kyc/me/submit          — submit draft for review
POST   /kyc/me/resubmit        — start new cycle after rejection
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, UploadFile, File, status

from app.deps import BuyerUser, DbConn
from app.schemas.kyc import (
    KycDocumentResponse,
    KycStatusResponse,
)
from app.schemas.auth import MessageResponse
from app.services.kyc_service import (
    delete_kyc_document,
    get_kyc_status,
    list_buyer_documents,
    start_resubmission,
    submit_kyc,
    upload_kyc_document,
)

router = APIRouter(tags=["KYC — Buyer"])


@router.get(
    "/me",
    response_model=KycStatusResponse,
    summary="My KYC status",
    description=(
        "Returns the buyer's current KYC status, required/optional document types, "
        "upload count, and any rejection reason."
    ),
)
async def my_kyc_status(
    db: DbConn,
    current_user: BuyerUser,
):
    from uuid import UUID as _UUID
    return await get_kyc_status(db, _UUID(str(current_user["id"])))


@router.get(
    "/me/documents",
    response_model=list[KycDocumentResponse],
    summary="List my uploaded documents",
    description="Returns all non-deleted documents in the buyer's current draft submission.",
)
async def list_my_documents(
    db: DbConn,
    current_user: BuyerUser,
):
    from uuid import UUID as _UUID
    return await list_buyer_documents(db, _UUID(str(current_user["id"])))


@router.post(
    "/me/documents",
    response_model=KycDocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a KYC document",
    description=(
        "Upload a single document file (JPEG, PNG, WebP, or PDF — max 10 MB). "
        "Provide the document_type_id as a query parameter. "
        "A draft submission is auto-created on first upload. "
        "Documents are locked once the submission is submitted for review."
    ),
)
async def upload_document(
    document_type_id: UUID,
    file: UploadFile,
    db: DbConn,
    current_user: BuyerUser,
):
    return await upload_kyc_document(db, file, document_type_id, current_user)


@router.delete(
    "/me/documents/{document_id}",
    response_model=MessageResponse,
    summary="Delete a document",
    description="Remove a document from the current draft. Not allowed once the submission is locked.",
)
async def delete_document(
    document_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
):
    return await delete_kyc_document(db, document_id, current_user)


@router.post(
    "/me/submit",
    response_model=MessageResponse,
    summary="Submit KYC for review",
    description=(
        "Locks the document set and submits the application for agent review. "
        "All required document types must be covered before submission."
    ),
)
async def submit(
    db: DbConn,
    current_user: BuyerUser,
):
    return await submit_kyc(db, current_user)


@router.post(
    "/me/resubmit",
    response_model=MessageResponse,
    summary="Start a new KYC cycle",
    description=(
        "Creates a fresh draft submission for buyers whose KYC was rejected, "
        "requires_resubmission, or expired. Capped at 3 total attempts."
    ),
)
async def resubmit(
    db: DbConn,
    current_user: BuyerUser,
):
    return await start_resubmission(db, current_user)
