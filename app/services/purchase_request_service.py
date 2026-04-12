"""
Phase 7 — Purchase Request Service Layer.

Business logic for:
  - Buyer: submit, list, view, cancel purchase requests
  - Admin: list, view, assign agent, approve, reject, convert to deal
  - Buyer Agent: list assigned, view, submit structured report, request/waive PR docs
  - Buyer: view/fulfill PR document requests
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid as uuid_module
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

import asyncpg
from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.core.file_validation import validate_magic_bytes
from app.schemas.purchase_requests import (
    AdminPurchaseRequestDetail,
    AdminPurchaseRequestList,
    AgentAssignedList,
    AgentAssignedRequest,
    AgentAssignmentInfo,
    AgentReportInfo,
    PRDocRequestCreate,
    PRDocRequestResponse,
    PurchaseRequestCreate,
    PurchaseRequestListResponse,
    PurchaseRequestResponse,
    ConvertToDealResponse,
)
from app.services import notification_service
from app.services.auth_service import get_supabase_admin_client
from app.services.deal_service import generate_deal_ref

logger = logging.getLogger(__name__)

PR_DOCS_BUCKET = "pr-documents"
PR_DOC_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
PR_DOC_ALLOWED_MIME = {
    "image/jpeg", "image/png", "image/webp", "application/pdf",
}
PR_DOC_MIME_TO_EXT = {
    "image/jpeg": "jpg", "image/png": "png",
    "image/webp": "webp", "application/pdf": "pdf",
}


# ══════════════════════════════════════════════════════════════════════════════
# PRIVATE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

async def _signed_image_url(storage_path: str) -> str | None:
    """Generate a short-lived signed URL for a product image in Supabase Storage."""
    try:
        supabase = await get_supabase_admin_client()
        result = await supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).create_signed_url(
            storage_path, settings.SIGNED_URL_EXPIRY_SECONDS
        )
        return result.get("signedURL") or result.get("signed_url") or None
    except Exception as exc:
        logger.warning("Failed to generate signed URL for %s: %s", storage_path, exc)
        return None

def _pr_to_response(row: asyncpg.Record, product_title: str | None = None) -> PurchaseRequestResponse:
    return PurchaseRequestResponse(
        id=row["id"],
        product_id=row["product_id"],
        product_title=product_title or row.get("product_title"),
        buyer_id=row["buyer_id"],
        purchase_type=row["purchase_type"],
        quantity=row["quantity"],
        offered_price=row["offered_price"],
        offered_currency=row["offered_currency"],
        message=row["message"],
        status=row["status"],
        admin_notes=row.get("admin_notes"),
        converted_deal_id=row.get("converted_deal_id"),
        cancelled_reason=row.get("cancelled_reason"),
        reviewed_at=row.get("reviewed_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _fetch_pr_admin_detail(
    db: asyncpg.Connection,
    request_id: UUID,
) -> AdminPurchaseRequestDetail | None:
    """Load full admin view of a purchase request including assignment and report."""
    row = await db.fetchrow(
        """
        SELECT
            pr.*,
            mp.title               AS product_title,
            mp.asking_price        AS product_asking_price,
            mp.currency            AS product_currency,
            mp.condition           AS product_condition,
            mp.availability_type   AS product_availability_type,
            mp.location_country    AS product_location_country,
            mp.location_port       AS product_location_port,
            sp.company_name        AS seller_company,
            buyer.full_name        AS buyer_name,
            buyer.phone            AS buyer_phone,
            buyer.company_name     AS buyer_company_name,
            buyer.kyc_status       AS buyer_kyc_status,
            buyer.country          AS buyer_country,
            bu.email               AS buyer_email
        FROM marketplace.purchase_requests pr
        LEFT JOIN marketplace.products mp      ON mp.id = pr.product_id
        LEFT JOIN public.profiles sp           ON sp.id = mp.seller_id
        LEFT JOIN public.profiles buyer        ON buyer.id = pr.buyer_id
        LEFT JOIN auth.users bu                ON bu.id = pr.buyer_id
        WHERE pr.id = $1
        """,
        request_id,
    )
    if not row:
        return None

    # Fetch primary product image and generate signed URL
    image_url: str | None = None
    if row.get("product_id"):
        img_row = await db.fetchrow(
            """
            SELECT storage_path FROM marketplace.product_images
            WHERE product_id = $1
            ORDER BY is_primary DESC, display_order ASC
            LIMIT 1
            """,
            row["product_id"],
        )
        if img_row:
            image_url = await _signed_image_url(img_row["storage_path"])

    # Load latest assignment
    asgn_row = await db.fetchrow(
        """
        SELECT ba.*, p.full_name AS agent_name
        FROM marketplace.buyer_agent_assignments ba
        LEFT JOIN public.profiles p ON p.id = ba.agent_id
        WHERE ba.request_id = $1
        ORDER BY ba.created_at DESC
        LIMIT 1
        """,
        request_id,
    )

    # Load agent report (if any)
    report_row = await db.fetchrow(
        """
        SELECT bar.*, p.full_name AS agent_name
        FROM marketplace.buyer_agent_reports bar
        LEFT JOIN public.profiles p ON p.id = bar.agent_id
        WHERE bar.request_id = $1
        ORDER BY bar.created_at DESC
        LIMIT 1
        """,
        request_id,
    )

    assignment = None
    if asgn_row:
        assignment = AgentAssignmentInfo(
            id=asgn_row["id"],
            agent_id=asgn_row["agent_id"],
            agent_name=asgn_row["agent_name"],
            status=asgn_row["status"],
            notes=asgn_row["notes"],
            created_at=asgn_row["created_at"],
        )

    report = None
    if report_row:
        report = AgentReportInfo(
            id=report_row["id"],
            agent_id=report_row["agent_id"],
            agent_name=report_row.get("agent_name"),
            financial_capacity_usd=report_row["financial_capacity_usd"],
            risk_rating=report_row["risk_rating"],
            recommendation=report_row["recommendation"],
            verification_notes=report_row["verification_notes"],
            created_at=report_row["created_at"],
        )

    return AdminPurchaseRequestDetail(
        id=row["id"],
        product_id=row["product_id"],
        product_title=row.get("product_title"),
        product_asking_price=row.get("product_asking_price"),
        product_currency=row.get("product_currency"),
        product_condition=row.get("product_condition"),
        product_availability_type=row.get("product_availability_type"),
        product_location_country=row.get("product_location_country"),
        product_location_port=row.get("product_location_port"),
        product_primary_image_url=image_url,
        seller_company=row.get("seller_company"),
        buyer_id=row["buyer_id"],
        buyer_name=row.get("buyer_name"),
        buyer_email=row.get("buyer_email"),
        buyer_phone=row.get("buyer_phone"),
        buyer_company_name=row.get("buyer_company_name"),
        buyer_kyc_status=row.get("buyer_kyc_status"),
        buyer_country=row.get("buyer_country"),
        purchase_type=row["purchase_type"],
        quantity=row["quantity"],
        offered_price=row.get("offered_price"),
        offered_currency=row["offered_currency"],
        message=row.get("message"),
        status=row["status"],
        admin_notes=row.get("admin_notes"),
        admin_bypass_reason=row.get("admin_bypass_reason"),
        cancelled_reason=row.get("cancelled_reason"),
        converted_deal_id=row.get("converted_deal_id"),
        reviewed_by=row.get("reviewed_by"),
        reviewed_at=row.get("reviewed_at"),
        agent_assignment=assignment,
        agent_report=report,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ══════════════════════════════════════════════════════════════════════════════
# BUYER OPERATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def create_purchase_request(
    db: asyncpg.Connection,
    buyer: dict,
    body: PurchaseRequestCreate,
) -> PurchaseRequestResponse:
    """Submit a new purchase request. KYC gate is enforced by router dependency."""
    buyer_id = buyer["id"]

    # Verify product exists and is live
    product = await db.fetchrow(
        "SELECT id, title, status, seller_id FROM marketplace.products WHERE id = $1",
        body.product_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    if product["status"] not in ("active", "under_offer"):
        raise HTTPException(
            status_code=400,
            detail="This product is not available for purchase requests.",
        )

    # Prevent duplicate active requests
    existing = await db.fetchrow(
        """
        SELECT id FROM marketplace.purchase_requests
        WHERE buyer_id = $1 AND product_id = $2
          AND status NOT IN ('rejected', 'converted', 'cancelled')
        """,
        buyer_id,
        body.product_id,
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="You already have an active purchase request for this product.",
        )

    row = await db.fetchrow(
        """
        INSERT INTO marketplace.purchase_requests
            (product_id, buyer_id, purchase_type, quantity,
             offered_price, offered_currency, message, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted')
        RETURNING *
        """,
        body.product_id,
        buyer_id,
        body.purchase_type,
        body.quantity,
        body.offered_price,
        body.offered_currency,
        body.message,
    )

    await write_audit_log(
        db,
        actor_id=buyer_id,
        actor_roles=buyer.get("roles", []),
        action=AuditAction.PURCHASE_REQUEST_CREATED,
        resource_type="purchase_request",
        resource_id=str(row["id"]),
        new_state={"product_id": str(body.product_id), "purchase_type": body.purchase_type, "status": "submitted"},
    )

    # Notify admin: new purchase request received
    asyncio.create_task(notification_service.notify_admin_new_purchase_request(
        buyer_name=buyer.get("full_name") or buyer.get("email", ""),
        product_title=product["title"],
        request_id=str(row["id"]),
        purchase_type=body.purchase_type,
    ))

    return _pr_to_response(row, product_title=product["title"])


async def list_buyer_requests(
    db: asyncpg.Connection,
    buyer_id: UUID,
    status_filter: str | None = None,
) -> PurchaseRequestListResponse:
    where = "WHERE pr.buyer_id = $1"
    params: list = [buyer_id]
    if status_filter:
        params.append(status_filter)
        where += f" AND pr.status = ${len(params)}"

    rows = await db.fetch(
        f"""
        SELECT pr.*, mp.title AS product_title
        FROM marketplace.purchase_requests pr
        LEFT JOIN marketplace.products mp ON mp.id = pr.product_id
        {where}
        ORDER BY pr.created_at DESC
        """,
        *params,
    )
    items = [_pr_to_response(r) for r in rows]
    return PurchaseRequestListResponse(items=items, total=len(items))


async def get_buyer_request(
    db: asyncpg.Connection,
    buyer_id: UUID,
    request_id: UUID,
) -> PurchaseRequestResponse:
    row = await db.fetchrow(
        """
        SELECT pr.*, mp.title AS product_title
        FROM marketplace.purchase_requests pr
        LEFT JOIN marketplace.products mp ON mp.id = pr.product_id
        WHERE pr.id = $1 AND pr.buyer_id = $2
        """,
        request_id,
        buyer_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Purchase request not found.")

    # Fetch primary product image
    image_url: str | None = None
    img_row = await db.fetchrow(
        """
        SELECT storage_path FROM marketplace.product_images
        WHERE product_id = $1 AND is_primary = TRUE
        LIMIT 1
        """,
        row["product_id"],
    )
    if img_row and img_row["storage_path"]:
        image_url = await _signed_image_url(img_row["storage_path"])

    resp = _pr_to_response(row)
    resp.product_primary_image_url = image_url
    return resp


async def cancel_purchase_request(
    db: asyncpg.Connection,
    buyer: dict,
    request_id: UUID,
    reason: str | None = None,
) -> PurchaseRequestResponse:
    row = await db.fetchrow(
        "SELECT * FROM marketplace.purchase_requests WHERE id = $1 AND buyer_id = $2",
        request_id,
        buyer["id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Purchase request not found.")
    if row["status"] != "submitted":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel a request in '{row['status']}' status. Only 'submitted' requests can be cancelled.",
        )

    updated = await db.fetchrow(
        """
        UPDATE marketplace.purchase_requests
        SET status = 'cancelled', cancelled_reason = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
        """,
        request_id,
        reason,
    )

    await write_audit_log(
        db,
        actor_id=buyer["id"],
        actor_roles=buyer.get("roles", []),
        action=AuditAction.PURCHASE_CANCELLED,
        resource_type="purchase_request",
        resource_id=str(request_id),
        old_state={"status": "submitted"},
        new_state={"status": "cancelled", "reason": reason},
    )

    return _pr_to_response(updated)


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN OPERATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def admin_list_requests(
    db: asyncpg.Connection,
    status_filter: str | None = None,
    buyer_id_filter: UUID | None = None,
    product_id_filter: UUID | None = None,
) -> AdminPurchaseRequestList:
    conditions = []
    params: list = []

    if status_filter:
        params.append(status_filter)
        conditions.append(f"pr.status = ${len(params)}")
    if buyer_id_filter:
        params.append(buyer_id_filter)
        conditions.append(f"pr.buyer_id = ${len(params)}")
    if product_id_filter:
        params.append(product_id_filter)
        conditions.append(f"pr.product_id = ${len(params)}")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    rows = await db.fetch(
        f"""
        SELECT
            pr.*,
            mp.title               AS product_title,
            mp.asking_price        AS product_asking_price,
            mp.currency            AS product_currency,
            mp.condition           AS product_condition,
            mp.availability_type   AS product_availability_type,
            mp.location_country    AS product_location_country,
            mp.location_port       AS product_location_port,
            sp.company_name        AS seller_company,
            buyer.full_name        AS buyer_name,
            buyer.phone            AS buyer_phone,
            buyer.company_name     AS buyer_company_name,
            buyer.kyc_status       AS buyer_kyc_status,
            buyer.country          AS buyer_country,
            bu.email               AS buyer_email
        FROM marketplace.purchase_requests pr
        LEFT JOIN marketplace.products mp      ON mp.id = pr.product_id
        LEFT JOIN public.profiles sp           ON sp.id = mp.seller_id
        LEFT JOIN public.profiles buyer        ON buyer.id = pr.buyer_id
        LEFT JOIN auth.users bu                ON bu.id = pr.buyer_id
        {where}
        ORDER BY pr.created_at DESC
        """,
        *params,
    )

    # Batch: load primary image storage_path for each product to avoid N+1
    product_ids = list({row["product_id"] for row in rows if row.get("product_id")})
    img_map: dict = {}
    if product_ids:
        img_rows = await db.fetch(
            """
            SELECT DISTINCT ON (product_id)
                product_id, storage_path
            FROM marketplace.product_images
            WHERE product_id = ANY($1)
            ORDER BY product_id, is_primary DESC, display_order ASC
            """,
            product_ids,
        )
        for img_row in img_rows:
            signed = await _signed_image_url(img_row["storage_path"])
            if signed:
                img_map[img_row["product_id"]] = signed

    # Batch: load latest assignment per request to avoid N+1
    request_ids = [row["id"] for row in rows]
    asgn_rows = await db.fetch(
        """
        SELECT DISTINCT ON (ba.request_id)
            ba.*, p.full_name AS agent_name
        FROM marketplace.buyer_agent_assignments ba
        LEFT JOIN public.profiles p ON p.id = ba.agent_id
        WHERE ba.request_id = ANY($1)
        ORDER BY ba.request_id, ba.created_at DESC
        """,
        request_ids,
    ) if request_ids else []
    asgn_map = {r["request_id"]: r for r in asgn_rows}

    items = []
    for row in rows:
        asgn_row = asgn_map.get(row["id"])
        assignment = None
        if asgn_row:
            assignment = AgentAssignmentInfo(
                id=asgn_row["id"],
                agent_id=asgn_row["agent_id"],
                agent_name=asgn_row["agent_name"],
                status=asgn_row["status"],
                notes=asgn_row["notes"],
                created_at=asgn_row["created_at"],
            )
        items.append(AdminPurchaseRequestDetail(
            id=row["id"],
            product_id=row["product_id"],
            product_title=row.get("product_title"),
            product_asking_price=row.get("product_asking_price"),
            product_currency=row.get("product_currency"),
            product_condition=row.get("product_condition"),
            product_availability_type=row.get("product_availability_type"),
            product_location_country=row.get("product_location_country"),
            product_location_port=row.get("product_location_port"),
            product_primary_image_url=img_map.get(row["product_id"]),
            seller_company=row.get("seller_company"),
            buyer_id=row["buyer_id"],
            buyer_name=row.get("buyer_name"),
            buyer_email=row.get("buyer_email"),
            buyer_phone=row.get("buyer_phone"),
            buyer_company_name=row.get("buyer_company_name"),
            buyer_kyc_status=row.get("buyer_kyc_status"),
            buyer_country=row.get("buyer_country"),
            purchase_type=row["purchase_type"],
            quantity=row["quantity"],
            offered_price=row.get("offered_price"),
            offered_currency=row["offered_currency"],
            message=row.get("message"),
            status=row["status"],
            admin_notes=row.get("admin_notes"),
            admin_bypass_reason=row.get("admin_bypass_reason"),
            cancelled_reason=row.get("cancelled_reason"),
            converted_deal_id=row.get("converted_deal_id"),
            reviewed_by=row.get("reviewed_by"),
            reviewed_at=row.get("reviewed_at"),
            agent_assignment=assignment,
            agent_report=None,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        ))

    return AdminPurchaseRequestList(items=items, total=len(items))


async def admin_get_request(
    db: asyncpg.Connection,
    request_id: UUID,
) -> AdminPurchaseRequestDetail:
    detail = await _fetch_pr_admin_detail(db, request_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Purchase request not found.")
    return detail


async def assign_agent(
    db: asyncpg.Connection,
    admin: dict,
    request_id: UUID,
    agent_id: UUID,
    notes: str | None,
) -> AdminPurchaseRequestDetail:
    # Verify request exists and is in assignable state
    pr = await db.fetchrow(
        "SELECT * FROM marketplace.purchase_requests WHERE id = $1", request_id
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase request not found.")
    if pr["status"] not in ("submitted", "agent_assigned"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot assign agent to a request in '{pr['status']}' status.",
        )

    # Verify agent exists and has buyer_agent role
    agent = await db.fetchrow(
        "SELECT id, full_name, roles FROM public.profiles WHERE id = $1", agent_id
    )
    if not agent or "buyer_agent" not in (agent["roles"] or []):
        raise HTTPException(status_code=400, detail="User is not a buyer agent.")

    # Close previous assignment if any
    await db.execute(
        """
        UPDATE marketplace.buyer_agent_assignments
        SET status = 'assigned', updated_at = NOW()
        WHERE request_id = $1 AND status != 'report_submitted'
        """,
        request_id,
    )

    # Create new assignment
    await db.execute(
        """
        INSERT INTO marketplace.buyer_agent_assignments
            (request_id, agent_id, assigned_by, status, notes)
        VALUES ($1, $2, $3, 'assigned', $4)
        ON CONFLICT DO NOTHING
        """,
        request_id,
        agent_id,
        admin["id"],
        notes,
    )

    # Advance request status
    await db.execute(
        """
        UPDATE marketplace.purchase_requests
        SET status = 'agent_assigned', updated_at = NOW()
        WHERE id = $1
        """,
        request_id,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.PURCHASE_AGENT_ASSIGNED,
        resource_type="purchase_request",
        resource_id=str(request_id),
        new_state={"agent_id": str(agent_id), "status": "agent_assigned"},
    )

    # Notify the agent
    agent_email_row = await db.fetchrow(
        "SELECT email FROM auth.users WHERE id = $1", agent_id
    )
    if agent_email_row:
        asyncio.create_task(notification_service.notify_agent_assigned_request(
            agent_email=agent_email_row["email"],
            agent_name=agent["full_name"] or "",
            request_id=str(request_id),
        ))

    return await _fetch_pr_admin_detail(db, request_id)


async def approve_request(
    db: asyncpg.Connection,
    admin: dict,
    request_id: UUID,
    admin_notes: str | None,
    admin_bypass_reason: str | None,
) -> AdminPurchaseRequestDetail:
    pr = await db.fetchrow(
        "SELECT * FROM marketplace.purchase_requests WHERE id = $1", request_id
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase request not found.")
    if pr["status"] not in ("submitted", "agent_assigned", "docs_requested", "under_review"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve a request in '{pr['status']}' status.",
        )

    await db.execute(
        """
        UPDATE marketplace.purchase_requests
        SET status = 'approved',
            admin_notes = $2,
            admin_bypass_reason = $3,
            reviewed_by = $4,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        """,
        request_id,
        admin_notes,
        admin_bypass_reason,
        admin["id"],
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.PURCHASE_STATUS_UPDATED,
        resource_type="purchase_request",
        resource_id=str(request_id),
        old_state={"status": pr["status"]},
        new_state={"status": "approved", "admin_notes": admin_notes},
    )

    # Notify buyer: request approved
    buyer_row = await db.fetchrow(
        """
        SELECT u.email, p.full_name, p.phone
        FROM auth.users u
        JOIN public.profiles p ON p.id = u.id
        WHERE u.id = $1
        """,
        pr["buyer_id"],
    )
    if buyer_row:
        asyncio.create_task(notification_service.notify_buyer_request_approved(
            buyer_email=buyer_row["email"],
            buyer_name=buyer_row["full_name"] or "",
            buyer_phone=buyer_row.get("phone") or "",
            request_id=str(request_id),
        ))

    return await _fetch_pr_admin_detail(db, request_id)


async def reject_request(
    db: asyncpg.Connection,
    admin: dict,
    request_id: UUID,
    admin_notes: str,
) -> AdminPurchaseRequestDetail:
    pr = await db.fetchrow(
        "SELECT * FROM marketplace.purchase_requests WHERE id = $1", request_id
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase request not found.")
    if pr["status"] in ("converted", "cancelled", "rejected"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject a request in '{pr['status']}' status.",
        )

    await db.execute(
        """
        UPDATE marketplace.purchase_requests
        SET status = 'rejected',
            admin_notes = $2,
            reviewed_by = $3,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        """,
        request_id,
        admin_notes,
        admin["id"],
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.PURCHASE_STATUS_UPDATED,
        resource_type="purchase_request",
        resource_id=str(request_id),
        old_state={"status": pr["status"]},
        new_state={"status": "rejected", "admin_notes": admin_notes},
    )

    # Notify buyer: request rejected
    buyer_row = await db.fetchrow(
        """
        SELECT u.email, p.full_name, p.phone
        FROM auth.users u
        JOIN public.profiles p ON p.id = u.id
        WHERE u.id = $1
        """,
        pr["buyer_id"],
    )
    if buyer_row:
        asyncio.create_task(notification_service.notify_buyer_request_rejected(
            buyer_email=buyer_row["email"],
            buyer_name=buyer_row["full_name"] or "",
            buyer_phone=buyer_row.get("phone") or "",
            request_id=str(request_id),
            reason=admin_notes,
        ))

    return await _fetch_pr_admin_detail(db, request_id)


async def convert_to_deal(
    db: asyncpg.Connection,
    admin: dict,
    request_id: UUID,
    deal_type: str,
    agreed_price: Decimal,
    currency: str,
    admin_notes: str | None,
) -> ConvertToDealResponse:
    pr = await db.fetchrow(
        "SELECT * FROM marketplace.purchase_requests WHERE id = $1", request_id
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase request not found.")
    if pr["status"] != "approved":
        raise HTTPException(
            status_code=400,
            detail=f"Only 'approved' requests can be converted. Current status: '{pr['status']}'.",
        )

    # Buyer KYC must be approved before a deal can be created
    buyer_kyc = await db.fetchval(
        "SELECT kyc_status FROM public.profiles WHERE id = $1", pr["buyer_id"]
    )
    if buyer_kyc != "approved":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Buyer's KYC is '{buyer_kyc}'. KYC must be approved before converting to a deal."
            ),
        )

    # Get seller_id from the product
    product = await db.fetchrow(
        "SELECT seller_id FROM marketplace.products WHERE id = $1", pr["product_id"]
    )
    if not product:
        raise HTTPException(status_code=400, detail="Product not found — cannot create deal.")

    deal_ref = await generate_deal_ref(db)

    deal_row = await db.fetchrow(
        """
        INSERT INTO finance.deals
            (deal_ref, product_id, buyer_id, seller_id, purchase_request_id,
             deal_type, total_price, currency, status, admin_notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)
        RETURNING id, deal_ref, status
        """,
        deal_ref,
        pr["product_id"],
        pr["buyer_id"],
        product["seller_id"],
        request_id,
        deal_type,
        agreed_price,
        currency,
        admin_notes,
        admin["id"],
    )

    # Update the purchase request to 'converted'
    await db.execute(
        """
        UPDATE marketplace.purchase_requests
        SET status = 'converted',
            converted_deal_id = $2,
            reviewed_by = $3,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        """,
        request_id,
        deal_row["id"],
        admin["id"],
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.PURCHASE_STATUS_UPDATED,
        resource_type="purchase_request",
        resource_id=str(request_id),
        old_state={"status": "approved"},
        new_state={
            "status": "converted",
            "deal_id": str(deal_row["id"]),
            "deal_ref": deal_ref,
        },
    )

    # Notify buyer: request converted to deal
    buyer_row = await db.fetchrow(
        """
        SELECT u.email, p.full_name, p.phone
        FROM auth.users u
        JOIN public.profiles p ON p.id = u.id
        WHERE u.id = $1
        """,
        pr["buyer_id"],
    )
    if buyer_row:
        asyncio.create_task(notification_service.notify_buyer_request_converted(
            buyer_email=buyer_row["email"],
            buyer_name=buyer_row["full_name"] or "",
            buyer_phone=buyer_row.get("phone") or "",
            deal_ref=deal_ref,
        ))

    return ConvertToDealResponse(
        deal_id=deal_row["id"],
        deal_ref=deal_row["deal_ref"],
        deal_status=deal_row["status"],
        request_id=request_id,
        message=f"Purchase request converted to DRAFT deal {deal_ref}. Configure terms in the Deals module.",
    )


# ══════════════════════════════════════════════════════════════════════════════
# BUYER AGENT OPERATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def agent_list_assigned(
    db: asyncpg.Connection,
    agent_id: UUID,
) -> AgentAssignedList:
    rows = await db.fetch(
        """
        SELECT
            pr.*,
            mp.title        AS product_title,
            buyer.full_name AS buyer_name,
            ba.status       AS assignment_status,
            ba.notes        AS assignment_notes,
            EXISTS (
                SELECT 1 FROM marketplace.buyer_agent_reports bar
                WHERE bar.request_id = pr.id AND bar.agent_id = $1
            ) AS report_submitted
        FROM marketplace.purchase_requests pr
        JOIN marketplace.buyer_agent_assignments ba ON ba.request_id = pr.id AND ba.agent_id = $1
        LEFT JOIN marketplace.products mp   ON mp.id = pr.product_id
        LEFT JOIN public.profiles buyer     ON buyer.id = pr.buyer_id
        ORDER BY ba.created_at DESC
        """,
        agent_id,
    )
    items = [
        AgentAssignedRequest(
            id=r["id"],
            product_id=r["product_id"],
            product_title=r.get("product_title"),
            buyer_id=r["buyer_id"],
            buyer_name=r.get("buyer_name"),
            purchase_type=r["purchase_type"],
            quantity=r["quantity"],
            offered_price=r.get("offered_price"),
            offered_currency=r["offered_currency"],
            message=r.get("message"),
            status=r["status"],
            assignment_status=r.get("assignment_status"),
            assignment_notes=r.get("assignment_notes"),
            report_submitted=r["report_submitted"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return AgentAssignedList(items=items, total=len(items))


async def agent_get_request(
    db: asyncpg.Connection,
    agent_id: UUID,
    request_id: UUID,
) -> AgentAssignedRequest:
    row = await db.fetchrow(
        """
        SELECT
            pr.*,
            mp.title        AS product_title,
            buyer.full_name AS buyer_name,
            ba.status       AS assignment_status,
            ba.notes        AS assignment_notes,
            EXISTS (
                SELECT 1 FROM marketplace.buyer_agent_reports bar
                WHERE bar.request_id = pr.id AND bar.agent_id = $1
            ) AS report_submitted
        FROM marketplace.purchase_requests pr
        JOIN marketplace.buyer_agent_assignments ba ON ba.request_id = pr.id AND ba.agent_id = $1
        LEFT JOIN marketplace.products mp   ON mp.id = pr.product_id
        LEFT JOIN public.profiles buyer     ON buyer.id = pr.buyer_id
        WHERE pr.id = $2
        """,
        agent_id,
        request_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Purchase request not found or not assigned to you.")
    return AgentAssignedRequest(
        id=row["id"],
        product_id=row["product_id"],
        product_title=row.get("product_title"),
        buyer_id=row["buyer_id"],
        buyer_name=row.get("buyer_name"),
        purchase_type=row["purchase_type"],
        quantity=row["quantity"],
        offered_price=row.get("offered_price"),
        offered_currency=row["offered_currency"],
        message=row.get("message"),
        status=row["status"],
        assignment_status=row.get("assignment_status"),
        assignment_notes=row.get("assignment_notes"),
        report_submitted=row["report_submitted"],
        created_at=row["created_at"],
    )


async def agent_submit_report(
    db: asyncpg.Connection,
    agent: dict,
    request_id: UUID,
    financial_capacity_usd: Decimal,
    risk_rating: str,
    recommendation: str,
    verification_notes: str,
) -> AgentReportInfo:
    agent_id = agent["id"]

    # Verify the agent is assigned to this request
    asgn = await db.fetchrow(
        """
        SELECT id, status FROM marketplace.buyer_agent_assignments
        WHERE request_id = $1 AND agent_id = $2
        """,
        request_id,
        agent_id,
    )
    if not asgn:
        raise HTTPException(status_code=404, detail="No assignment found for this request.")
    if asgn["status"] == "report_submitted":
        raise HTTPException(status_code=409, detail="You have already submitted a report for this request.")

    # Verify request is in a reviewable state
    pr = await db.fetchrow(
        "SELECT status FROM marketplace.purchase_requests WHERE id = $1", request_id
    )
    if not pr or pr["status"] not in ("agent_assigned", "docs_requested", "under_review"):
        raise HTTPException(
            status_code=400,
            detail="This request is not in a reviewable state.",
        )

    # Insert the report
    report_row = await db.fetchrow(
        """
        INSERT INTO marketplace.buyer_agent_reports
            (request_id, agent_id, financial_capacity_usd, risk_rating, recommendation, verification_notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        """,
        request_id,
        agent_id,
        financial_capacity_usd,
        risk_rating,
        recommendation,
        verification_notes,
    )

    # Advance assignment to report_submitted; advance request to under_review
    await db.execute(
        """
        UPDATE marketplace.buyer_agent_assignments
        SET status = 'report_submitted', updated_at = NOW()
        WHERE request_id = $1 AND agent_id = $2
        """,
        request_id,
        agent_id,
    )
    await db.execute(
        """
        UPDATE marketplace.purchase_requests
        SET status = 'under_review', updated_at = NOW()
        WHERE id = $1 AND status = 'agent_assigned'
        """,
        request_id,
    )

    await write_audit_log(
        db,
        actor_id=agent_id,
        actor_roles=agent.get("roles", []),
        action=AuditAction.PURCHASE_STATUS_UPDATED,
        resource_type="purchase_request",
        resource_id=str(request_id),
        new_state={
            "assignment_status": "report_submitted",
            "request_status": "under_review",
            "recommendation": recommendation,
        },
    )

    return AgentReportInfo(
        id=report_row["id"],
        agent_id=report_row["agent_id"],
        agent_name=agent.get("full_name"),
        financial_capacity_usd=report_row["financial_capacity_usd"],
        risk_rating=report_row["risk_rating"],
        recommendation=report_row["recommendation"],
        verification_notes=report_row["verification_notes"],
        created_at=report_row["created_at"],
    )


# ══════════════════════════════════════════════════════════════════════════════
# PR DOCUMENT REQUESTS
# ══════════════════════════════════════════════════════════════════════════════

async def _pr_doc_signed_url(storage_path: str) -> str | None:
    try:
        supabase = await get_supabase_admin_client()
        result = await supabase.storage.from_(PR_DOCS_BUCKET).create_signed_url(
            storage_path, settings.SIGNED_URL_EXPIRY_SECONDS
        )
        return result.get("signedURL") or result.get("signed_url") or None
    except Exception as exc:
        logger.warning("PR doc signed URL failed for %s: %s", storage_path, exc)
        return None


async def _enrich_pr_doc_request(db: asyncpg.Connection, row: asyncpg.Record) -> PRDocRequestResponse:
    signed_url = None
    if row.get("storage_path"):
        signed_url = await _pr_doc_signed_url(row["storage_path"])
    agent_name = await db.fetchval(
        "SELECT full_name FROM public.profiles WHERE id = $1", row["agent_id"]
    )
    return PRDocRequestResponse(
        id=row["id"],
        request_id=row["request_id"],
        agent_id=row["agent_id"],
        agent_name=agent_name,
        document_name=row["document_name"],
        reason=row.get("reason"),
        priority=row["priority"],
        status=row["status"],
        waive_reason=row.get("waive_reason"),
        file_name=row.get("file_name"),
        signed_url=signed_url,
        fulfilled_at=row.get("fulfilled_at"),
        waived_at=row.get("waived_at"),
        created_at=row["created_at"],
    )


async def agent_request_pr_documents(
    db: asyncpg.Connection,
    agent_id: UUID,
    request_id: UUID,
    items: list[PRDocRequestCreate],
) -> list[PRDocRequestResponse]:
    """Agent requests one or more custom documents from the buyer for a PR."""
    asgn = await db.fetchrow(
        "SELECT id FROM marketplace.buyer_agent_assignments WHERE request_id = $1 AND agent_id = $2",
        request_id, agent_id,
    )
    if not asgn:
        raise HTTPException(status_code=403, detail="You are not assigned to this purchase request.")

    pr = await db.fetchrow(
        "SELECT status FROM marketplace.purchase_requests WHERE id = $1", request_id
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase request not found.")
    if pr["status"] in ("approved", "rejected", "converted", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot request documents on a closed request.")

    rows = []
    async with db.transaction():
        for item in items:
            row = await db.fetchrow(
                """
                INSERT INTO marketplace.pr_document_requests
                    (request_id, agent_id, document_name, reason, priority)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
                """,
                request_id, agent_id,
                item.document_name.strip(), item.reason, item.priority,
            )
            rows.append(row)

        # Advance PR status to docs_requested if still at agent_assigned
        await db.execute(
            """
            UPDATE marketplace.purchase_requests
            SET status = 'docs_requested', updated_at = NOW()
            WHERE id = $1 AND status IN ('agent_assigned', 'docs_requested')
            """,
            request_id,
        )

    # Notify buyer
    buyer_row = await db.fetchrow(
        """
        SELECT u.email, p.full_name, p.phone
        FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE u.id = (SELECT buyer_id FROM marketplace.purchase_requests WHERE id = $1)
        """,
        request_id,
    )
    if buyer_row:
        doc_names = [item.document_name for item in items]
        asyncio.create_task(notification_service.notify_buyer_pr_documents_requested(
            buyer_email=buyer_row["email"],
            buyer_name=buyer_row["full_name"] or "",
            request_id=str(request_id),
            document_names=doc_names,
        ))

    return [await _enrich_pr_doc_request(db, r) for r in rows]


async def agent_list_pr_doc_requests(
    db: asyncpg.Connection,
    agent_id: UUID,
    request_id: UUID,
) -> list[PRDocRequestResponse]:
    asgn = await db.fetchrow(
        "SELECT id FROM marketplace.buyer_agent_assignments WHERE request_id = $1 AND agent_id = $2",
        request_id, agent_id,
    )
    if not asgn:
        raise HTTPException(status_code=403, detail="You are not assigned to this purchase request.")

    rows = await db.fetch(
        "SELECT * FROM marketplace.pr_document_requests WHERE request_id = $1 ORDER BY created_at",
        request_id,
    )
    return [await _enrich_pr_doc_request(db, r) for r in rows]


async def agent_waive_pr_doc_request(
    db: asyncpg.Connection,
    agent_id: UUID,
    doc_req_id: UUID,
    reason: str,
) -> PRDocRequestResponse:
    row = await db.fetchrow(
        "SELECT * FROM marketplace.pr_document_requests WHERE id = $1", doc_req_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document request not found.")

    asgn = await db.fetchrow(
        "SELECT id FROM marketplace.buyer_agent_assignments WHERE request_id = $1 AND agent_id = $2",
        row["request_id"], agent_id,
    )
    if not asgn:
        raise HTTPException(status_code=403, detail="You are not assigned to this purchase request.")

    if row["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot waive a request in '{row['status']}' status.")

    updated = await db.fetchrow(
        """
        UPDATE marketplace.pr_document_requests
        SET status = 'waived', waive_reason = $2, waived_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *
        """,
        doc_req_id, reason,
    )
    return await _enrich_pr_doc_request(db, updated)


async def agent_download_pr_doc(
    db: asyncpg.Connection,
    agent_id: UUID,
    doc_req_id: UUID,
):
    """Stream a fulfilled PR document to the agent, bypassing browser CORS restrictions."""
    from fastapi.responses import StreamingResponse
    import io

    row = await db.fetchrow(
        "SELECT * FROM marketplace.pr_document_requests WHERE id = $1", doc_req_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document request not found.")

    # Verify agent is assigned to the owning purchase request
    asgn = await db.fetchrow(
        "SELECT id FROM marketplace.buyer_agent_assignments WHERE request_id = $1 AND agent_id = $2",
        row["request_id"], agent_id,
    )
    if not asgn:
        raise HTTPException(status_code=403, detail="You are not assigned to this purchase request.")

    if row["status"] != "uploaded" or not row.get("storage_path"):
        raise HTTPException(status_code=404, detail="No uploaded file for this document request.")

    try:
        supabase = await get_supabase_admin_client()
        data = await supabase.storage.from_(PR_DOCS_BUCKET).download(row["storage_path"])
    except Exception as exc:
        logger.warning("Failed to download PR doc %s: %s", doc_req_id, exc)
        raise HTTPException(status_code=502, detail="Could not retrieve file from storage.")

    file_name = row.get("file_name") or "document"
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    MIME_MAP = {
        "pdf": "application/pdf",
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
    }
    content_type = MIME_MAP.get(ext, "application/octet-stream")

    return StreamingResponse(
        io.BytesIO(data),
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{file_name}"'},
    )


async def buyer_list_pr_doc_requests(
    db: asyncpg.Connection,
    buyer_id: UUID,
    request_id: UUID,
) -> list[PRDocRequestResponse]:
    pr = await db.fetchrow(
        "SELECT buyer_id FROM marketplace.purchase_requests WHERE id = $1", request_id
    )
    if not pr or str(pr["buyer_id"]) != str(buyer_id):
        raise HTTPException(status_code=404, detail="Purchase request not found.")

    rows = await db.fetch(
        "SELECT * FROM marketplace.pr_document_requests WHERE request_id = $1 ORDER BY created_at",
        request_id,
    )
    return [await _enrich_pr_doc_request(db, r) for r in rows]


async def buyer_fulfill_pr_doc_request(
    db: asyncpg.Connection,
    buyer_id: UUID,
    doc_req_id: UUID,
    file: UploadFile,
) -> PRDocRequestResponse:
    """Buyer uploads a file to fulfill a pending PR document request."""
    req_row = await db.fetchrow(
        "SELECT * FROM marketplace.pr_document_requests WHERE id = $1", doc_req_id
    )
    if not req_row:
        raise HTTPException(status_code=404, detail="Document request not found.")

    # Verify buyer owns the parent PR
    pr = await db.fetchrow(
        "SELECT buyer_id FROM marketplace.purchase_requests WHERE id = $1", req_row["request_id"]
    )
    if not pr or str(pr["buyer_id"]) != str(buyer_id):
        raise HTTPException(status_code=403, detail="Not your purchase request.")

    if req_row["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"This request is already '{req_row['status']}'.")

    # Validate file
    file_bytes = await file.read()
    if len(file_bytes) > PR_DOC_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 10 MB.")

    mime_type = file.content_type or ""
    if mime_type not in PR_DOC_ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Unsupported file type. Upload JPEG, PNG, WebP, or PDF.")

    if not validate_magic_bytes(file_bytes, mime_type):
        raise HTTPException(status_code=415, detail="File content does not match the declared type.")

    # Upload to Supabase Storage
    doc_id = uuid_module.uuid4()
    ext = PR_DOC_MIME_TO_EXT[mime_type]
    storage_path = f"{buyer_id}/{req_row['request_id']}/{doc_id}.{ext}"

    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(PR_DOCS_BUCKET).upload(
            storage_path, file_bytes, {"content_type": mime_type},
        )
    except Exception as exc:
        logger.error("PR doc upload failed: %s", exc)
        raise HTTPException(status_code=502, detail="Upload failed. Please try again.")

    updated = await db.fetchrow(
        """
        UPDATE marketplace.pr_document_requests
        SET status = 'uploaded',
            storage_path = $2,
            file_name    = $3,
            fulfilled_at = NOW(),
            updated_at   = NOW()
        WHERE id = $1 RETURNING *
        """,
        doc_req_id, storage_path, file.filename,
    )
    return await _enrich_pr_doc_request(db, updated)
