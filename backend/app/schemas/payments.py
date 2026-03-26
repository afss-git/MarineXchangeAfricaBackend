"""
Phase 9 — Payment Lifecycle Schemas.

Covers:
  - Payment schedule creation (auto + manual modes)
  - Schedule item representation
  - Payment record submission (buyer)
  - Admin verify / reject actions
  - Evidence file metadata
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ══════════════════════════════════════════════════════════════════════════════
# SCHEDULE CREATION
# ══════════════════════════════════════════════════════════════════════════════

class ManualInstallment(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    due_date: date


class CreateScheduleAuto(BaseModel):
    mode: Literal["auto"]
    installments: int = Field(..., ge=1, le=60)
    currency: str = Field(default="USD", min_length=3, max_length=3)


class CreateScheduleManual(BaseModel):
    mode: Literal["manual"]
    installments: list[ManualInstallment] = Field(..., min_length=1, max_length=60)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @model_validator(mode="after")
    def unique_labels_and_ascending_dates(self) -> "CreateScheduleManual":
        labels = [i.label for i in self.installments]
        if len(labels) != len(set(labels)):
            raise ValueError("Each installment label must be unique.")
        dates = [i.due_date for i in self.installments]
        if dates != sorted(dates):
            raise ValueError("Installment due_dates must be in ascending order.")
        return self


# Union type used in the service — router accepts either body
CreateScheduleRequest = CreateScheduleAuto | CreateScheduleManual


# ══════════════════════════════════════════════════════════════════════════════
# RESPONSE MODELS
# ══════════════════════════════════════════════════════════════════════════════

class ScheduleItemOut(BaseModel):
    id: UUID
    schedule_id: UUID
    deal_id: UUID
    installment_number: int
    label: str
    amount: Decimal
    currency: str
    due_date: date
    status: str
    verified_by: UUID | None
    verified_at: datetime | None
    waived_by: UUID | None
    waived_at: datetime | None
    waiver_reason: str | None
    created_at: datetime
    updated_at: datetime


class PaymentScheduleOut(BaseModel):
    id: UUID
    deal_id: UUID
    mode: str
    total_items: int
    currency: str
    is_complete: bool
    completed_at: datetime | None
    created_by: UUID
    created_at: datetime
    items: list[ScheduleItemOut]


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT RECORD (BUYER SUBMITS)
# ══════════════════════════════════════════════════════════════════════════════

class SubmitPaymentRecord(BaseModel):
    amount_paid: Decimal = Field(..., gt=0, decimal_places=2)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    payment_method: Literal[
        "bank_transfer", "wire_transfer", "swift",
        "cheque", "cash", "other"
    ]
    payment_date: date
    bank_name: str | None = Field(default=None, max_length=200)
    bank_reference: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class PaymentRecordOut(BaseModel):
    id: UUID
    schedule_item_id: UUID
    deal_id: UUID
    submitted_by: UUID
    amount_paid: Decimal
    currency: str
    payment_method: str
    payment_date: date
    bank_name: str | None
    bank_reference: str | None
    notes: str | None
    status: str
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    rejection_reason: str | None
    submitted_at: datetime
    evidence: list[EvidenceOut] = []


# ══════════════════════════════════════════════════════════════════════════════
# EVIDENCE (FILE UPLOAD METADATA)
# ══════════════════════════════════════════════════════════════════════════════

class EvidenceOut(BaseModel):
    id: UUID
    payment_record_id: UUID
    file_name: str
    file_path: str
    file_size_bytes: int | None
    mime_type: str
    uploaded_at: datetime


# Rebuild to resolve forward references
PaymentRecordOut.model_rebuild()


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN ACTIONS
# ══════════════════════════════════════════════════════════════════════════════

class VerifyPaymentBody(BaseModel):
    notes: str | None = Field(default=None, max_length=500)


class RejectPaymentBody(BaseModel):
    rejection_reason: str = Field(..., min_length=5, max_length=500)


class WaiveItemBody(BaseModel):
    waiver_reason: str = Field(..., min_length=5, max_length=500)


# ══════════════════════════════════════════════════════════════════════════════
# DEAL PAYMENT SUMMARY (returned alongside deal detail)
# ══════════════════════════════════════════════════════════════════════════════

class DealPaymentSummary(BaseModel):
    schedule_id: UUID | None
    total_items: int
    verified_count: int
    pending_count: int
    overdue_count: int
    waived_count: int
    is_complete: bool
    total_amount: Decimal
    verified_amount: Decimal
    outstanding_amount: Decimal
