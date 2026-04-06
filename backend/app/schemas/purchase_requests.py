"""
Phase 7 — Purchase Request Flow schemas (Pydantic v2).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════════════════════
# BUYER ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

class PurchaseRequestCreate(BaseModel):
    product_id:       UUID
    purchase_type:    Literal["full_payment", "financing"]
    quantity:         int              = Field(default=1, ge=1, le=100)
    offered_price:    Decimal          = Field(..., gt=0, description="Buyer's offered price in USD")
    offered_currency: str              = Field(default="USD", max_length=10)
    message:          Optional[str]    = Field(default=None, max_length=2000)


class PurchaseRequestResponse(BaseModel):
    id:               UUID
    product_id:       UUID
    product_title:    Optional[str]    = None
    buyer_id:         UUID
    purchase_type:    str
    quantity:         int
    offered_price:    Optional[Decimal]
    offered_currency: str
    message:          Optional[str]
    status:           str
    admin_notes:      Optional[str]    = None
    converted_deal_id: Optional[UUID]  = None
    cancelled_reason: Optional[str]    = None
    reviewed_at:      Optional[datetime] = None
    created_at:       datetime
    updated_at:       datetime

    model_config = {"from_attributes": True}


class PurchaseRequestListResponse(BaseModel):
    items: list[PurchaseRequestResponse]
    total: int


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

class AssignAgentRequest(BaseModel):
    agent_id: UUID
    notes:    Optional[str] = Field(default=None, max_length=1000)


class ApproveRequestBody(BaseModel):
    admin_notes:          Optional[str] = Field(default=None, max_length=2000)
    admin_bypass_reason:  Optional[str] = Field(
        default=None, max_length=2000,
        description="Required when bypassing agent recommendation"
    )


class RejectRequestBody(BaseModel):
    admin_notes: str = Field(..., min_length=1, max_length=2000)


class ConvertToDealBody(BaseModel):
    """
    Convert an approved purchase request to a DRAFT deal.
    Admin finalises price and deal type here.
    """
    deal_type:      Literal["full_payment", "financing"]
    agreed_price:   Decimal = Field(..., gt=0, description="Admin-confirmed price in USD")
    currency:       str     = Field(default="USD", max_length=10)
    admin_notes:    Optional[str] = Field(default=None, max_length=2000)


class ConvertToDealResponse(BaseModel):
    deal_id:     UUID
    deal_ref:    str
    deal_status: str
    request_id:  UUID
    message:     str


class AdminPurchaseRequestDetail(BaseModel):
    id:               UUID
    product_id:       UUID
    product_title:    Optional[str]    = None
    # Enriched product fields
    product_asking_price:      Optional[Decimal] = None
    product_currency:          Optional[str]     = None
    product_condition:         Optional[str]     = None
    product_availability_type: Optional[str]     = None
    product_location_country:  Optional[str]     = None
    product_location_port:     Optional[str]     = None
    product_primary_image_url: Optional[str]     = None
    seller_company:            Optional[str]     = None
    buyer_id:         UUID
    buyer_name:       Optional[str]   = None
    buyer_email:      Optional[str]   = None
    # Enriched buyer fields
    buyer_phone:         Optional[str] = None
    buyer_company_name:  Optional[str] = None
    buyer_kyc_status:    Optional[str] = None
    buyer_country:       Optional[str] = None
    purchase_type:    str
    quantity:         int
    offered_price:    Optional[Decimal]
    offered_currency: str
    message:          Optional[str]
    status:           str
    admin_notes:      Optional[str]
    admin_bypass_reason: Optional[str]
    cancelled_reason: Optional[str]
    converted_deal_id: Optional[UUID]
    reviewed_by:      Optional[UUID]
    reviewed_at:      Optional[datetime]
    agent_assignment: Optional[AgentAssignmentInfo] = None
    agent_report:     Optional[AgentReportInfo]     = None
    created_at:       datetime
    updated_at:       datetime

    model_config = {"from_attributes": True}


class AgentAssignmentInfo(BaseModel):
    id:         UUID
    agent_id:   UUID
    agent_name: Optional[str] = None
    status:     str
    notes:      Optional[str]
    created_at: datetime


class AgentReportInfo(BaseModel):
    id:                     UUID
    agent_id:               UUID
    agent_name:             Optional[str] = None
    financial_capacity_usd: Decimal
    risk_rating:            str
    recommendation:         str
    verification_notes:     str
    created_at:             datetime


class AdminPurchaseRequestList(BaseModel):
    items: list[AdminPurchaseRequestDetail]
    total: int


# ══════════════════════════════════════════════════════════════════════════════
# AGENT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

class SubmitAgentReport(BaseModel):
    financial_capacity_usd: Decimal = Field(..., gt=0)
    risk_rating:            Literal["low", "medium", "high"]
    recommendation:         Literal["recommend_approve", "recommend_reject"]
    verification_notes:     str = Field(..., min_length=10, max_length=5000)


class AgentAssignedRequest(BaseModel):
    id:               UUID
    product_id:       UUID
    product_title:    Optional[str]  = None
    buyer_id:         UUID
    buyer_name:       Optional[str]  = None
    purchase_type:    str
    quantity:         int
    offered_price:    Optional[Decimal]
    offered_currency: str
    message:          Optional[str]
    status:           str
    assignment_status: Optional[str] = None
    assignment_notes:  Optional[str] = None
    report_submitted:  bool           = False
    created_at:       datetime

    model_config = {"from_attributes": True}


class AgentAssignedList(BaseModel):
    items: list[AgentAssignedRequest]
    total: int
