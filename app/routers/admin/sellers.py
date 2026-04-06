"""
Admin Sellers Router.

GET /admin/sellers        — paginated list of all sellers
GET /admin/sellers/{id}   — full seller profile (profile + KYC + listings + deals + agents)
"""
from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from app.deps import AdminUser, DbConn

router = APIRouter(tags=["Admin — Sellers"])


@router.get("", summary="List all sellers")
async def list_sellers(
    db: DbConn,
    current_user: AdminUser,
    search: str | None = Query(default=None),
    kyc_status: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> dict:
    conditions = ["'seller' = ANY(p.roles)"]
    params: list = []
    idx = 1

    if search:
        conditions.append(f"(p.full_name ILIKE ${idx} OR u.email ILIKE ${idx} OR p.company_name ILIKE ${idx})")
        params.append(f"%{search}%")
        idx += 1
    if kyc_status:
        conditions.append(f"p.kyc_status = ${idx}")
        params.append(kyc_status)
        idx += 1
    if is_active is not None:
        conditions.append(f"p.is_active = ${idx}")
        params.append(is_active)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * page_size

    total = await db.fetchval(
        f"SELECT COUNT(*) FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE {where}",
        *params,
    )

    rows = await db.fetch(
        f"""
        SELECT
            p.id, p.full_name, p.company_name, p.phone, p.phone_verified, p.country,
            p.roles, p.kyc_status, p.is_active, p.created_at,
            u.email,
            (SELECT COUNT(*) FROM marketplace.products WHERE seller_id = p.id AND deleted_at IS NULL) AS total_listings,
            (SELECT COUNT(*) FROM marketplace.products WHERE seller_id = p.id AND status = 'active' AND deleted_at IS NULL) AS active_listings,
            (SELECT COUNT(*) FROM finance.deals WHERE seller_id = p.id) AS total_deals
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE {where}
        ORDER BY p.created_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, page_size, offset,
    )

    return {"items": [dict(r) for r in rows], "total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size))}


@router.get("/{seller_id}", summary="Full seller profile")
async def get_seller(seller_id: UUID, db: DbConn, current_user: AdminUser) -> dict:
    # ── Profile ──────────────────────────────────────────────────────────────
    profile = await db.fetchrow(
        """
        SELECT p.id, p.full_name, p.company_name, p.company_reg_no,
               p.phone, p.phone_verified, p.country, p.roles, p.kyc_status, p.kyc_expires_at,
               p.is_active, p.created_at, p.updated_at,
               u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1 AND 'seller' = ANY(p.roles)
        """,
        seller_id,
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Seller not found.")

    # Sellers are verified via product verification, not KYC submissions.
    # Their kyc_status lives directly on their profile row.
    kyc_rows: list = []

    # ── Listings ─────────────────────────────────────────────────────────────
    listing_rows = await db.fetch(
        """
        SELECT
            p.id, p.title, p.status, p.asking_price, p.currency,
            p.condition, p.availability_type, p.location_country,
            p.location_port, p.verification_cycle,
            p.created_at, p.updated_at,
            p.description,
            c.name AS category_name,
            -- current assigned agent
            va.id AS verification_assignment_id,
            COALESCE(ap.full_name, agu.email) AS verification_agent,
            agu.email AS agent_email,
            -- image count
            (SELECT COUNT(*) FROM marketplace.product_images pi WHERE pi.product_id = p.id) AS image_count,
            -- deal linked to this product
            (SELECT COUNT(*) FROM finance.deals d WHERE d.product_id = p.id) AS deal_count
        FROM marketplace.products p
        LEFT JOIN marketplace.categories c ON c.id = p.category_id
        LEFT JOIN marketplace.verification_assignments va
               ON va.product_id = p.id AND va.cycle_number = p.verification_cycle + 1
        LEFT JOIN public.profiles ap ON ap.id = va.agent_id
        LEFT JOIN auth.users agu ON agu.id = va.agent_id
        WHERE p.seller_id = $1 AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        """,
        seller_id,
    )

    # ── Deals as seller ──────────────────────────────────────────────────────
    deal_rows = await db.fetch(
        """
        SELECT
            d.id, d.status, d.deal_type, d.total_price, d.currency,
            d.created_at, d.updated_at,
            p.title AS product_title,
            COALESCE(bp.full_name, bp.company_name) AS buyer_name,
            bu.email AS buyer_email
        FROM finance.deals d
        LEFT JOIN marketplace.products p ON p.id = d.product_id
        LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
        LEFT JOIN auth.users bu ON bu.id = d.buyer_id
        WHERE d.seller_id = $1
        ORDER BY d.created_at DESC
        """,
        seller_id,
    )

    # ── All verification agents who touched their products ───────────────────
    agent_rows = await db.fetch(
        """
        SELECT DISTINCT
            COALESCE(ap.full_name, agu.email) AS agent_name,
            agu.email AS agent_email,
            ap.roles AS agent_roles,
            COUNT(va.id) AS assignments_count,
            MAX(va.updated_at) AS last_activity
        FROM marketplace.verification_assignments va
        JOIN marketplace.products p ON p.id = va.product_id AND p.seller_id = $1
        LEFT JOIN public.profiles ap ON ap.id = va.agent_id
        LEFT JOIN auth.users agu ON agu.id = va.agent_id
        GROUP BY ap.full_name, agu.email, ap.roles
        ORDER BY last_activity DESC
        """,
        seller_id,
    )

    # ── Recent audit activity ────────────────────────────────────────────────
    activity_rows = await db.fetch(
        """
        SELECT action, resource_type, resource_id, created_at
        FROM audit.logs
        WHERE actor_id = $1
        ORDER BY created_at DESC
        LIMIT 20
        """,
        str(seller_id),
    )

    return {
        "profile": dict(profile),
        "kyc": [dict(r) for r in kyc_rows],
        "listings": [dict(r) for r in listing_rows],
        "deals": [dict(r) for r in deal_rows],
        "agents": [dict(r) for r in agent_rows],
        "activity": [
            {**dict(r), "created_at": r["created_at"].isoformat() if r["created_at"] else None}
            for r in activity_rows
        ],
    }
