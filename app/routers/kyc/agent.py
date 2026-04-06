"""
KYC -- Buyer Agent endpoints.

GET    /kyc/agent/queue                                -- list my assigned submissions
GET    /kyc/agent/submissions/{id}                     -- full submission detail
PATCH  /kyc/agent/submissions/{id}/assignment          -- update assignment status (in_review)
POST   /kyc/agent/submissions/{id}/review              -- submit assessment

-- Enhanced KYC (Phase 4b) --
POST   /kyc/agent/submissions/{id}/call                -- initiate Twilio verification call
POST   /kyc/agent/calls/{call_id}/notes                -- save call outcome & notes
POST   /kyc/agent/submissions/{id}/document-requests   -- request docs from buyer
POST   /kyc/agent/document-requests/{id}/waive         -- waive a document request
POST   /kyc/agent/documents/{id}/verify                -- per-document structured verification
GET    /kyc/agent/submissions/{id}/verifications       -- list document verifications
GET    /kyc/agent/submissions/{id}/document-requests   -- list document requests
GET    /kyc/agent/documents/{id}/access-log            -- document access history
GET    /kyc/agent/documents/{id}/checklist-template    -- get verification checklist
GET    /kyc/agent/documents/{id}/view                  -- get signed URL with access logging
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from typing import Optional

from app.deps import DbConn, KycAgentOrAdmin
from app.schemas.kyc import (
    KycAgentReviewRequest,
    KycAssignmentResponse,
    KycReviewResponse,
    KycSubmissionResponse,
    PaginatedKycSubmissionsResponse,
    UpdateKycAssignmentRequest,
)
from app.services.kyc_service import (
    create_document_requests,
    fulfill_document_request,
    get_checklist_template,
    get_document_access_history,
    get_document_verifications,
    get_or_create_draft_submission,
    get_signed_url_with_logging,
    get_submission_detail,
    list_agent_assignments,
    list_document_requests,
    submit_agent_review,
    update_agent_assignment,
    verify_document,
    waive_document_request,
)
from app.services.twilio_service import (
    initiate_verification_call,
    save_call_notes,
)

router = APIRouter(tags=["KYC -- Agent"])


@router.get(
    "/agent/queue",
    response_model=PaginatedKycSubmissionsResponse,
    summary="My assigned KYC queue",
    description="Lists all KYC submissions assigned to the current agent, newest first.",
)
async def my_queue(
    db: DbConn,
    current_user: KycAgentOrAdmin,
    page:       int = Query(default=1, ge=1),
    page_size:  int = Query(default=20, ge=1, le=100),
):
    from uuid import UUID as _UUID
    return await list_agent_assignments(
        db,
        agent_id=_UUID(str(current_user["id"])),
        page=page,
        page_size=page_size,
    )


@router.get(
    "/agent/submissions/{submission_id}",
    response_model=KycSubmissionResponse,
    summary="View submission detail",
    description="Full view of a KYC submission including documents, reviews, and assignment.",
)
async def submission_detail(
    submission_id: UUID,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    return await get_submission_detail(db, submission_id, current_user)


@router.patch(
    "/agent/submissions/{submission_id}/assignment",
    response_model=KycAssignmentResponse,
    summary="Update assignment status",
    description="Agent marks their assignment as 'in_review' once they begin reviewing.",
)
async def update_assignment(
    submission_id: UUID,
    payload: UpdateKycAssignmentRequest,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    return await update_agent_assignment(db, submission_id, payload, current_user)


@router.post(
    "/agent/submissions/{submission_id}/review",
    response_model=KycReviewResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit KYC assessment",
    description=(
        "Agent submits their structured assessment including risk score, PEP flag, "
        "sanctions flag, and recommendation. "
        "Agents cannot recommend 'approve' -- only admin can grant final approval. "
        "If is_pep or sanctions_match is True, risk_score is forced to 'high' "
        "and recommendation is restricted to reject/requires_resubmission."
    ),
)
async def submit_review(
    submission_id: UUID,
    payload: KycAgentReviewRequest,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    return await submit_agent_review(db, submission_id, payload, current_user)


# ══════════════════════════════════════════════════════════════════════════════
# Enhanced KYC — Twilio Calls
# ══════════════════════════════════════════════════════════════════════════════


class InitiateCallRequest(BaseModel):
    buyer_phone: str = Field(..., description="Buyer phone in E.164 format")
    agent_phone: str = Field(..., description="Agent's personal phone in E.164 format")


class CallNotesRequest(BaseModel):
    call_outcome: str = Field(..., description="verified | inconclusive | unreachable | callback_scheduled | refused")
    call_notes: Optional[str] = Field(None, description="Agent's notes about the call")


@router.post(
    "/agent/submissions/{submission_id}/call",
    status_code=status.HTTP_201_CREATED,
    summary="Initiate verification call",
    description="Start a Twilio voice call to the buyer. Agent phone rings first, then bridges to buyer.",
)
async def initiate_call(
    submission_id: UUID,
    payload: InitiateCallRequest,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    agent_id = UUID(str(current_user["id"]))

    # Get buyer_id from submission
    sub = await db.fetchrow("SELECT buyer_id FROM kyc.submissions WHERE id = $1", submission_id)
    if not sub:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Submission not found.")

    return await initiate_verification_call(
        db=db,
        submission_id=submission_id,
        agent_id=agent_id,
        buyer_id=sub["buyer_id"],
        agent_phone=payload.agent_phone,
        buyer_phone=payload.buyer_phone,
    )


@router.post(
    "/agent/calls/{call_id}/notes",
    summary="Save call notes",
    description="Agent saves outcome and notes after a verification call.",
)
async def post_call_notes(
    call_id: UUID,
    payload: CallNotesRequest,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    agent_id = UUID(str(current_user["id"]))
    await save_call_notes(db, call_id, agent_id, payload.call_outcome, payload.call_notes)
    return {"message": "Call notes saved.", "call_id": str(call_id)}


# ══════════════════════════════════════════════════════════════════════════════
# Enhanced KYC — Document Requests
# ══════════════════════════════════════════════════════════════════════════════


class DocumentRequestItem(BaseModel):
    document_type_id: Optional[UUID] = None
    custom_document_name: Optional[str] = None
    reason: str = ""
    priority: str = Field(default="required", description="required | recommended")


class CreateDocumentRequestsPayload(BaseModel):
    requests: list[DocumentRequestItem]


class WaiveDocumentRequestPayload(BaseModel):
    reason: str = Field(..., description="Why this request is being waived")


@router.post(
    "/agent/submissions/{submission_id}/document-requests",
    status_code=status.HTTP_201_CREATED,
    summary="Request documents from buyer",
    description="Agent requests specific documents from the buyer for this submission.",
)
async def request_documents(
    submission_id: UUID,
    payload: CreateDocumentRequestsPayload,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    agent_id = UUID(str(current_user["id"]))
    return await create_document_requests(
        db,
        submission_id=submission_id,
        agent_id=agent_id,
        requests=[r.model_dump() for r in payload.requests],
    )


@router.get(
    "/agent/submissions/{submission_id}/document-requests",
    summary="List document requests",
    description="Lists all document requests for a submission.",
)
async def list_doc_requests(
    submission_id: UUID,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    return await list_document_requests(db, submission_id)


@router.post(
    "/agent/document-requests/{request_id}/waive",
    summary="Waive document request",
    description="Agent waives a pending document request with a reason.",
)
async def waive_doc_request(
    request_id: UUID,
    payload: WaiveDocumentRequestPayload,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    agent_id = UUID(str(current_user["id"]))
    return await waive_document_request(db, request_id, agent_id, payload.reason)


@router.post(
    "/agent/buyer/{buyer_id}/ensure-submission",
    summary="Get or create KYC submission for buyer",
    description=(
        "Called by an agent when assigned to a purchase request. "
        "Returns the buyer's current draft KYC submission, or creates one. "
        "This lets the agent request documents before the buyer has formally started KYC."
    ),
)
async def ensure_buyer_submission(
    buyer_id: UUID,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    try:
        sub = await get_or_create_draft_submission(db, buyer_id)
        return {
            "submission_id": str(sub["id"]),
            "status": sub["status"],
            "cycle_number": sub["cycle_number"],
        }
    except HTTPException:
        # Submission is locked (submitted/under_review) — return existing submission id
        row = await db.fetchrow(
            "SELECT id, status, cycle_number FROM kyc.submissions WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 1",
            buyer_id,
        )
        if not row:
            raise
        return {
            "submission_id": str(row["id"]),
            "status": row["status"],
            "cycle_number": row["cycle_number"],
        }


# ══════════════════════════════════════════════════════════════════════════════
# Enhanced KYC — Document Verification
# ══════════════════════════════════════════════════════════════════════════════


class VerifyDocumentPayload(BaseModel):
    status: str = Field(..., description="verified | rejected | needs_clarification")
    checklist_results: Optional[dict] = None
    extracted_data: Optional[dict] = None
    rejection_reason: Optional[str] = None
    notes: Optional[str] = None


@router.post(
    "/agent/documents/{document_id}/verify",
    status_code=status.HTTP_201_CREATED,
    summary="Verify a document",
    description="Agent submits a structured per-document verification with checklist results.",
)
async def verify_doc(
    document_id: UUID,
    payload: VerifyDocumentPayload,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    agent_id = UUID(str(current_user["id"]))
    return await verify_document(
        db,
        document_id=document_id,
        verified_by=agent_id,
        verification_status=payload.status,
        checklist_results=payload.checklist_results,
        extracted_data=payload.extracted_data,
        rejection_reason=payload.rejection_reason,
        notes=payload.notes,
    )


@router.get(
    "/agent/submissions/{submission_id}/verifications",
    summary="List document verifications",
    description="Get all per-document verifications for a submission.",
)
async def list_verifications(
    submission_id: UUID,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    return await get_document_verifications(db, submission_id)


@router.get(
    "/agent/documents/{document_id}/checklist-template",
    summary="Get verification checklist template",
    description="Returns the structured checklist template for a document's type.",
)
async def get_checklist(
    document_id: UUID,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    # Get document type from the document
    doc = await db.fetchrow(
        "SELECT document_type_id FROM kyc.documents WHERE id = $1 AND deleted_at IS NULL",
        document_id,
    )
    if not doc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Document not found.")

    template = await get_checklist_template(db, doc["document_type_id"])
    return {"document_id": str(document_id), "checklist_template": template}


@router.get(
    "/agent/documents/{document_id}/view",
    summary="View document with access logging",
    description="Generates a signed URL and records the access in the audit log.",
)
async def view_document(
    document_id: UUID,
    request: Request,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    ip = getattr(request.state, "client_ip", None)
    return await get_signed_url_with_logging(db, document_id, current_user, ip_address=ip)


@router.get(
    "/agent/documents/{document_id}/access-log",
    summary="Document access history",
    description="Returns the full access log for a document.",
)
async def document_access_log(
    document_id: UUID,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    return await get_document_access_history(db, document_id)
