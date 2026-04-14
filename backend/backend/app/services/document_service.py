"""
Phase 10 — Document & Invoice Service.

Security principles applied throughout:
  - Every download generates a short-lived Supabase signed URL (1 hour).
    No permanent public URLs are ever exposed.
  - Access checks run BEFORE any signed URL is generated:
      * Admin: full access to all deal documents/invoices
      * Buyer: only visible documents for their own deals
      * Seller: only visible documents for their own deals
  - File checksums (SHA-256) are computed on upload and stored for integrity.
  - MIME type and file size are validated server-side — not trusted from client.
  - Soft-delete pattern: documents with acknowledgements are never hard-deleted.
    Hard delete is blocked if the document has any acknowledgement record.
  - Invoice PDF bytes never touch the file system — generated in memory,
    uploaded directly to Supabase Storage.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.db.client import get_pool
from app.schemas.documents import (
    AcknowledgementOut,
    DocumentDeleteBody,
    DocumentOut,
    DocumentDownloadResponse,
    DocumentUpdateBody,
    DocumentUploadMeta,
    InvoiceDownloadResponse,
    InvoiceGenerateBody,
    InvoiceOut,
    InvoiceVoidBody,
)
from app.services import notification_service
from app.services.auth_service import get_supabase_admin_client
from app.services.pdf_service import generate_invoice_pdf

logger = logging.getLogger(__name__)

# ── Storage config ─────────────────────────────────────────────────────────────
DOCUMENTS_BUCKET = "deal-documents"
INVOICES_BUCKET  = "deal-invoices"
SIGNED_URL_TTL   = 3600   # 1 hour

# ── Allowed MIME types for document uploads ────────────────────────────────────
ALLOWED_DOC_MIME = frozenset({
    "application/pdf",
    "image/jpeg", "image/png", "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
})
MIME_TO_EXT = {
    "application/pdf":   "pdf",
    "image/jpeg":        "jpg",
    "image/png":         "png",
    "image/webp":        "webp",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}
MAX_DOC_SIZE_BYTES = 25 * 1024 * 1024   # 25 MB


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _record_to_dict(row: asyncpg.Record) -> dict:
    result = {}
    for k, v in dict(row).items():
        if v is not None and type(v).__module__ == "asyncpg.pgproto.pgproto":
            result[k] = UUID(str(v))
        else:
            result[k] = v
    return result


async def _assert_deal_party(
    db: asyncpg.Connection,
    deal_id: UUID,
    user: dict,
) -> asyncpg.Record:
    """
    Verify deal exists and caller is an admin, the buyer, or the seller.
    Returns the deal record.
    """
    deal = await db.fetchrow(
        "SELECT id, buyer_id, seller_id, deal_ref FROM finance.deals WHERE id = $1",
        deal_id,
    )
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found.")

    roles = user.get("roles", [])
    uid = str(user["id"])

    if "admin" in roles or "finance_admin" in roles:
        return deal

    if str(deal["buyer_id"]) == uid or str(deal["seller_id"]) == uid:
        return deal

    raise HTTPException(status_code=403, detail="Access denied.")


async def _assert_admin(user: dict) -> None:
    roles = user.get("roles", [])
    if "admin" not in roles and "finance_admin" not in roles:
        raise HTTPException(status_code=403, detail="Admin access required.")


def _compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _row_to_doc(row: asyncpg.Record, acked_at: datetime | None = None, ack_count: int = 0) -> DocumentOut:
    d = _record_to_dict(row)
    d["acknowledged_at"] = acked_at
    d["acknowledgements_count"] = ack_count
    return DocumentOut(**d)


def _row_to_invoice(row: asyncpg.Record) -> InvoiceOut:
    d = _record_to_dict(row)
    d["has_pdf"] = bool(d.get("pdf_path"))
    return InvoiceOut(**d)


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT — ADMIN
# ══════════════════════════════════════════════════════════════════════════════

async def admin_upload_document(
    db: asyncpg.Connection,
    deal_id: UUID,
    meta: DocumentUploadMeta,
    file: UploadFile,
    admin: dict,
) -> DocumentOut:
    await _assert_admin(admin)

    deal = await db.fetchrow("SELECT id FROM finance.deals WHERE id = $1", deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found.")

    # Read + validate file
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")
    if len(content) > MAX_DOC_SIZE_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"File exceeds maximum size of {MAX_DOC_SIZE_BYTES // (1024*1024)} MB.",
        )

    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_DOC_MIME:
        raise HTTPException(
            status_code=422,
            detail=f"File type '{mime}' not allowed. Accepted: PDF, JPEG, PNG, WebP, DOC, DOCX, XLS, XLSX.",
        )
    from app.core.file_validation import validate_magic_bytes
    if not validate_magic_bytes(content, mime):
        raise HTTPException(
            status_code=422,
            detail="File content does not match the declared file type.",
        )

    # Compute integrity checksum BEFORE upload
    checksum = _compute_sha256(content)

    ext = MIME_TO_EXT.get(mime, "bin")
    file_uuid = uuid.uuid4()
    storage_path = f"{deal_id}/{file_uuid}.{ext}"
    original_name = file.filename or f"{file_uuid}.{ext}"

    # Upload to Supabase Storage
    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(DOCUMENTS_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content_type": mime, "upsert": "false"},
        )
    except Exception as exc:
        logger.error("Document upload failed: %s", exc)
        raise HTTPException(status_code=500, detail="File upload failed. Please try again.")

    doc_id: UUID = await db.fetchval(
        """
        INSERT INTO finance.deal_documents
            (deal_id, document_type, description, file_name, file_path,
             file_size_bytes, mime_type, checksum_sha256,
             is_visible_to_buyer, is_visible_to_seller, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
        """,
        deal_id,
        meta.document_type,
        meta.description,
        original_name,
        storage_path,
        len(content),
        mime,
        checksum,
        meta.is_visible_to_buyer,
        meta.is_visible_to_seller,
        UUID(str(admin["id"])),
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.DOCUMENT_UPLOADED,
        resource_type="deal_document",
        resource_id=str(doc_id),
        new_state={
            "deal_id": str(deal_id),
            "type": meta.document_type,
            "visible_buyer": meta.is_visible_to_buyer,
            "visible_seller": meta.is_visible_to_seller,
        },
    )

    # Notify if immediately visible
    if meta.is_visible_to_buyer or meta.is_visible_to_seller:
        asyncio.create_task(
            notification_service.notify_document_shared(deal_id, str(doc_id), meta.document_type)
        )

    row = await db.fetchrow("SELECT * FROM finance.deal_documents WHERE id = $1", doc_id)
    return _row_to_doc(row)


async def admin_update_document(
    db: asyncpg.Connection,
    doc_id: UUID,
    body: DocumentUpdateBody,
    admin: dict,
) -> DocumentOut:
    await _assert_admin(admin)

    doc = await db.fetchrow(
        "SELECT * FROM finance.deal_documents WHERE id = $1 AND is_deleted = FALSE", doc_id
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Build update
    updates = {}
    if body.description is not None:
        updates["description"] = body.description
    if body.is_visible_to_buyer is not None:
        updates["is_visible_to_buyer"] = body.is_visible_to_buyer
    if body.is_visible_to_seller is not None:
        updates["is_visible_to_seller"] = body.is_visible_to_seller

    if not updates:
        return _row_to_doc(doc)

    now = datetime.now(timezone.utc)
    set_clauses = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates))
    values = list(updates.values())
    await db.execute(
        f"UPDATE finance.deal_documents SET {set_clauses}, updated_at = ${len(values)+2} WHERE id = $1",
        doc_id, *values, now
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.DOCUMENT_UPDATED,
        resource_type="deal_document",
        resource_id=str(doc_id),
        new_state=updates,
    )

    # Notify parties if visibility was just turned on
    newly_visible = (
        (body.is_visible_to_buyer and not doc["is_visible_to_buyer"]) or
        (body.is_visible_to_seller and not doc["is_visible_to_seller"])
    )
    if newly_visible:
        asyncio.create_task(
            notification_service.notify_document_shared(
                doc["deal_id"], str(doc_id), doc["document_type"]
            )
        )

    row = await db.fetchrow("SELECT * FROM finance.deal_documents WHERE id = $1", doc_id)
    return _row_to_doc(row)


async def admin_delete_document(
    db: asyncpg.Connection,
    doc_id: UUID,
    body: DocumentDeleteBody,
    admin: dict,
) -> dict:
    await _assert_admin(admin)

    doc = await db.fetchrow(
        "SELECT * FROM finance.deal_documents WHERE id = $1 AND is_deleted = FALSE", doc_id
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Block delete if any party has acknowledged this document
    ack_count = await db.fetchval(
        "SELECT COUNT(*) FROM finance.document_acknowledgements WHERE document_id = $1", doc_id
    )
    if ack_count > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                "This document has been acknowledged by one or more parties "
                "and cannot be deleted. Use the visibility controls to hide it instead."
            ),
        )

    now = datetime.now(timezone.utc)
    await db.execute(
        """
        UPDATE finance.deal_documents
        SET is_deleted = TRUE, deleted_by = $1, deleted_at = $2,
            deletion_reason = $3, updated_at = $2
        WHERE id = $4
        """,
        UUID(str(admin["id"])), now, body.deletion_reason, doc_id,
    )

    # Also remove from Storage
    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(DOCUMENTS_BUCKET).remove([doc["file_path"]])
    except Exception as exc:
        logger.warning("Storage delete failed for %s: %s", doc["file_path"], exc)

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.DOCUMENT_DELETED,
        resource_type="deal_document",
        resource_id=str(doc_id),
        new_state={"reason": body.deletion_reason},
    )

    return {"message": "Document deleted."}


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT — SHARED (admin + buyer + seller)
# ══════════════════════════════════════════════════════════════════════════════

async def list_documents(
    db: asyncpg.Connection,
    deal_id: UUID,
    user: dict,
) -> list[DocumentOut]:
    deal = await _assert_deal_party(db, deal_id, user)
    roles = user.get("roles", [])
    uid = str(user["id"])
    is_admin = "admin" in roles or "finance_admin" in roles

    if is_admin:
        rows = await db.fetch(
            "SELECT * FROM finance.deal_documents WHERE deal_id = $1 AND is_deleted = FALSE ORDER BY uploaded_at DESC",
            deal_id,
        )
    elif str(deal["buyer_id"]) == uid:
        rows = await db.fetch(
            "SELECT * FROM finance.deal_documents WHERE deal_id = $1 AND is_deleted = FALSE AND is_visible_to_buyer = TRUE ORDER BY uploaded_at DESC",
            deal_id,
        )
    else:  # seller
        rows = await db.fetch(
            "SELECT * FROM finance.deal_documents WHERE deal_id = $1 AND is_deleted = FALSE AND is_visible_to_seller = TRUE ORDER BY uploaded_at DESC",
            deal_id,
        )

    if not rows:
        return []

    doc_ids = [row["id"] for row in rows]

    # Batch: get user's acknowledgement timestamps
    ack_rows = await db.fetch(
        "SELECT document_id, acknowledged_at FROM finance.document_acknowledgements WHERE document_id = ANY($1) AND acknowledged_by = $2",
        doc_ids, UUID(uid),
    )
    ack_map = {r["document_id"]: r["acknowledged_at"] for r in ack_rows}

    # Batch: get acknowledgement counts per document
    count_rows = await db.fetch(
        "SELECT document_id, COUNT(*) AS cnt FROM finance.document_acknowledgements WHERE document_id = ANY($1) GROUP BY document_id",
        doc_ids,
    )
    count_map = {r["document_id"]: r["cnt"] for r in count_rows}

    return [
        _row_to_doc(row, ack_map.get(row["id"]), count_map.get(row["id"], 0))
        for row in rows
    ]


async def get_signed_download_url(
    db: asyncpg.Connection,
    doc_id: UUID,
    user: dict,
    request_ip: str = "unknown",
) -> DocumentDownloadResponse:
    doc = await db.fetchrow(
        "SELECT * FROM finance.deal_documents WHERE id = $1 AND is_deleted = FALSE", doc_id
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    deal = await _assert_deal_party(db, doc["deal_id"], user)
    roles = user.get("roles", [])
    uid = str(user["id"])
    is_admin = "admin" in roles or "finance_admin" in roles

    # Visibility check for non-admins
    if not is_admin:
        if str(deal["buyer_id"]) == uid and not doc["is_visible_to_buyer"]:
            raise HTTPException(status_code=403, detail="This document is not available.")
        if str(deal["seller_id"]) == uid and not doc["is_visible_to_seller"]:
            raise HTTPException(status_code=403, detail="This document is not available.")

    # Generate short-lived signed URL
    try:
        supabase = await get_supabase_admin_client()
        result = await supabase.storage.from_(DOCUMENTS_BUCKET).create_signed_url(
            doc["file_path"], SIGNED_URL_TTL
        )
        signed_url = result.get("signedURL") or result.get("signed_url") or result.get("signedUrl", "")
        if not signed_url:
            raise ValueError("No signed URL returned from Supabase.")
    except Exception as exc:
        logger.error("Signed URL generation failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not generate download link.")

    await write_audit_log(
        db,
        actor_id=user["id"],
        actor_roles=user.get("roles", []),
        action=AuditAction.DOCUMENT_DOWNLOADED,
        resource_type="deal_document",
        resource_id=str(doc_id),
        metadata={"ip": request_ip, "deal_id": str(doc["deal_id"])},
    )

    return DocumentDownloadResponse(
        document_id=UUID(str(doc["id"])),
        file_name=doc["file_name"],
        signed_url=signed_url,
        expires_in_seconds=SIGNED_URL_TTL,
    )


async def acknowledge_document(
    db: asyncpg.Connection,
    doc_id: UUID,
    user: dict,
    request_ip: str = "unknown",
    user_agent: str = "",
) -> AcknowledgementOut:
    doc = await db.fetchrow(
        "SELECT * FROM finance.deal_documents WHERE id = $1 AND is_deleted = FALSE", doc_id
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    await _assert_deal_party(db, doc["deal_id"], user)
    uid = UUID(str(user["id"]))

    # Idempotent — return existing acknowledgement if already done
    existing = await db.fetchrow(
        "SELECT * FROM finance.document_acknowledgements WHERE document_id = $1 AND acknowledged_by = $2",
        doc_id, uid,
    )
    if existing:
        return AcknowledgementOut(**_record_to_dict(existing))

    ack_id: UUID = await db.fetchval(
        """
        INSERT INTO finance.document_acknowledgements
            (document_id, deal_id, acknowledged_by, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        """,
        doc_id, doc["deal_id"], uid, request_ip, user_agent,
    )

    await write_audit_log(
        db,
        actor_id=user["id"],
        actor_roles=user.get("roles", []),
        action=AuditAction.DOCUMENT_ACKNOWLEDGED,
        resource_type="deal_document",
        resource_id=str(doc_id),
        metadata={"ip": request_ip},
    )

    row = await db.fetchrow(
        "SELECT * FROM finance.document_acknowledgements WHERE id = $1", ack_id
    )
    return AcknowledgementOut(**_record_to_dict(row))


# ══════════════════════════════════════════════════════════════════════════════
# INVOICE — ADMIN
# ══════════════════════════════════════════════════════════════════════════════

async def admin_generate_invoice(
    db: asyncpg.Connection,
    deal_id: UUID,
    body: InvoiceGenerateBody,
    admin: dict,
) -> InvoiceOut:
    await _assert_admin(admin)

    # Load deal with full party + payment account info
    deal = await db.fetchrow(
        """
        SELECT
            d.*,
            bp.full_name    AS buyer_name,
            bu.email        AS buyer_email,
            sp.full_name    AS seller_name,
            pa.bank_name,
            pa.account_number,
            pa.swift_code,
            pa.iban
        FROM finance.deals d
        JOIN public.profiles bp ON bp.id = d.buyer_id
        JOIN auth.users      bu ON bu.id = d.buyer_id
        JOIN public.profiles sp ON sp.id = d.seller_id
        LEFT JOIN finance.payment_accounts pa ON pa.id = d.payment_account_id
        WHERE d.id = $1
        """,
        deal_id,
    )
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found.")

    # Validate installment type requires schedule_item_id
    if body.invoice_type == "installment" and not body.schedule_item_id:
        raise HTTPException(
            status_code=422,
            detail="invoice_type 'installment' requires a schedule_item_id.",
        )

    # Determine amount and line items
    line_items = []
    amount = Decimal("0")

    if body.invoice_type == "installment" and body.schedule_item_id:
        item = await db.fetchrow(
            "SELECT * FROM finance.payment_schedule_items WHERE id = $1 AND deal_id = $2",
            body.schedule_item_id, deal_id,
        )
        if not item:
            raise HTTPException(status_code=404, detail="Schedule item not found for this deal.")
        amount = Decimal(str(item["amount"]))
        line_items = [{
            "label": item["label"],
            "amount": amount,
            "due_date": str(item["due_date"]) if item["due_date"] else None,
        }]

    elif body.invoice_type == "proforma":
        amount = Decimal(str(deal["total_price"]))
        line_items = [{"label": "Deal Value (Proforma)", "amount": amount, "due_date": None}]

    else:  # final
        # Sum all verified payments
        verified = await db.fetch(
            """
            SELECT label, amount, due_date
            FROM finance.payment_schedule_items
            WHERE deal_id = $1 AND status IN ('verified', 'waived')
            ORDER BY installment_number
            """,
            deal_id,
        )
        if verified:
            for v in verified:
                line_items.append({
                    "label": v["label"],
                    "amount": Decimal(str(v["amount"])),
                    "due_date": str(v["due_date"]) if v["due_date"] else None,
                })
            amount = sum(Decimal(str(v["amount"])) for v in verified)
        else:
            amount = Decimal(str(deal["total_price"]))
            line_items = [{"label": "Total Deal Value", "amount": amount, "due_date": None}]

    # Generate invoice reference
    seq = await db.fetchval("SELECT nextval('finance.invoice_ref_seq')")
    year = datetime.now(timezone.utc).year
    invoice_ref = f"MXI-{year}-{seq:05d}"

    # Generate PDF
    pdf_data = {
        "invoice_ref":      invoice_ref,
        "invoice_type":     body.invoice_type,
        "issued_at":        datetime.now(timezone.utc).isoformat(),
        "due_date":         str(body.due_date) if body.due_date else None,
        "deal_ref":         deal["deal_ref"],
        "deal_type":        deal["deal_type"],
        "buyer_name":       deal["buyer_name"],
        "buyer_email":      deal["buyer_email"],
        "seller_name":      deal["seller_name"],
        "amount":           amount,
        "currency":         deal["currency"],
        "line_items":       line_items,
        "payment_bank":     deal["bank_name"],
        "payment_account":  deal["account_number"],
        "payment_swift":    deal["swift_code"],
        "payment_iban":     deal["iban"],
        "notes":            body.notes,
        "status":           "draft",
    }

    pdf_bytes = generate_invoice_pdf(pdf_data)

    # Upload PDF to Storage
    pdf_path = f"{deal_id}/{invoice_ref}.pdf"
    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(INVOICES_BUCKET).upload(
            path=pdf_path,
            file=pdf_bytes,
            file_options={"content_type": "application/pdf", "upsert": "true"},
        )
    except Exception as exc:
        logger.error("Invoice PDF upload failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not save invoice PDF. Please retry.")

    now = datetime.now(timezone.utc)
    invoice_id: UUID = await db.fetchval(
        """
        INSERT INTO finance.deal_invoices
            (deal_id, invoice_ref, invoice_type, schedule_item_id,
             amount, currency, due_date, status,
             pdf_path, pdf_generated_at, notes, generated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11)
        RETURNING id
        """,
        deal_id,
        invoice_ref,
        body.invoice_type,
        body.schedule_item_id,
        amount,
        deal["currency"],
        body.due_date,
        pdf_path,
        now,
        body.notes,
        UUID(str(admin["id"])),
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.INVOICE_GENERATED,
        resource_type="deal_invoice",
        resource_id=str(invoice_id),
        new_state={"invoice_ref": invoice_ref, "type": body.invoice_type, "amount": str(amount)},
    )

    row = await db.fetchrow("SELECT * FROM finance.deal_invoices WHERE id = $1", invoice_id)
    return _row_to_invoice(row)


async def admin_issue_invoice(
    db: asyncpg.Connection,
    invoice_id: UUID,
    admin: dict,
) -> InvoiceOut:
    await _assert_admin(admin)

    inv = await db.fetchrow(
        "SELECT * FROM finance.deal_invoices WHERE id = $1", invoice_id
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    if inv["status"] != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"Only draft invoices can be issued. Current status: '{inv['status']}'.",
        )

    now = datetime.now(timezone.utc)

    # Regenerate PDF with status=issued and issued_at date
    deal = await db.fetchrow(
        """
        SELECT d.*, bp.full_name AS buyer_name, bu.email AS buyer_email,
               sp.full_name AS seller_name,
               pa.bank_name, pa.account_number, pa.swift_code, pa.iban
        FROM finance.deals d
        JOIN public.profiles bp ON bp.id = d.buyer_id
        JOIN auth.users      bu ON bu.id = d.buyer_id
        JOIN public.profiles sp ON sp.id = d.seller_id
        LEFT JOIN finance.payment_accounts pa ON pa.id = d.payment_account_id
        WHERE d.id = $1
        """,
        inv["deal_id"],
    )

    # Build line items from schedule if available
    schedule_items = await db.fetch(
        """
        SELECT label, amount, due_date FROM finance.payment_schedule_items
        WHERE deal_id = $1 ORDER BY installment_number
        """,
        inv["deal_id"],
    )
    line_items = [
        {"label": r["label"], "amount": Decimal(str(r["amount"])), "due_date": str(r["due_date"]) if r["due_date"] else None}
        for r in schedule_items
    ] or [{"label": "Deal Value", "amount": Decimal(str(inv["amount"])), "due_date": str(inv["due_date"]) if inv["due_date"] else None}]

    pdf_bytes = generate_invoice_pdf({
        "invoice_ref":      inv["invoice_ref"],
        "invoice_type":     inv["invoice_type"],
        "issued_at":        now.isoformat(),
        "due_date":         str(inv["due_date"]) if inv["due_date"] else None,
        "deal_ref":         deal["deal_ref"],
        "deal_type":        deal["deal_type"],
        "buyer_name":       deal["buyer_name"],
        "buyer_email":      deal["buyer_email"],
        "seller_name":      deal["seller_name"],
        "amount":           Decimal(str(inv["amount"])),
        "currency":         inv["currency"],
        "line_items":       line_items,
        "payment_bank":     deal["bank_name"],
        "payment_account":  deal["account_number"],
        "payment_swift":    deal["swift_code"],
        "payment_iban":     deal["iban"],
        "notes":            inv["notes"],
        "status":           "issued",
    })

    # Overwrite PDF in Storage
    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(INVOICES_BUCKET).upload(
            path=inv["pdf_path"],
            file=pdf_bytes,
            file_options={"content_type": "application/pdf", "upsert": "true"},
        )
    except Exception as exc:
        logger.error("Invoice PDF reupload failed: %s", exc)
        # Non-fatal — status update proceeds even if PDF overwrite fails

    await db.execute(
        """
        UPDATE finance.deal_invoices
        SET status = 'issued', issued_at = $1, pdf_generated_at = $1, updated_at = $1
        WHERE id = $2
        """,
        now, invoice_id,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.INVOICE_ISSUED,
        resource_type="deal_invoice",
        resource_id=str(invoice_id),
        new_state={"invoice_ref": inv["invoice_ref"], "issued_at": now.isoformat()},
    )

    asyncio.create_task(
        notification_service.notify_invoice_issued(
            inv["deal_id"], str(invoice_id), inv["invoice_ref"]
        )
    )

    row = await db.fetchrow("SELECT * FROM finance.deal_invoices WHERE id = $1", invoice_id)
    return _row_to_invoice(row)


async def admin_void_invoice(
    db: asyncpg.Connection,
    invoice_id: UUID,
    body: InvoiceVoidBody,
    admin: dict,
) -> InvoiceOut:
    await _assert_admin(admin)

    inv = await db.fetchrow(
        "SELECT * FROM finance.deal_invoices WHERE id = $1", invoice_id
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    if inv["status"] in ("void", "paid"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot void an invoice in '{inv['status']}' status.",
        )

    now = datetime.now(timezone.utc)
    await db.execute(
        """
        UPDATE finance.deal_invoices
        SET status = 'void', void_reason = $1, voided_by = $2, voided_at = $3, updated_at = $3
        WHERE id = $4
        """,
        body.void_reason, UUID(str(admin["id"])), now, invoice_id,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.INVOICE_VOIDED,
        resource_type="deal_invoice",
        resource_id=str(invoice_id),
        new_state={"reason": body.void_reason},
    )

    row = await db.fetchrow("SELECT * FROM finance.deal_invoices WHERE id = $1", invoice_id)
    return _row_to_invoice(row)


# ══════════════════════════════════════════════════════════════════════════════
# INVOICE — SHARED
# ══════════════════════════════════════════════════════════════════════════════

async def list_invoices(
    db: asyncpg.Connection,
    deal_id: UUID,
    user: dict,
) -> list[InvoiceOut]:
    await _assert_deal_party(db, deal_id, user)
    roles = user.get("roles", [])
    is_admin = "admin" in roles or "finance_admin" in roles

    if is_admin:
        rows = await db.fetch(
            "SELECT * FROM finance.deal_invoices WHERE deal_id = $1 ORDER BY created_at DESC",
            deal_id,
        )
    else:
        # Buyers and sellers only see issued invoices
        rows = await db.fetch(
            "SELECT * FROM finance.deal_invoices WHERE deal_id = $1 AND status = 'issued' ORDER BY created_at DESC",
            deal_id,
        )
    return [_row_to_invoice(r) for r in rows]


async def get_invoice_download_url(
    db: asyncpg.Connection,
    invoice_id: UUID,
    user: dict,
    request_ip: str = "unknown",
) -> InvoiceDownloadResponse:
    inv = await db.fetchrow(
        "SELECT * FROM finance.deal_invoices WHERE id = $1", invoice_id
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found.")

    deal = await _assert_deal_party(db, inv["deal_id"], user)
    roles = user.get("roles", [])
    is_admin = "admin" in roles or "finance_admin" in roles

    # Non-admins can only download issued invoices
    if not is_admin and inv["status"] != "issued":
        raise HTTPException(status_code=403, detail="Invoice is not yet available for download.")

    if not inv["pdf_path"]:
        raise HTTPException(status_code=404, detail="No PDF available for this invoice.")

    try:
        supabase = await get_supabase_admin_client()
        result = await supabase.storage.from_(INVOICES_BUCKET).create_signed_url(
            inv["pdf_path"], SIGNED_URL_TTL,
            options={"download": f"{inv['invoice_ref']}.pdf"},
        )
        signed_url = result.get("signedURL") or result.get("signed_url") or result.get("signedUrl", "")
        if not signed_url:
            raise ValueError("No signed URL returned.")
    except Exception as exc:
        logger.error("Invoice signed URL failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not generate download link.")

    await write_audit_log(
        db,
        actor_id=user["id"],
        actor_roles=user.get("roles", []),
        action=AuditAction.INVOICE_DOWNLOADED,
        resource_type="deal_invoice",
        resource_id=str(invoice_id),
        metadata={"ip": request_ip, "invoice_ref": inv["invoice_ref"]},
    )

    return InvoiceDownloadResponse(
        invoice_id=UUID(str(inv["id"])),
        invoice_ref=inv["invoice_ref"],
        signed_url=signed_url,
        expires_in_seconds=SIGNED_URL_TTL,
    )
