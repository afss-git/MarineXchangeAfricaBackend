"""
Phase 11 — Admin Dashboard Stats Router.

GET /admin/dashboard  — single endpoint that powers the admin home screen.
Returns live counts and totals across all major entities.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.deps import AnyAdmin, DbConn

router = APIRouter(tags=["Admin — Dashboard"])


@router.get(
    "",
    summary="Admin dashboard — live platform stats",
)
async def get_dashboard(
    db: DbConn,
    current_user: AnyAdmin,
) -> dict:
    """
    Single aggregated stats call for the admin home screen.
    Returns user counts, deal pipeline, KYC queue, auction activity,
    monthly revenue, and a recent activity feed.
    """

    # ── Users ─────────────────────────────────────────────────────────────────
    user_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*)                                                        AS total_users,
            COUNT(*) FILTER (WHERE 'buyer'  = ANY(roles) AND is_active)    AS active_buyers,
            COUNT(*) FILTER (WHERE 'seller' = ANY(roles) AND is_active)    AS active_sellers,
            COUNT(*) FILTER (WHERE (
                'verification_agent' = ANY(roles) OR 'buyer_agent' = ANY(roles)
            ) AND is_active)                                                AS active_agents,
            COUNT(*) FILTER (WHERE NOT is_active)                          AS deactivated_users
        FROM public.profiles
        """
    )

    # ── Deals ─────────────────────────────────────────────────────────────────
    deal_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled','disputed','defaulted'))
                AS active_deals,
            COALESCE(SUM(total_price) FILTER (
                WHERE status NOT IN ('completed','cancelled','disputed','defaulted')
            ), 0)                                                           AS active_deals_value,
            COUNT(*) FILTER (WHERE status = 'completed')                   AS completed_deals,
            COALESCE(SUM(total_price) FILTER (
                WHERE status = 'completed'
                AND updated_at >= date_trunc('month', NOW())
            ), 0)                                                           AS revenue_this_month,
            COUNT(*) FILTER (WHERE status = 'disputed')                    AS disputed_deals,
            COUNT(*) FILTER (
                WHERE created_at >= date_trunc('month', NOW())
            )                                                               AS new_deals_this_month
        FROM finance.deals
        """
    )

    # ── KYC ───────────────────────────────────────────────────────────────────
    kyc_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status IN ('submitted', 'under_review')) AS pending_kyc,
            COUNT(*) FILTER (WHERE status = 'approved')                     AS approved_kyc,
            COUNT(*) FILTER (WHERE status = 'rejected')                     AS rejected_kyc
        FROM kyc.submissions
        """
    )

    # ── Purchase Requests ─────────────────────────────────────────────────────
    request_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status IN ('submitted', 'under_review')) AS open_requests,
            COUNT(*) FILTER (WHERE status = 'approved')                     AS approved_requests,
            COUNT(*) FILTER (
                WHERE created_at >= date_trunc('month', NOW())
            )                                                               AS new_requests_this_month
        FROM marketplace.purchase_requests
        """
    )

    # ── Auctions ──────────────────────────────────────────────────────────────
    auction_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'live')       AS live_auctions,
            COUNT(*) FILTER (WHERE status = 'scheduled')  AS scheduled_auctions,
            COUNT(*) FILTER (WHERE status = 'closed' AND winner_approved_at IS NULL
                AND winner_approved_by IS NULL)           AS pending_approval_auctions
        FROM marketplace.auctions
        """
    )

    # ── Documents & Invoices ──────────────────────────────────────────────────
    doc_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE is_deleted = FALSE)             AS total_documents,
            (SELECT COUNT(*) FROM finance.deal_invoices
             WHERE status = 'draft')                               AS draft_invoices,
            (SELECT COUNT(*) FROM finance.deal_invoices
             WHERE status = 'issued')                              AS issued_invoices
        FROM finance.deal_documents
        """
    )

    # ── Recent Activity (last 10 audit log entries) ───────────────────────────
    recent_rows = await db.fetch(
        """
        SELECT
            l.action,
            l.resource_type,
            l.resource_id,
            l.actor_id,
            l.created_at,
            p.full_name AS actor_name
        FROM audit.logs l
        LEFT JOIN public.profiles p ON p.id = l.actor_id::UUID
        ORDER BY l.created_at DESC
        LIMIT 10
        """
    )

    recent_activity = [
        {
            "action": r["action"],
            "resource_type": r["resource_type"],
            "resource_id": r["resource_id"],
            "actor_id": str(r["actor_id"]) if r["actor_id"] else None,
            "actor_name": r["actor_name"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in recent_rows
    ]

    return {
        "users": dict(user_stats),
        "deals": {k: str(v) if hasattr(v, '__class__') and v.__class__.__name__ == 'Decimal' else v
                  for k, v in dict(deal_stats).items()},
        "kyc": dict(kyc_stats),
        "purchase_requests": dict(request_stats),
        "auctions": dict(auction_stats),
        "documents": dict(doc_stats),
        "recent_activity": recent_activity,
    }
