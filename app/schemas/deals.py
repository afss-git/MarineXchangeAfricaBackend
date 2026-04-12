"""
Phase 5 — Deal, Payment & Financing schemas (Pydantic v2).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT ACCOUNT SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class PaymentAccountCreate(BaseModel):
    bank_name: str = Field(..., min_length=1, max_length=200)
    account_name: str = Field(default="Harbours360 Ltd", max_length=200)
    account_number: str = Field(..., min_length=1, max_length=100)
    sort_code: str | None = None
    swift_code: str | None = None
    iban: str | None = None
    routing_number: str | None = None
    currency: str = Field(default="USD", max_length=10)
    country: str = Field(default="NG", max_length=10)
    additional_info: str | None = None


class PaymentAccountUpdate(BaseModel):
    bank_name: str | None = Field(default=None, min_length=1, max_length=200)
    account_name: str | None = Field(default=None, max_length=200)
    account_number: str | None = Field(default=None, min_length=1, max_length=100)
    sort_code: str | None = None
    swift_code: str | None = None
    iban: str | None = None
    routing_number: str | None = None
    currency: str | None = Field(default=None, max_length=10)
    country: str | None = Field(default=None, max_length=10)
    additional_info: str | None = None
    is_active: bool | None = None


class PaymentAccountResponse(BaseModel):
    id: UUID
    bank_name: str
    account_name: str
    account_number: str
    sort_code: str | None
    swift_code: str | None
    iban: str | None
    routing_number: str | None
    currency: str
    country: str
    additional_info: str | None
    is_active: bool
    created_by: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# RATE SCHEDULE SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class RateScheduleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    asset_class: str | None = None
    # Keys are duration_months as strings, values are MONTHLY rates (not annual)
    # e.g. {"3": 0.035, "6": 0.039, "12": 0.045}
    monthly_rates: dict[str, float] = Field(...)
    arrangement_fee: Decimal = Field(default=Decimal("0"), ge=0)
    min_down_payment_percent: Decimal = Field(default=Decimal("20.00"), ge=0, le=100)
    max_down_payment_percent: Decimal = Field(default=Decimal("80.00"), ge=0, le=100)

    @field_validator("monthly_rates")
    @classmethod
    def validate_monthly_rates(cls, v: dict[str, float]) -> dict[str, float]:
        if not v:
            raise ValueError("monthly_rates must not be empty")
        for k, rate in v.items():
            try:
                months = int(k)
            except ValueError:
                raise ValueError(f"Rate schedule key '{k}' must be an integer string (months)")
            if months < 1 or months > 120:
                raise ValueError(f"Duration months key '{k}' must be between 1 and 120")
            if rate <= 0 or rate > 0.20:
                raise ValueError(f"Monthly rate {rate} for {k} months is out of range (0, 0.20]")
        return v

    @model_validator(mode="after")
    def validate_down_payment_range(self) -> "RateScheduleCreate":
        if self.min_down_payment_percent > self.max_down_payment_percent:
            raise ValueError("min_down_payment_percent must not exceed max_down_payment_percent")
        return self


class RateScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    asset_class: str | None = None
    monthly_rates: dict[str, float] | None = None
    arrangement_fee: Decimal | None = Field(default=None, ge=0)
    min_down_payment_percent: Decimal | None = Field(default=None, ge=0, le=100)
    max_down_payment_percent: Decimal | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None


class RateScheduleResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    asset_class: str | None
    monthly_rates: dict[str, Any]
    arrangement_fee: Decimal
    min_down_payment_percent: Decimal
    max_down_payment_percent: Decimal
    is_active: bool
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# BUYER CREDIT PROFILE SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class BuyerCreditProfileSet(BaseModel):
    is_financing_eligible: bool
    credit_limit_usd: Decimal | None = Field(default=None, gt=0)
    max_single_deal_usd: Decimal | None = Field(default=None, gt=0)
    collateral_notes: str | None = None
    risk_rating: Literal["low", "medium", "high"] | None = None
    notes: str | None = None


class BuyerCreditProfileResponse(BaseModel):
    buyer_id: UUID
    is_financing_eligible: bool
    credit_limit_usd: Decimal | None
    max_single_deal_usd: Decimal | None
    collateral_notes: str | None
    risk_rating: str | None
    notes: str | None
    set_by: UUID | None
    set_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# DEAL SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class DealCreate(BaseModel):
    product_id: UUID
    buyer_id: UUID
    deal_type: Literal["full_payment", "financing"]
    total_price: Decimal = Field(..., gt=0)
    currency: str = Field(default="USD", max_length=10)
    purchase_request_id: UUID | None = None
    admin_notes: str | None = None

    # Full payment fields
    payment_account_id: UUID | None = None
    payment_deadline: datetime | None = None
    payment_instructions: str | None = None

    # Financing fields
    initial_payment_percent: Decimal | None = Field(default=None, ge=10, le=90)
    duration_months: int | None = Field(default=None, ge=1, le=120)
    monthly_finance_rate: Decimal | None = Field(default=None, ge=Decimal("0.001"), le=Decimal("0.10"))
    arrangement_fee: Decimal = Field(default=Decimal("0"), ge=0)
    rate_schedule_id: UUID | None = None

    @model_validator(mode="after")
    def validate_deal_type_fields(self) -> "DealCreate":
        if self.deal_type == "full_payment":
            if not self.payment_account_id:
                raise ValueError("payment_account_id is required for full_payment deals")
        elif self.deal_type == "financing":
            if self.initial_payment_percent is None:
                raise ValueError("initial_payment_percent is required for financing deals")
            if self.duration_months is None:
                raise ValueError("duration_months is required for financing deals")
            if self.monthly_finance_rate is None:
                raise ValueError("monthly_finance_rate is required for financing deals")
        return self


class DealUpdate(BaseModel):
    """Only allowed when deal status is 'draft'."""
    total_price: Decimal | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, max_length=10)
    purchase_request_id: UUID | None = None
    admin_notes: str | None = None

    # Full payment
    payment_account_id: UUID | None = None
    payment_deadline: datetime | None = None
    payment_instructions: str | None = None

    # Financing
    initial_payment_percent: Decimal | None = Field(default=None, ge=10, le=90)
    duration_months: int | None = Field(default=None, ge=1, le=120)
    monthly_finance_rate: Decimal | None = Field(default=None, ge=Decimal("0.001"), le=Decimal("0.10"))
    arrangement_fee: Decimal | None = Field(default=None, ge=0)
    rate_schedule_id: UUID | None = None


class DealResponse(BaseModel):
    id: UUID
    deal_ref: str
    product_id: UUID
    buyer_id: UUID
    seller_id: UUID
    purchase_request_id: UUID | None
    deal_type: str
    total_price: Decimal
    currency: str
    payment_account_id: UUID | None
    payment_deadline: datetime | None
    payment_instructions: str | None
    initial_payment_percent: Decimal | None
    initial_payment_amount: Decimal | None
    financed_amount: Decimal | None
    monthly_finance_rate: Decimal | None
    duration_months: int | None
    arrangement_fee: Decimal
    rate_schedule_id: UUID | None
    total_finance_charge: Decimal | None
    total_amount_payable: Decimal | None
    first_monthly_payment: Decimal | None
    accepted_at: datetime | None
    acceptance_ip: str | None
    portal_token: str | None
    portal_token_expires_at: datetime | None
    portal_first_accessed: datetime | None
    requires_second_approval: bool
    second_approved_by: UUID | None
    second_approved_at: datetime | None
    second_approval_notes: str | None
    admin_notes: str | None
    cancellation_reason: str | None
    status: str
    created_by: UUID
    created_at: datetime
    updated_at: datetime

    # Enriched fields
    buyer_name: str | None = None
    buyer_email: str | None = None
    buyer_phone: str | None = None
    seller_name: str | None = None
    product_title: str | None = None
    product_primary_image_url: str | None = None
    payment_account: PaymentAccountResponse | None = None

    # Computed
    initial_payment_due: Decimal | None = None

    model_config = {"from_attributes": True}


class DealListResponse(BaseModel):
    id: UUID
    deal_ref: str
    deal_type: str
    status: str
    total_price: Decimal
    currency: str
    buyer_name: str | None = None
    buyer_email: str | None = None
    seller_name: str | None = None
    product_title: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SchedulePreviewInstallment(BaseModel):
    installment_number: int
    due_date: date
    amount_due: Decimal
    opening_balance: Decimal
    finance_charge: Decimal
    principal_amount: Decimal
    closing_balance: Decimal


class DealPortalResponse(BaseModel):
    """Buyer-facing deal portal view."""
    deal_ref: str
    deal_type: str
    status: str
    product_title: str
    product_description: str | None
    total_price: Decimal
    currency: str
    arrangement_fee: Decimal

    # Full payment
    payment_account: PaymentAccountResponse | None = None
    payment_deadline: datetime | None = None
    payment_instructions: str | None = None
    total_amount_payable: Decimal | None = None

    # Financing
    initial_payment_amount: Decimal | None = None
    financed_amount: Decimal | None = None
    monthly_finance_rate_display: str | None = None   # e.g. "2.0% per month"
    duration_months: int | None = None
    total_finance_charge: Decimal | None = None
    first_monthly_payment: Decimal | None = None
    schedule_preview: list[SchedulePreviewInstallment] | None = None

    accepted_at: datetime | None
    portal_token_expires_at: datetime | None

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class RecordPaymentRequest(BaseModel):
    payment_type: Literal["full_payment", "initial_payment", "installment"]
    installment_number: int | None = Field(default=None, ge=1)
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="USD", max_length=10)
    payment_date: date
    bank_name: str | None = None
    bank_reference: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_installment_number(self) -> "RecordPaymentRequest":
        if self.payment_type == "installment" and self.installment_number is None:
            raise ValueError("installment_number is required when payment_type is 'installment'")
        return self


class MarkAcceptedRequest(BaseModel):
    notes: str = Field(..., min_length=5, max_length=1000,
                       description="Reason / evidence for offline acceptance (e.g. 'Buyer confirmed via phone call')")


class VerifyPaymentRequest(BaseModel):
    verification_status: Literal["verified", "disputed"]
    verification_notes: str | None = None


class DealPaymentResponse(BaseModel):
    id: UUID
    deal_id: UUID
    payment_type: str
    installment_number: int | None
    amount: Decimal
    currency: str
    payment_date: date
    bank_name: str | None
    bank_reference: str | None
    payment_proof_path: str | None
    notes: str | None
    recorded_by: UUID
    recorded_at: datetime
    verified_by: UUID | None
    verified_at: datetime | None
    verification_status: str
    verification_notes: str | None
    created_at: datetime

    # Enriched
    recorded_by_name: str | None = None
    verified_by_name: str | None = None

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
# INSTALLMENT SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class InstallmentResponse(BaseModel):
    id: UUID
    deal_id: UUID
    installment_number: int
    due_date: date
    grace_period_end: date
    opening_balance: Decimal
    principal_amount: Decimal
    finance_charge: Decimal
    amount_due: Decimal
    closing_balance: Decimal
    status: str
    payment_id: UUID | None
    paid_amount: Decimal | None
    paid_at: datetime | None
    waived_by: UUID | None
    waived_at: datetime | None
    waiver_reason: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class InstallmentScheduleResponse(BaseModel):
    deal_ref: str
    deal_type: str
    status: str
    buyer_name: str | None
    product_title: str | None
    financed_amount: Decimal | None
    monthly_finance_rate: Decimal | None
    duration_months: int | None
    total_finance_charge: Decimal | None
    total_amount_payable: Decimal | None
    installments: list[InstallmentResponse]


# ══════════════════════════════════════════════════════════════════════════════
# OTP SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class RequestOtpResponse(BaseModel):
    message: str
    expires_in_minutes: int


class AcceptDealRequest(BaseModel):
    otp: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN ACTION SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class SendOfferRequest(BaseModel):
    override_notes: str | None = None


class SecondApproveRequest(BaseModel):
    notes: str | None = None


class CancelDealRequest(BaseModel):
    reason: str = Field(..., min_length=5, max_length=1000)


class SendReminderRequest(BaseModel):
    message_type: Literal[
        "payment_reminder",
        "overdue_warning",
        "installment_due",
        "installment_overdue",
    ]
    custom_message: str | None = None
