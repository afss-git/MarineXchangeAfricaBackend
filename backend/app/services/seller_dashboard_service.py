"""
Phase 12 — Seller Dashboard Service.

Aggregates a seller's business activity into a single response:
  - Listing counts + value
  - Deal pipeline (active, completed, disputed)
  - Revenue this month vs last month
  - Purchase requests targeting seller's products
  - Auction activity
  - Recent deals (last 5)
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID


def _safe(v):
    """Convert Decimal / pgproto types to JSON-serialisable Python types."""
    if isinstance(v, Decimal):
        return str(v)
    if hasattr(v, "hex"):          # pgproto UUID
        return str(v)
    return v


def _row_to_dict(row) -> dict:
    return {k: _safe(v) for k, v in dict(row).items()}


async def get_seller_dashboard(db, user: dict) -> dict:
    seller_id = user["id"]

    # ── Listings ──────────────────────────────────────────────────────────────
    listing_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*)                                                             AS total_listings,
            COUNT(*) FILTER (WHERE status = 'active')                           AS active_listings,
            COUNT(*) FILTER (WHERE status IN ('under_offer', 'in_auction'))     AS listings_with_activity,
            COUNT(*) FILTER (WHERE status = 'sold')                             AS sold_listings,
            COUNT(*) FILTER (WHERE status = 'draft')                            AS draft_listings,
            COUNT(*) FILTER (WHERE status = 'pending_verification')             AS pending_review,
            COALESCE(SUM(asking_price) FILTER (WHERE status = 'active'), 0)     AS active_listings_value,
            COALESCE(SUM(asking_price) FILTER (WHERE status = 'sold'), 0)       AS sold_listings_value
        FROM marketplace.products
        WHERE seller_id = $1
          AND deleted_at IS NULL
        """,
        seller_id,
    )

    # ── Deals ─────────────────────────────────────────────────────────────────
    deal_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*)                                                             AS total_deals,
            COUNT(*) FILTER (WHERE status NOT IN (
                'completed', 'cancelled', 'disputed', 'defaulted'
            ))                                                                   AS active_deals,
            COUNT(*) FILTER (WHERE status = 'completed')                        AS completed_deals,
            COUNT(*) FILTER (WHERE status IN ('disputed', 'defaulted'))         AS problem_deals,
            COUNT(*) FILTER (WHERE status = 'cancelled')                        AS cancelled_deals,
            COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0)   AS total_revenue,
            COALESCE(SUM(total_price) FILTER (
                WHERE status = 'completed'
                  AND updated_at >= date_trunc('month', NOW())
            ), 0)                                                                AS revenue_this_month,
            COALESCE(SUM(total_price) FILTER (
                WHERE status = 'completed'
                  AND updated_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
                  AND updated_at <  date_trunc('month', NOW())
            ), 0)                                                                AS revenue_last_month
        FROM finance.deals
        WHERE seller_id = $1
        """,
        seller_id,
    )

    # ── Purchase Requests ─────────────────────────────────────────────────────
    pr_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*)                                                             AS total_requests,
            COUNT(*) FILTER (WHERE pr.status IN (
                'submitted', 'agent_assigned', 'under_review'
            ))                                                                   AS open_requests,
            COUNT(*) FILTER (WHERE pr.status = 'approved')                      AS approved_requests,
            COUNT(*) FILTER (WHERE pr.status = 'converted')                     AS converted_requests,
            COUNT(*) FILTER (WHERE pr.status IN ('rejected', 'cancelled'))      AS closed_requests
        FROM marketplace.purchase_requests pr
        JOIN marketplace.products p ON p.id = pr.product_id
        WHERE p.seller_id = $1
        """,
        seller_id,
    )

    # ── Auctions ──────────────────────────────────────────────────────────────
    auction_stats = await db.fetchrow(
        """
        SELECT
            COUNT(*)                                                             AS total_auctions,
            COUNT(*) FILTER (WHERE a.status = 'live')                           AS live_auctions,
            COUNT(*) FILTER (WHERE a.status = 'scheduled')                      AS scheduled_auctions,
            COUNT(*) FILTER (WHERE a.status = 'closed')                         AS closed_auctions,
            COUNT(*) FILTER (WHERE a.status = 'cancelled')                      AS cancelled_auctions,
            (
                SELECT COUNT(*)
                FROM marketplace.auction_bids ab
                JOIN marketplace.auctions inner_a ON inner_a.id = ab.auction_id
                WHERE inner_a.created_by = $1
            )                                                                    AS total_bids_received
        FROM marketplace.auctions a
        WHERE a.created_by = $1
        """,
        seller_id,
    )

    # ── Recent Deals (last 5) ─────────────────────────────────────────────────
    recent_rows = await db.fetch(
        """
        SELECT
            d.id,
            d.deal_ref,
            d.status,
            d.total_price,
            d.currency,
            d.created_at,
            buyer.full_name  AS buyer_name,
            prod.title       AS product_title
        FROM finance.deals d
        JOIN public.profiles  buyer ON buyer.id = d.buyer_id
        JOIN marketplace.products prod  ON prod.id  = d.product_id
        WHERE d.seller_id = $1
        ORDER BY d.created_at DESC
        LIMIT 5
        """,
        seller_id,
    )

    recent_deals = [
        {
            "id": str(r["id"]),
            "deal_ref": r["deal_ref"],
            "status": r["status"],
            "total_price": str(r["total_price"]),
            "currency": r["currency"],
            "buyer_name": r["buyer_name"],
            "product_title": r["product_title"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in recent_rows
    ]

    return {
        "listings": _row_to_dict(listing_stats),
        "deals": _row_to_dict(deal_stats),
        "purchase_requests": _row_to_dict(pr_stats),
        "auctions": _row_to_dict(auction_stats),
        "recent_deals": recent_deals,
    }
