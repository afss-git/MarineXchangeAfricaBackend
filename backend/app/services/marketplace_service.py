"""
Marketplace service — product listing business logic.

Responsibilities:
  - Product CRUD (draft creation, update, submit, resubmit)
  - Image upload/delete via Supabase Storage (signed URLs)
  - Dynamic attribute value management
  - Verification workflow (agent assignment, status progression, report submission)
  - Admin approval / rejection / corrections workflow
  - Public catalog queries

All status transitions are validated by the DB trigger.
This layer enforces business rules that sit above the DB constraint layer.
"""
from __future__ import annotations

import logging
import math
import mimetypes
import os
import uuid
from decimal import Decimal
from typing import Any

import asyncpg
from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.schemas.marketplace import (
    AdminProductDecisionRequest,
    AdminProductUpdateRequest,
    AssignVerificationAgentRequest,
    AttributeValueInput,
    CreateAttributeRequest,
    ProductContactInput,
    ProductCreateRequest,
    ProductSpecUpdateRequest,
    ProductUpdateRequest,
    SubmitVerificationReportRequest,
    UpdateVerificationAssignmentRequest,
)
from app.services.auth_service import get_supabase_admin_client

logger = logging.getLogger(__name__)

STORAGE_BUCKET = settings.SUPABASE_STORAGE_BUCKET


# ══════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _require_product_exists(product: asyncpg.Record | None, product_id: Any) -> None:
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Product {product_id} not found.",
        )


def _require_seller_owns(product: asyncpg.Record, seller_id: Any) -> None:
    if str(product["seller_id"]) != str(seller_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this listing.",
        )


async def _generate_signed_url(storage_path: str) -> str:
    """Generates a short-lived signed URL for an image in Supabase Storage."""
    try:
        supabase = await get_supabase_admin_client()
        result = await supabase.storage.from_(STORAGE_BUCKET).create_signed_url(
            storage_path, settings.SIGNED_URL_EXPIRY_SECONDS
        )
        return result.get("signedURL") or result.get("signed_url") or ""
    except Exception as exc:
        logger.warning("Failed to generate signed URL for %s: %s", storage_path, exc)
        return ""


async def _enrich_images(
    db: asyncpg.Connection, product_id: uuid.UUID
) -> list[dict]:
    """Loads product images and attaches fresh signed URLs."""
    rows = await db.fetch(
        """
        SELECT id, storage_path, original_name, file_size_bytes,
               mime_type, is_primary, display_order, uploaded_at
        FROM marketplace.product_images
        WHERE product_id = $1
        ORDER BY display_order ASC, uploaded_at ASC
        """,
        product_id,
    )
    images = []
    for row in rows:
        signed_url = await _generate_signed_url(row["storage_path"])
        images.append({**dict(row), "signed_url": signed_url})
    return images


async def _enrich_attribute_values(
    db: asyncpg.Connection, product_id: uuid.UUID
) -> list[dict]:
    """Loads attribute values for a product with attribute metadata joined in."""
    rows = await db.fetch(
        """
        SELECT
            pav.attribute_id,
            a.name   AS attribute_name,
            a.slug   AS attribute_slug,
            a.data_type,
            a.unit,
            pav.value_text,
            pav.value_numeric,
            pav.value_boolean,
            pav.value_date,
            p.full_name AS set_by_name,
            pav.updated_at
        FROM marketplace.product_attribute_values pav
        JOIN marketplace.attributes a ON a.id = pav.attribute_id
        LEFT JOIN public.profiles p   ON p.id = pav.last_updated_by
        WHERE pav.product_id = $1
        ORDER BY a.display_order ASC, a.name ASC
        """,
        product_id,
    )
    return [dict(r) for r in rows]


async def _upsert_attribute_values(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    values: list[AttributeValueInput],
    actor_id: uuid.UUID,
) -> None:
    """Upserts a list of attribute values for a product."""
    for av in values:
        # Verify attribute exists
        attr = await db.fetchrow(
            "SELECT id, data_type FROM marketplace.attributes WHERE id = $1 AND is_active = TRUE",
            av.attribute_id,
        )
        if not attr:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Attribute {av.attribute_id} not found or is inactive.",
            )

        await db.execute(
            """
            INSERT INTO marketplace.product_attribute_values
                (product_id, attribute_id, value_text, value_numeric,
                 value_boolean, value_date, set_by, last_updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
            ON CONFLICT (product_id, attribute_id) DO UPDATE SET
                value_text      = EXCLUDED.value_text,
                value_numeric   = EXCLUDED.value_numeric,
                value_boolean   = EXCLUDED.value_boolean,
                value_date      = EXCLUDED.value_date,
                last_updated_by = EXCLUDED.last_updated_by,
                updated_at      = NOW()
            """,
            product_id,
            av.attribute_id,
            av.value_text,
            float(av.value_numeric) if av.value_numeric is not None else None,
            av.value_boolean,
            av.value_date,
            actor_id,
        )


async def _upsert_product_contact(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    contact: ProductContactInput,
) -> None:
    await db.execute(
        """
        INSERT INTO marketplace.product_contacts
            (product_id, contact_name, phone, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (product_id) DO UPDATE SET
            contact_name = EXCLUDED.contact_name,
            phone        = EXCLUDED.phone,
            email        = EXCLUDED.email,
            updated_at   = NOW()
        """,
        product_id,
        contact.contact_name,
        contact.phone,
        str(contact.email),
    )


async def _record_status_history(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    old_status: str,
    new_status: str,
    changed_by: uuid.UUID,
    reason: str | None = None,
) -> None:
    await db.execute(
        """
        UPDATE marketplace.product_status_history
        SET changed_by = $1, reason = $2
        WHERE product_id = $3
          AND new_status = $4
          AND id = (
              SELECT id FROM marketplace.product_status_history
              WHERE product_id = $3 AND new_status = $4
              ORDER BY created_at DESC LIMIT 1
          )
        """,
        changed_by, reason, product_id, new_status,
    )


async def _get_product_for_seller(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    seller_id: uuid.UUID,
) -> asyncpg.Record:
    product = await db.fetchrow(
        """
        SELECT p.*, c.name AS category_name, pr.company_name AS seller_company
        FROM marketplace.products p
        LEFT JOIN marketplace.categories c ON c.id = p.category_id
        LEFT JOIN public.profiles pr ON pr.id = p.seller_id
        WHERE p.id = $1 AND p.deleted_at IS NULL
        """,
        product_id,
    )
    _require_product_exists(product, product_id)
    _require_seller_owns(product, seller_id)
    return product


# ══════════════════════════════════════════════════════════════════════════════
# CATEGORIES
# ══════════════════════════════════════════════════════════════════════════════

async def get_category_tree(db: asyncpg.Connection) -> list[dict]:
    """Returns all active categories as a nested tree."""
    rows = await db.fetch(
        """
        SELECT id, name, slug, parent_id, description, icon, display_order
        FROM marketplace.categories
        WHERE is_active = TRUE
        ORDER BY display_order ASC, name ASC
        """
    )
    all_cats = [dict(r) for r in rows]

    # Build tree in memory
    by_id: dict[uuid.UUID, dict] = {}
    roots: list[dict] = []
    for cat in all_cats:
        cat["subcategories"] = []
        by_id[cat["id"]] = cat

    for cat in all_cats:
        if cat["parent_id"] is None:
            roots.append(cat)
        elif cat["parent_id"] in by_id:
            by_id[cat["parent_id"]]["subcategories"].append(cat)

    return roots


async def get_category_by_id(
    db: asyncpg.Connection, category_id: uuid.UUID
) -> dict:
    row = await db.fetchrow(
        """
        SELECT id, name, slug, parent_id, description, icon, display_order
        FROM marketplace.categories
        WHERE id = $1 AND is_active = TRUE
        """,
        category_id,
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found.",
        )
    # Attach subcategories
    subs = await db.fetch(
        """
        SELECT id, name, slug, parent_id, description, icon, display_order
        FROM marketplace.categories
        WHERE parent_id = $1 AND is_active = TRUE
        ORDER BY display_order ASC, name ASC
        """,
        category_id,
    )
    result = dict(row)
    result["subcategories"] = [dict(s) for s in subs]
    return result


# ══════════════════════════════════════════════════════════════════════════════
# ATTRIBUTES
# ══════════════════════════════════════════════════════════════════════════════

async def list_attributes(
    db: asyncpg.Connection,
    category_id: uuid.UUID | None = None,
) -> list[dict]:
    """
    Returns active attribute definitions.
    If category_id is given, returns global + category-specific attributes.
    Otherwise returns only global attributes.
    """
    if category_id:
        rows = await db.fetch(
            """
            SELECT id, name, slug, data_type, unit, category_id, display_order
            FROM marketplace.attributes
            WHERE is_active = TRUE
              AND (category_id IS NULL OR category_id = $1)
            ORDER BY display_order ASC, name ASC
            """,
            category_id,
        )
    else:
        rows = await db.fetch(
            """
            SELECT id, name, slug, data_type, unit, category_id, display_order
            FROM marketplace.attributes
            WHERE is_active = TRUE AND category_id IS NULL
            ORDER BY display_order ASC, name ASC
            """
        )
    return [dict(r) for r in rows]


async def create_attribute(
    db: asyncpg.Connection,
    payload: CreateAttributeRequest,
    actor: dict,
) -> dict:
    """Agent or admin creates a new attribute definition."""
    try:
        row = await db.fetchrow(
            """
            INSERT INTO marketplace.attributes
                (name, slug, data_type, unit, category_id, display_order, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, name, slug, data_type, unit, category_id, display_order
            """,
            payload.name,
            payload.slug,
            payload.data_type,
            payload.unit,
            payload.category_id,
            payload.display_order,
            uuid.UUID(str(actor["id"])),
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An attribute with slug '{payload.slug}' already exists "
                   f"for this category scope.",
        )
    return dict(row)


# ══════════════════════════════════════════════════════════════════════════════
# PRODUCT CRUD
# ══════════════════════════════════════════════════════════════════════════════

async def create_product_draft(
    db: asyncpg.Connection,
    payload: ProductCreateRequest,
    actor: dict,
) -> dict:
    """
    Seller creates a new product listing in 'draft' status.
    Returns the created product record.
    """
    seller_id = uuid.UUID(str(actor["id"]))

    # Verify category exists
    cat = await db.fetchrow(
        "SELECT id, name FROM marketplace.categories WHERE id = $1 AND is_active = TRUE",
        payload.category_id,
    )
    if not cat:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category not found or is inactive.",
        )

    async with db.transaction():
        product = await db.fetchrow(
            """
            INSERT INTO marketplace.products
                (seller_id, title, description, category_id, availability_type,
                 condition, asking_price, currency, location_country, location_port,
                 location_details, status)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
            RETURNING *
            """,
            seller_id,
            payload.title,
            payload.description,
            payload.category_id,
            payload.availability_type,
            payload.condition,
            float(payload.asking_price),
            payload.currency,
            payload.location_country,
            payload.location_port,
            payload.location_details,
        )

        product_id = product["id"]

        # Persist seller contact
        await _upsert_product_contact(db, product_id, payload.contact)

        # Persist attribute values
        if payload.attribute_values:
            await _upsert_attribute_values(
                db, product_id, payload.attribute_values, seller_id
            )

    await write_audit_log(
        db,
        actor_id=seller_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.PRODUCT_CREATED,
        resource_type="product",
        resource_id=str(product_id),
        new_state={"title": payload.title, "status": "draft"},
        metadata={"ip": actor.get("_client_ip")},
    )

    return await get_product_detail(db, product_id, actor, include_contact=True)


async def update_product_draft(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    payload: ProductUpdateRequest,
    actor: dict,
) -> dict:
    """Seller updates a listing.

    Allowed when status is:
    - draft
    - pending_reverification
    - pending_verification with no agent assigned yet
    """
    seller_id = uuid.UUID(str(actor["id"]))
    product = await _get_product_for_seller(db, product_id, seller_id)

    if product["status"] not in ("draft", "pending_reverification", "pending_verification"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Only draft, pending_verification (before agent assignment), or "
                f"pending_reverification listings can be edited. "
                f"Current status: {product['status']}"
            ),
        )

    # For pending_verification: block edits once an agent has been assigned
    if product["status"] == "pending_verification":
        assignment = await db.fetchrow(
            """
            SELECT id FROM marketplace.verification_assignments
            WHERE product_id = $1 AND cycle_number = $2
            """,
            product_id,
            product["verification_cycle"] + 1,
        )
        if assignment:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Editing is no longer allowed — a verification agent has been assigned to this listing.",
            )

    # Build SET clause dynamically from non-None fields
    updates: dict[str, Any] = {}
    if payload.title             is not None: updates["title"]             = payload.title
    if payload.category_id       is not None: updates["category_id"]       = payload.category_id
    if payload.description       is not None: updates["description"]       = payload.description
    if payload.availability_type is not None: updates["availability_type"] = payload.availability_type
    if payload.condition         is not None: updates["condition"]         = payload.condition
    if payload.location_country  is not None: updates["location_country"]  = payload.location_country
    if payload.location_port     is not None: updates["location_port"]     = payload.location_port
    if payload.location_details  is not None: updates["location_details"]  = payload.location_details
    if payload.asking_price      is not None: updates["asking_price"]      = float(payload.asking_price)
    if payload.currency          is not None: updates["currency"]          = payload.currency

    if updates:
        set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates.keys()))
        await db.execute(
            f"UPDATE marketplace.products SET {set_clause} WHERE id = $1",
            product_id, *updates.values(),
        )

    async with db.transaction():
        if payload.contact is not None:
            await _upsert_product_contact(db, product_id, payload.contact)
        if payload.attribute_values is not None:
            await _upsert_attribute_values(
                db, product_id, payload.attribute_values, seller_id
            )

    await write_audit_log(
        db,
        actor_id=seller_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.PRODUCT_UPDATED,
        resource_type="product",
        resource_id=str(product_id),
        old_state={"status": product["status"]},
        new_state={"updated_fields": list(updates.keys())},
    )

    return await get_product_detail(db, product_id, actor, include_contact=True)


async def delete_product_draft(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    actor: dict,
) -> None:
    """Seller soft-deletes a draft listing."""
    seller_id = uuid.UUID(str(actor["id"]))
    product = await _get_product_for_seller(db, product_id, seller_id)

    if product["status"] != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft listings can be deleted.",
        )

    await db.execute(
        "UPDATE marketplace.products SET deleted_at = NOW() WHERE id = $1",
        product_id,
    )


async def submit_product_for_verification(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    actor: dict,
) -> dict:
    """
    Seller submits a draft listing for verification.
    Enforces minimum image count.
    Transitions: draft → pending_verification
    """
    seller_id = uuid.UUID(str(actor["id"]))
    product = await _get_product_for_seller(db, product_id, seller_id)

    if product["status"] not in ("draft", "pending_reverification"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Only draft or pending_reverification listings can be submitted. "
                f"Current status: {product['status']}"
            ),
        )

    # Enforce minimum images
    image_count = await db.fetchval(
        "SELECT COUNT(*) FROM marketplace.product_images WHERE product_id = $1",
        product_id,
    )
    if image_count < settings.MIN_PRODUCT_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"A minimum of {settings.MIN_PRODUCT_IMAGES} images is required before submission. "
                f"You have uploaded {image_count}."
            ),
        )

    old_status = product["status"]

    if old_status == "pending_reverification":
        # Seller addressed corrections — increment cycle and resubmit
        await db.execute(
            """UPDATE marketplace.products
               SET status = 'pending_verification',
                   verification_cycle = verification_cycle + 1,
                   corrections_reason = NULL
               WHERE id = $1""",
            product_id,
        )
    else:
        # draft → pending_verification
        await db.execute(
            "UPDATE marketplace.products SET status = 'pending_verification' WHERE id = $1",
            product_id,
        )

    await write_audit_log(
        db,
        actor_id=seller_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.PRODUCT_SUBMITTED,
        resource_type="product",
        resource_id=str(product_id),
        old_state={"status": old_status},
        new_state={"status": "pending_verification"},
        metadata={"ip": actor.get("_client_ip")},
    )

    return {"product_id": product_id, "new_status": "pending_verification",
            "message": "Listing submitted for verification."}


async def resubmit_product(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    actor: dict,
) -> dict:
    """
    Seller resubmits a rejected or verification-failed listing.
    Transitions: rejected → pending_reverification
                 verification_failed → pending_reverification
    """
    seller_id = uuid.UUID(str(actor["id"]))
    product = await _get_product_for_seller(db, product_id, seller_id)

    if product["status"] not in ("rejected", "verification_failed"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Only rejected or verification_failed listings can be resubmitted. "
                f"Current status: {product['status']}"
            ),
        )

    await db.execute(
        """
        UPDATE marketplace.products
        SET status = 'pending_reverification',
            verification_cycle = verification_cycle + 1
        WHERE id = $1
        """,
        product_id,
    )

    await write_audit_log(
        db,
        actor_id=seller_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.PRODUCT_RESUBMITTED,
        resource_type="product",
        resource_id=str(product_id),
        old_state={"status": product["status"]},
        new_state={"status": "pending_reverification"},
        metadata={"ip": actor.get("_client_ip")},
    )

    return {"product_id": product_id, "new_status": "pending_reverification",
            "message": "Listing resubmitted for re-verification."}


# ══════════════════════════════════════════════════════════════════════════════
# PRODUCT QUERIES
# ══════════════════════════════════════════════════════════════════════════════

async def get_product_verification_status(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    seller_id: uuid.UUID,
) -> dict | None:
    """Return verification assignment details visible to the owning seller."""
    row = await db.fetchrow(
        """
        SELECT
            va.id,
            va.status,
            COALESCE(ap.full_name, agu.email) AS agent_name,
            va.created_at AS assigned_at,
            va.scheduled_date,
            va.updated_at,
            EXISTS(
                SELECT 1 FROM marketplace.verification_reports vr
                WHERE vr.assignment_id = va.id
            ) AS report_submitted
        FROM marketplace.products p
        JOIN marketplace.verification_assignments va
               ON va.product_id = p.id AND va.cycle_number = p.verification_cycle + 1
        LEFT JOIN public.profiles ap ON ap.id = va.agent_id
        LEFT JOIN auth.users agu ON agu.id = va.agent_id
        WHERE p.id = $1 AND p.seller_id = $2
        """,
        product_id,
        seller_id,
    )
    if not row:
        return None
    r = dict(row)
    return {
        "id": str(r["id"]),
        "status": r["status"],
        "agent_name": r["agent_name"],
        "assigned_at": r["assigned_at"].isoformat() if r["assigned_at"] else None,
        "scheduled_date": str(r["scheduled_date"]) if r["scheduled_date"] else None,
        "report_submitted": bool(r["report_submitted"]),
        "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
    }


async def get_product_detail(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    actor: dict | None,
    include_contact: bool = False,
) -> dict:
    """
    Fetches full product detail with images, attributes, and category.
    Contact info is included only when include_contact=True (seller/agent/admin views).
    """
    product = await db.fetchrow(
        """
        SELECT p.*,
               c.name   AS category_name,
               pr.company_name AS seller_company,
               su.email        AS seller_email,
               pr.phone        AS seller_phone,
               COALESCE(ap.full_name, agu.email) AS verification_agent,
               va.id AS verification_assignment_id
        FROM marketplace.products p
        LEFT JOIN marketplace.categories c ON c.id = p.category_id
        LEFT JOIN public.profiles pr ON pr.id = p.seller_id
        LEFT JOIN auth.users su ON su.id = p.seller_id
        LEFT JOIN marketplace.verification_assignments va
               ON va.product_id = p.id AND va.cycle_number = p.verification_cycle + 1
        LEFT JOIN public.profiles ap ON ap.id = va.agent_id
        LEFT JOIN auth.users agu ON agu.id = va.agent_id
        WHERE p.id = $1 AND p.deleted_at IS NULL
        """,
        product_id,
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")

    result = dict(product)
    result["images"] = await _enrich_images(db, product_id)
    result["attribute_values"] = await _enrich_attribute_values(db, product_id)

    if include_contact:
        contact_row = await db.fetchrow(
            "SELECT contact_name, phone, email FROM marketplace.product_contacts WHERE product_id = $1",
            product_id,
        )
        result["contact"] = dict(contact_row) if contact_row else None
    else:
        result["contact"] = None

    # Seller-uploaded documents
    doc_rows = await db.fetch(
        """
        SELECT id, storage_path, original_name, file_size_bytes, mime_type, description, uploaded_at
        FROM marketplace.product_documents
        WHERE product_id = $1
        ORDER BY uploaded_at ASC
        """,
        product_id,
    )
    docs_with_urls = []
    for doc in doc_rows:
        signed_url = await _generate_signed_url(doc["storage_path"])
        docs_with_urls.append({
            "id": str(doc["id"]),
            "storage_path": doc["storage_path"],
            "original_name": doc["original_name"],
            "file_size_bytes": doc["file_size_bytes"],
            "mime_type": doc["mime_type"],
            "description": doc["description"],
            "signed_url": signed_url,
            "uploaded_at": doc["uploaded_at"].isoformat() if doc["uploaded_at"] else None,
        })
    result["documents"] = docs_with_urls

    return result


async def list_seller_products(
    db: asyncpg.Connection,
    seller_id: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
    status_filter: str | None = None,
) -> dict:
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    where_clause = "p.seller_id = $1 AND p.deleted_at IS NULL"
    params: list[Any] = [seller_id]
    if status_filter:
        params.append(status_filter)
        where_clause += f" AND p.status = ${len(params)}"

    total = await db.fetchval(
        f"SELECT COUNT(*) FROM marketplace.products p WHERE {where_clause}", *params
    )

    rows = await db.fetch(
        f"""
        SELECT p.id, p.title, p.category_id, c.name AS category_name,
               p.availability_type, p.condition, p.asking_price, p.currency,
               p.location_country, p.location_port, p.status,
               p.created_at, p.seller_id, pr.company_name AS seller_company
        FROM marketplace.products p
        LEFT JOIN marketplace.categories c ON c.id = p.category_id
        LEFT JOIN public.profiles pr ON pr.id = p.seller_id
        WHERE {where_clause}
        ORDER BY p.created_at DESC
        LIMIT ${len(params)+1} OFFSET ${len(params)+2}
        """,
        *params, page_size, offset,
    )

    items = []
    for row in rows:
        item = dict(row)
        # Attach primary image signed URL
        img = await db.fetchrow(
            """
            SELECT storage_path FROM marketplace.product_images
            WHERE product_id = $1 AND is_primary = TRUE
            LIMIT 1
            """,
            row["id"],
        )
        item["primary_image_url"] = (
            await _generate_signed_url(img["storage_path"]) if img else None
        )
        items.append(item)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)),
    }


async def list_public_products(
    db: asyncpg.Connection,
    page: int = 1,
    page_size: int = 20,
    category_id: uuid.UUID | None = None,
    availability_type: str | None = None,
    location_country: str | None = None,
    search: str | None = None,
) -> dict:
    """Returns paginated published products for public browsing."""
    page_size = min(page_size, 50)
    offset = (page - 1) * page_size

    conditions = ["p.status = 'active'", "p.deleted_at IS NULL"]
    params: list[Any] = []

    if category_id:
        params.append(category_id)
        conditions.append(f"p.category_id = ${len(params)}")

    if availability_type:
        params.append(availability_type)
        conditions.append(f"p.availability_type = ${len(params)}")

    if location_country:
        params.append(location_country)
        conditions.append(f"LOWER(p.location_country) = LOWER(${len(params)})")

    if search:
        params.append(f"%{search.lower()}%")
        conditions.append(
            f"(LOWER(p.title) LIKE ${len(params)} OR LOWER(p.description) LIKE ${len(params)})"
        )

    where_clause = " AND ".join(conditions)
    total = await db.fetchval(
        f"SELECT COUNT(*) FROM marketplace.products p WHERE {where_clause}", *params
    )

    rows = await db.fetch(
        f"""
        SELECT p.id, p.title, p.category_id, c.name AS category_name,
               p.availability_type, p.condition, p.asking_price, p.currency,
               p.location_country, p.location_port, p.status,
               p.created_at, p.seller_id, pr.company_name AS seller_company
        FROM marketplace.products p
        LEFT JOIN marketplace.categories c ON c.id = p.category_id
        LEFT JOIN public.profiles pr ON pr.id = p.seller_id
        WHERE {where_clause}
        ORDER BY p.created_at DESC
        LIMIT ${len(params)+1} OFFSET ${len(params)+2}
        """,
        *params, page_size, offset,
    )

    items = []
    for row in rows:
        item = dict(row)
        img = await db.fetchrow(
            """
            SELECT storage_path FROM marketplace.product_images
            WHERE product_id = $1 AND is_primary = TRUE
            LIMIT 1
            """,
            row["id"],
        )
        item["primary_image_url"] = (
            await _generate_signed_url(img["storage_path"]) if img else None
        )
        items.append(item)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)),
    }


async def list_admin_products(
    db: asyncpg.Connection,
    page: int = 1,
    page_size: int = 20,
    status_filter: str | None = None,
    seller_id_filter: uuid.UUID | None = None,
) -> dict:
    """Admin/agent view — all products regardless of status."""
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    conditions = ["p.deleted_at IS NULL"]
    params: list[Any] = []

    if status_filter:
        params.append(status_filter)
        conditions.append(f"p.status = ${len(params)}")

    if seller_id_filter:
        params.append(seller_id_filter)
        conditions.append(f"p.seller_id = ${len(params)}")

    where_clause = " AND ".join(conditions)
    total = await db.fetchval(
        f"SELECT COUNT(*) FROM marketplace.products p WHERE {where_clause}", *params
    )

    rows = await db.fetch(
        f"""
        SELECT p.id, p.title, p.category_id, c.name AS category_name,
               p.availability_type, p.condition, p.asking_price, p.currency,
               p.location_country, p.location_port, p.status,
               p.created_at, p.seller_id, pr.company_name AS seller_company,
               COALESCE(ap.full_name, agu.email) AS verification_agent
        FROM marketplace.products p
        LEFT JOIN marketplace.categories c ON c.id = p.category_id
        LEFT JOIN public.profiles pr ON pr.id = p.seller_id
        LEFT JOIN marketplace.verification_assignments va
               ON va.product_id = p.id AND va.cycle_number = p.verification_cycle + 1
        LEFT JOIN public.profiles ap ON ap.id = va.agent_id
        LEFT JOIN auth.users agu ON agu.id = va.agent_id
        WHERE {where_clause}
        ORDER BY p.created_at DESC
        LIMIT ${len(params)+1} OFFSET ${len(params)+2}
        """,
        *params, page_size, offset,
    )

    items = []
    for row in rows:
        item = dict(row)
        img = await db.fetchrow(
            """
            SELECT storage_path FROM marketplace.product_images
            WHERE product_id = $1 AND is_primary = TRUE
            LIMIT 1
            """,
            row["id"],
        )
        item["primary_image_url"] = (
            await _generate_signed_url(img["storage_path"]) if img else None
        )
        items.append(item)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)),
    }


# ══════════════════════════════════════════════════════════════════════════════
# IMAGE MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

ALLOWED_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
MIME_TO_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

ALLOWED_EVIDENCE_MIME_TYPES = frozenset({
    "image/jpeg", "image/png", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
})
EVIDENCE_MIME_TO_EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}
EVIDENCE_MAX_SIZE_MB = 20


async def upload_product_image(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    file: UploadFile,
    actor: dict,
) -> dict:
    """
    Validates and uploads a product image to Supabase Storage.
    Returns the image record with signed URL.
    """
    seller_id = uuid.UUID(str(actor["id"]))

    # Validate product ownership (agents/admins bypass seller check in their own flows)
    roles = actor.get("roles", [])
    if "seller" in roles and "admin" not in roles and "verification_agent" not in roles:
        product = await _get_product_for_seller(db, product_id, seller_id)
        if product["status"] not in ("draft", "pending_reverification"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Images can only be uploaded to draft or pending_reverification listings.",
            )

    # Count existing images
    current_count = await db.fetchval(
        "SELECT COUNT(*) FROM marketplace.product_images WHERE product_id = $1",
        product_id,
    )
    if current_count >= settings.MAX_PRODUCT_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum of {settings.MAX_PRODUCT_IMAGES} images per listing.",
        )

    # Validate MIME type
    mime_type = file.content_type or ""
    # Try to guess from filename if content_type is missing
    if mime_type not in ALLOWED_MIME_TYPES and file.filename:
        guessed, _ = mimetypes.guess_type(file.filename)
        mime_type = guessed or mime_type

    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{mime_type}'. Allowed: JPEG, PNG, WebP.",
        )

    # Read and validate size
    file_bytes = await file.read()
    max_bytes = settings.MAX_IMAGE_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image exceeds maximum size of {settings.MAX_IMAGE_SIZE_MB} MB.",
        )

    from app.core.file_validation import validate_magic_bytes
    if not validate_magic_bytes(file_bytes, mime_type):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File content does not match the declared image type.",
        )

    # Generate unique storage path
    image_id = uuid.uuid4()
    ext = MIME_TO_EXT[mime_type]
    storage_path = f"products/{product_id}/{image_id}.{ext}"

    # Upload to Supabase Storage
    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path,
            file_bytes,
            {"content-type": mime_type},
        )
    except Exception as exc:
        logger.error("Storage upload failed for %s: %s", storage_path, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image upload failed. Please try again.",
        )

    # Determine if this should be the primary image
    is_primary = current_count == 0

    # Record in DB
    row = await db.fetchrow(
        """
        INSERT INTO marketplace.product_images
            (id, product_id, storage_path, original_name, file_size_bytes,
             mime_type, is_primary, display_order, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        """,
        image_id,
        product_id,
        storage_path,
        file.filename,
        len(file_bytes),
        mime_type,
        is_primary,
        int(current_count),
        uuid.UUID(str(actor["id"])),
    )

    signed_url = await _generate_signed_url(storage_path)
    return {**dict(row), "signed_url": signed_url}


async def delete_product_image(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    image_id: uuid.UUID,
    actor: dict,
) -> None:
    """Deletes an image from the listing and from Supabase Storage."""
    seller_id = uuid.UUID(str(actor["id"]))
    roles = actor.get("roles", [])

    # Check ownership and status unless admin
    if "admin" not in roles:
        product = await _get_product_for_seller(db, product_id, seller_id)
        locked_statuses = {
            "pending_verification", "under_verification",
            "pending_approval", "approved", "active",
        }
        if product["status"] in locked_statuses:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Images cannot be deleted once a listing is submitted for verification. "
                    f"Current status: {product['status']}"
                ),
            )

    image = await db.fetchrow(
        "SELECT id, storage_path, is_primary FROM marketplace.product_images WHERE id = $1 AND product_id = $2",
        image_id, product_id,
    )
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")

    # Delete from Supabase Storage
    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(STORAGE_BUCKET).remove([image["storage_path"]])
    except Exception as exc:
        logger.warning("Storage delete failed for %s: %s", image["storage_path"], exc)

    await db.execute(
        "DELETE FROM marketplace.product_images WHERE id = $1", image_id
    )

    # If deleted image was primary, promote the first remaining image
    if image["is_primary"]:
        await db.execute(
            """
            UPDATE marketplace.product_images
            SET is_primary = TRUE
            WHERE product_id = $1
              AND id = (
                  SELECT id FROM marketplace.product_images
                  WHERE product_id = $1
                  ORDER BY display_order ASC, uploaded_at ASC
                  LIMIT 1
              )
            """,
            product_id,
        )


ALLOWED_DOC_MIME_TYPES = frozenset({
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg", "image/png", "image/webp",
})
DOC_MIME_TO_EXT = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
}
MAX_PRODUCT_DOCS = 10
MAX_DOC_SIZE_MB = 20


async def upload_product_document(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    file: UploadFile,
    actor: dict,
) -> dict:
    """Uploads a seller document (PDF, Word, image) to Supabase Storage."""
    seller_id = uuid.UUID(str(actor["id"]))
    roles = actor.get("roles", [])

    if "seller" in roles and "admin" not in roles and "verification_agent" not in roles:
        product = await _get_product_for_seller(db, product_id, seller_id)
        if product["status"] not in {"draft", "pending_reverification"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Documents can only be uploaded to draft or pending_reverification listings.",
            )

    current_count = await db.fetchval(
        "SELECT COUNT(*) FROM marketplace.product_documents WHERE product_id = $1",
        product_id,
    )
    if current_count >= MAX_PRODUCT_DOCS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Maximum of {MAX_PRODUCT_DOCS} documents per listing.",
        )

    mime_type = file.content_type or ""
    if mime_type not in ALLOWED_DOC_MIME_TYPES and file.filename:
        guessed, _ = mimetypes.guess_type(file.filename)
        mime_type = guessed or mime_type

    if mime_type not in ALLOWED_DOC_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{mime_type}'. Allowed: PDF, Word (.doc/.docx), images.",
        )

    file_bytes = await file.read()
    max_bytes = MAX_DOC_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Document exceeds maximum size of {MAX_DOC_SIZE_MB} MB.",
        )

    doc_id = uuid.uuid4()
    ext = DOC_MIME_TO_EXT.get(mime_type, "bin")
    storage_path = f"products/{product_id}/documents/{doc_id}.{ext}"

    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path,
            file_bytes,
            {"content-type": mime_type},
        )
    except Exception as exc:
        logger.error("Document upload failed for %s: %s", storage_path, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Document upload failed. Please try again.",
        )

    row = await db.fetchrow(
        """
        INSERT INTO marketplace.product_documents
            (id, product_id, storage_path, original_name, file_size_bytes, mime_type, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        doc_id, product_id, storage_path,
        file.filename, len(file_bytes), mime_type,
        uuid.UUID(str(actor["id"])),
    )

    signed_url = await _generate_signed_url(storage_path)
    result = dict(row)
    result["id"] = str(doc_id)
    result["signed_url"] = signed_url
    result["uploaded_at"] = row["uploaded_at"].isoformat() if row["uploaded_at"] else None
    return result


async def delete_product_document(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    doc_id: uuid.UUID,
    actor: dict,
) -> None:
    """Deletes a seller document from storage and DB."""
    seller_id = uuid.UUID(str(actor["id"]))
    roles = actor.get("roles", [])

    doc = await db.fetchrow(
        "SELECT id, storage_path, uploaded_by FROM marketplace.product_documents WHERE id = $1 AND product_id = $2",
        doc_id, product_id,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    if "admin" not in roles and str(doc["uploaded_by"]) != str(seller_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your document.")

    storage_path = doc["storage_path"]
    await db.execute("DELETE FROM marketplace.product_documents WHERE id = $1", doc_id)

    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
    except Exception as exc:
        logger.warning("Storage deletion failed for %s: %s", storage_path, exc)


async def upload_verification_evidence_file(
    assignment_id: uuid.UUID,
    file: UploadFile,
    actor: dict,
) -> dict:
    """
    Uploads a single evidence file (image or document) to Supabase Storage.
    Returns {storage_path, signed_url, file_type} — no DB record is created yet;
    the caller attaches paths to a SubmitVerificationReportRequest.
    """
    mime_type = file.content_type or ""
    if mime_type not in ALLOWED_EVIDENCE_MIME_TYPES and file.filename:
        guessed, _ = mimetypes.guess_type(file.filename)
        mime_type = guessed or mime_type

    if mime_type not in ALLOWED_EVIDENCE_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported file type. Allowed: JPEG, PNG, WebP, PDF, DOC, DOCX.",
        )

    file_bytes = await file.read()
    max_bytes = EVIDENCE_MAX_SIZE_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of {EVIDENCE_MAX_SIZE_MB} MB.",
        )

    from app.core.file_validation import validate_magic_bytes
    if not validate_magic_bytes(file_bytes, mime_type):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File content does not match the declared type.",
        )

    file_id = uuid.uuid4()
    ext = EVIDENCE_MIME_TO_EXT[mime_type]
    storage_path = f"evidence/{assignment_id}/{file_id}.{ext}"

    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path, file_bytes, {"content-type": mime_type}
        )
    except Exception as exc:
        logger.error("Evidence upload failed for %s: %s", storage_path, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="File upload failed. Please try again.",
        )

    is_image = mime_type.startswith("image/")
    signed_url = await _generate_signed_url(storage_path)
    return {
        "storage_path": storage_path,
        "signed_url": signed_url,
        "file_type": "image" if is_image else "document",
    }


async def set_primary_image(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    image_id: uuid.UUID,
    actor: dict,
) -> None:
    """Sets a specific image as the primary display image."""
    seller_id = uuid.UUID(str(actor["id"]))
    roles = actor.get("roles", [])

    if "admin" not in roles:
        await _get_product_for_seller(db, product_id, seller_id)

    exists = await db.fetchval(
        "SELECT id FROM marketplace.product_images WHERE id = $1 AND product_id = $2",
        image_id, product_id,
    )
    if not exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found.")

    async with db.transaction():
        await db.execute(
            "UPDATE marketplace.product_images SET is_primary = FALSE WHERE product_id = $1",
            product_id,
        )
        await db.execute(
            "UPDATE marketplace.product_images SET is_primary = TRUE WHERE id = $1",
            image_id,
        )


# ══════════════════════════════════════════════════════════════════════════════
# VERIFICATION WORKFLOW
# ══════════════════════════════════════════════════════════════════════════════

async def assign_verification_agent(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    payload: AssignVerificationAgentRequest,
    actor: dict,
) -> dict:
    """Admin assigns a verification agent to a pending_verification product."""
    admin_id = uuid.UUID(str(actor["id"]))

    product = await db.fetchrow(
        "SELECT * FROM marketplace.products WHERE id = $1 AND deleted_at IS NULL",
        product_id,
    )
    _require_product_exists(product, product_id)

    if product["status"] not in ("pending_verification", "pending_reverification"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Product must be pending_verification or pending_reverification. "
                   f"Current: {product['status']}",
        )

    # Verify agent exists and has verification_agent role
    agent = await db.fetchrow(
        "SELECT id, roles FROM public.profiles WHERE id = $1 AND is_active = TRUE",
        payload.agent_id,
    )
    if not agent or "verification_agent" not in agent["roles"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not an active verification agent.",
        )

    cycle = product["verification_cycle"] + 1

    async with db.transaction():
        # Transition to under_verification
        await db.execute(
            "UPDATE marketplace.products SET status = 'under_verification' WHERE id = $1",
            product_id,
        )

        # Create assignment record
        assignment = await db.fetchrow(
            """
            INSERT INTO marketplace.verification_assignments
                (product_id, agent_id, assigned_by, cycle_number, status, full_history_access)
            VALUES ($1, $2, $3, $4, 'assigned', $5)
            ON CONFLICT (product_id, cycle_number) DO UPDATE SET
                agent_id            = EXCLUDED.agent_id,
                assigned_by         = EXCLUDED.assigned_by,
                status              = 'assigned',
                full_history_access = EXCLUDED.full_history_access,
                updated_at          = NOW()
            RETURNING *
            """,
            product_id, payload.agent_id, admin_id, cycle,
            payload.full_history_access,
        )

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.VERIFICATION_AGENT_ASSIGNED,
        resource_type="product",
        resource_id=str(product_id),
        new_state={"agent_id": str(payload.agent_id), "cycle": cycle},
        metadata={"ip": actor.get("_client_ip")},
    )

    return dict(assignment)


async def update_verification_assignment(
    db: asyncpg.Connection,
    assignment_id: uuid.UUID,
    payload: UpdateVerificationAssignmentRequest,
    actor: dict,
) -> dict:
    """Agent updates their assignment progress (contacted, scheduled, etc.)."""
    agent_id = uuid.UUID(str(actor["id"]))

    assignment = await db.fetchrow(
        "SELECT * FROM marketplace.verification_assignments WHERE id = $1",
        assignment_id,
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")
    if str(assignment["agent_id"]) != str(agent_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this verification task.",
        )
    if assignment["status"] == "report_submitted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot update a completed assignment.",
        )

    updated = await db.fetchrow(
        """
        UPDATE marketplace.verification_assignments
        SET status         = $2,
            scheduled_date = COALESCE($3, scheduled_date),
            contact_notes  = COALESCE($4, contact_notes),
            updated_at     = NOW()
        WHERE id = $1
        RETURNING *
        """,
        assignment_id,
        payload.status,
        payload.scheduled_date,
        payload.contact_notes,
    )

    await write_audit_log(
        db,
        actor_id=agent_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.VERIFICATION_STATUS_UPDATED,
        resource_type="verification_assignment",
        resource_id=str(assignment_id),
        new_state={"status": payload.status},
    )

    enriched = await db.fetchrow(
        """
        SELECT
            va.id, va.product_id, mp.title AS product_title,
            pr.company_name AS seller_company,
            va.agent_id,
            ab.full_name AS assigned_by_name,
            va.cycle_number, va.status, va.scheduled_date,
            va.contact_notes, va.created_at, va.updated_at,
            EXISTS(
                SELECT 1 FROM marketplace.verification_reports vr
                WHERE vr.assignment_id = va.id
            ) AS report_submitted
        FROM marketplace.verification_assignments va
        JOIN marketplace.products mp ON mp.id = va.product_id
        LEFT JOIN public.profiles pr ON pr.id = mp.seller_id
        LEFT JOIN public.profiles ab ON ab.id = va.assigned_by
        WHERE va.id = $1
        """,
        assignment_id,
    )
    return dict(enriched)


async def submit_verification_report(
    db: asyncpg.Connection,
    assignment_id: uuid.UUID,
    payload: SubmitVerificationReportRequest,
    actor: dict,
) -> dict:
    """
    Agent submits the final verification report (immutable).
    Also transitions the product status:
      outcome=verified           → pending_approval
      outcome=failed             → verification_failed
      outcome=requires_clarification → verification_failed
    """
    agent_id = uuid.UUID(str(actor["id"]))

    assignment = await db.fetchrow(
        "SELECT * FROM marketplace.verification_assignments WHERE id = $1",
        assignment_id,
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")
    if str(assignment["agent_id"]) != str(agent_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this verification task.",
        )
    if assignment["status"] == "report_submitted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A report has already been submitted for this assignment.",
        )

    product_id = assignment["product_id"]

    # Map frontend recommendation to DB outcome
    outcome = payload.outcome  # property on schema does the mapping
    new_product_status = (
        "pending_approval" if outcome == "verified"
        else "verification_failed"
    )

    async with db.transaction():
        # Create immutable report — map frontend fields to DB columns
        report = await db.fetchrow(
            """
            INSERT INTO marketplace.verification_reports
                (assignment_id, agent_id, outcome, findings,
                 asset_condition, issues_found, recommendations)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            """,
            assignment_id,
            agent_id,
            outcome,
            payload.notes,                  # findings ← notes
            payload.condition_confirmed,    # asset_condition ← condition_confirmed
            None,                           # issues_found (not in new form)
            payload.price_assessment,       # recommendations ← price_assessment
        )

        # Mark assignment as report_submitted
        await db.execute(
            "UPDATE marketplace.verification_assignments SET status = 'report_submitted', updated_at = NOW() WHERE id = $1",
            assignment_id,
        )

        # Transition product status
        await db.execute(
            f"UPDATE marketplace.products SET status = '{new_product_status}' WHERE id = $1",
            product_id,
        )

        # Persist any spec updates from the agent
        if payload.attribute_updates:
            await _upsert_attribute_values(
                db, product_id, payload.attribute_updates, agent_id
            )

        # Attach pre-uploaded evidence files
        if payload.evidence_files:
            await db.executemany(
                """
                INSERT INTO marketplace.verification_evidence
                    (report_id, file_type, storage_path, description, uploaded_by)
                VALUES ($1, $2, $3, $4, $5)
                """,
                [
                    (
                        report["id"],
                        ev.file_type,
                        ev.storage_path,
                        ev.description or None,
                        agent_id,
                    )
                    for ev in payload.evidence_files
                ],
            )

    await write_audit_log(
        db,
        actor_id=agent_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.VERIFICATION_REPORT_SUBMITTED,
        resource_type="product",
        resource_id=str(product_id),
        new_state={
            "outcome": payload.outcome,
            "new_product_status": new_product_status,
            "report_id": str(report["id"]),
        },
        metadata={"ip": actor.get("_client_ip")},
    )

    return dict(report)


async def get_agent_assignments(
    db: asyncpg.Connection,
    agent_id: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Loads assignments for a specific agent."""
    page_size = min(page_size, 100)
    offset = (page - 1) * page_size

    total = await db.fetchval(
        "SELECT COUNT(*) FROM marketplace.verification_assignments WHERE agent_id = $1",
        agent_id,
    )
    rows = await db.fetch(
        """
        SELECT
            va.id, va.product_id, mp.title AS product_title,
            pr.company_name AS seller_company,
            va.agent_id,
            ab.full_name AS assigned_by_name,
            va.cycle_number, va.status, va.scheduled_date,
            va.contact_notes, va.created_at AS assigned_at, va.updated_at,
            va.full_history_access,
            mp.status AS product_status,
            EXISTS(
                SELECT 1 FROM marketplace.verification_reports vr
                WHERE vr.assignment_id = va.id
            ) AS report_submitted
        FROM marketplace.verification_assignments va
        JOIN marketplace.products mp ON mp.id = va.product_id
        LEFT JOIN public.profiles pr ON pr.id = mp.seller_id
        LEFT JOIN public.profiles ab ON ab.id = va.assigned_by
        WHERE va.agent_id = $1
        ORDER BY va.created_at DESC
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


async def get_assignment_detail(
    db: asyncpg.Connection,
    assignment_id: uuid.UUID,
    actor: dict,
) -> dict:
    """Loads a single assignment with inlined product fields, images, specs, and report."""
    agent_id = uuid.UUID(str(actor["id"]))
    roles = actor.get("roles", [])

    row = await db.fetchrow(
        """
        SELECT
            va.id, va.product_id, mp.title AS product_title,
            pr.company_name AS seller_company,
            pr.full_name AS seller_name,
            pr.phone AS seller_phone,
            su.email AS seller_email,
            va.agent_id,
            ab.full_name AS assigned_by_name,
            va.cycle_number, va.status, va.scheduled_date,
            va.contact_notes, va.created_at AS assigned_at, va.updated_at,
            va.full_history_access,
            mp.status AS product_status,
            EXISTS(
                SELECT 1 FROM marketplace.verification_reports vr
                WHERE vr.assignment_id = va.id
            ) AS report_submitted,
            mp.asking_price, mp.currency, mp.condition,
            mp.location_country, mp.location_port, mp.description,
            mp.availability_type,
            mc.name AS category_name
        FROM marketplace.verification_assignments va
        JOIN marketplace.products mp ON mp.id = va.product_id
        LEFT JOIN public.profiles pr ON pr.id = mp.seller_id
        LEFT JOIN auth.users su ON su.id = mp.seller_id
        LEFT JOIN public.profiles ab ON ab.id = va.assigned_by
        LEFT JOIN marketplace.categories mc ON mc.id = mp.category_id
        WHERE va.id = $1
        """,
        assignment_id,
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")
    if "admin" not in roles and str(row["agent_id"]) != str(agent_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    result = dict(row)
    product_id = result["product_id"]

    # Load images with signed URLs
    result["images"] = await _enrich_images(db, product_id)
    # Load attribute values
    result["attribute_values"] = await _enrich_attribute_values(db, product_id)

    # Load report if submitted, mapped to frontend-compatible field names
    if result["report_submitted"]:
        rep = await db.fetchrow(
            """
            SELECT id, assignment_id, outcome, findings, asset_condition,
                   recommendations, submitted_at
            FROM marketplace.verification_reports
            WHERE assignment_id = $1
            """,
            assignment_id,
        )
        if rep:
            _outcome_map = {
                "verified": "approve",
                "failed": "reject",
                "requires_clarification": "request_corrections",
            }
            result["report"] = {
                "id": rep["id"],
                "assignment_id": rep["assignment_id"],
                "recommendation": _outcome_map.get(rep["outcome"], rep["outcome"]),
                "condition_confirmed": rep["asset_condition"],
                "price_assessment": rep["recommendations"],
                "documentation_complete": True,
                "notes": rep["findings"],
                "created_at": rep["submitted_at"],
            }
            # Load evidence files
            evidence_rows = await db.fetch(
                """
                SELECT ve.id, ve.file_type, ve.storage_path, ve.description, ve.created_at
                FROM marketplace.verification_evidence ve
                WHERE ve.report_id = $1
                ORDER BY ve.created_at ASC
                """,
                rep["id"],
            )
            evidence_with_urls = []
            for ev in evidence_rows:
                signed_url = await _generate_signed_url(ev["storage_path"])
                evidence_with_urls.append({
                    "id": str(ev["id"]),
                    "file_type": ev["file_type"],
                    "storage_path": ev["storage_path"],
                    "description": ev["description"],
                    "signed_url": signed_url,
                    "created_at": ev["created_at"].isoformat() if ev["created_at"] else None,
                })
            result["evidence_files"] = evidence_with_urls
        else:
            result["report"] = None
    else:
        result["report"] = None
        result["evidence_files"] = []

    # Previous cycles — only loaded when full_history_access is True
    if result.get("full_history_access"):
        prev_rows = await db.fetch(
            """
            SELECT
                va2.id, va2.cycle_number, va2.status, va2.created_at AS assigned_at,
                ag.full_name AS agent_name, ag2.email AS agent_email,
                vr.outcome, vr.findings, vr.asset_condition,
                vr.recommendations, vr.submitted_at
            FROM marketplace.verification_assignments va2
            LEFT JOIN public.profiles ag  ON ag.id  = va2.agent_id
            LEFT JOIN auth.users     ag2  ON ag2.id = va2.agent_id
            LEFT JOIN marketplace.verification_reports vr ON vr.assignment_id = va2.id
            WHERE va2.product_id = $1 AND va2.cycle_number < $2
            ORDER BY va2.cycle_number ASC
            """,
            product_id, result["cycle_number"],
        )
        _outcome_map = {
            "verified": "approve",
            "failed": "reject",
            "requires_clarification": "request_corrections",
        }
        result["previous_cycles"] = [
            {
                "id": str(r["id"]),
                "cycle_number": r["cycle_number"],
                "status": r["status"],
                "assigned_at": r["assigned_at"].isoformat() if r["assigned_at"] else None,
                "agent_name": r["agent_name"] or r["agent_email"],
                "outcome": _outcome_map.get(r["outcome"], r["outcome"]) if r["outcome"] else None,
                "findings": r["findings"],
                "asset_condition": r["asset_condition"],
                "recommendations": r["recommendations"],
                "submitted_at": r["submitted_at"].isoformat() if r["submitted_at"] else None,
            }
            for r in prev_rows
        ]
    else:
        result["previous_cycles"] = []

    return result


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN ACTIONS
# ══════════════════════════════════════════════════════════════════════════════

async def admin_product_decision(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    payload: AdminProductDecisionRequest,
    actor: dict,
) -> dict:
    """
    Admin approves, rejects, or requests corrections on a pending_approval product.

    approve             → active
    reject              → rejected
    request_corrections → pending_reverification
    """
    admin_id = uuid.UUID(str(actor["id"]))

    product = await db.fetchrow(
        "SELECT * FROM marketplace.products WHERE id = $1 AND deleted_at IS NULL",
        product_id,
    )
    _require_product_exists(product, product_id)

    if product["status"] != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Product must be in pending_approval to make a decision. "
                   f"Current: {product['status']}",
        )

    status_map = {
        "approve":             "active",
        "reject":              "rejected",
        "request_corrections": "pending_reverification",
    }
    new_status = status_map[payload.decision]

    # Write status + reason back to the product row so sellers can see it
    if payload.decision == "reject":
        await db.execute(
            """UPDATE marketplace.products
               SET status = $1, rejection_reason = $2, corrections_reason = NULL, updated_at = NOW()
               WHERE id = $3""",
            new_status, payload.reason, product_id,
        )
    elif payload.decision == "request_corrections":
        await db.execute(
            """UPDATE marketplace.products
               SET status = $1, corrections_reason = $2, admin_notes = $2, updated_at = NOW()
               WHERE id = $3""",
            new_status, payload.reason, product_id,
        )
    else:  # approve
        await db.execute(
            """UPDATE marketplace.products
               SET status = $1, updated_at = NOW()
               WHERE id = $2""",
            new_status, product_id,
        )

    audit_action = {
        "approve":             AuditAction.PRODUCT_APPROVED,
        "reject":              AuditAction.PRODUCT_REJECTED,
        "request_corrections": AuditAction.PRODUCT_RESUBMITTED,
    }[payload.decision]

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=audit_action,
        resource_type="product",
        resource_id=str(product_id),
        old_state={"status": "pending_approval"},
        new_state={"status": new_status, "reason": payload.reason},
        metadata={"ip": actor.get("_client_ip")},
    )

    return {"product_id": product_id, "new_status": new_status,
            "message": f"Product {payload.decision}d successfully."}


_TRANSITION_LABELS: dict[tuple[str | None, str], tuple[str, str]] = {
    (None,                       "draft"):                  ("Listing Created",                "Draft listing created"),
    ("draft",                    "pending_verification"):   ("Submitted for Verification",     "Listing submitted for agent review"),
    ("pending_reverification",   "pending_verification"):   ("Resubmitted After Corrections",  "Seller addressed admin feedback and resubmitted"),
    ("rejected",                 "pending_verification"):   ("Resubmitted",                    "Seller resubmitted after rejection"),
    ("rejected",                 "pending_reverification"): ("Resubmitted",                    "Seller resubmitted after rejection"),
    ("verification_failed",      "pending_verification"):   ("Resubmitted",                    "Seller resubmitted after verification failure"),
    ("verification_failed",      "pending_reverification"): ("Resubmitted",                    "Seller resubmitted after failure"),
    ("pending_verification",     "under_verification"):     ("Verification Started",           "A verification agent has begun the inspection"),
    ("under_verification",       "pending_approval"):       ("Inspection Report Filed",        "Agent submitted report — awaiting admin decision"),
    ("under_verification",       "verification_failed"):    ("Verification Failed",            "Agent was unable to complete verification"),
    ("pending_approval",         "active"):                 ("Listing Approved",               "Listing is now live on the marketplace"),
    ("pending_approval",         "rejected"):               ("Listing Rejected",               "Admin reviewed and rejected the listing"),
    ("pending_approval",         "pending_reverification"): ("Corrections Requested",          "Admin requested changes before approval"),
    ("active",                   "delisted"):               ("Listing Delisted",               "Listing removed from the marketplace"),
    ("active",                   "under_offer"):            ("Offer Received",                 "A buyer has made an offer"),
    ("under_offer",              "sold"):                   ("Listing Sold",                   "Transaction completed"),
    ("under_offer",              "active"):                 ("Offer Withdrawn",                "Listing returned to active status"),
}


async def get_product_timeline(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    viewer_role: str = "seller",  # "seller" | "agent" | "admin"
) -> list[dict]:
    """
    Returns a unified chronological timeline of all events for a product.
    For seller view: admin names are anonymised to 'MarineXchange Team',
    agent names to 'Verification Agent'.
    """
    events: list[dict] = []

    # ── 1. Status transitions ────────────────────────────────────────────────
    status_rows = await db.fetch(
        """
        SELECT psh.old_status, psh.new_status, psh.reason, psh.created_at,
               p.full_name AS actor_name, p.roles AS actor_roles
        FROM marketplace.product_status_history psh
        LEFT JOIN public.profiles p ON p.id = psh.changed_by
        WHERE psh.product_id = $1
        ORDER BY psh.created_at ASC
        """,
        product_id,
    )
    for r in status_rows:
        actor_roles: list[str] = list(r["actor_roles"] or [])
        is_admin = "admin" in actor_roles
        is_agent = "verification_agent" in actor_roles

        if viewer_role == "seller":
            actor = "MarineXchange Team" if is_admin else "You"
        elif viewer_role == "agent":
            actor = "Admin" if is_admin else (r["actor_name"] or "Seller")
        else:
            actor = r["actor_name"] or "System"

        old_s: str | None = r["old_status"]
        new_s: str = r["new_status"]
        label, detail = _TRANSITION_LABELS.get(
            (old_s, new_s),
            (new_s.replace("_", " ").title(), f"{old_s or '—'} → {new_s}"),
        )

        events.append({
            "event_type": "status_change",
            "new_status": new_s,
            "label": label,
            "detail": detail,
            "reason": r["reason"],
            "actor": actor,
            "timestamp": r["created_at"].isoformat(),
        })

    # ── 2. Agent assignment events ───────────────────────────────────────────
    assign_rows = await db.fetch(
        """
        SELECT va.cycle_number, va.created_at,
               ag.full_name AS agent_name,
               ab.full_name AS assigned_by_name, ab.roles AS assigned_by_roles
        FROM marketplace.verification_assignments va
        LEFT JOIN public.profiles ag ON ag.id = va.agent_id
        LEFT JOIN public.profiles ab ON ab.id = va.assigned_by
        WHERE va.product_id = $1
        ORDER BY va.created_at ASC
        """,
        product_id,
    )
    for r in assign_rows:
        cycle = r["cycle_number"]
        cycle_suffix = f" — Cycle {cycle}" if cycle > 1 else ""

        if viewer_role == "seller":
            detail = f"A verification agent has been assigned to inspect your listing{cycle_suffix}."
            actor = "MarineXchange Team"
        elif viewer_role == "agent":
            agent_display = r["agent_name"] or "Agent"
            detail = f"Assigned to {agent_display}{cycle_suffix}"
            actor = r["assigned_by_name"] or "Admin"
        else:
            agent_display = r["agent_name"] or "Agent"
            detail = f"Agent: {agent_display}{cycle_suffix}"
            actor = r["assigned_by_name"] or "Admin"

        events.append({
            "event_type": "agent_assigned",
            "new_status": None,
            "label": f"Verification Agent Assigned{cycle_suffix}",
            "detail": detail,
            "reason": None,
            "actor": actor,
            "timestamp": r["created_at"].isoformat(),
        })

    # ── 3. Verification report events ────────────────────────────────────────
    report_rows = await db.fetch(
        """
        SELECT vr.outcome, vr.submitted_at, va.cycle_number,
               ag.full_name AS agent_name
        FROM marketplace.verification_reports vr
        JOIN marketplace.verification_assignments va ON va.id = vr.assignment_id
        LEFT JOIN public.profiles ag ON ag.id = va.agent_id
        WHERE va.product_id = $1
        ORDER BY vr.submitted_at ASC
        """,
        product_id,
    )
    _outcome_map = {
        "verified":               "Recommend Approve",
        "failed":                 "Recommend Reject",
        "requires_clarification": "Request Corrections",
    }
    for r in report_rows:
        if not r["submitted_at"]:
            continue
        cycle = r["cycle_number"]
        cycle_suffix = f" — Cycle {cycle}" if cycle > 1 else ""

        if viewer_role == "seller":
            detail = f"Inspection complete{cycle_suffix}. Awaiting admin review."
            actor = "Verification Agent"
        else:
            outcome = _outcome_map.get(r["outcome"], r["outcome"] or "—")
            detail = f"Recommendation: {outcome}{cycle_suffix}"
            actor = r["agent_name"] or "Verification Agent"

        events.append({
            "event_type": "report_submitted",
            "new_status": None,
            "label": f"Inspection Report Filed{cycle_suffix}",
            "detail": detail,
            "reason": None,
            "actor": actor,
            "timestamp": r["submitted_at"].isoformat(),
        })

    # Sort chronologically
    events.sort(key=lambda e: e["timestamp"] or "")
    return events


async def admin_update_product(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    payload: AdminProductUpdateRequest,
    actor: dict,
) -> dict:
    """Admin edits any field of a listing."""
    admin_id = uuid.UUID(str(actor["id"]))

    product = await db.fetchrow(
        "SELECT * FROM marketplace.products WHERE id = $1 AND deleted_at IS NULL",
        product_id,
    )
    _require_product_exists(product, product_id)

    updates: dict[str, Any] = {}
    if payload.title             is not None: updates["title"]             = payload.title
    if payload.description       is not None: updates["description"]       = payload.description
    if payload.asking_price      is not None: updates["asking_price"]      = float(payload.asking_price)
    if payload.currency          is not None: updates["currency"]          = payload.currency
    if payload.location_country  is not None: updates["location_country"]  = payload.location_country
    if payload.location_port     is not None: updates["location_port"]     = payload.location_port
    if payload.location_details  is not None: updates["location_details"]  = payload.location_details
    if payload.availability_type is not None: updates["availability_type"] = payload.availability_type
    if payload.condition         is not None: updates["condition"]         = payload.condition

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update.",
        )

    # Capture original values before overwriting (for audit trail)
    from decimal import Decimal
    old_state: dict[str, Any] = {}
    for k in updates:
        v = product[k]
        old_state[k] = float(v) if isinstance(v, Decimal) else v

    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates.keys()))
    await db.execute(
        f"UPDATE marketplace.products SET {set_clause}, updated_at = NOW() WHERE id = $1",
        product_id, *updates.values(),
    )

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.PRODUCT_UPDATED,
        resource_type="product",
        resource_id=str(product_id),
        old_state=old_state,
        new_state={"updated_fields": list(updates.keys()), **{k: (float(v) if isinstance(v, Decimal) else v) for k, v in updates.items()}},
        metadata={"ip": actor.get("_client_ip")},
    )

    return await get_product_detail(db, product_id, actor, include_contact=True)


async def admin_update_product_specs(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    payload: ProductSpecUpdateRequest,
    actor: dict,
) -> list[dict]:
    """Agent or admin adds/updates product specification attribute values."""
    actor_id = uuid.UUID(str(actor["id"]))

    product = await db.fetchrow(
        "SELECT id FROM marketplace.products WHERE id = $1 AND deleted_at IS NULL",
        product_id,
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")

    await _upsert_attribute_values(db, product_id, payload.attribute_values, actor_id)

    return await _enrich_attribute_values(db, product_id)


async def admin_delist_product(
    db: asyncpg.Connection,
    product_id: uuid.UUID,
    reason: str | None,
    actor: dict,
) -> dict:
    """Admin suspends/delists an active listing."""
    admin_id = uuid.UUID(str(actor["id"]))

    product = await db.fetchrow(
        "SELECT status FROM marketplace.products WHERE id = $1 AND deleted_at IS NULL",
        product_id,
    )
    _require_product_exists(product, product_id)

    if product["status"] not in ("active", "under_offer"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only active or under_offer listings can be delisted. "
                   f"Current: {product['status']}",
        )

    await db.execute(
        "UPDATE marketplace.products SET status = 'delisted' WHERE id = $1",
        product_id,
    )

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.PRODUCT_DELISTED,
        resource_type="product",
        resource_id=str(product_id),
        old_state={"status": product["status"]},
        new_state={"status": "delisted", "reason": reason},
        metadata={"ip": actor.get("_client_ip")},
    )

    return {"product_id": product_id, "new_status": "delisted",
            "message": "Listing has been delisted."}
