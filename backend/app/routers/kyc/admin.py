"""
KYC -- Admin endpoints.

GET    /kyc/admin/submissions              -- all submissions (filterable by status)
GET    /kyc/admin/submissions/pending      -- shortcut: submitted + under_review queue
GET    /kyc/admin/submissions/{id}         -- full submission detail
POST   /kyc/admin/submissions/{id}/assign-agent  -- assign buyer_agent
POST   /kyc/admin/submissions/{id}/decide  -- approve / reject / request resubmission

GET    /kyc/admin/document-types           -- list all document types (incl. inactive)
POST   /kyc/admin/document-types           -- create new document type
PATCH  /kyc/admin/document-types/{id}      -- update (name, is_required, is_active, etc.)
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.deps import AdminUser, DbConn, KycAgentOrAdmin
from app.schemas.kyc import (
    AssignKycAgentRequest,
    CreateDocumentTypeRequest,
    DocumentTypeResponse,
    KycAdminDecisionRequest,
    KycAssignmentResponse,
    KycSubmissionResponse,
    PaginatedKycSubmissionsResponse,
    UpdateDocumentTypeRequest,
)
from app.schemas.auth import MessageResponse
from app.services.kyc_service import (
    admin_kyc_decision,
    assign_kyc_agent,
    create_document_type,
    get_submission_detail,
    list_document_types,
    list_kyc_submissions,
    update_document_type,
)

router = APIRouter(tags=["KYC -- Admin"])


# -- Submission Queue -------------------------------------------------------------------

@router.get(
    "/admin/submissions",
    response_model=PaginatedKycSubmissionsResponse,
    summary="List all KYC submissions",
    description="Admin overview of all submissions. Filter by status using the query param.",
)
async def list_submissions(
    db: DbConn,
    current_user: KycAgentOrAdmin,
    kyc_status: str | None = Query(
        default=None,
        description="Filter by status: draft | submitted | under_review | approved | rejected | requires_resubmission",
    ),
    page:       int = Query(default=1, ge=1),
    page_size:  int = Query(default=20, ge=1, le=100),
):
    return await list_kyc_submissions(db, status_filter=kyc_status, page=page, page_size=page_size)


@router.get(
    "/admin/submissions/pending",
    response_model=PaginatedKycSubmissionsResponse,
    summary="Pending review queue",
    description="Submissions in 'submitted' or 'under_review' status -- the active work queue.",
)
async def pending_queue(
    db: DbConn,
    current_user: KycAgentOrAdmin,
    page:       int = Query(default=1, ge=1),
    page_size:  int = Query(default=20, ge=1, le=100),
):
    # Fetch both statuses and merge (submitted + under_review)
    s = await list_kyc_submissions(db, status_filter="submitted",    page=1, page_size=100)
    u = await list_kyc_submissions(db, status_filter="under_review", page=1, page_size=100)
    combined = s["items"] + u["items"]
    combined.sort(key=lambda x: x.get("submitted_at") or x.get("created_at"), reverse=False)
    total = len(combined)
    offset = (page - 1) * page_size
    import math
    return {
        "items": combined[offset: offset + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)),
    }


@router.get(
    "/admin/submissions/{submission_id}",
    response_model=KycSubmissionResponse,
    summary="Full submission detail",
    description="Complete view: documents (with signed URLs), all reviews, assignment.",
)
async def submission_detail(
    submission_id: UUID,
    db: DbConn,
    current_user: KycAgentOrAdmin,
):
    return await get_submission_detail(db, submission_id, current_user)


@router.post(
    "/admin/submissions/{submission_id}/assign-agent",
    response_model=KycAssignmentResponse,
    summary="Assign a buyer agent",
    description=(
        "Admin assigns a buyer_agent to a 'submitted' KYC application. "
        "Transitions submission to 'under_review'. "
        "Can be used to reassign -- previous assignment is overwritten."
    ),
)
async def assign_agent(
    submission_id: UUID,
    payload: AssignKycAgentRequest,
    db: DbConn,
    current_user: AdminUser,
):
    return await assign_kyc_agent(db, submission_id, payload, current_user)


@router.post(
    "/admin/submissions/{submission_id}/decide",
    response_model=MessageResponse,
    summary="Make final KYC decision",
    description=(
        "Admin approves, rejects, or requests resubmission.\n\n"
        "- **approve** -> kyc_status=approved, kyc_expires_at=now+12mo\n"
        "- **reject** -> kyc_status=rejected (permanent, can be overridden)\n"
        "- **requires_resubmission** -> buyer is asked to submit a new cycle\n\n"
        "Blocked if is_pep=True or sanctions_match=True with decision='approve'."
    ),
)
async def decide(
    submission_id: UUID,
    payload: KycAdminDecisionRequest,
    db: DbConn,
    current_user: AdminUser,
):
    return await admin_kyc_decision(db, submission_id, payload, current_user)


# -- Document Types ---------------------------------------------------------------------

@router.get(
    "/admin/document-types",
    response_model=list[DocumentTypeResponse],
    summary="List all document types",
    description="Returns all document types including inactive ones (admin view).",
)
async def get_document_types(
    db: DbConn,
    current_user: AdminUser,
    include_inactive: bool = Query(default=True),
):
    return await list_document_types(db, include_inactive=include_inactive)


@router.post(
    "/admin/document-types",
    response_model=DocumentTypeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create document type",
    description=(
        "Admin creates a new KYC document type. "
        "Set is_required=True to require all buyers to upload this type."
    ),
)
async def create_doc_type(
    payload: CreateDocumentTypeRequest,
    db: DbConn,
    current_user: AdminUser,
):
    return await create_document_type(db, payload, current_user)


@router.patch(
    "/admin/document-types/{doc_type_id}",
    response_model=DocumentTypeResponse,
    summary="Update document type",
    description=(
        "Update name, description, is_required, is_active, or display_order. "
        "Setting is_required=True immediately applies globally to all new submissions."
    ),
)
async def update_doc_type(
    doc_type_id: UUID,
    payload: UpdateDocumentTypeRequest,
    db: DbConn,
    current_user: AdminUser,
):
    return await update_document_type(db, doc_type_id, payload, current_user)
