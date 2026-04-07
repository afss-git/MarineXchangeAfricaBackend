"""
Pydantic v2 schemas for the Phase 4 KYC system.

Covers:
  - Document type management (admin)
  - Submission lifecycle (buyer)
  - Document upload / response
  - Agent assignment and assessment
  - Admin decision
  - Buyer KYC status view
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── Constants ─────────────────────────────────────────────────────────────────

KYC_STATUSES = frozenset({
    "pending", "under_review", "approved",
    "rejected", "requires_resubmission", "expired", "not_applicable",
})

SUBMISSION_STATUSES = frozenset({
    "draft", "submitted", "under_review",
    "approved", "rejected", "requires_resubmission",
})

ASSIGNMENT_STATUSES = frozenset({
    "assigned", "in_review", "assessment_submitted",
})

RISK_SCORES = frozenset({"low", "medium", "high"})

RECOMMENDATIONS = frozenset({"approve", "reject", "requires_resubmission"})

REVIEWER_ROLES = frozenset({"buyer_agent", "admin"})

ALLOWED_MIME_TYPES = frozenset({
    "image/jpeg", "image/png", "image/webp",
    "application/pdf",
})

MAX_RESUBMISSION_ATTEMPTS = 3


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT TYPES
# ══════════════════════════════════════════════════════════════════════════════

class DocumentTypeResponse(BaseModel):
    """A KYC document type entry."""
    id:             UUID
    name:           str
    slug:           str
    description:    str | None
    is_required:    bool
    is_active:      bool
    display_order:  int
    created_at:     datetime

    model_config = {"from_attributes": True}


class CreateDocumentTypeRequest(BaseModel):
    """Admin creates a new document type."""
    model_config = {"extra": "forbid"}

    name:           str         = Field(min_length=2, max_length=100)
    slug:           str         = Field(min_length=2, max_length=60,
                                        pattern=r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
    description:    str | None  = Field(default=None, max_length=500)
    is_required:    bool        = False
    display_order:  int         = 0

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()


class UpdateDocumentTypeRequest(BaseModel):
    """Admin updates an existing document type."""
    model_config = {"extra": "forbid"}

    name:           str | None  = Field(default=None, min_length=2, max_length=100)
    description:    str | None  = Field(default=None, max_length=500)
    is_required:    bool | None = None
    is_active:      bool | None = None
    display_order:  int | None  = None


# ══════════════════════════════════════════════════════════════════════════════
# KYC DOCUMENTS
# ══════════════════════════════════════════════════════════════════════════════

class KycDocumentResponse(BaseModel):
    """A single uploaded KYC document."""
    id:                 UUID
    submission_id:      UUID
    document_type_id:   UUID
    document_type_name: str
    document_type_slug: str
    storage_path:       str
    signed_url:         str     # pre-signed, short expiry
    original_name:      str | None
    file_size_bytes:    int | None
    mime_type:          str | None
    file_hash:          str     # SHA-256
    uploaded_at:        datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# KYC SUBMISSIONS
# ══════════════════════════════════════════════════════════════════════════════

class KycSubmissionResponse(BaseModel):
    """Full submission detail — returned to buyer, agent, admin."""
    id:                 UUID
    buyer_id:           UUID
    buyer_name:         str | None
    buyer_company:      str | None
    buyer_email:        str | None
    cycle_number:       int
    status:             str
    locked_at:          datetime | None
    submitted_at:       datetime | None
    decided_at:         datetime | None
    expires_at:         datetime | None
    rejection_reason:   str | None
    documents:          list[KycDocumentResponse] = []
    reviews:            list[KycReviewResponse]   = []
    assignment:         KycAssignmentResponse | None = None
    created_at:         datetime
    updated_at:         datetime

    model_config = {"from_attributes": True}


class KycSubmissionListItem(BaseModel):
    """Compact submission card for queue/list views."""
    id:             UUID
    buyer_id:       UUID
    buyer_name:     str | None
    buyer_company:  str | None
    cycle_number:   int
    status:         str
    submitted_at:   datetime | None
    risk_score:     str | None      # most recent review risk score (if any)
    assigned_agent: str | None      # agent full_name (if assigned)
    document_count: int
    created_at:     datetime
    buyer_phone_verified: bool = False
    buyer_phone:    str | None = None

    model_config = {"from_attributes": True}


class PaginatedKycSubmissionsResponse(BaseModel):
    items:      list[KycSubmissionListItem]
    total:      int
    page:       int
    page_size:  int
    pages:      int


# ══════════════════════════════════════════════════════════════════════════════
# BUYER STATUS VIEW
# ══════════════════════════════════════════════════════════════════════════════

class KycDocumentBrief(BaseModel):
    """Brief document info for the KYC dashboard."""
    id:                  UUID
    document_type_id:    UUID | None
    document_type_name:  str
    document_type_slug:  str | None
    original_name:       str | None
    uploaded_at:         datetime


class KycStatusResponse(BaseModel):
    """Buyer's own KYC dashboard view."""
    kyc_status:                 str
    kyc_expires_at:             datetime | None
    kyc_attempt_count:          int
    current_submission_id:      UUID | None
    current_submission_status:  str | None
    required_document_types:    list[DocumentTypeResponse]
    optional_document_types:    list[DocumentTypeResponse]
    uploaded_document_count:    int
    rejection_reason:           str | None
    phone_verified:             bool = False
    phone:                      str | None = None
    documents:                  list[KycDocumentBrief] = []


# ══════════════════════════════════════════════════════════════════════════════
# ASSIGNMENTS
# ══════════════════════════════════════════════════════════════════════════════

class AssignKycAgentRequest(BaseModel):
    """Admin assigns a buyer_agent to a submitted KYC."""
    model_config = {"extra": "forbid"}

    agent_id: UUID


class KycAssignmentResponse(BaseModel):
    """Agent's view of their KYC assignment."""
    id:                 UUID
    submission_id:      UUID
    agent_id:           UUID
    agent_name:         str | None
    assigned_by_name:   str | None
    status:             str
    created_at:         datetime
    updated_at:         datetime

    model_config = {"from_attributes": True}


class UpdateKycAssignmentRequest(BaseModel):
    """Agent updates their assignment status."""
    model_config = {"extra": "forbid"}

    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {"in_review"}
        if v not in allowed:
            raise ValueError(f"status must be one of: {sorted(allowed)}")
        return v


# ══════════════════════════════════════════════════════════════════════════════
# REVIEWS
# ══════════════════════════════════════════════════════════════════════════════

class KycAgentReviewRequest(BaseModel):
    """
    Buyer agent submits their assessment.
    If is_pep=True or sanctions_match=True, risk_score is forced to 'high'
    and recommendation is restricted to 'reject' or 'requires_resubmission'.
    """
    model_config = {"extra": "forbid"}

    assessment:         str  = Field(min_length=20, max_length=10_000)
    risk_score:         str
    is_pep:             bool = False
    sanctions_match:    bool = False
    recommendation:     str

    @field_validator("risk_score")
    @classmethod
    def validate_risk(cls, v: str) -> str:
        if v not in RISK_SCORES:
            raise ValueError(f"risk_score must be one of: {sorted(RISK_SCORES)}")
        return v

    @field_validator("recommendation")
    @classmethod
    def validate_recommendation(cls, v: str) -> str:
        if v not in RECOMMENDATIONS:
            raise ValueError(f"recommendation must be one of: {sorted(RECOMMENDATIONS)}")
        return v


class KycAdminDecisionRequest(BaseModel):
    """
    Admin makes the final KYC decision.
    Agents cannot approve; only admin can set status to 'approved'.
    If is_pep=True or sanctions_match=True, 'approve' is blocked.
    """
    model_config = {"extra": "forbid"}

    decision:           str
    assessment:         str  = Field(min_length=10, max_length=10_000)
    risk_score:         str
    is_pep:             bool = False
    sanctions_match:    bool = False
    reason:             str | None = Field(default=None, max_length=2000)

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, v: str) -> str:
        if v not in RECOMMENDATIONS:
            raise ValueError(f"decision must be one of: {sorted(RECOMMENDATIONS)}")
        return v

    @field_validator("risk_score")
    @classmethod
    def validate_risk(cls, v: str) -> str:
        if v not in RISK_SCORES:
            raise ValueError(f"risk_score must be one of: {sorted(RISK_SCORES)}")
        return v


class KycReviewResponse(BaseModel):
    """A single review record."""
    id:                 UUID
    submission_id:      UUID
    reviewer_id:        UUID
    reviewer_name:      str | None
    reviewer_role:      str
    assessment:         str
    risk_score:         str
    is_pep:             bool
    sanctions_match:    bool
    recommendation:     str
    created_at:         datetime

    model_config = {"from_attributes": True}


# ── Forward-reference resolution ─────────────────────────────────────────────
KycSubmissionResponse.model_rebuild()
