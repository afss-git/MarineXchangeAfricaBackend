"""
Admin Buyers Router.

GET /admin/buyers        — paginated list of all buyers
GET /admin/buyers/{id}   — full buyer profile (profile + KYC + deals + purchase requests + activity)
"""
from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from app.deps import AdminUser, DbConn

router = APIRouter(tags=["Admin — Buyers"])


@router.get("", summary="List all buyers")
async def list_buyers(
    db: DbConn,
    current_user: AdminUser,
    search: str | None = Query(default=None),
    kyc_status: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> dict:
    conditions = ["'buyer' = ANY(p.roles)"]
    params: list = []
    idx = 1

    if search:
        conditions.append(f"(p.full_name ILIKE ${idx} OR u.email ILIKE ${idx})")
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
            p.id, p.full_name, p.company_name, p.phone, p.country,
            p.roles, p.kyc_status, p.is_active, p.created_at,
            u.email,
            (SELECT COUNT(*) FROM finance.deals WHERE buyer_id = p.id) AS total_deals,
            (SELECT COUNT(*) FROM marketplace.purchase_requests WHERE buyer_id = p.id) AS total_requests,
            (SELECT COUNT(*) FROM kyc.submissions WHERE buyer_id = p.id) AS kyc_submissions
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE {where}
        ORDER BY p.created_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, page_size, offset,
    )

    return {"items": [dict(r) for r in rows], "total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size))}


@router.get("/{buyer_id}", summary="Full buyer profile")
async def get_buyer(buyer_id: UUID, db: DbConn, current_user: AdminUser) -> dict:
    # ── Profile ──────────────────────────────────────────────────────────────
    profile = await db.fetchrow(
        """
        SELECT p.id, p.full_name, p.company_name, p.company_reg_no,
               p.phone, p.country, p.roles, p.kyc_status, p.kyc_expires_at,
               p.kyc_attempt_count, p.is_active, p.created_at, p.updated_at,
               u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1 AND 'buyer' = ANY(p.roles)
        """,
        buyer_id,
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Buyer not found.")

    # ── KYC submissions ──────────────────────────────────────────────────────
    kyc_rows = await db.fetch(
        """
        SELECT
            s.id, s.status, s.cycle_number, s.created_at, s.updated_at,
            s.rejection_reason,
            -- Latest assignment for this submission
            a.id AS assignment_id, a.status AS assignment_status,
            a.updated_at AS reviewed_at,
            COALESCE(ag.full_name, ag_u.email) AS agent_name,
            ag_u.email AS agent_email,
            -- Document count
            (SELECT COUNT(*) FROM kyc.documents d WHERE d.submission_id = s.id) AS doc_count
        FROM kyc.submissions s
        LEFT JOIN kyc.assignments a ON a.submission_id = s.id
        LEFT JOIN public.profiles ag ON ag.id = a.agent_id
        LEFT JOIN auth.users ag_u ON ag_u.id = a.agent_id
        WHERE s.buyer_id = $1
        ORDER BY s.created_at DESC
        """,
        buyer_id,
    )

    # ── Deals as buyer ───────────────────────────────────────────────────────
    deal_rows = await db.fetch(
        """
        SELECT
            d.id, d.status, d.deal_type, d.total_price, d.currency,
            d.created_at, d.updated_at,
            p.title AS product_title, p.id AS product_id,
            COALESCE(sp.full_name, sp.company_name) AS seller_name,
            su.email AS seller_email
        FROM finance.deals d
        LEFT JOIN marketplace.products p ON p.id = d.product_id
        LEFT JOIN public.profiles sp ON sp.id = d.seller_id
        LEFT JOIN auth.users su ON su.id = d.seller_id
        WHERE d.buyer_id = $1
        ORDER BY d.created_at DESC
        """,
        buyer_id,
    )

    # ── Purchase requests ────────────────────────────────────────────────────
    pr_rows = await db.fetch(
        """
        SELECT
            r.id, r.status, r.purchase_type AS request_type,
            r.offered_price AS budget_min, NULL::NUMERIC AS budget_max,
            r.offered_currency AS currency, r.message AS description,
            r.created_at, r.updated_at,
            p.title AS product_title,
            COALESCE(ag.full_name, ag.company_name) AS agent_name,
            agu.email AS agent_email
        FROM marketplace.purchase_requests r
        LEFT JOIN marketplace.products p ON p.id = r.product_id
        LEFT JOIN marketplace.buyer_agent_assignments baa ON baa.request_id = r.id
        LEFT JOIN public.profiles ag ON ag.id = baa.agent_id
        LEFT JOIN auth.users agu ON agu.id = baa.agent_id
        WHERE r.buyer_id = $1
        ORDER BY r.created_at DESC
        """,
        buyer_id,
    )

    # ── Recent audit activity ────────────────────────────────────────────────
    activity_rows = await db.fetch(
        """
        SELECT action, resource_type, resource_id, created_at, metadata
        FROM audit.logs
        WHERE actor_id = $1
        ORDER BY created_at DESC
        LIMIT 20
        """,
        str(buyer_id),
    )

    return {
        "profile": dict(profile),
        "kyc": [dict(r) for r in kyc_rows],
        "deals": [dict(r) for r in deal_rows],
        "purchase_requests": [dict(r) for r in pr_rows],
        "activity": [
            {**dict(r), "created_at": r["created_at"].isoformat() if r["created_at"] else None}
            for r in activity_rows
        ],
    }
