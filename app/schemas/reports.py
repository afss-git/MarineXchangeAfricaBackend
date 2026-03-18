"""
Phase 6 — Reporting schemas.

Covers all six report modules:
  1. Admin Overview Dashboard
  2. Financial Report
  3. Deal Pipeline Report
  4. KYC Compliance Report
  5. Marketplace Health Report
  6. Agent Workload & Performance Report
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


# ─── 1. Overview Dashboard ────────────────────────────────────────────────────

class ListingStats(BaseModel):
    total: int
    live: int
    pending_verification: int
    pending_approval: int
    rejected: int
    delisted: int


class DealStats(BaseModel):
    total: int
    draft: int
    offer_sent: int
    accepted: int
    active: int
    completed: int
    cancelled: int
    defaulted: int
    awaiting_second_approval: int


class KycOverviewStats(BaseModel):
    total_buyers: int
    active_kyc: int
    expired_kyc: int
    pending_review: int
    expiring_soon: int


class PaymentAlerts(BaseModel):
    pending_verification: int
    disputed: int


class OverviewDashboard(BaseModel):
    listings: ListingStats
    deals: DealStats
    kyc: KycOverviewStats
    payment_alerts: PaymentAlerts
    generated_at: datetime


# ─── 2. Financial Report ──────────────────────────────────────────────────────

class PaymentSummary(BaseModel):
    total_payments: int
    total_verified: int
    total_pending: int
    total_disputed: int
    amount_verified: Decimal
    amount_pending: Decimal
    amount_disputed: Decimal


class DealTypeSummary(BaseModel):
    deal_type: str
    count: int
    total_value: Decimal
    total_collected: Decimal


class LateInstallmentItem(BaseModel):
    deal_id: UUID
    deal_ref: str
    buyer_name: str
    installment_number: int
    due_date: date
    total_due: Decimal
    days_overdue: int


class DefaultedDealItem(BaseModel):
    deal_id: UUID
    deal_ref: str
    buyer_name: str
    total_price: Decimal
    amount_collected: Decimal
    outstanding: Decimal


class FinancialReport(BaseModel):
    period_from: date
    period_to: date
    payment_summary: PaymentSummary
    by_deal_type: list[DealTypeSummary]
    late_installments: list[LateInstallmentItem]
    defaulted_deals: list[DefaultedDealItem]
    generated_at: datetime


# ─── 3. Deal Pipeline Report ──────────────────────────────────────────────────

class DealPipelineItem(BaseModel):
    deal_id: UUID
    deal_ref: str
    product_title: str
    buyer_name: str
    seller_name: str
    deal_type: str
    total_price: Decimal
    currency: str
    status: str
    days_in_status: int
    requires_second_approval: bool
    second_approved: bool
    created_at: datetime


class DealPipelineReport(BaseModel):
    period_from: date
    period_to: date
    total: int
    by_status: dict[str, int]
    deals: list[DealPipelineItem]
    generated_at: datetime


# ─── 4. KYC Compliance Report ─────────────────────────────────────────────────

class KycComplianceItem(BaseModel):
    submission_id: UUID
    buyer_id: UUID
    buyer_name: str
    buyer_email: str
    status: str
    submitted_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    days_until_expiry: Optional[int] = None
    rejection_reason: Optional[str] = None
    is_pep: bool = False
    sanctions_match: bool = False


class KycComplianceReport(BaseModel):
    period_from: date
    period_to: date
    total: int
    by_status: dict[str, int]
    expiring_within_30_days: int
    submissions: list[KycComplianceItem]
    generated_at: datetime


# ─── 5. Marketplace Health Report ────────────────────────────────────────────

class MarketplaceListingItem(BaseModel):
    product_id: UUID
    title: str
    category: str
    seller_name: str
    status: str
    price: Decimal
    currency: str
    days_in_status: int
    assigned_agent: Optional[str] = None
    created_at: datetime


class CategoryStat(BaseModel):
    category: str
    total: int
    active: int
    pending: int


class MarketplaceHealthReport(BaseModel):
    period_from: date
    period_to: date
    total_listings: int
    by_status: dict[str, int]
    by_category: list[CategoryStat]
    stuck_listings: list[MarketplaceListingItem]
    generated_at: datetime


# ─── 6. Agent Workload & Performance Report ───────────────────────────────────

class AgentPerformanceItem(BaseModel):
    agent_id: UUID
    agent_name: str
    agent_email: str
    kyc_assigned: int
    kyc_reviewed: int
    kyc_approved: int
    kyc_rejected: int
    listings_assigned: int
    listings_verified: int
    listings_rejected: int
    avg_kyc_review_hours: Optional[float] = None
    avg_listing_review_hours: Optional[float] = None


class AgentWorkloadReport(BaseModel):
    period_from: date
    period_to: date
    agents: list[AgentPerformanceItem]
    generated_at: datetime
