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
    """Seller updates a listing that is in 'draft' or 'pending_reverification' status."""
    seller_id = uuid.UUID(str(actor["id"]))
    product = await _get_product_for_seller(db, product_id, seller_id)

    if product["status"] not in ("draft", "pending_reverification"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Only draft or pending_reverification listings can be edited. "
                f"Current status: {product['status']}"
            ),
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

    if product["status"] != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only draft listings can be submitted. Current status: {product['status']}",
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

    # DB trigger validates the transition
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
        old_state={"status": "draft"},
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

    # Check ownership unless admin
    if "admin" not in roles:
        await _get_product_for_seller(db, product_id, seller_id)

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
                (product_id, agent_id, assigned_by, cycle_number, status)
            VALUES ($1, $2, $3, $4, 'assigned')
            ON CONFLICT (product_id, cycle_number) DO UPDATE SET
                agent_id    = EXCLUDED.agent_id,
                assigned_by = EXCLUDED.assigned_by,
                status      = 'assigned',
                updated_at  = NOW()
            RETURNING *
            """,
            product_id, payload.agent_id, admin_id, cycle,
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
            va.contact_notes, va.created_at, va.updated_at,
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
            va.agent_id,
            ab.full_name AS assigned_by_name,
            va.cycle_number, va.status, va.scheduled_date,
            va.contact_notes, va.created_at, va.updated_at,
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
    result["images"] = await _load_product_images(db, product_id)
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
        else:
            result["report"] = None
    else:
        result["report"] = None

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

    await db.execute(
        "UPDATE marketplace.products SET status = $1 WHERE id = $2",
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

    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates.keys()))
    await db.execute(
        f"UPDATE marketplace.products SET {set_clause} WHERE id = $1",
        product_id, *updates.values(),
    )

    await write_audit_log(
        db,
        actor_id=admin_id,
        actor_roles=actor.get("roles", []),
        action=AuditAction.PRODUCT_UPDATED,
        resource_type="product",
        resource_id=str(product_id),
        new_state={"updated_fields": list(updates.keys())},
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
