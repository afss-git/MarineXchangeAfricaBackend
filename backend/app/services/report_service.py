"""
Phase 6 — Reporting service.

All DB queries for the six report modules. No writes — pure read-only analytics.
Uses the service role connection (bypasses RLS) already established in the pool.
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

import asyncpg

from app.schemas.reports import (
    AgentPerformanceItem,
    AgentWorkloadReport,
    CategoryStat,
    DealPipelineItem,
    DealPipelineReport,
    DealStats,
    DealTypeSummary,
    DefaultedDealItem,
    FinancialReport,
    KycComplianceItem,
    KycComplianceReport,
    KycOverviewStats,
    LateInstallmentItem,
    ListingStats,
    MarketplaceHealthReport,
    MarketplaceListingItem,
    OverviewDashboard,
    PaymentAlerts,
    PaymentSummary,
)


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


# ─── 1. Overview Dashboard ────────────────────────────────────────────────────

async def get_overview_dashboard(db: asyncpg.Connection) -> OverviewDashboard:
    listings_row = await db.fetchrow("""
        SELECT
            COUNT(*)                                                  AS total,
            COUNT(*) FILTER (WHERE status = 'active')                 AS live,
            COUNT(*) FILTER (WHERE status = 'pending_verification')   AS pending_verification,
            COUNT(*) FILTER (WHERE status = 'pending_approval')       AS pending_approval,
            COUNT(*) FILTER (WHERE status = 'rejected')               AS rejected,
            COUNT(*) FILTER (WHERE status = 'delisted')               AS delisted
        FROM marketplace.products
        WHERE deleted_at IS NULL
    """)

    deals_row = await db.fetchrow("""
        SELECT
            COUNT(*)                                                              AS total,
            COUNT(*) FILTER (WHERE status = 'draft')                             AS draft,
            COUNT(*) FILTER (WHERE status = 'offer_sent')                        AS offer_sent,
            COUNT(*) FILTER (WHERE status = 'accepted')                          AS accepted,
            COUNT(*) FILTER (WHERE status = 'active')                            AS active,
            COUNT(*) FILTER (WHERE status = 'completed')                         AS completed,
            COUNT(*) FILTER (WHERE status = 'cancelled')                         AS cancelled,
            COUNT(*) FILTER (WHERE status = 'defaulted')                         AS defaulted,
            COUNT(*) FILTER (
                WHERE requires_second_approval = TRUE
                  AND second_approved_by IS NULL
                  AND status NOT IN ('cancelled', 'completed', 'defaulted')
            )                                                                     AS awaiting_second_approval
        FROM finance.deals
    """)

    # KYC profile-level stats (uses denormalised columns added in Phase 4)
    kyc_profile_row = await db.fetchrow("""
        SELECT
            COUNT(*)                                                                         AS total_buyers,
            COUNT(*) FILTER (
                WHERE kyc_status = 'approved'
                  AND kyc_expires_at IS NOT NULL
                  AND kyc_expires_at > NOW()
            )                                                                                AS active_kyc,
            COUNT(*) FILTER (
                WHERE kyc_status = 'expired'
                   OR (kyc_status = 'approved' AND kyc_expires_at <= NOW())
            )                                                                                AS expired_kyc,
            COUNT(*) FILTER (
                WHERE kyc_status = 'approved'
                  AND kyc_expires_at IS NOT NULL
                  AND kyc_expires_at > NOW()
                  AND kyc_expires_at <= NOW() + INTERVAL '30 days'
            )                                                                                AS expiring_soon
        FROM public.profiles
        WHERE 'buyer' = ANY(roles)
          AND is_active = TRUE
    """)

    pending_kyc_row = await db.fetchrow("""
        SELECT COUNT(*) AS pending_review
        FROM kyc.submissions
        WHERE status IN ('submitted', 'under_review')
    """)

    payments_row = await db.fetchrow("""
        SELECT
            COUNT(*) FILTER (WHERE verification_status = 'pending')  AS pending_verification,
            COUNT(*) FILTER (WHERE verification_status = 'disputed')  AS disputed
        FROM finance.deal_payments
    """)

    return OverviewDashboard(
        listings=ListingStats(**dict(listings_row)),
        deals=DealStats(**dict(deals_row)),
        kyc=KycOverviewStats(
            total_buyers=kyc_profile_row["total_buyers"],
            active_kyc=kyc_profile_row["active_kyc"],
            expired_kyc=kyc_profile_row["expired_kyc"],
            pending_review=pending_kyc_row["pending_review"],
            expiring_soon=kyc_profile_row["expiring_soon"],
        ),
        payment_alerts=PaymentAlerts(**dict(payments_row)),
        generated_at=_utcnow(),
    )


# ─── 2. Financial Report ──────────────────────────────────────────────────────

async def get_financial_report(
    db: asyncpg.Connection,
    from_date: date,
    to_date: date,
) -> FinancialReport:
    payment_row = await db.fetchrow("""
        SELECT
            COUNT(*)                                                                          AS total_payments,
            COUNT(*) FILTER (WHERE verification_status = 'verified')                          AS total_verified,
            COUNT(*) FILTER (WHERE verification_status = 'pending')                           AS total_pending,
            COUNT(*) FILTER (WHERE verification_status = 'disputed')                          AS total_disputed,
            COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'),          0) AS amount_verified,
            COALESCE(SUM(amount) FILTER (WHERE verification_status = 'pending'),           0) AS amount_pending,
            COALESCE(SUM(amount) FILTER (WHERE verification_status = 'disputed'),          0) AS amount_disputed
        FROM finance.deal_payments
        WHERE created_at::date BETWEEN $1 AND $2
    """, from_date, to_date)

    type_rows = await db.fetch("""
        SELECT
            d.deal_type,
            COUNT(DISTINCT d.id)                                                                  AS count,
            COALESCE(SUM(d.total_price), 0)                                                       AS total_value,
            COALESCE(SUM(dp.amount) FILTER (WHERE dp.verification_status = 'verified'), 0)        AS total_collected
        FROM finance.deals d
        LEFT JOIN finance.deal_payments dp ON dp.deal_id = d.id
        WHERE d.created_at::date BETWEEN $1 AND $2
        GROUP BY d.deal_type
        ORDER BY d.deal_type
    """, from_date, to_date)

    late_rows = await db.fetch("""
        SELECT
            d.id                                AS deal_id,
            d.deal_ref,
            p.full_name                         AS buyer_name,
            di.installment_number,
            di.due_date,
            di.amount_due                       AS total_due,
            (CURRENT_DATE - di.due_date)::int   AS days_overdue
        FROM finance.deal_installments di
        JOIN finance.deals d  ON d.id  = di.deal_id
        JOIN public.profiles p ON p.id = d.buyer_id
        WHERE di.status = 'overdue'
        ORDER BY days_overdue DESC
    """)

    defaulted_rows = await db.fetch("""
        SELECT
            d.id           AS deal_id,
            d.deal_ref,
            p.full_name    AS buyer_name,
            d.total_price,
            COALESCE(SUM(dp.amount) FILTER (WHERE dp.verification_status = 'verified'), 0)                  AS amount_collected,
            d.total_price - COALESCE(SUM(dp.amount) FILTER (WHERE dp.verification_status = 'verified'), 0)  AS outstanding
        FROM finance.deals d
        JOIN public.profiles p ON p.id = d.buyer_id
        LEFT JOIN finance.deal_payments dp ON dp.deal_id = d.id
        WHERE d.status = 'defaulted'
          AND d.created_at::date BETWEEN $1 AND $2
        GROUP BY d.id, d.deal_ref, p.full_name, d.total_price
        ORDER BY outstanding DESC
    """, from_date, to_date)

    return FinancialReport(
        period_from=from_date,
        period_to=to_date,
        payment_summary=PaymentSummary(**dict(payment_row)),
        by_deal_type=[DealTypeSummary(**dict(r)) for r in type_rows],
        late_installments=[LateInstallmentItem(**dict(r)) for r in late_rows],
        defaulted_deals=[DefaultedDealItem(**dict(r)) for r in defaulted_rows],
        generated_at=_utcnow(),
    )


# ─── 3. Deal Pipeline Report ──────────────────────────────────────────────────

async def get_deal_pipeline_report(
    db: asyncpg.Connection,
    from_date: date,
    to_date: date,
) -> DealPipelineReport:
    rows = await db.fetch("""
        SELECT
            d.id                                            AS deal_id,
            d.deal_ref,
            mp.title                                        AS product_title,
            buyer.full_name                                 AS buyer_name,
            seller.full_name                                AS seller_name,
            d.deal_type,
            d.total_price,
            d.currency,
            d.status,
            EXTRACT(DAY FROM (NOW() - d.updated_at))::int  AS days_in_status,
            d.requires_second_approval,
            (d.second_approved_by IS NOT NULL)              AS second_approved,
            d.created_at
        FROM finance.deals d
        JOIN marketplace.products mp ON mp.id = d.product_id
        JOIN public.profiles buyer   ON buyer.id  = d.buyer_id
        JOIN public.profiles seller  ON seller.id = d.seller_id
        WHERE d.created_at::date BETWEEN $1 AND $2
        ORDER BY d.created_at DESC
    """, from_date, to_date)

    deals = [DealPipelineItem(**dict(r)) for r in rows]

    by_status: dict[str, int] = {}
    for d in deals:
        by_status[d.status] = by_status.get(d.status, 0) + 1

    return DealPipelineReport(
        period_from=from_date,
        period_to=to_date,
        total=len(deals),
        by_status=by_status,
        deals=deals,
        generated_at=_utcnow(),
    )


# ─── 4. KYC Compliance Report ─────────────────────────────────────────────────

async def get_kyc_compliance_report(
    db: asyncpg.Connection,
    from_date: date,
    to_date: date,
) -> KycComplianceReport:
    rows = await db.fetch("""
        SELECT
            ks.id                       AS submission_id,
            ks.buyer_id,
            p.full_name                 AS buyer_name,
            COALESCE(u.email, '')       AS buyer_email,
            ks.status,
            ks.submitted_at,
            ks.decided_at,
            ks.expires_at,
            CASE
                WHEN ks.expires_at IS NOT NULL AND ks.expires_at > NOW()
                THEN EXTRACT(DAY FROM (ks.expires_at - NOW()))::int
                ELSE NULL
            END                         AS days_until_expiry,
            ks.rejection_reason,
            COALESCE(lr.is_pep, FALSE)           AS is_pep,
            COALESCE(lr.sanctions_match, FALSE)  AS sanctions_match
        FROM kyc.submissions ks
        JOIN public.profiles p  ON p.id  = ks.buyer_id
        LEFT JOIN auth.users u  ON u.id  = ks.buyer_id
        -- Latest review for PEP/sanctions flags
        LEFT JOIN LATERAL (
            SELECT is_pep, sanctions_match
            FROM kyc.reviews
            WHERE submission_id = ks.id
            ORDER BY created_at DESC
            LIMIT 1
        ) lr ON TRUE
        WHERE ks.created_at::date BETWEEN $1 AND $2
        ORDER BY ks.created_at DESC
    """, from_date, to_date)

    submissions = [KycComplianceItem(**dict(r)) for r in rows]

    by_status: dict[str, int] = {}
    for s in submissions:
        by_status[s.status] = by_status.get(s.status, 0) + 1

    expiring_30 = sum(
        1 for s in submissions
        if s.days_until_expiry is not None and s.days_until_expiry <= 30
    )

    return KycComplianceReport(
        period_from=from_date,
        period_to=to_date,
        total=len(submissions),
        by_status=by_status,
        expiring_within_30_days=expiring_30,
        submissions=submissions,
        generated_at=_utcnow(),
    )


# ─── 5. Marketplace Health Report ────────────────────────────────────────────

async def get_marketplace_health_report(
    db: asyncpg.Connection,
    from_date: date,
    to_date: date,
) -> MarketplaceHealthReport:
    rows = await db.fetch("""
        SELECT
            mp.id                                           AS product_id,
            mp.title,
            COALESCE(cat.name, 'Uncategorised')             AS category,
            seller.full_name                                AS seller_name,
            mp.status,
            mp.asking_price                                 AS price,
            mp.currency,
            EXTRACT(DAY FROM (NOW() - mp.updated_at))::int  AS days_in_status,
            agent.full_name                                  AS assigned_agent,
            mp.created_at
        FROM marketplace.products mp
        JOIN  public.profiles seller      ON seller.id = mp.seller_id
        LEFT JOIN marketplace.categories cat ON cat.id = mp.category_id
        -- Most recent verification assignment for this product
        LEFT JOIN LATERAL (
            SELECT agent_id FROM marketplace.verification_assignments
            WHERE product_id = mp.id
            ORDER BY created_at DESC
            LIMIT 1
        ) va ON TRUE
        LEFT JOIN public.profiles agent ON agent.id = va.agent_id
        WHERE mp.created_at::date BETWEEN $1 AND $2
          AND mp.deleted_at IS NULL
        ORDER BY mp.created_at DESC
    """, from_date, to_date)

    listings = [MarketplaceListingItem(**dict(r)) for r in rows]

    by_status: dict[str, int] = {}
    category_map: dict[str, dict] = {}
    for listing in listings:
        by_status[listing.status] = by_status.get(listing.status, 0) + 1
        cat = listing.category
        if cat not in category_map:
            category_map[cat] = {"category": cat, "total": 0, "active": 0, "pending": 0}
        category_map[cat]["total"] += 1
        if listing.status == "active":
            category_map[cat]["active"] += 1
        elif listing.status in ("pending_verification", "pending_approval"):
            category_map[cat]["pending"] += 1

    by_category = [
        CategoryStat(**v)
        for v in sorted(category_map.values(), key=lambda x: -x["total"])
    ]

    # Stuck = pending_verification or pending_approval for > 7 days
    stuck = [
        listing for listing in listings
        if listing.status in ("pending_verification", "pending_approval")
        and listing.days_in_status > 7
    ]

    return MarketplaceHealthReport(
        period_from=from_date,
        period_to=to_date,
        total_listings=len(listings),
        by_status=by_status,
        by_category=by_category,
        stuck_listings=stuck,
        generated_at=_utcnow(),
    )


# ─── 6. Agent Workload & Performance Report ───────────────────────────────────

async def get_agent_workload_report(
    db: asyncpg.Connection,
    from_date: date,
    to_date: date,
    agent_id: Optional[UUID] = None,
) -> AgentWorkloadReport:
    agent_clause = "AND p.id = $3" if agent_id else ""
    params = [from_date, to_date] + ([agent_id] if agent_id else [])

    rows = await db.fetch(f"""
        SELECT
            p.id                        AS agent_id,
            p.full_name                 AS agent_name,
            COALESCE(u.email, '')       AS agent_email,

            -- KYC: assigned in period
            (SELECT COUNT(*) FROM kyc.assignments ka
             WHERE ka.agent_id = p.id
               AND ka.created_at::date BETWEEN $1 AND $2
            )                           AS kyc_assigned,

            -- KYC: reviews submitted by agent in period
            (SELECT COUNT(*) FROM kyc.reviews kr
             WHERE kr.reviewer_id = p.id
               AND kr.reviewer_role = 'buyer_agent'
               AND kr.created_at::date BETWEEN $1 AND $2
            )                           AS kyc_reviewed,

            -- KYC: approved outcomes agent contributed to
            (SELECT COUNT(*) FROM kyc.reviews kr
             JOIN kyc.submissions ks ON ks.id = kr.submission_id
             WHERE kr.reviewer_id = p.id
               AND kr.reviewer_role = 'buyer_agent'
               AND ks.status = 'approved'
               AND ks.decided_at::date BETWEEN $1 AND $2
            )                           AS kyc_approved,

            -- KYC: rejected outcomes agent contributed to
            (SELECT COUNT(*) FROM kyc.reviews kr
             JOIN kyc.submissions ks ON ks.id = kr.submission_id
             WHERE kr.reviewer_id = p.id
               AND kr.reviewer_role = 'buyer_agent'
               AND ks.status = 'rejected'
               AND ks.decided_at::date BETWEEN $1 AND $2
            )                           AS kyc_rejected,

            -- Marketplace: listings assigned in period
            (SELECT COUNT(*) FROM marketplace.verification_assignments mva
             WHERE mva.agent_id = p.id
               AND mva.created_at::date BETWEEN $1 AND $2
            )                           AS listings_assigned,

            -- Marketplace: listings that went active (verified) in period
            (SELECT COUNT(*) FROM marketplace.verification_assignments mva
             JOIN marketplace.products mp ON mp.id = mva.product_id
             WHERE mva.agent_id = p.id
               AND mp.status = 'active'
               AND mva.updated_at::date BETWEEN $1 AND $2
            )                           AS listings_verified,

            -- Marketplace: listings that ended rejected in period
            (SELECT COUNT(*) FROM marketplace.verification_assignments mva
             JOIN marketplace.products mp ON mp.id = mva.product_id
             WHERE mva.agent_id = p.id
               AND mp.status = 'rejected'
               AND mva.updated_at::date BETWEEN $1 AND $2
            )                           AS listings_rejected,

            -- Avg KYC review time in hours
            (SELECT AVG(EXTRACT(EPOCH FROM (kr.created_at - ks.submitted_at)) / 3600.0)
             FROM kyc.reviews kr
             JOIN kyc.submissions ks ON ks.id = kr.submission_id
             WHERE kr.reviewer_id = p.id
               AND kr.reviewer_role = 'buyer_agent'
               AND ks.submitted_at IS NOT NULL
               AND kr.created_at::date BETWEEN $1 AND $2
            )                           AS avg_kyc_review_hours,

            -- Avg listing assignment-to-completion time in hours
            (SELECT AVG(EXTRACT(EPOCH FROM (mva.updated_at - mva.created_at)) / 3600.0)
             FROM marketplace.verification_assignments mva
             JOIN marketplace.products mp ON mp.id = mva.product_id
             WHERE mva.agent_id = p.id
               AND mp.status IN ('active', 'rejected')
               AND mva.updated_at::date BETWEEN $1 AND $2
            )                           AS avg_listing_review_hours

        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        WHERE 'verification_agent' = ANY(p.roles)
          AND p.is_active = TRUE
          {agent_clause}
        ORDER BY p.full_name
    """, *params)

    agents = [AgentPerformanceItem(**dict(r)) for r in rows]

    return AgentWorkloadReport(
        period_from=from_date,
        period_to=to_date,
        agents=agents,
        generated_at=_utcnow(),
    )


# ─── CSV Helper ───────────────────────────────────────────────────────────────

def to_csv_bytes(data: list[dict]) -> bytes:
    """Serialize a list of flat dicts to UTF-8 CSV bytes."""
    if not data:
        return b"no data\n"
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(data[0].keys()))
    writer.writeheader()
    writer.writerows(data)
    return output.getvalue().encode("utf-8")
