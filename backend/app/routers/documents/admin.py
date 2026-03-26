"""
Phase 10 — Admin Document & Invoice Router.

Prefix: /documents/admin  (mounted under /api/v1)

Endpoints:
  POST   /deals/{deal_id}/documents           — upload document to a deal
  PATCH  /documents/{doc_id}                  — update visibility / description
  DELETE /documents/{doc_id}                  — soft-delete document
  POST   /deals/{deal_id}/invoices            — generate invoice (proforma/installment/final)
  POST   /invoices/{invoice_id}/issue         — issue (send) a draft invoice
  POST   /invoices/{invoice_id}/void          — void an invoice
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, UploadFile, File, Form
from typing import Annotated

from app.deps import AdminUser, DbConn
from app.schemas.documents import (
    DocumentDeleteBody,
    DocumentOut,
    DocumentUpdateBody,
    InvoiceGenerateBody,
    InvoiceOut,
    InvoiceVoidBody,
)
from app.services import document_service

router = APIRouter(tags=["Documents — Admin"])


# ── Documents ─────────────────────────────────────────────────────────────────

@router.post(
    "/deals/{deal_id}/documents",
    response_model=DocumentOut,
    status_code=201,
    summary="Upload a document to a deal",
)
async def upload_document(
    deal_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    file: UploadFile = File(...),
    document_type: Annotated[str, Form()] = "other",
    description: Annotated[str | None, Form()] = None,
    is_visible_to_buyer: Annotated[bool, Form()] = False,
    is_visible_to_seller: Annotated[bool, Form()] = False,
):
    from app.schemas.documents import DocumentUploadMeta
    meta = DocumentUploadMeta(
        document_type=document_type,
        description=description,
        is_visible_to_buyer=is_visible_to_buyer,
        is_visible_to_seller=is_visible_to_seller,
    )
    return await document_service.admin_upload_document(db, deal_id, meta, file, current_user)


@router.patch(
    "/documents/{doc_id}",
    response_model=DocumentOut,
    summary="Update document visibility or description",
)
async def update_document(
    doc_id: UUID,
    body: DocumentUpdateBody,
    db: DbConn,
    current_user: AdminUser,
):
    return await document_service.admin_update_document(db, doc_id, body, current_user)


@router.delete(
    "/documents/{doc_id}",
    summary="Soft-delete a document (blocked if acknowledged)",
)
async def delete_document(
    doc_id: UUID,
    body: DocumentDeleteBody,
    db: DbConn,
    current_user: AdminUser,
):
    return await document_service.admin_delete_document(db, doc_id, body, current_user)


# ── Invoices ──────────────────────────────────────────────────────────────────

@router.post(
    "/deals/{deal_id}/invoices",
    response_model=InvoiceOut,
    status_code=201,
    summary="Generate a proforma, installment, or final invoice for a deal",
)
async def generate_invoice(
    deal_id: UUID,
    body: InvoiceGenerateBody,
    db: DbConn,
    current_user: AdminUser,
):
    return await document_service.admin_generate_invoice(db, deal_id, body, current_user)


@router.post(
    "/invoices/{invoice_id}/issue",
    response_model=InvoiceOut,
    summary="Issue (send) a draft invoice to the buyer",
)
async def issue_invoice(
    invoice_id: UUID,
    db: DbConn,
    current_user: AdminUser,
):
    return await document_service.admin_issue_invoice(db, invoice_id, current_user)


@router.post(
    "/invoices/{invoice_id}/void",
    response_model=InvoiceOut,
    summary="Void an invoice",
)
async def void_invoice(
    invoice_id: UUID,
    body: InvoiceVoidBody,
    db: DbConn,
    current_user: AdminUser,
):
    return await document_service.admin_void_invoice(db, invoice_id, body, current_user)
