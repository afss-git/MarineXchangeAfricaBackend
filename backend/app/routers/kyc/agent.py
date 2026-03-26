"""
KYC -- Buyer Agent endpoints.

GET    /kyc/agent/queue                        -- list my assigned submissions
GET    /kyc/agent/submissions/{id}             -- full submission detail
PATCH  /kyc/agent/submissions/{id}/assignment  -- update assignment status (in_review)
POST   /kyc/agent/submissions/{id}/review      -- submit assessment
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

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
    get_submission_detail,
    list_agent_assignments,
    submit_agent_review,
    update_agent_assignment,
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
