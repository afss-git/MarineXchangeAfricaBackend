"""
KYC — Buyer endpoints.

GET    /kyc/me                           — my KYC status dashboard
GET    /kyc/me/documents                 — list documents in current draft
POST   /kyc/me/documents                 — upload a document
DELETE /kyc/me/documents/{id}            — delete document (draft only)
POST   /kyc/me/submit                    — submit draft for review
POST   /kyc/me/resubmit                  — start new cycle after rejection

-- Enhanced KYC (Phase 4b) --
POST   /kyc/me/phone/send-otp           — send phone OTP
POST   /kyc/me/phone/verify-otp         — verify phone OTP
GET    /kyc/me/document-requests         — list documents requested by agent
POST   /kyc/me/document-requests/{id}/fulfill — link uploaded doc to a request
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, UploadFile, File, status
from pydantic import BaseModel, Field

from app.deps import BuyerUser, CurrentUser, DbConn
from app.schemas.kyc import (
    KycDocumentResponse,
    KycStatusResponse,
)
from app.schemas.auth import MessageResponse
from app.services.kyc_service import (
    delete_kyc_document,
    fulfill_document_request,
    get_kyc_status,
    get_signed_url_with_logging,
    list_buyer_documents,
    list_document_requests,
    start_resubmission,
    submit_kyc,
    upload_kyc_document,
)
from app.services.twilio_service import (
    mark_phone_verified,
    send_phone_otp,
    verify_phone_otp,
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
    file: UploadFile,
    db: DbConn,
    current_user: BuyerUser,
    document_type_id: Optional[UUID] = None,
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


# ══════════════════════════════════════════════════════════════════════════════
# Phone OTP Verification
# ══════════════════════════════════════════════════════════════════════════════


class SendOtpRequest(BaseModel):
    phone: str = Field(..., description="Phone number in E.164 format (e.g. +2348012345678)")


class VerifyOtpRequest(BaseModel):
    phone: str = Field(..., description="Phone number in E.164 format")
    code: str = Field(..., min_length=4, max_length=8, description="OTP code from SMS")


@router.post(
    "/me/phone/send-otp",
    summary="Send phone verification OTP",
    description="Generates an OTP, stores in DB, and sends via SMS. In non-production, the code is returned in the response for testing.",
)
async def send_otp(
    payload: SendOtpRequest,
    db: DbConn,
    current_user: CurrentUser,
):
    result = await send_phone_otp(db, payload.phone)
    if not result["sent"]:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to send OTP. Please try again.",
        )
    response = {"message": "OTP sent successfully.", "phone": payload.phone}
    # In dev/staging, include the code so the flow is testable without paid Twilio
    if "code" in result:
        response["code"] = result["code"]
        response["note"] = result.get("note", "")
    return response


@router.post(
    "/me/phone/verify-otp",
    summary="Verify phone OTP",
    description="Verifies the OTP code against DB. On success, marks the user's phone as verified.",
)
async def verify_otp(
    payload: VerifyOtpRequest,
    db: DbConn,
    current_user: CurrentUser,
):
    valid = await verify_phone_otp(db, payload.phone, payload.code)
    if not valid:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid or expired OTP code.",
        )

    user_id = UUID(str(current_user["id"]))
    await mark_phone_verified(db, user_id)

    # Also update the phone number on the profile
    await db.execute(
        "UPDATE public.profiles SET phone = $1 WHERE id = $2",
        payload.phone, user_id,
    )

    return {"message": "Phone verified successfully.", "phone": payload.phone, "phone_verified": True}


# ══════════════════════════════════════════════════════════════════════════════
# Document Requests (Buyer side)
# ══════════════════════════════════════════════════════════════════════════════


class FulfillRequestPayload(BaseModel):
    document_id: UUID = Field(..., description="The uploaded document ID that fulfills this request")


@router.get(
    "/me/document-requests",
    summary="My document requests",
    description="Lists all documents that agents have requested from you.",
)
async def my_document_requests(
    db: DbConn,
    current_user: BuyerUser,
):
    user_id = UUID(str(current_user["id"]))
    sub_id = current_user.get("current_kyc_submission_id")
    if not sub_id:
        return []
    return await list_document_requests(db, sub_id)


@router.post(
    "/me/document-requests/{request_id}/fulfill",
    summary="Fulfill a document request",
    description="Link an uploaded document to a pending request from the agent.",
)
async def fulfill_request(
    request_id: UUID,
    payload: FulfillRequestPayload,
    db: DbConn,
    current_user: BuyerUser,
):
    buyer_id = UUID(str(current_user["id"]))
    return await fulfill_document_request(db, request_id, payload.document_id, buyer_id)


@router.get(
    "/me/documents/{document_id}/view",
    summary="View my document",
    description="Get a signed URL for a document with access logging.",
)
async def view_my_document(
    document_id: UUID,
    request: Request,
    db: DbConn,
    current_user: BuyerUser,
):
    ip = getattr(request.state, "client_ip", None)
    return await get_signed_url_with_logging(db, document_id, current_user, ip_address=ip)
