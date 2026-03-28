"""
Verification agent endpoints.

GET   /marketplace/verification/assignments            — agent's assigned products
GET   /marketplace/verification/assignments/{id}       — assignment detail
PATCH /marketplace/verification/assignments/{id}       — update assignment status
POST  /marketplace/verification/assignments/{id}/report — submit verification report
PUT   /marketplace/verification/products/{id}/specs    — add/update product specifications

Also accessible to admins (broader product visibility).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile, status

from app.deps import DbConn, require_roles
from app.schemas.marketplace import (
    AttributeDefinitionResponse,
    AttributeValueResponse,
    CreateAttributeRequest,
    ProductSpecUpdateRequest,
    SubmitVerificationReportRequest,
    UpdateVerificationAssignmentRequest,
    VerificationAssignmentResponse,
)
from app.schemas.auth import MessageResponse
from app.services.marketplace_service import (
    admin_update_product_specs,
    create_attribute,
    get_assignment_detail,
    get_agent_assignments,
    list_attributes,
    submit_verification_report,
    update_verification_assignment,
    upload_verification_evidence_file,
)

router = APIRouter(tags=["Marketplace — Verification"])

# Accessible to both verification agents and admins
AgentOrAdmin = Depends(require_roles("verification_agent", "admin"))
AgentOnly    = Depends(require_roles("verification_agent"))


@router.get(
    "/verification/assignments",
    summary="List verification assignments",
    description=(
        "Verification agents see only their own assignments. "
        "Admins can also use this endpoint (they see based on their own agent_id — "
        "for full admin oversight use /admin/products)."
    ),
)
async def list_assignments(
    db: DbConn,
    current_user: dict = AgentOrAdmin,
    page:       int = Query(default=1, ge=1),
    page_size:  int = Query(default=20, ge=1, le=100),
):
    from uuid import UUID as _UUID
    return await get_agent_assignments(
        db,
        agent_id=_UUID(str(current_user["id"])),
        page=page,
        page_size=page_size,
    )


@router.get(
    "/verification/assignments/{assignment_id}",
    response_model=VerificationAssignmentResponse,
    summary="Get assignment detail",
)
async def get_assignment(
    assignment_id: UUID,
    db: DbConn,
    current_user: dict = AgentOrAdmin,
):
    return await get_assignment_detail(db, assignment_id, current_user)


@router.patch(
    "/verification/assignments/{assignment_id}",
    response_model=VerificationAssignmentResponse,
    summary="Update assignment progress",
    description=(
        "Agent updates their assignment status. "
        "Allowed statuses: 'contacted', 'inspection_scheduled', 'inspection_done'."
    ),
)
async def update_assignment(
    assignment_id: UUID,
    payload: UpdateVerificationAssignmentRequest,
    db: DbConn,
    current_user: dict = AgentOnly,
):
    return await update_verification_assignment(db, assignment_id, payload, current_user)


@router.post(
    "/verification/assignments/{assignment_id}/report",
    status_code=status.HTTP_201_CREATED,
    summary="Submit verification report",
    description=(
        "Agent submits the final verification report. This is immutable — "
        "it cannot be modified after submission. "
        "Outcome options: 'verified', 'failed', 'requires_clarification'. "
        "Optional attribute_updates are persisted on the product at the same time."
    ),
)
async def submit_report(
    assignment_id: UUID,
    payload: SubmitVerificationReportRequest,
    db: DbConn,
    current_user: dict = AgentOnly,
):
    return await submit_verification_report(db, assignment_id, payload, current_user)


@router.post(
    "/verification/assignments/{assignment_id}/evidence",
    status_code=status.HTTP_201_CREATED,
    summary="Upload evidence file",
    description=(
        "Upload a single inspection image or document to attach to the verification report. "
        "Returns {storage_path, signed_url, file_type}. "
        "Collect storage_paths and pass them in the evidence_files field of the submit-report request."
    ),
)
async def upload_evidence(
    assignment_id: UUID,
    file: UploadFile = File(...),
    current_user: dict = AgentOnly,
):
    return await upload_verification_evidence_file(assignment_id, file, current_user)


@router.put(
    "/verification/products/{product_id}/specs",
    response_model=list[AttributeValueResponse],
    summary="Update product specifications",
    description=(
        "Agent or admin adds or updates technical specification attributes for a product. "
        "This can be done during or after verification."
    ),
)
async def update_product_specs(
    product_id: UUID,
    payload: ProductSpecUpdateRequest,
    db: DbConn,
    current_user: dict = AgentOrAdmin,
):
    return await admin_update_product_specs(db, product_id, payload, current_user)


@router.post(
    "/attributes",
    response_model=AttributeDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create attribute definition",
    description=(
        "Agents and admins can create new attribute definitions to support "
        "category-specific or novel technical specifications. "
        "category_id = null creates a global attribute. "
        "slug must be unique within the same category scope."
    ),
)
async def create_attribute_definition(
    payload: CreateAttributeRequest,
    db: DbConn,
    current_user: dict = AgentOrAdmin,
):
    return await create_attribute(db, payload, current_user)
