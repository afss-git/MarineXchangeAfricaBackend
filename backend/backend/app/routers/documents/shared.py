"""
Phase 10 — Shared Document & Invoice Router (admin + buyer + seller).

Prefix: /documents  (mounted under /api/v1)

Endpoints:
  GET    /deals/{deal_id}/documents           — list documents (role-filtered)
  GET    /documents/{doc_id}/download         — get signed download URL
  POST   /documents/{doc_id}/acknowledge      — acknowledge a document
  GET    /deals/{deal_id}/invoices            — list invoices (role-filtered)
  GET    /invoices/{invoice_id}/download      — get signed invoice PDF URL
"""
from __future__ import annotations

import io
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.deps import CurrentUser, DbConn
from app.schemas.documents import (
    AcknowledgementOut,
    DocumentDownloadResponse,
    DocumentOut,
    InvoiceOut,
)
from app.services import document_service

router = APIRouter(tags=["Documents — Shared"])


@router.get(
    "/deals/{deal_id}/documents",
    response_model=list[DocumentOut],
    summary="List documents for a deal (visibility filtered by role)",
)
async def list_documents(
    deal_id: UUID,
    db: DbConn,
    current_user: CurrentUser,
):
    return await document_service.list_documents(db, deal_id, current_user)


@router.get(
    "/documents/{doc_id}/download",
    response_model=DocumentDownloadResponse,
    summary="Get a short-lived signed download URL for a document",
)
async def download_document(
    doc_id: UUID,
    request: Request,
    db: DbConn,
    current_user: CurrentUser,
):
    ip = getattr(request.state, "client_ip", "unknown")
    return await document_service.get_signed_download_url(db, doc_id, current_user, ip)


@router.post(
    "/documents/{doc_id}/acknowledge",
    response_model=AcknowledgementOut,
    status_code=201,
    summary="Acknowledge a document (idempotent)",
)
async def acknowledge_document(
    doc_id: UUID,
    request: Request,
    db: DbConn,
    current_user: CurrentUser,
):
    ip = getattr(request.state, "client_ip", "unknown")
    ua = getattr(request.state, "user_agent", "")
    return await document_service.acknowledge_document(db, doc_id, current_user, ip, ua)


@router.get(
    "/deals/{deal_id}/invoices",
    response_model=list[InvoiceOut],
    summary="List invoices for a deal (admins see all; buyers/sellers see issued only)",
)
async def list_invoices(
    deal_id: UUID,
    db: DbConn,
    current_user: CurrentUser,
):
    return await document_service.list_invoices(db, deal_id, current_user)


@router.get(
    "/invoices/{invoice_id}/download",
    summary="Stream invoice PDF bytes directly (forces browser download)",
)
async def download_invoice(
    invoice_id: UUID,
    request: Request,
    db: DbConn,
    current_user: CurrentUser,
):
    ip = getattr(request.state, "client_ip", "unknown")
    pdf_bytes, invoice_ref = await document_service.get_invoice_pdf_bytes(db, invoice_id, current_user, ip)
    safe_name = invoice_ref.replace(" ", "_")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.pdf"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
