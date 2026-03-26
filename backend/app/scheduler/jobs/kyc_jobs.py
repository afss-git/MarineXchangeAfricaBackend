"""
Phase 8A — KYC scheduled jobs.

run_kyc_expiry_warnings: Daily 08:00 UTC
  Finds buyers whose KYC expires in exactly 30 days or 7 days and sends a warning email.
  Uses a ±12h window around the target day to tolerate job drift.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.db.client import get_pool
from app.services import notification_service

logger = logging.getLogger(__name__)


async def run_kyc_expiry_warnings() -> None:
    logger.info("[kyc_expiry_warnings] job started")
    pool = await get_pool()
    async with pool.acquire() as db:
        await _warn_expiring_kyc(db)
    logger.info("[kyc_expiry_warnings] job finished")


async def _warn_expiring_kyc(db) -> None:
    now = datetime.now(timezone.utc)

    for days in (30, 7):
        target_start = now + timedelta(days=days) - timedelta(hours=12)
        target_end   = now + timedelta(days=days) + timedelta(hours=12)

        rows = await db.fetch(
            """
            SELECT p.id, p.full_name, p.kyc_expires_at, u.email
            FROM public.profiles p
            JOIN auth.users u ON u.id = p.id
            WHERE p.kyc_status = 'approved'
              AND p.kyc_expires_at >= $1
              AND p.kyc_expires_at <  $2
              AND p.is_active = TRUE
            """,
            target_start,
            target_end,
        )

        logger.info("[kyc_expiry_warnings] %d buyers expiring in ~%d days", len(rows), days)

        for row in rows:
            try:
                await notification_service.send_kyc_expiry_warning(
                    buyer_email=row["email"],
                    buyer_name=row["full_name"] or "",
                    days_remaining=days,
                    expires_at=row["kyc_expires_at"].strftime("%d %b %Y"),
                )
            except Exception as exc:
                logger.error(
                    "[kyc_expiry_warnings] failed to notify buyer %s: %s",
                    row["id"], exc,
                )
