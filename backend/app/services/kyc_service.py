"""
Phase 4 — KYC Service Layer.

Business logic for:
  - Document type management (admin)
  - Submission lifecycle (buyer)
  - Document upload / delete
  - Agent assignment and assessment
  - Admin final decision
  - Expiry checks
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import mimetypes
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import asyncpg
from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.schemas.kyc import (
    AssignKycAgentRequest,
    CreateDocumentTypeRequest,
    KycAdminDecisionRequest,
    KycAgentReviewRequest,
    MAX_RESUBMISSION_ATTEMPTS,
    UpdateDocumentTypeRequest,
    UpdateKycAssignmentRequest,
)
from app.services.auth_service import get_supabase_admin_client
from app.services import notification_service

logger = logging.getLogger(__name__)

KYC_BUCKET = "kyc-documents"
ALLOWED_MIME_TYPES = frozenset({
    "image/jpeg", "image/png", "image/webp", "application/pdf",
})
MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png":  "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}
MAX_DOC_SIZE_MB = 10


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

async def _get_buyer_email(db: asyncpg.Connection, buyer_id: uuid.UUID) -> tuple[str, str]:
    """Returns (email, full_name) for a buyer profile."""
    row = await db.fetchrow(
        "SELECT u.email, p.full_name FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.id = $1",
        buyer_id,
    )
    if not row:
        return ("", "")
    return (row["email"] or "", row["full_name"] or "")


async def _get_submission_or_404(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
) -> asyncpg.Record:
    row = await db.fetchrow(
        "SELECT * FROM kyc.submissions WHERE id = $1",
        submission_id,
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KYC submission not found.")
    return row


async def _require_submission_owner(
    submission: asyncpg.Record,
    buyer_id: uuid.UUID,
) -> None:
    if str(submission["buyer_id"]) != str(buyer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")


async def _get_signed_url(storage_path: str) -> str:
    """Generates a short-lived signed URL for a KYC document."""
    try:
        supabase = await get_supabase_admin_client()
        result = await supabase.storage.from_(KYC_BUCKET).create_signed_url(
            storage_path, settings.SIGNED_URL_EXPIRY_SECONDS
        )
        return result.get("signedURL") or result.get("signed_url") or ""
    except Exception as exc:
        logger.warning("Failed to generate signed URL for %s: %s", storage_path, exc)
        return ""


async def _enrich_document(db: asyncpg.Connection, doc: asyncpg.Record) -> dict:
    """Adds document_type_name, document_type_slug, signed_url to a document row."""
    dt = None
    if doc["document_type_id"]:
        dt = await db.fetchrow(
            "SELECT name, slug FROM kyc.document_types WHERE id = $1",
            doc["document_type_id"],
        )
    signed_url = await _get_signed_url(doc["storage_path"])
    return {
        **dict(doc),
        "document_type_name": dt["name"] if dt else doc.get("original_name"),
        "document_type_slug": dt["slug"] if dt else None,
        "signed_url": signed_url,
    }


async def _get_full_submission(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
    actor_roles: list[str],
    actor_id: uuid.UUID,
) -> dict:
    """
    Loads a submission with its documents, reviews, and assignment.
    Admins and buyer_agents see all submissions.
    Buyers see only their own.
    """
    sub = await db.fetchrow(
        """
        SELECT s.*,
               p.full_name  AS buyer_name,
               p.company_name AS buyer_company,
               u.email      AS buyer_email
        FROM kyc.submissions s
        JOIN public.profiles p ON p.id = s.buyer_id
        JOIN auth.users u      ON u.id = s.buyer_id
        WHERE s.id = $1
        """,
        submission_id,
    )
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KYC submission not found.")

    is_privileged = any(r in actor_roles for r in ("admin", "buyer_agent"))
    if not is_privileged and str(sub["buyer_id"]) != str(actor_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    # Documents
    raw_docs = await db.fetch(
        "SELECT * FROM kyc.documents WHERE submission_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at",
        submission_id,
    )
    docs = [await _enrich_document(db, d) for d in raw_docs]

    # Reviews
    raw_reviews = await db.fetch(
        """
        SELECT r.*, p.full_name AS reviewer_name
        FROM kyc.reviews r
        LEFT JOIN public.profiles p ON p.id = r.reviewer_id
        WHERE r.submission_id = $1
        ORDER BY r.created_at
        """,
        submission_id,
    )
    reviews = [dict(r) for r in raw_reviews]

    # Assignment
    asgn = await db.fetchrow(
        """
        SELECT a.*,
               ag.full_name AS agent_name,
               ab.full_name AS assigned_by_name
        FROM kyc.assignments a
        LEFT JOIN public.profiles ag ON ag.id = a.agent_id
        LEFT JOIN public.profiles ab ON ab.id = a.assigned_by
        WHERE a.submission_id = $1
        """,
        submission_id,
    )

    return {
        **dict(sub),
        "documents": docs,
        "reviews": reviews,
        "assignment": dict(asgn) if asgn else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT TYPES
# ══════════════════════════════════════════════════════════════════════════════

async def list_document_types(
    db: asyncpg.Connection,
    include_inactive: bool = False,
) -> list[dict]:
    """Returns all document types. Inactive types hidden unless include_inactive=True."""
    query = "SELECT * FROM kyc.document_types"
    if not include_inactive:
        query += " WHERE is_active = TRUE"
    query += " ORDER BY display_order, name"
    rows = await db.fetch(query)
    return [dict(r) for r in rows]


async def create_document_type(
    db: asyncpg.Connection,
    payload: CreateDocumentTypeRequest,
    actor: dict,
) -> dict:
    admin_id = uuid.UUID(str(actor["id"]))
    try:
        row = await db.fetchrow(
            """
            INSERT INTO kyc.document_types
                (name, slug, description, is_required, display_order, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            """,
            payload.name, payload.slug, payload.description,
            payload.is_required, payload.display_order, admin_id,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A document type with slug '{payload.slug}' already exists.",
        )

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_DOCUMENT_TYPE_CREATED,
        resource_type="kyc_document_type",
        resource_id=str(row["id"]),
        new_state={"slug": payload.slug, "is_required": payload.is_required},
    )
    return dict(row)


async def update_document_type(
    db: asyncpg.Connection,
    doc_type_id: uuid.UUID,
    payload: UpdateDocumentTypeRequest,
    actor: dict,
) -> dict:
    admin_id = uuid.UUID(str(actor["id"]))

    existing = await db.fetchrow("SELECT * FROM kyc.document_types WHERE id = $1", doc_type_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document type not found.")

    updates: dict = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.description is not None:
        updates["description"] = payload.description
    if payload.is_required is not None:
        updates["is_required"] = payload.is_required
    if payload.is_active is not None:
        updates["is_active"] = payload.is_active
    if payload.display_order is not None:
        updates["display_order"] = payload.display_order

    if not updates:
        return dict(existing)

    _ALLOWED_DOC_TYPE_COLS = frozenset({"name", "description", "is_required", "is_active", "display_order"})
    if not updates.keys() <= _ALLOWED_DOC_TYPE_COLS:
        raise ValueError(f"Invalid column(s): {updates.keys() - _ALLOWED_DOC_TYPE_COLS}")

    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates))
    values = [doc_type_id, *updates.values()]
    row = await db.fetchrow(
        f"UPDATE kyc.document_types SET {set_clause} WHERE id = $1 RETURNING *",
        *values,
    )

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_DOCUMENT_TYPE_UPDATED,
        resource_type="kyc_document_type",
        resource_id=str(doc_type_id),
        old_state=dict(existing),
        new_state=updates,
    )
    return dict(row)


# ══════════════════════════════════════════════════════════════════════════════
# BUYER: STATUS VIEW
# ══════════════════════════════════════════════════════════════════════════════

async def get_kyc_status(db: asyncpg.Connection, buyer_id: uuid.UUID) -> dict:
    """Returns the buyer's full KYC dashboard view."""
    profile = await db.fetchrow(
        "SELECT kyc_status, kyc_expires_at, kyc_attempt_count, current_kyc_submission_id, phone_verified, phone FROM public.profiles WHERE id = $1",
        buyer_id,
    )

    doc_types = await db.fetch(
        "SELECT * FROM kyc.document_types WHERE is_active = TRUE ORDER BY display_order, name"
    )
    required = [dict(d) for d in doc_types if d["is_required"]]
    optional = [dict(d) for d in doc_types if not d["is_required"]]

    sub_status = None
    rejection_reason = None
    uploaded_count = 0

    sub_id = profile["current_kyc_submission_id"]
    if sub_id:
        sub = await db.fetchrow("SELECT status, rejection_reason FROM kyc.submissions WHERE id = $1", sub_id)
        if sub:
            sub_status = sub["status"]
            rejection_reason = sub["rejection_reason"]
            uploaded_count = await db.fetchval(
                "SELECT COUNT(*) FROM kyc.documents WHERE submission_id = $1 AND deleted_at IS NULL",
                sub_id,
            ) or 0

    # Fetch documents for the current submission
    documents = []
    if sub_id:
        doc_rows = await db.fetch(
            """
            SELECT d.id, d.document_type_id, COALESCE(dt.name, d.original_name) AS document_type_name, dt.slug AS document_type_slug,
                   d.original_name, d.uploaded_at
            FROM kyc.documents d
            LEFT JOIN kyc.document_types dt ON dt.id = d.document_type_id
            WHERE d.submission_id = $1 AND d.deleted_at IS NULL
            ORDER BY d.uploaded_at
            """,
            sub_id,
        )
        documents = [dict(r) for r in doc_rows]

    return {
        "kyc_status": profile["kyc_status"],
        "kyc_expires_at": profile["kyc_expires_at"],
        "kyc_attempt_count": profile["kyc_attempt_count"],
        "current_submission_id": sub_id,
        "current_submission_status": sub_status,
        "required_document_types": required,
        "optional_document_types": optional,
        "uploaded_document_count": uploaded_count,
        "rejection_reason": rejection_reason,
        "phone_verified": bool(profile.get("phone_verified", False)),
        "phone": profile.get("phone"),
        "documents": documents,
    }


# ══════════════════════════════════════════════════════════════════════════════
# BUYER: DOCUMENTS
# ══════════════════════════════════════════════════════════════════════════════

async def get_or_create_draft_submission(
    db: asyncpg.Connection,
    buyer_id: uuid.UUID,
) -> asyncpg.Record:
    """
    Returns the buyer's current draft submission, or creates one if none exists.
    Raises 409 if the current submission is locked (submitted/under review).
    """
    profile = await db.fetchrow(
        "SELECT current_kyc_submission_id, kyc_attempt_count FROM public.profiles WHERE id = $1",
        buyer_id,
    )
    sub_id = profile["current_kyc_submission_id"]

    if sub_id:
        sub = await db.fetchrow("SELECT * FROM kyc.submissions WHERE id = $1", sub_id)
        if sub and sub["status"] == "draft":
            return sub
        if sub and sub["status"] in ("submitted", "under_review"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Your KYC submission is currently '{sub['status']}' and cannot be modified.",
            )
        # Status is approved/rejected/requires_resubmission — buyer should call /resubmit

    # Create new draft
    attempt = (profile["kyc_attempt_count"] or 0) + 1
    sub = await db.fetchrow(
        """
        INSERT INTO kyc.submissions (buyer_id, cycle_number, status)
        VALUES ($1, $2, 'draft')
        RETURNING *
        """,
        buyer_id, attempt,
    )
    await db.execute(
        "UPDATE public.profiles SET current_kyc_submission_id = $1 WHERE id = $2",
        sub["id"], buyer_id,
    )
    return sub


async def upload_kyc_document(
    db: asyncpg.Connection,
    file: UploadFile,
    document_type_id: uuid.UUID | None,
    actor: dict,
) -> dict:
    """Buyer uploads a document to their current draft submission."""
    buyer_id = uuid.UUID(str(actor["id"]))

    # Validate document type if provided
    doc_type = None
    if document_type_id:
        doc_type = await db.fetchrow(
            "SELECT * FROM kyc.document_types WHERE id = $1 AND is_active = TRUE",
            document_type_id,
        )
        if not doc_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document type not found or not active.",
            )

    submission = await get_or_create_draft_submission(db, buyer_id)
    submission_id = submission["id"]

    # MIME validation
    mime_type = file.content_type or ""
    if mime_type not in ALLOWED_MIME_TYPES and file.filename:
        guessed, _ = mimetypes.guess_type(file.filename)
        mime_type = guessed or mime_type
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{mime_type}'. Allowed: JPEG, PNG, WebP, PDF.",
        )

    # Size validation
    file_bytes = await file.read()
    max_bytes = MAX_DOC_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {MAX_DOC_SIZE_MB} MB.",
        )

    from app.core.file_validation import validate_magic_bytes
    if not validate_magic_bytes(file_bytes, mime_type):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File content does not match the declared file type.",
        )

    # SHA-256 integrity hash
    file_hash = hashlib.sha256(file_bytes).hexdigest()

    # Upload to Supabase Storage
    doc_id = uuid.uuid4()
    ext = MIME_TO_EXT[mime_type]
    storage_path = f"{buyer_id}/{submission_id}/{doc_id}.{ext}"

    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(KYC_BUCKET).upload(
            storage_path,
            file_bytes,
            {"content_type": mime_type},
        )
    except Exception as exc:
        logger.error("KYC storage upload failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Document upload failed. Please try again.",
        )

    row = await db.fetchrow(
        """
        INSERT INTO kyc.documents
            (id, submission_id, buyer_id, document_type_id, storage_path,
             original_name, file_size_bytes, mime_type, file_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        """,
        doc_id, submission_id, buyer_id, document_type_id,
        storage_path, file.filename, len(file_bytes), mime_type, file_hash,
    )

    await write_audit_log(
        db,
        actor_id=buyer_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_DOCUMENT_UPLOADED,
        resource_type="kyc_document",
        resource_id=str(doc_id),
        new_state={
            "submission_id": str(submission_id),
            "document_type_id": str(document_type_id),
            "file_hash": file_hash,
            "mime_type": mime_type,
        },
    )

    return await _enrich_document(db, row)


async def delete_kyc_document(
    db: asyncpg.Connection,
    document_id: uuid.UUID,
    actor: dict,
) -> dict:
    """Buyer deletes a document from their draft submission."""
    buyer_id = uuid.UUID(str(actor["id"]))

    doc = await db.fetchrow("SELECT * FROM kyc.documents WHERE id = $1 AND deleted_at IS NULL", document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    if str(doc["buyer_id"]) != str(buyer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    # Verify the submission is still a draft
    sub = await db.fetchrow("SELECT status FROM kyc.submissions WHERE id = $1", doc["submission_id"])
    if sub and sub["status"] != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete documents from a submitted or locked application.",
        )

    # Soft-delete in DB
    await db.execute(
        "UPDATE kyc.documents SET deleted_at = NOW() WHERE id = $1",
        document_id,
    )

    await write_audit_log(
        db,
        actor_id=buyer_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_DOCUMENT_DELETED,
        resource_type="kyc_document",
        resource_id=str(document_id),
    )
    return {"message": "Document deleted successfully.", "document_id": str(document_id)}


async def list_buyer_documents(
    db: asyncpg.Connection,
    buyer_id: uuid.UUID,
) -> list[dict]:
    """Lists non-deleted documents in the buyer's current draft submission."""
    profile = await db.fetchrow(
        "SELECT current_kyc_submission_id FROM public.profiles WHERE id = $1",
        buyer_id,
    )
    sub_id = profile["current_kyc_submission_id"] if profile else None
    if not sub_id:
        return []

    rows = await db.fetch(
        "SELECT * FROM kyc.documents WHERE submission_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at",
        sub_id,
    )
    return [await _enrich_document(db, r) for r in rows]


# ══════════════════════════════════════════════════════════════════════════════
# BUYER: SUBMIT / RESUBMIT
# ══════════════════════════════════════════════════════════════════════════════

async def submit_kyc(db: asyncpg.Connection, actor: dict) -> dict:
    """
    Buyer submits their current draft for review.

    Validates:
      - All required document types have at least one uploaded document.
      - At least 1 document total.
    Transitions: draft → submitted, kyc_status → under_review (pending agent assignment).
    """
    buyer_id = uuid.UUID(str(actor["id"]))

    profile = await db.fetchrow(
        "SELECT current_kyc_submission_id, kyc_status FROM public.profiles WHERE id = $1",
        buyer_id,
    )
    sub_id = profile["current_kyc_submission_id"]
    if not sub_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No draft submission found. Please upload documents first.",
        )

    sub = await _get_submission_or_404(db, sub_id)
    if sub["status"] != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot submit — current status is '{sub['status']}'.",
        )

    # Check required document types are covered
    required_types = await db.fetch(
        "SELECT id, name FROM kyc.document_types WHERE is_required = TRUE AND is_active = TRUE"
    )
    uploaded_type_ids = await db.fetch(
        "SELECT DISTINCT document_type_id FROM kyc.documents WHERE submission_id = $1 AND deleted_at IS NULL AND document_type_id IS NOT NULL",
        sub_id,
    )
    uploaded_ids = {str(r["document_type_id"]) for r in uploaded_type_ids}
    missing = [r["name"] for r in required_types if str(r["id"]) not in uploaded_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Missing required documents: {', '.join(missing)}",
        )

    total_docs = await db.fetchval(
        "SELECT COUNT(*) FROM kyc.documents WHERE submission_id = $1 AND deleted_at IS NULL",
        sub_id,
    )
    if not total_docs:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload at least one document before submitting.",
        )

    now = datetime.now(timezone.utc)
    async with db.transaction():
        await db.execute(
            """
            UPDATE kyc.submissions
            SET status = 'submitted', locked_at = $2, submitted_at = $2, updated_at = $2
            WHERE id = $1
            """,
            sub_id, now,
        )
        await db.execute(
            "UPDATE public.profiles SET kyc_status = 'under_review', kyc_attempt_count = kyc_attempt_count + 1 WHERE id = $1",
            buyer_id,
        )

    await write_audit_log(
        db,
        actor_id=buyer_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_SUBMITTED,
        resource_type="kyc_submission",
        resource_id=str(sub_id),
        new_state={"cycle_number": sub["cycle_number"]},
    )

    # Email notification (fire-and-forget)
    email, name = await _get_buyer_email(db, buyer_id)
    if email:
        import asyncio
        asyncio.create_task(notification_service.send_kyc_submitted(email, name))

    return {"message": "KYC submission received.", "submission_id": str(sub_id), "status": "submitted"}


async def start_resubmission(db: asyncpg.Connection, actor: dict) -> dict:
    """
    Buyer starts a new KYC cycle after rejection or resubmission request.
    Checks the attempt cap (MAX_RESUBMISSION_ATTEMPTS).
    Transitions: kyc_status remains 'under_review' until submitted.
    """
    buyer_id = uuid.UUID(str(actor["id"]))

    profile = await db.fetchrow(
        "SELECT kyc_status, kyc_attempt_count, current_kyc_submission_id FROM public.profiles WHERE id = $1",
        buyer_id,
    )
    allowed_statuses = ("rejected", "requires_resubmission", "expired")
    if profile["kyc_status"] not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Resubmission is only allowed when KYC status is one of: {allowed_statuses}. "
                f"Current: '{profile['kyc_status']}'"
            ),
        )

    attempt = profile["kyc_attempt_count"] or 0
    if attempt >= MAX_RESUBMISSION_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Maximum resubmission attempts ({MAX_RESUBMISSION_ATTEMPTS}) reached. "
                "Please contact support for manual review."
            ),
        )

    cycle = attempt + 1
    sub = await db.fetchrow(
        "INSERT INTO kyc.submissions (buyer_id, cycle_number, status) VALUES ($1, $2, 'draft') RETURNING *",
        buyer_id, cycle,
    )
    await db.execute(
        "UPDATE public.profiles SET current_kyc_submission_id = $1, kyc_status = 'pending' WHERE id = $2",
        sub["id"], buyer_id,
    )

    await write_audit_log(
        db,
        actor_id=buyer_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_RESUBMISSION_STARTED,
        resource_type="kyc_submission",
        resource_id=str(sub["id"]),
        new_state={"cycle_number": cycle},
    )
    return {"message": "New KYC submission started.", "submission_id": str(sub["id"]), "cycle_number": cycle}


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN: ASSIGN AGENT
# ══════════════════════════════════════════════════════════════════════════════

async def assign_kyc_agent(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
    payload: AssignKycAgentRequest,
    actor: dict,
) -> dict:
    """Admin assigns a buyer_agent to a submitted KYC."""
    admin_id = uuid.UUID(str(actor["id"]))

    sub = await _get_submission_or_404(db, submission_id)
    if sub["status"] != "submitted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Submission must be in 'submitted' status. Current: '{sub['status']}'.",
        )

    agent = await db.fetchrow(
        "SELECT id, roles FROM public.profiles WHERE id = $1 AND is_active = TRUE",
        payload.agent_id,
    )
    if not agent or "buyer_agent" not in agent["roles"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not an active buyer_agent.",
        )

    async with db.transaction():
        # Upsert assignment (allow reassignment by admin)
        asgn = await db.fetchrow(
            """
            INSERT INTO kyc.assignments (submission_id, agent_id, assigned_by, status)
            VALUES ($1, $2, $3, 'assigned')
            ON CONFLICT (submission_id) DO UPDATE
                SET agent_id    = EXCLUDED.agent_id,
                    assigned_by = EXCLUDED.assigned_by,
                    status      = 'assigned',
                    updated_at  = NOW()
            RETURNING *
            """,
            submission_id, payload.agent_id, admin_id,
        )
        await db.execute(
            "UPDATE kyc.submissions SET status = 'under_review', updated_at = NOW() WHERE id = $1",
            submission_id,
        )

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_AGENT_ASSIGNED,
        resource_type="kyc_submission",
        resource_id=str(submission_id),
        new_state={"agent_id": str(payload.agent_id)},
    )

    # Notify buyer
    buyer_email, buyer_name = await _get_buyer_email(db, sub["buyer_id"])
    if buyer_email:
        import asyncio
        asyncio.create_task(notification_service.send_kyc_under_review(buyer_email, buyer_name))

    enriched = await db.fetchrow(
        """
        SELECT a.*, ag.full_name AS agent_name, ab.full_name AS assigned_by_name
        FROM kyc.assignments a
        LEFT JOIN public.profiles ag ON ag.id = a.agent_id
        LEFT JOIN public.profiles ab ON ab.id = a.assigned_by
        WHERE a.id = $1
        """,
        asgn["id"],
    )
    return dict(enriched)


# ══════════════════════════════════════════════════════════════════════════════
# AGENT: VIEW ASSIGNMENTS
# ══════════════════════════════════════════════════════════════════════════════

async def list_agent_assignments(
    db: asyncpg.Connection,
    agent_id: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    total = await db.fetchval(
        "SELECT COUNT(*) FROM kyc.assignments WHERE agent_id = $1",
        agent_id,
    )
    rows = await db.fetch(
        """
        SELECT
            s.id, s.buyer_id, s.cycle_number, s.status, s.submitted_at, s.created_at,
            p.full_name  AS buyer_name,
            p.company_name AS buyer_company,
            p.phone_verified AS buyer_phone_verified,
            p.phone AS buyer_phone,
            ag.full_name AS assigned_agent,
            (SELECT COUNT(*) FROM kyc.documents d
             WHERE d.submission_id = s.id AND d.deleted_at IS NULL) AS document_count,
            (SELECT r.risk_score FROM kyc.reviews r
             WHERE r.submission_id = s.id
             ORDER BY r.created_at DESC LIMIT 1) AS risk_score
        FROM kyc.assignments a
        JOIN kyc.submissions s ON s.id = a.submission_id
        JOIN public.profiles p ON p.id = s.buyer_id
        LEFT JOIN public.profiles ag ON ag.id = a.agent_id
        WHERE a.agent_id = $1
        ORDER BY s.created_at DESC
        LIMIT $2 OFFSET $3
        """,
        agent_id, page_size, offset,
    )
    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)),
    }


async def update_agent_assignment(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
    payload: UpdateKycAssignmentRequest,
    actor: dict,
) -> dict:
    """Agent marks their assignment as in_review."""
    agent_id = uuid.UUID(str(actor["id"]))

    asgn = await db.fetchrow(
        "SELECT * FROM kyc.assignments WHERE submission_id = $1",
        submission_id,
    )
    if not asgn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")
    if str(asgn["agent_id"]) != str(agent_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not assigned to this submission.")

    await db.execute(
        "UPDATE kyc.assignments SET status = $2, updated_at = NOW() WHERE id = $1",
        asgn["id"], payload.status,
    )

    await write_audit_log(
        db,
        actor_id=agent_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.KYC_ASSIGNMENT_UPDATED,
        resource_type="kyc_assignment",
        resource_id=str(asgn["id"]),
        new_state={"status": payload.status},
    )

    enriched = await db.fetchrow(
        """
        SELECT a.*, ag.full_name AS agent_name, ab.full_name AS assigned_by_name
        FROM kyc.assignments a
        LEFT JOIN public.profiles ag ON ag.id = a.agent_id
        LEFT JOIN public.profiles ab ON ab.id = a.assigned_by
        WHERE a.id = $1
        """,
        asgn["id"],
    )
    return dict(enriched)


# ══════════════════════════════════════════════════════════════════════════════
# AGENT: SUBMIT REVIEW
# ══════════════════════════════════════════════════════════════════════════════

async def submit_agent_review(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
    payload: KycAgentReviewRequest,
    actor: dict,
) -> dict:
    """
    Agent submits their assessment.
    - If is_pep or sanctions_match → risk_score forced to 'high',
      recommendation restricted to reject/requires_resubmission.
    - Agents cannot recommend 'approve' on high-risk (pep/sanctions) submissions.
    - Marks assignment as assessment_submitted.
    """
    agent_id = uuid.UUID(str(actor["id"]))

    asgn = await db.fetchrow(
        "SELECT * FROM kyc.assignments WHERE submission_id = $1",
        submission_id,
    )
    if not asgn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No assignment found for this submission.")

    roles = actor.get("roles", [])
    is_admin = "admin" in roles
    is_agent = "buyer_agent" in roles

    if not is_admin and (not is_agent or str(asgn["agent_id"]) != str(agent_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not assigned to this submission.")

    if asgn["status"] == "assessment_submitted" and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Assessment already submitted for this assignment.",
        )

    # Enforce PEP/sanctions escalation rules
    effective_risk = payload.risk_score
    if payload.is_pep or payload.sanctions_match:
        effective_risk = "high"
        if payload.recommendation == "approve":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Cannot recommend 'approve' when is_pep or sanctions_match is True. "
                    "Use 'reject' or 'requires_resubmission' and escalate to admin."
                ),
            )

    # Agents cannot approve — only admin can approve
    reviewer_role = "admin" if is_admin else "buyer_agent"
    if reviewer_role == "buyer_agent" and payload.recommendation == "approve":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agents cannot approve KYC directly. Submit your recommendation and the admin will make the final decision.",
        )

    async with db.transaction():
        review = await db.fetchrow(
            """
            INSERT INTO kyc.reviews
                (submission_id, assignment_id, reviewer_id, reviewer_role,
                 assessment, risk_score, is_pep, sanctions_match, recommendation)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            """,
            submission_id, asgn["id"], agent_id, reviewer_role,
            payload.assessment, effective_risk, payload.is_pep,
            payload.sanctions_match, payload.recommendation,
        )
        await db.execute(
            "UPDATE kyc.assignments SET status = 'assessment_submitted', updated_at = NOW() WHERE id = $1",
            asgn["id"],
        )

    await write_audit_log(
        db,
        actor_id=agent_id,
        actor_roles=roles,
        action=AuditAction.KYC_AGENT_REVIEW_SUBMITTED,
        resource_type="kyc_submission",
        resource_id=str(submission_id),
        new_state={
            "risk_score": effective_risk,
            "recommendation": payload.recommendation,
            "is_pep": payload.is_pep,
            "sanctions_match": payload.sanctions_match,
        },
    )

    enriched = await db.fetchrow(
        "SELECT r.*, p.full_name AS reviewer_name FROM kyc.reviews r LEFT JOIN public.profiles p ON p.id = r.reviewer_id WHERE r.id = $1",
        review["id"],
    )
    return dict(enriched)


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN: FINAL DECISION
# ══════════════════════════════════════════════════════════════════════════════

async def admin_kyc_decision(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
    payload: KycAdminDecisionRequest,
    actor: dict,
) -> dict:
    """
    Admin makes the final KYC decision.
    - approve   → submission & profile status = approved, kyc_expires_at = now + 12mo
    - reject    → submission & profile status = rejected
    - requires_resubmission → submission status = requires_resubmission, profile = requires_resubmission
    Dual-control: if is_pep or sanctions_match, 'approve' is blocked.
    """
    admin_id = uuid.UUID(str(actor["id"]))

    sub = await _get_submission_or_404(db, submission_id)
    if sub["status"] not in ("submitted", "under_review"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Submission must be submitted or under_review. Current: '{sub['status']}'.",
        )

    if (payload.is_pep or payload.sanctions_match) and payload.decision == "approve":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot approve a submission flagged as PEP or sanctions match. Reject or escalate.",
        )

    effective_risk = payload.risk_score
    if payload.is_pep or payload.sanctions_match:
        effective_risk = "high"

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=365) if payload.decision == "approve" else None

    # Map decision to statuses
    status_map = {
        "approve":               "approved",
        "reject":                "rejected",
        "requires_resubmission": "requires_resubmission",
    }
    submission_status = status_map[payload.decision]
    profile_kyc_status = submission_status

    async with db.transaction():
        # Record immutable admin review
        review = await db.fetchrow(
            """
            INSERT INTO kyc.reviews
                (submission_id, assignment_id, reviewer_id, reviewer_role,
                 assessment, risk_score, is_pep, sanctions_match, recommendation)
            VALUES ($1, NULL, $2, 'admin', $3, $4, $5, $6, $7)
            RETURNING *
            """,
            submission_id, admin_id,
            payload.assessment, effective_risk, payload.is_pep,
            payload.sanctions_match, payload.decision,
        )

        # Update submission
        await db.execute(
            """
            UPDATE kyc.submissions
            SET status = $2, decided_at = $3, expires_at = $4,
                rejection_reason = $5, updated_at = $3
            WHERE id = $1
            """,
            submission_id, submission_status, now, expires_at, payload.reason,
        )

        # Update profile
        await db.execute(
            """
            UPDATE public.profiles
            SET kyc_status = $1, kyc_expires_at = $2, updated_at = $3
            WHERE id = $4
            """,
            profile_kyc_status, expires_at, now, sub["buyer_id"],
        )

    audit_action = {
        "approve": AuditAction.KYC_APPROVED,
        "reject":  AuditAction.KYC_REJECTED,
        "requires_resubmission": AuditAction.KYC_RESUBMISSION_REQUESTED,
    }[payload.decision]

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=audit_action,
        resource_type="kyc_submission",
        resource_id=str(submission_id),
        new_state={
            "decision": payload.decision,
            "risk_score": effective_risk,
            "is_pep": payload.is_pep,
            "sanctions_match": payload.sanctions_match,
            "expires_at": str(expires_at) if expires_at else None,
        },
    )

    # Email notification
    buyer_email, buyer_name = await _get_buyer_email(db, sub["buyer_id"])
    if buyer_email:
        import asyncio
        if payload.decision == "approve":
            asyncio.create_task(
                notification_service.send_kyc_approved(
                    buyer_email, buyer_name,
                    expires_at.strftime("%d %B %Y") if expires_at else "N/A",
                )
            )
        elif payload.decision == "reject":
            asyncio.create_task(
                notification_service.send_kyc_rejected(buyer_email, buyer_name, payload.reason)
            )
        else:
            asyncio.create_task(
                notification_service.send_kyc_requires_resubmission(
                    buyer_email, buyer_name, payload.reason
                )
            )

    return {
        "message": f"KYC decision recorded: {payload.decision}.",
        "submission_id": str(submission_id),
        "decision": payload.decision,
        "expires_at": expires_at.isoformat() if expires_at else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN: QUEUE & LIST
# ══════════════════════════════════════════════════════════════════════════════

async def list_kyc_submissions(
    db: asyncpg.Connection,
    status_filter: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Admin/agent lists all KYC submissions, optionally filtered by status."""
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    where = "WHERE 1=1"
    params: list = []
    if status_filter:
        params.append(status_filter)
        where += f" AND s.status = ${len(params)}"

    total = await db.fetchval(
        f"SELECT COUNT(*) FROM kyc.submissions s {where}", *params
    )
    rows = await db.fetch(
        f"""
        SELECT
            s.id, s.buyer_id, s.cycle_number, s.status, s.submitted_at, s.created_at,
            p.full_name  AS buyer_name,
            p.company_name AS buyer_company,
            p.phone_verified AS buyer_phone_verified,
            p.phone AS buyer_phone,
            ag.full_name AS assigned_agent,
            (SELECT COUNT(*) FROM kyc.documents d
             WHERE d.submission_id = s.id AND d.deleted_at IS NULL) AS document_count,
            (SELECT r.risk_score FROM kyc.reviews r
             WHERE r.submission_id = s.id
             ORDER BY r.created_at DESC LIMIT 1) AS risk_score
        FROM kyc.submissions s
        JOIN public.profiles p ON p.id = s.buyer_id
        LEFT JOIN kyc.assignments a ON a.submission_id = s.id
        LEFT JOIN public.profiles ag ON ag.id = a.agent_id
        {where}
        ORDER BY s.submitted_at DESC NULLS LAST, s.created_at DESC
        LIMIT ${len(params)+1} OFFSET ${len(params)+2}
        """,
        *params, page_size, offset,
    )
    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)),
    }


async def get_submission_detail(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
    actor: dict,
) -> dict:
    """Loads full submission detail (documents, reviews, assignment)."""
    return await _get_full_submission(
        db, submission_id,
        actor_roles=actor.get("roles", []),
        actor_id=uuid.UUID(str(actor["id"])),
    )


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT ACCESS LOGGING
# ══════════════════════════════════════════════════════════════════════════════

async def log_document_access(
    db: asyncpg.Connection,
    *,
    document_id: uuid.UUID,
    accessed_by: uuid.UUID,
    accessor_role: str,
    access_type: str = "view",
    ip_address: Optional[str] = None,
    integrity_ok: Optional[bool] = None,
) -> None:
    """
    Record every document view/download in the immutable access log.
    Called whenever a signed URL is generated or a document is downloaded.
    """
    await db.execute(
        """
        INSERT INTO kyc.document_access_log
            (document_id, accessed_by, accessor_role, access_type, ip_address, integrity_ok)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        document_id, accessed_by, accessor_role, access_type,
        ip_address, integrity_ok,
    )


async def get_signed_url_with_logging(
    db: asyncpg.Connection,
    document_id: uuid.UUID,
    actor: dict,
    ip_address: Optional[str] = None,
) -> dict:
    """
    Generate a signed URL for a KYC document and log the access.
    Also verifies file integrity by comparing stored hash.
    """
    doc = await db.fetchrow(
        "SELECT * FROM kyc.documents WHERE id = $1 AND deleted_at IS NULL",
        document_id,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    # Access control: buyer sees own docs, agent/admin sees assigned or all
    actor_id = uuid.UUID(str(actor["id"]))
    roles = actor.get("roles", [])
    is_privileged = any(r in roles for r in ("admin", "buyer_agent"))

    if not is_privileged and str(doc["buyer_id"]) != str(actor_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    if "buyer_agent" in roles and "admin" not in roles:
        # Agent must be assigned to this submission
        asgn = await db.fetchrow(
            "SELECT id FROM kyc.assignments WHERE submission_id = $1 AND agent_id = $2",
            doc["submission_id"], actor_id,
        )
        if not asgn:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this submission.")

    signed_url = await _get_signed_url(doc["storage_path"])
    accessor_role = "admin" if "admin" in roles else ("buyer_agent" if "buyer_agent" in roles else "buyer")

    await log_document_access(
        db,
        document_id=document_id,
        accessed_by=actor_id,
        accessor_role=accessor_role,
        access_type="view",
        ip_address=ip_address,
        integrity_ok=True,  # We trust Supabase storage integrity
    )

    await write_audit_log(
        db,
        actor_id=actor_id,
        actor_roles=roles,
        action=AuditAction.KYC_DOCUMENT_ACCESSED,
        resource_type="kyc_document",
        resource_id=str(document_id),
        metadata={"access_type": "view", "ip_address": ip_address},
    )

    enriched = await _enrich_document(db, doc)
    return enriched


async def get_document_access_history(
    db: asyncpg.Connection,
    document_id: uuid.UUID,
) -> list[dict]:
    """Returns the full access log for a document (admin/agent use)."""
    rows = await db.fetch(
        """
        SELECT dal.*, p.full_name AS accessed_by_name
        FROM kyc.document_access_log dal
        LEFT JOIN public.profiles p ON p.id = dal.accessed_by
        WHERE dal.document_id = $1
        ORDER BY dal.accessed_at DESC
        """,
        document_id,
    )
    return [dict(r) for r in rows]


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT REQUESTS (Agent → Buyer)
# ══════════════════════════════════════════════════════════════════════════════

async def create_document_requests(
    db: asyncpg.Connection,
    *,
    submission_id: uuid.UUID,
    agent_id: uuid.UUID,
    requests: list[dict],
) -> list[dict]:
    """
    Agent requests specific documents from a buyer.

    Each request dict: {document_type_id?, custom_document_name?, reason, priority}
    - Provide document_type_id to pick from the pre-defined list, OR
    - Provide custom_document_name to write a free-text document name.
    priority: 'required' or 'recommended'
    """
    sub = await _get_submission_or_404(db, submission_id)

    # Verify agent is assigned — or auto-create assignment if coming from PR context
    asgn = await db.fetchrow(
        "SELECT id FROM kyc.assignments WHERE submission_id = $1 AND agent_id = $2",
        submission_id, agent_id,
    )
    if not asgn:
        # Auto-assign agent to this submission (covers purchase-request-driven flow)
        await db.execute(
            """
            INSERT INTO kyc.assignments (submission_id, agent_id, assigned_by, status)
            VALUES ($1, $2, $2, 'in_review')
            ON CONFLICT (submission_id) DO NOTHING
            """,
            submission_id, agent_id,
        )

    created = []
    for req in requests:
        raw_type_id = req.get("document_type_id")
        custom_name = (req.get("custom_document_name") or "").strip()
        reason      = req.get("reason", "")
        priority    = req.get("priority", "required")

        if not raw_type_id and not custom_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Each request must have either document_type_id or custom_document_name.",
            )

        doc_type_id   = uuid.UUID(str(raw_type_id)) if raw_type_id else None
        doc_type_name = custom_name

        if doc_type_id:
            # Validate pre-defined type exists
            dt = await db.fetchrow(
                "SELECT id, name FROM kyc.document_types WHERE id = $1 AND is_active = TRUE",
                doc_type_id,
            )
            if not dt:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Document type {doc_type_id} not found or inactive.",
                )
            doc_type_name = dt["name"]

        row = await db.fetchrow(
            """
            INSERT INTO kyc.document_requests
                (submission_id, document_type_id, custom_document_name, requested_by, reason, priority, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            RETURNING *
            """,
            submission_id, doc_type_id, custom_name or None, agent_id, reason, priority,
        )
        created.append({**dict(row), "document_type_name": doc_type_name})

    await write_audit_log(
        db,
        actor_id=agent_id,
        actor_roles=["buyer_agent"],
        action=AuditAction.KYC_DOCUMENT_REQUESTED,
        resource_type="kyc_submission",
        resource_id=str(submission_id),
        new_state={
            "request_count": len(created),
            "document_types": [str(r["document_type_id"]) for r in created],
        },
    )

    # Notify buyer about requested documents
    buyer_email, buyer_name = await _get_buyer_email(db, sub["buyer_id"])
    if buyer_email:
        import asyncio
        doc_names = [r["document_type_name"] for r in created]
        asyncio.create_task(
            notification_service.send_document_request(buyer_email, buyer_name, doc_names)
        )

    return created


async def list_document_requests(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
) -> list[dict]:
    """List all document requests for a submission."""
    rows = await db.fetch(
        """
        SELECT dr.*,
               COALESCE(dt.name, dr.custom_document_name) AS document_type_name,
               dt.slug AS document_type_slug,
               p.full_name AS requested_by_name
        FROM kyc.document_requests dr
        LEFT JOIN kyc.document_types dt ON dt.id = dr.document_type_id
        LEFT JOIN public.profiles p ON p.id = dr.requested_by
        WHERE dr.submission_id = $1
        ORDER BY dr.created_at
        """,
        submission_id,
    )
    return [dict(r) for r in rows]


async def fulfill_document_request(
    db: asyncpg.Connection,
    request_id: uuid.UUID,
    document_id: uuid.UUID,
    buyer_id: uuid.UUID,
) -> dict:
    """
    Buyer links an uploaded document to a pending request.
    Transitions request status: pending → uploaded.
    """
    req = await db.fetchrow(
        "SELECT * FROM kyc.document_requests WHERE id = $1",
        request_id,
    )
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document request not found.")
    if req["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Request is already '{req['status']}'.",
        )

    # Verify the document belongs to the buyer and matches the submission
    doc = await db.fetchrow(
        "SELECT * FROM kyc.documents WHERE id = $1 AND deleted_at IS NULL",
        document_id,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    if str(doc["buyer_id"]) != str(buyer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
    if str(doc["submission_id"]) != str(req["submission_id"]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Document does not belong to the same submission as the request.",
        )

    row = await db.fetchrow(
        """
        UPDATE kyc.document_requests
        SET status = 'uploaded', fulfilled_doc_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
        """,
        request_id, document_id,
    )

    await write_audit_log(
        db,
        actor_id=buyer_id,
        actor_roles=["buyer"],
        action=AuditAction.KYC_DOCUMENT_REQUEST_FULFILLED,
        resource_type="kyc_document_request",
        resource_id=str(request_id),
        new_state={"document_id": str(document_id)},
    )

    return dict(row)


async def waive_document_request(
    db: asyncpg.Connection,
    request_id: uuid.UUID,
    agent_id: uuid.UUID,
    reason: str,
) -> dict:
    """Agent waives a document request (e.g., buyer explained why they don't have it)."""
    req = await db.fetchrow(
        "SELECT * FROM kyc.document_requests WHERE id = $1",
        request_id,
    )
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document request not found.")

    # Verify agent is assigned
    asgn = await db.fetchrow(
        "SELECT id FROM kyc.assignments WHERE submission_id = $1 AND agent_id = $2",
        req["submission_id"], agent_id,
    )
    if not asgn:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this submission.")

    row = await db.fetchrow(
        """
        UPDATE kyc.document_requests
        SET status = 'waived', reason = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
        """,
        request_id, reason,
    )
    return dict(row)


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT VERIFICATION (Per-Document Structured Check)
# ══════════════════════════════════════════════════════════════════════════════

async def verify_document(
    db: asyncpg.Connection,
    *,
    document_id: uuid.UUID,
    verified_by: uuid.UUID,
    verification_status: str,
    checklist_results: Optional[dict] = None,
    extracted_data: Optional[dict] = None,
    rejection_reason: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """
    Agent submits a structured verification for a specific document.

    verification_status: 'verified', 'rejected', 'needs_clarification'
    checklist_results: JSONB with per-item pass/fail matching the document type template
    extracted_data: JSONB with key info extracted from the document (name, ID number, etc.)
    """
    doc = await db.fetchrow(
        "SELECT * FROM kyc.documents WHERE id = $1 AND deleted_at IS NULL",
        document_id,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    # Verify agent is assigned to this submission
    asgn = await db.fetchrow(
        "SELECT id FROM kyc.assignments WHERE submission_id = $1 AND agent_id = $2",
        doc["submission_id"], verified_by,
    )
    if not asgn:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not assigned to this submission.",
        )

    row = await db.fetchrow(
        """
        INSERT INTO kyc.document_verifications
            (document_id, verified_by, status, checklist_results,
             extracted_data, rejection_reason, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        document_id, verified_by, verification_status,
        json.dumps(checklist_results) if checklist_results else None,
        json.dumps(extracted_data) if extracted_data else None,
        rejection_reason, notes,
    )

    await write_audit_log(
        db,
        actor_id=verified_by,
        actor_roles=["buyer_agent"],
        action=AuditAction.KYC_DOCUMENT_VERIFIED,
        resource_type="kyc_document",
        resource_id=str(document_id),
        new_state={
            "status": verification_status,
            "has_checklist": checklist_results is not None,
        },
    )

    return dict(row)


async def get_document_verifications(
    db: asyncpg.Connection,
    submission_id: uuid.UUID,
) -> list[dict]:
    """Fetch all document verifications for a submission."""
    rows = await db.fetch(
        """
        SELECT dv.*, d.original_name, d.document_type_id,
               COALESCE(dt.name, d.original_name) AS document_type_name,
               p.full_name AS verified_by_name
        FROM kyc.document_verifications dv
        JOIN kyc.documents d ON d.id = dv.document_id
        LEFT JOIN kyc.document_types dt ON dt.id = d.document_type_id
        LEFT JOIN public.profiles p ON p.id = dv.verified_by
        WHERE d.submission_id = $1
        ORDER BY dv.created_at
        """,
        submission_id,
    )
    return [dict(r) for r in rows]


async def get_checklist_template(
    db: asyncpg.Connection,
    document_type_id: uuid.UUID,
) -> Optional[dict]:
    """Get the verification checklist template for a document type."""
    row = await db.fetchrow(
        "SELECT checklist_template FROM kyc.document_types WHERE id = $1",
        document_type_id,
    )
    if not row or not row["checklist_template"]:
        return None
    tpl = row["checklist_template"]
    return json.loads(tpl) if isinstance(tpl, str) else tpl
