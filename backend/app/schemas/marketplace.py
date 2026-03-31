"""
Pydantic v2 schemas for the marketplace product listing system.

Covers:
  - Product create / update / response
  - Image upload / response
  - Category response (nested tree)
  - Attribute definitions and values
  - Seller contact
  - Verification workflow (agent assignment, status updates, reports)
  - Admin decisions and edits
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


# ── Constants ─────────────────────────────────────────────────────────────────

AVAILABILITY_TYPES = frozenset({
    "for_sale", "hire", "lease", "bareboat_charter", "time_charter"
})

CONDITION_TYPES = frozenset({"new", "used", "refurbished"})

ATTRIBUTE_DATA_TYPES = frozenset({"text", "numeric", "boolean", "date"})

VERIFICATION_OUTCOMES = frozenset({"verified", "failed", "requires_clarification"})

ADMIN_DECISIONS = frozenset({"approve", "reject", "request_corrections"})

ASSIGNMENT_STATUSES = frozenset({
    "assigned", "contacted", "inspection_scheduled", "inspection_done", "report_submitted"
})

ALLOWED_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})


# ── Shared field types ────────────────────────────────────────────────────────

TitleField = Annotated[str, Field(min_length=3, max_length=200)]
SlugField  = Annotated[str, Field(min_length=2, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]


# ══════════════════════════════════════════════════════════════════════════════
# CATEGORIES
# ══════════════════════════════════════════════════════════════════════════════

class CategoryResponse(BaseModel):
    """Single category node — may include nested subcategories."""
    id:             UUID
    name:           str
    slug:           str
    parent_id:      UUID | None
    description:    str | None
    icon:           str | None
    display_order:  int
    subcategories:  list[CategoryResponse] = []

    model_config = {"from_attributes": True}


CategoryResponse.model_rebuild()  # needed for self-referential model


# ══════════════════════════════════════════════════════════════════════════════
# ATTRIBUTES
# ══════════════════════════════════════════════════════════════════════════════

class AttributeDefinitionResponse(BaseModel):
    """An attribute definition (the template, not the value)."""
    id:             UUID
    name:           str
    slug:           str
    data_type:      str
    unit:           str | None
    category_id:    UUID | None
    display_order:  int

    model_config = {"from_attributes": True}


class AttributeValueInput(BaseModel):
    """
    A single attribute value to set on a product.
    Provide exactly one of: value_text, value_numeric, value_boolean, value_date.
    """
    model_config = {"extra": "forbid"}

    attribute_id:   UUID
    value_text:     str | None    = Field(default=None, max_length=2000)
    value_numeric:  Decimal | None = None
    value_boolean:  bool | None   = None
    value_date:     date | None   = None

    @model_validator(mode="after")
    def exactly_one_value(self) -> AttributeValueInput:
        filled = sum(v is not None for v in [
            self.value_text, self.value_numeric, self.value_boolean, self.value_date
        ])
        if filled == 0:
            raise ValueError(
                "Provide exactly one of: value_text, value_numeric, value_boolean, value_date."
            )
        if filled > 1:
            raise ValueError(
                "Only one value field may be set per attribute_id."
            )
        return self


class AttributeValueResponse(BaseModel):
    """A resolved attribute value with its definition metadata."""
    attribute_id:    UUID
    attribute_name:  str
    attribute_slug:  str
    data_type:       str
    unit:            str | None
    value_text:      str | None
    value_numeric:   Decimal | None
    value_boolean:   bool | None
    value_date:      date | None
    set_by_name:     str | None     # full_name of the profile who last set this
    updated_at:      datetime

    model_config = {"from_attributes": True}


class CreateAttributeRequest(BaseModel):
    """Agent or admin creates a new attribute definition."""
    model_config = {"extra": "forbid"}

    name:           str   = Field(min_length=2, max_length=100)
    slug:           SlugField
    data_type:      str   = "text"
    unit:           str | None = Field(default=None, max_length=30)
    category_id:    UUID | None = None
    display_order:  int   = 0

    @field_validator("data_type")
    @classmethod
    def validate_data_type(cls, v: str) -> str:
        if v not in ATTRIBUTE_DATA_TYPES:
            raise ValueError(f"data_type must be one of: {sorted(ATTRIBUTE_DATA_TYPES)}")
        return v

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()


# ══════════════════════════════════════════════════════════════════════════════
# PRODUCT CONTACT
# ══════════════════════════════════════════════════════════════════════════════

class ProductContactInput(BaseModel):
    model_config = {"extra": "forbid"}

    contact_name:   str            = Field(min_length=2, max_length=100)
    phone:          str | None     = Field(default=None, max_length=30)
    email:          EmailStr

    @field_validator("contact_name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()


class ProductContactResponse(BaseModel):
    contact_name:   str
    phone:          str
    email:          str

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# PRODUCT IMAGES
# ══════════════════════════════════════════════════════════════════════════════

class ProductImageResponse(BaseModel):
    id:                 UUID
    storage_path:       str
    signed_url:         str         # pre-signed, expires in settings.SIGNED_URL_EXPIRY_SECONDS
    original_name:      str | None
    file_size_bytes:    int | None
    mime_type:          str | None
    is_primary:         bool
    display_order:      int
    uploaded_at:        datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# PRODUCT CREATE / UPDATE
# ══════════════════════════════════════════════════════════════════════════════

class ProductCreateRequest(BaseModel):
    """
    Seller creates a new product listing (draft).
    Images are uploaded separately after draft creation.
    """
    model_config = {"extra": "forbid"}

    title:              TitleField
    category_id:        UUID
    description:        str | None   = Field(default=None, max_length=10_000)
    availability_type:  str
    condition:          str          = "used"
    location_country:   str          = Field(min_length=2, max_length=100)
    location_port:      str | None   = Field(default=None, max_length=200)
    location_details:   str | None   = Field(default=None, max_length=500)
    asking_price:       Decimal      = Field(ge=0)   # 0 = price on request
    currency:           str          = Field(default="USD", min_length=3, max_length=5)
    contact:            ProductContactInput
    attribute_values:   list[AttributeValueInput] = []

    @field_validator("availability_type")
    @classmethod
    def validate_availability(cls, v: str) -> str:
        if v not in AVAILABILITY_TYPES:
            raise ValueError(f"availability_type must be one of: {sorted(AVAILABILITY_TYPES)}")
        return v

    @field_validator("condition")
    @classmethod
    def validate_condition(cls, v: str) -> str:
        if v not in CONDITION_TYPES:
            raise ValueError(f"condition must be one of: {sorted(CONDITION_TYPES)}")
        return v

    @field_validator("title", "location_country")
    @classmethod
    def strip_text(cls, v: str) -> str:
        return v.strip()

    @field_validator("currency")
    @classmethod
    def uppercase_currency(cls, v: str) -> str:
        return v.strip().upper()


class ProductUpdateRequest(BaseModel):
    """
    Seller updates a draft listing.
    All fields are optional — only provided fields are updated.
    """
    model_config = {"extra": "forbid"}

    title:              str | None   = Field(default=None, min_length=3, max_length=200)
    category_id:        UUID | None  = None
    description:        str | None   = Field(default=None, max_length=10_000)
    availability_type:  str | None   = None
    condition:          str | None   = None
    location_country:   str | None   = Field(default=None, min_length=2, max_length=100)
    location_port:      str | None   = Field(default=None, max_length=200)
    location_details:   str | None   = Field(default=None, max_length=500)
    asking_price:       Decimal | None = Field(default=None, gt=0)
    currency:           str | None   = Field(default=None, min_length=3, max_length=5)
    contact:            ProductContactInput | None = None
    attribute_values:   list[AttributeValueInput] | None = None

    @field_validator("availability_type")
    @classmethod
    def validate_availability(cls, v: str | None) -> str | None:
        if v is not None and v not in AVAILABILITY_TYPES:
            raise ValueError(f"availability_type must be one of: {sorted(AVAILABILITY_TYPES)}")
        return v

    @field_validator("condition")
    @classmethod
    def validate_condition(cls, v: str | None) -> str | None:
        if v is not None and v not in CONDITION_TYPES:
            raise ValueError(f"condition must be one of: {sorted(CONDITION_TYPES)}")
        return v

    @field_validator("currency")
    @classmethod
    def uppercase_currency(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v


# ══════════════════════════════════════════════════════════════════════════════
# PRODUCT RESPONSES
# ══════════════════════════════════════════════════════════════════════════════

class ProductListItemResponse(BaseModel):
    """Compact product card for listing pages."""
    id:                 UUID
    title:              str
    category_id:        UUID | None
    category_name:      str | None
    availability_type:  str
    condition:          str
    asking_price:       Decimal
    currency:           str
    location_country:   str
    location_port:      str | None
    status:             str
    primary_image_url:  str | None   # signed URL of the primary image
    created_at:         datetime
    seller_id:          UUID
    seller_company:     str | None
    verification_agent: str | None = None  # name of currently assigned agent

    model_config = {"from_attributes": True}


class ProductDetailResponse(BaseModel):
    """Full product detail — contact shown only to seller, agents, admins."""
    id:                 UUID
    seller_id:          UUID
    seller_company:     str | None
    title:              str
    description:        str | None
    category_id:        UUID | None
    category_name:      str | None
    availability_type:  str
    condition:          str
    asking_price:       Decimal
    currency:           str
    location_country:   str
    location_port:      str | None
    location_details:   str | None
    status:             str
    verification_cycle: int
    is_auction:         bool
    images:             list[ProductImageResponse]
    attribute_values:   list[AttributeValueResponse]
    contact:            ProductContactResponse | None   # None for anonymous public view
    created_at:         datetime
    updated_at:         datetime
    verification_agent:      str | None = None  # name of currently assigned agent
    verification_assignment_id: UUID | None = None
    seller_email:            str | None = None
    seller_phone:            str | None = None
    submitted_at:            datetime | None = None
    admin_notes:             str | None = None
    rejection_reason:        str | None = None

    model_config = {"from_attributes": True}


class ProductSubmitResponse(BaseModel):
    """Returned after a seller submits or resubmits a listing."""
    message:    str
    product_id: UUID
    new_status: str


# ══════════════════════════════════════════════════════════════════════════════
# VERIFICATION WORKFLOW
# ══════════════════════════════════════════════════════════════════════════════

class AssignVerificationAgentRequest(BaseModel):
    """Admin assigns a verification agent to a pending product."""
    model_config = {"extra": "forbid"}

    agent_id:            UUID
    full_history_access: bool = False


class UpdateVerificationAssignmentRequest(BaseModel):
    """Agent updates their assignment progress."""
    model_config = {"extra": "forbid"}

    status:             str
    scheduled_date:     date | None = None
    contact_notes:      str | None  = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {"in_progress", "contacted", "inspection_scheduled", "inspection_done"}
        if v not in allowed:
            raise ValueError(f"status must be one of: {sorted(allowed)}")
        return v


_RECOMMENDATION_TO_OUTCOME = {
    "approve": "verified",
    "reject": "failed",
    "request_corrections": "requires_clarification",
}
_OUTCOME_TO_RECOMMENDATION = {v: k for k, v in _RECOMMENDATION_TO_OUTCOME.items()}


class EvidenceFileInput(BaseModel):
    """A pre-uploaded evidence file to attach to a verification report."""
    storage_path: str
    file_type:    str = "image"   # "image" | "document"
    description:  str = ""


class SubmitVerificationReportRequest(BaseModel):
    """
    Agent submits a verification report (immutable after submission).
    If attribute_updates are included, they are persisted on the product.
    """
    model_config = {"extra": "forbid"}

    condition_confirmed:    str          = Field(min_length=1, max_length=500)
    price_assessment:       str          = Field(min_length=1, max_length=1000)
    documentation_complete: bool         = True
    notes:                  str          = Field(min_length=10, max_length=10_000)
    recommendation:         str
    attribute_updates:      list[AttributeValueInput] = []
    evidence_files:         list[EvidenceFileInput]   = []

    @field_validator("recommendation")
    @classmethod
    def validate_recommendation(cls, v: str) -> str:
        if v not in _RECOMMENDATION_TO_OUTCOME:
            raise ValueError(f"recommendation must be one of: {sorted(_RECOMMENDATION_TO_OUTCOME)}")
        return v

    @property
    def outcome(self) -> str:
        return _RECOMMENDATION_TO_OUTCOME[self.recommendation]


class VerificationReportOut(BaseModel):
    id:                     UUID
    assignment_id:          UUID
    outcome:                str                  # verified | failed | requires_clarification
    recommendation:         str = ""             # computed alias — populated by validator
    findings:               str                  # agent's inspection notes
    asset_condition:        str | None = None    # condition_confirmed
    recommendations:        str | None = None    # price_assessment
    issues_found:           str | None = None
    submitted_at:           datetime
    # Frontend-friendly aliases (None if not mapped)
    condition_confirmed:    str | None = None
    price_assessment:       str | None = None
    documentation_complete: bool = True
    notes:                  str = ""
    created_at:             datetime | None = None

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _populate_aliases(self) -> "VerificationReportOut":
        _outcome_map = {
            "verified": "approve",
            "failed": "reject",
            "requires_clarification": "request_corrections",
        }
        if not self.recommendation:
            self.recommendation = _outcome_map.get(self.outcome, self.outcome)
        if self.condition_confirmed is None:
            self.condition_confirmed = self.asset_condition
        if self.price_assessment is None:
            self.price_assessment = self.recommendations
        if not self.notes:
            self.notes = self.findings
        if self.created_at is None:
            self.created_at = self.submitted_at
        return self


class VerificationAssignmentResponse(BaseModel):
    """Agent's view of a verification assignment — includes inlined product fields."""
    id:                 UUID
    product_id:         UUID
    product_title:      str
    seller_company:     str | None = None
    seller_name:        str | None = None
    seller_phone:       str | None = None
    seller_email:       str | None = None
    agent_id:           UUID
    assigned_by_name:   str | None = None
    cycle_number:       int
    status:             str
    product_status:     str | None = None
    full_history_access: bool = False
    scheduled_date:     date | None = None
    contact_notes:      str | None = None
    assigned_at:        datetime
    updated_at:         datetime
    report_submitted:   bool
    # Inlined product fields
    asking_price:       Decimal | None = None
    currency:           str | None = None
    condition:          str | None = None
    location_country:   str | None = None
    location_port:      str | None = None
    category_name:      str | None = None
    availability_type:  str | None = None
    description:        str | None = None
    images:             list[dict] = []
    attribute_values:   list[dict] = []
    report:             VerificationReportOut | None = None
    evidence_files:     list[dict] = []
    previous_cycles:    list[dict] = []

    model_config = {"from_attributes": True}


class ProductSpecUpdateRequest(BaseModel):
    """Agent or admin updates product specification attributes."""
    model_config = {"extra": "forbid"}

    attribute_values:   list[AttributeValueInput] = Field(min_length=1)


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN ACTIONS
# ══════════════════════════════════════════════════════════════════════════════

class AdminProductDecisionRequest(BaseModel):
    """
    Admin approves, rejects, or requests corrections on a verified listing.

    decision = "approve"             → status becomes active
    decision = "reject"              → status becomes rejected
    decision = "request_corrections" → status becomes pending_reverification
    """
    model_config = {"extra": "forbid"}

    decision:   str
    reason:     str | None = Field(default=None, max_length=2000)

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, v: str) -> str:
        if v not in ADMIN_DECISIONS:
            raise ValueError(f"decision must be one of: {sorted(ADMIN_DECISIONS)}")
        return v


class AdminProductUpdateRequest(BaseModel):
    """
    Admin can edit a listing's core fields after approval.
    Agents/admins can also update specs separately via ProductSpecUpdateRequest.
    """
    model_config = {"extra": "forbid"}

    title:              str | None   = Field(default=None, min_length=3, max_length=200)
    description:        str | None   = Field(default=None, max_length=10_000)
    asking_price:       Decimal | None = Field(default=None, gt=0)
    currency:           str | None   = Field(default=None, min_length=3, max_length=5)
    location_country:   str | None   = Field(default=None, min_length=2, max_length=100)
    location_port:      str | None   = Field(default=None, max_length=200)
    location_details:   str | None   = Field(default=None, max_length=500)
    availability_type:  str | None   = None
    condition:          str | None   = None

    @field_validator("availability_type")
    @classmethod
    def validate_availability(cls, v: str | None) -> str | None:
        if v is not None and v not in AVAILABILITY_TYPES:
            raise ValueError(f"availability_type must be one of: {sorted(AVAILABILITY_TYPES)}")
        return v

    @field_validator("condition")
    @classmethod
    def validate_condition(cls, v: str | None) -> str | None:
        if v is not None and v not in CONDITION_TYPES:
            raise ValueError(f"condition must be one of: {sorted(CONDITION_TYPES)}")
        return v

    @field_validator("currency")
    @classmethod
    def uppercase_currency(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v


# ── Paginated list wrapper ─────────────────────────────────────────────────────

class PaginatedProductsResponse(BaseModel):
    items:      list[ProductListItemResponse]
    total:      int
    page:       int
    page_size:  int
    pages:      int
