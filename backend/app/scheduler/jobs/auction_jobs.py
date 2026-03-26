"""
Phase 8B — Auction scheduled jobs.

run_open_scheduled_auctions:   Every 60s — transitions scheduled → live at start_time.
run_close_live_auctions:       Every 60s — closes live/closing_soon at end_time, determines winner.
run_auction_ending_soon_alerts: Every 30m — notifies active bidders 1 hour before close.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.core.audit import AuditAction, write_audit_log
from app.db.client import get_pool
from app.services import notification_service

logger = logging.getLogger(__name__)


async def run_open_scheduled_auctions() -> None:
    pool = await get_pool()
    async with pool.acquire() as db:
        now = datetime.now(timezone.utc)
        rows = await db.fetch(
            """
            SELECT id, title
            FROM marketplace.auctions
            WHERE status = 'scheduled' AND start_time <= $1
            """,
            now,
        )
        for row in rows:
            try:
                await db.execute(
                    """
                    UPDATE marketplace.auctions
                    SET status = 'live', updated_at = NOW()
                    WHERE id = $1 AND status = 'scheduled'
                    """,
                    row["id"],
                )
                logger.info("[auction_open] auction %s (%s) is now LIVE", row["id"], row["title"])
            except Exception as exc:
                logger.error("[auction_open] failed to open auction %s: %s", row["id"], exc)


async def run_close_live_auctions() -> None:
    pool = await get_pool()
    async with pool.acquire() as db:
        now = datetime.now(timezone.utc)
        rows = await db.fetch(
            """
            SELECT *
            FROM marketplace.auctions
            WHERE status IN ('live', 'closing_soon') AND end_time <= $1
            """,
            now,
        )
        for auction in rows:
            try:
                await _close_auction(db, auction, now)
            except Exception as exc:
                logger.error("[auction_close] failed to close auction %s: %s", auction["id"], exc)


async def _close_auction(db, auction, now: datetime) -> None:
    auction_id = auction["id"]

    # Determine outcome
    highest_bid = auction["current_highest_bid"]
    reserve     = auction["reserve_price"]
    winner_id   = auction["current_winner_id"]

    if highest_bid is None:
        new_status = "failed_no_bids"
        audit_action = AuditAction.AUCTION_FAILED_NO_BIDS
    elif reserve is not None and highest_bid < reserve:
        new_status = "failed_reserve_not_met"
        audit_action = AuditAction.AUCTION_FAILED_RESERVE
        winner_id = None   # no winner — reserve not met
    else:
        new_status = "winner_pending_approval"
        audit_action = AuditAction.AUCTION_WINNER_DECLARED

    await db.execute(
        """
        UPDATE marketplace.auctions
        SET status = $2, updated_at = NOW()
        WHERE id = $1
        """,
        auction_id, new_status,
    )

    await write_audit_log(
        db,
        actor_id=None,
        actor_roles=["system"],
        action=audit_action,
        resource_type="auction",
        resource_id=str(auction_id),
        new_state={
            "status": new_status,
            "highest_bid": str(highest_bid) if highest_bid else None,
            "winner_id": str(winner_id) if winner_id else None,
        },
    )

    logger.info("[auction_close] auction %s closed → %s", auction_id, new_status)

    # Load bidder contact details for notifications
    if new_status == "winner_pending_approval" and winner_id:
        winner_row = await db.fetchrow(
            """
            SELECT u.email, p.full_name, p.phone
            FROM auth.users u JOIN public.profiles p ON p.id = u.id
            WHERE u.id = $1
            """,
            winner_id,
        )
        if winner_row:
            await notification_service.notify_auction_winner_pending(
                winner_email=winner_row["email"],
                winner_name=winner_row["full_name"] or "",
                winner_phone=winner_row["phone"] or "",
                auction_title=auction["title"],
                winning_bid=str(highest_bid),
                currency=auction["currency"],
            )

    # Notify all losing bidders
    losers = await db.fetch(
        """
        SELECT DISTINCT ON (ab.bidder_id) ab.bidder_id, u.email, p.full_name
        FROM marketplace.auction_bids ab
        JOIN auth.users u       ON u.id = ab.bidder_id
        JOIN public.profiles p  ON p.id = ab.bidder_id
        WHERE ab.auction_id = $1
          AND ab.bidder_id IS DISTINCT FROM $2
        """,
        auction_id, winner_id,
    )
    for loser in losers:
        try:
            await notification_service.notify_auction_bid_lost(
                buyer_email=loser["email"],
                buyer_name=loser["full_name"] or "",
                auction_title=auction["title"],
                outcome=new_status,
            )
        except Exception as exc:
            logger.error("[auction_close] loser notify failed for %s: %s", loser["bidder_id"], exc)


async def run_auction_ending_soon_alerts() -> None:
    """Alert active bidders when an auction closes within the next hour."""
    pool = await get_pool()
    async with pool.acquire() as db:
        now = datetime.now(timezone.utc)
        window_start = now + timedelta(minutes=50)
        window_end   = now + timedelta(minutes=70)

        auctions = await db.fetch(
            """
            SELECT id, title, end_time, currency, current_highest_bid
            FROM marketplace.auctions
            WHERE status IN ('live', 'closing_soon')
              AND end_time >= $1
              AND end_time <  $2
            """,
            window_start, window_end,
        )

        for auction in auctions:
            bidders = await db.fetch(
                """
                SELECT DISTINCT ON (ab.bidder_id) ab.bidder_id, u.email, p.full_name
                FROM marketplace.auction_bids ab
                JOIN auth.users u      ON u.id = ab.bidder_id
                JOIN public.profiles p ON p.id = ab.bidder_id
                WHERE ab.auction_id = $1
                """,
                auction["id"],
            )
            for bidder in bidders:
                try:
                    await notification_service.notify_auction_ending_soon(
                        buyer_email=bidder["email"],
                        buyer_name=bidder["full_name"] or "",
                        auction_title=auction["title"],
                        end_time=auction["end_time"].strftime("%d %b %Y %H:%M UTC"),
                        current_bid=str(auction["current_highest_bid"] or 0),
                        currency=auction["currency"],
                    )
                except Exception as exc:
                    logger.error(
                        "[auction_ending_soon] notify failed for bidder %s: %s",
                        bidder["bidder_id"], exc,
                    )
