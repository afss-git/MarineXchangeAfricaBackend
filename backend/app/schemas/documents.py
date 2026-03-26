"""
Phase 10 — Document Management Schemas.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENTS
# ══════════════════════════════════════════════════════════════════════════════

DocumentType = Literal[
    "contract", "inspection_report", "receipt", "invoice",
    "identification", "bank_statement", "title_deed",
    "survey_report", "correspondence", "other"
]


class DocumentUploadMeta(BaseModel):
    """Metadata sent alongside the file upload (multipart form)."""
    document_type: DocumentType
    description: str | None = Field(default=None, max_length=500)
    is_visible_to_buyer: bool = False
    is_visible_to_seller: bool = False


class DocumentUpdateBody(BaseModel):
    description: str | None = Field(default=None, max_length=500)
    is_visible_to_buyer: bool | None = None
    is_visible_to_seller: bool | None = None


class DocumentDeleteBody(BaseModel):
    deletion_reason: str = Field(..., min_length=5, max_length=500)


class AcknowledgementOut(BaseModel):
    id: UUID
    document_id: UUID
    deal_id: UUID
    acknowledged_by: UUID
    acknowledged_at: datetime
    ip_address: str | None


class DocumentOut(BaseModel):
    id: UUID
    deal_id: UUID
    document_type: str
    description: str | None
    file_name: str
    file_size_bytes: int | None
    mime_type: str
    checksum_sha256: str | None
    is_visible_to_buyer: bool
    is_visible_to_seller: bool
    is_deleted: bool
    uploaded_by: UUID
    uploaded_at: datetime
    updated_at: datetime
    # Populated when caller has acknowledged
    acknowledged_at: datetime | None = None
    acknowledgements_count: int = 0


class DocumentDownloadResponse(BaseModel):
    document_id: UUID
    file_name: str
    signed_url: str
    expires_in_seconds: int = 3600


# ══════════════════════════════════════════════════════════════════════════════
# INVOICES
# ══════════════════════════════════════════════════════════════════════════════

InvoiceType = Literal["proforma", "installment", "final"]


class InvoiceGenerateBody(BaseModel):
    invoice_type: InvoiceType
    schedule_item_id: UUID | None = None   # required for installment type
    due_date: date | None = None
    notes: str | None = Field(default=None, max_length=1000)

    @property
    def requires_schedule_item(self) -> bool:
        return self.invoice_type == "installment"


class InvoiceVoidBody(BaseModel):
    void_reason: str = Field(..., min_length=5, max_length=500)


class InvoiceOut(BaseModel):
    id: UUID
    deal_id: UUID
    invoice_ref: str
    invoice_type: str
    schedule_item_id: UUID | None
    amount: Decimal
    currency: str
    due_date: date | None
    issued_at: datetime | None
    status: str
    void_reason: str | None
    voided_by: UUID | None
    voided_at: datetime | None
    has_pdf: bool
    notes: str | None
    generated_by: UUID
    created_at: datetime
    updated_at: datetime


class InvoiceDownloadResponse(BaseModel):
    invoice_id: UUID
    invoice_ref: str
    signed_url: str
    expires_in_seconds: int = 3600
