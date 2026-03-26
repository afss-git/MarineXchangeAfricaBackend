"""
Phase 8A — Deal scheduled jobs.

run_deal_offer_timeout: Daily 06:00 UTC
  Auto-cancels deals stuck in 'offer_sent' status after the payment_deadline has passed.
  Buyer is notified. Audit logged.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.core.audit import AuditAction, write_audit_log
from app.db.client import get_pool
from app.services import notification_service

logger = logging.getLogger(__name__)


async def run_deal_offer_timeout() -> None:
    logger.info("[deal_offer_timeout] job started")
    pool = await get_pool()
    async with pool.acquire() as db:
        await _timeout_expired_offers(db)
    logger.info("[deal_offer_timeout] job finished")


async def _timeout_expired_offers(db) -> None:
    now = datetime.now(timezone.utc)

    rows = await db.fetch(
        """
        SELECT
            d.id, d.deal_ref, d.buyer_id, d.currency, d.total_price,
            d.payment_deadline,
            p.full_name  AS buyer_name,
            p.phone      AS buyer_phone,
            u.email      AS buyer_email
        FROM finance.deals d
        JOIN public.profiles p ON p.id = d.buyer_id
        JOIN auth.users u      ON u.id = d.buyer_id
        WHERE d.status           = 'offer_sent'
          AND d.payment_deadline IS NOT NULL
          AND d.payment_deadline < $1
        """,
        now,
    )

    logger.info("[deal_offer_timeout] %d expired offers found", len(rows))

    for row in rows:
        try:
            await db.execute(
                """
                UPDATE finance.deals
                SET status = 'cancelled',
                    cancellation_reason = 'Offer expired — buyer did not respond within the deadline.',
                    updated_at = NOW()
                WHERE id = $1 AND status = 'offer_sent'
                """,
                row["id"],
            )

            await write_audit_log(
                db,
                actor_id=None,
                actor_roles=["system"],
                action=AuditAction.FINANCE_REQUEST_EXPIRED,
                resource_type="deal",
                resource_id=str(row["id"]),
                old_state={"status": "offer_sent"},
                new_state={"status": "cancelled", "reason": "offer_deadline_exceeded"},
            )

            await notification_service.notify_buyer_deal_expired(
                buyer_email=row["buyer_email"],
                buyer_name=row["buyer_name"] or "",
                deal_ref=row["deal_ref"],
            )

        except Exception as exc:
            logger.error(
                "[deal_offer_timeout] failed to expire deal %s: %s",
                row["id"], exc,
            )
