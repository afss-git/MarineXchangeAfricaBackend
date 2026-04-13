"""
Phase 8B — Auction Service Layer.

Business logic for:
  - Admin: create, edit, schedule, cancel, approve/reject winner, convert to deal
  - Public/Buyer: list, view, place bid, view bid history
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

import asyncpg
from fastapi import HTTPException, status

from app.core.audit import AuditAction, write_audit_log
from app.schemas.auctions import (
    AdminAuctionDetail,
    AdminAuctionList,
    AdminAuctionListItem,
    AuctionConvertResponse,
    BidItem,
    MyBidItem,
    MyBidList,
    PlaceBidResponse,
    PublicAuctionDetail,
    PublicAuctionList,
    PublicAuctionListItem,
    PublicBidItem,
)
from app.services import notification_service
from app.services.deal_service import generate_deal_ref

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# PRIVATE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _reserve_status(auction: asyncpg.Record) -> str:
    if auction["reserve_price"] is None:
        return "no_reserve"
    current = auction["current_highest_bid"]
    if current is None or current < auction["reserve_price"]:
        return "reserve_not_met"
    return "reserve_met"


def _min_next_bid(auction: asyncpg.Record) -> Decimal:
    current = auction["current_highest_bid"]
    if current is None:
        return Decimal(str(auction["starting_bid"]))
    return Decimal(str(current)) + Decimal(str(auction["min_bid_increment_usd"]))


def _increment_pct(auction: asyncpg.Record) -> str:
    base = auction["current_highest_bid"] or auction["starting_bid"]
    if base and base > 0:
        pct = float(auction["min_bid_increment_usd"]) / float(base) * 100
        return f"{pct:.1f}%"
    return "N/A"


def _time_remaining(auction: asyncpg.Record) -> int:
    end = auction["end_time"]
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    delta = (end - datetime.now(timezone.utc)).total_seconds()
    return max(0, int(delta))


def _to_public_list_item(
    auction: asyncpg.Record, bid_count: int
) -> PublicAuctionListItem:
    return PublicAuctionListItem(
        id=auction["id"],
        product_id=auction["product_id"],
        product_title=auction.get("product_title"),
        title=auction["title"],
        status=auction["status"],
        currency=auction["currency"],
        starting_bid=auction["starting_bid"],
        current_highest_bid=auction["current_highest_bid"],
        reserve_status=_reserve_status(auction),
        min_next_bid=_min_next_bid(auction),
        bid_count=bid_count,
        end_time=auction["end_time"],
        time_remaining_seconds=_time_remaining(auction),
        extensions_count=auction["extensions_count"],
    )


async def _load_bids(db: asyncpg.Connection, auction_id: UUID, limit: int = 0) -> list:
    q = """
        SELECT ab.id, ab.bidder_id, ab.amount, ab.currency,
               ab.is_winning_bid, ab.bid_time,
               p.company_name AS bidder_company
        FROM marketplace.auction_bids ab
        LEFT JOIN public.profiles p ON p.id = ab.bidder_id
        WHERE ab.auction_id = $1
        ORDER BY ab.amount DESC, ab.bid_time DESC
    """
    args: list = [auction_id]
    if limit:
        # SECURITY: LIMIT parameterized — never interpolated directly
        q += f" LIMIT $2"
        args.append(limit)
    return await db.fetch(q, *args)


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN OPERATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def admin_create_auction(
    db: asyncpg.Connection,
    admin: dict,
    body,
) -> AdminAuctionDetail:
    # Verify product exists and is active
    product = await db.fetchrow(
        "SELECT id, title, status FROM marketplace.products WHERE id = $1",
        body.product_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found.")
    if product["status"] not in ("active", "under_offer"):
        raise HTTPException(
            status_code=400,
            detail="Product must be active to create an auction.",
        )

    row = await db.fetchrow(
        """
        INSERT INTO marketplace.auctions
            (product_id, created_by, title, description,
             starting_bid, reserve_price, currency, min_bid_increment_usd,
             start_time, end_time, original_end_time,
             auto_extend_minutes, max_extensions, admin_notes, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,'draft')
        RETURNING *
        """,
        body.product_id, admin["id"], body.title, body.description,
        body.starting_bid, body.reserve_price, body.currency, body.min_bid_increment_usd,
        body.start_time, body.end_time,
        body.auto_extend_minutes, body.max_extensions, body.admin_notes,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.AUCTION_CREATED,
        resource_type="auction",
        resource_id=str(row["id"]),
        new_state={"title": body.title, "product_id": str(body.product_id), "status": "draft"},
    )

    return await admin_get_auction(db, row["id"])


async def admin_update_auction(
    db: asyncpg.Connection,
    admin: dict,
    auction_id: UUID,
    body,
) -> AdminAuctionDetail:
    auction = await db.fetchrow(
        "SELECT * FROM marketplace.auctions WHERE id = $1", auction_id
    )
    if not auction:
        raise HTTPException(status_code=404, detail="Auction not found.")
    if auction["status"] != "draft":
        raise HTTPException(
            status_code=400,
            detail="Only draft auctions can be edited.",
        )

    updates: dict = {}
    if body.title is not None:               updates["title"]                  = body.title
    if body.description is not None:         updates["description"]             = body.description
    if body.starting_bid is not None:        updates["starting_bid"]            = body.starting_bid
    if body.reserve_price is not None:       updates["reserve_price"]           = body.reserve_price
    if body.min_bid_increment_usd is not None: updates["min_bid_increment_usd"] = body.min_bid_increment_usd
    if body.start_time is not None:          updates["start_time"]              = body.start_time
    if body.end_time is not None:
        updates["end_time"]          = body.end_time
        updates["original_end_time"] = body.end_time
    if body.auto_extend_minutes is not None: updates["auto_extend_minutes"]     = body.auto_extend_minutes
    if body.max_extensions is not None:      updates["max_extensions"]          = body.max_extensions
    if body.admin_notes is not None:         updates["admin_notes"]             = body.admin_notes

    if not updates:
        return await admin_get_auction(db, auction_id)

    _ALLOWED_AUCTION_COLS = frozenset({
        "title", "description", "starting_bid", "reserve_price", "min_bid_increment_usd",
        "start_time", "end_time", "original_end_time", "auto_extend_minutes",
        "max_extensions", "admin_notes",
    })
    if not updates.keys() <= _ALLOWED_AUCTION_COLS:
        raise ValueError(f"Invalid column(s): {updates.keys() - _ALLOWED_AUCTION_COLS}")

    set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates))
    await db.execute(
        f"UPDATE marketplace.auctions SET {set_clause}, updated_at = NOW() WHERE id = $1",
        auction_id, *updates.values(),
    )
    return await admin_get_auction(db, auction_id)


async def admin_schedule_auction(
    db: asyncpg.Connection,
    admin: dict,
    auction_id: UUID,
) -> AdminAuctionDetail:
    auction = await db.fetchrow(
        "SELECT * FROM marketplace.auctions WHERE id = $1", auction_id
    )
    if not auction:
        raise HTTPException(status_code=404, detail="Auction not found.")
    if auction["status"] != "draft":
        raise HTTPException(status_code=400, detail="Only draft auctions can be scheduled.")

    now = datetime.now(timezone.utc)
    start = auction["start_time"]
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if start <= now:
        raise HTTPException(
            status_code=400,
            detail="start_time must be in the future to schedule.",
        )

    await db.execute(
        "UPDATE marketplace.auctions SET status = 'scheduled', updated_at = NOW() WHERE id = $1",
        auction_id,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.AUCTION_SCHEDULED,
        resource_type="auction",
        resource_id=str(auction_id),
        new_state={"status": "scheduled", "start_time": str(auction["start_time"])},
    )

    return await admin_get_auction(db, auction_id)


async def admin_cancel_auction(
    db: asyncpg.Connection,
    admin: dict,
    auction_id: UUID,
    reason: Optional[str],
) -> AdminAuctionDetail:
    auction = await db.fetchrow(
        "SELECT status FROM marketplace.auctions WHERE id = $1", auction_id
    )
    if not auction:
        raise HTTPException(status_code=404, detail="Auction not found.")
    if auction["status"] not in ("draft", "scheduled"):
        raise HTTPException(
            status_code=400,
            detail="Only draft or scheduled auctions can be cancelled.",
        )

    await db.execute(
        """
        UPDATE marketplace.auctions
        SET status = 'cancelled', admin_notes = $2, updated_at = NOW()
        WHERE id = $1
        """,
        auction_id, reason,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.AUCTION_CANCELLED,
        resource_type="auction",
        resource_id=str(auction_id),
        new_state={"status": "cancelled", "reason": reason},
    )

    return await admin_get_auction(db, auction_id)


async def admin_get_auction(
    db: asyncpg.Connection,
    auction_id: UUID,
) -> AdminAuctionDetail:
    row = await db.fetchrow(
        """
        SELECT a.*, mp.title AS product_title,
               pw.company_name AS winner_company
        FROM marketplace.auctions a
        LEFT JOIN marketplace.products mp ON mp.id = a.product_id
        LEFT JOIN public.profiles pw      ON pw.id = a.current_winner_id
        WHERE a.id = $1
        """,
        auction_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Auction not found.")

    bid_rows = await _load_bids(db, auction_id)
    bids = [
        BidItem(
            id=b["id"],
            bidder_id=b["bidder_id"],
            bidder_company=b["bidder_company"],
            amount=b["amount"],
            currency=b["currency"],
            is_winning_bid=b["is_winning_bid"],
            bid_time=b["bid_time"],
        )
        for b in bid_rows
    ]

    return AdminAuctionDetail(
        id=row["id"],
        product_id=row["product_id"],
        product_title=row.get("product_title"),
        created_by=row["created_by"],
        title=row["title"],
        description=row.get("description"),
        starting_bid=row["starting_bid"],
        reserve_price=row.get("reserve_price"),
        currency=row["currency"],
        min_bid_increment_usd=row["min_bid_increment_usd"],
        start_time=row["start_time"],
        end_time=row["end_time"],
        original_end_time=row["original_end_time"],
        auto_extend_minutes=row["auto_extend_minutes"],
        max_extensions=row["max_extensions"],
        extensions_count=row["extensions_count"],
        current_highest_bid=row.get("current_highest_bid"),
        current_winner_id=row.get("current_winner_id"),
        winner_company=row.get("winner_company"),
        winner_approved_by=row.get("winner_approved_by"),
        winner_approved_at=row.get("winner_approved_at"),
        winner_rejection_reason=row.get("winner_rejection_reason"),
        converted_deal_id=row.get("converted_deal_id"),
        status=row["status"],
        admin_notes=row.get("admin_notes"),
        bid_count=len(bids),
        bids=bids,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def admin_list_auctions(
    db: asyncpg.Connection,
    status_filter: Optional[str] = None,
    product_id_filter: Optional[UUID] = None,
) -> AdminAuctionList:
    conditions = []
    params: list = []

    if status_filter:
        params.append(status_filter)
        conditions.append(f"a.status = ${len(params)}")
    if product_id_filter:
        params.append(product_id_filter)
        conditions.append(f"a.product_id = ${len(params)}")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    rows = await db.fetch(
        f"""
        SELECT a.*, mp.title AS product_title,
               (SELECT COUNT(*) FROM marketplace.auction_bids ab WHERE ab.auction_id = a.id) AS bid_count
        FROM marketplace.auctions a
        LEFT JOIN marketplace.products mp ON mp.id = a.product_id
        {where}
        ORDER BY a.created_at DESC
        """,
        *params,
    )

    items = [
        AdminAuctionListItem(
            id=r["id"],
            product_id=r["product_id"],
            product_title=r.get("product_title"),
            title=r["title"],
            status=r["status"],
            currency=r["currency"],
            starting_bid=r["starting_bid"],
            current_highest_bid=r.get("current_highest_bid"),
            bid_count=r["bid_count"],
            start_time=r["start_time"],
            end_time=r["end_time"],
            extensions_count=r["extensions_count"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return AdminAuctionList(items=items, total=len(items))


async def admin_approve_winner(
    db: asyncpg.Connection,
    admin: dict,
    auction_id: UUID,
    admin_notes: Optional[str],
) -> AdminAuctionDetail:
    auction = await db.fetchrow(
        "SELECT * FROM marketplace.auctions WHERE id = $1", auction_id
    )
    if not auction:
        raise HTTPException(status_code=404, detail="Auction not found.")
    if auction["status"] != "winner_pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve winner — status is '{auction['status']}'.",
        )

    await db.execute(
        """
        UPDATE marketplace.auctions
        SET status = 'winner_approved',
            winner_approved_by = $2,
            winner_approved_at = NOW(),
            admin_notes = COALESCE($3, admin_notes),
            updated_at = NOW()
        WHERE id = $1
        """,
        auction_id, admin["id"], admin_notes,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.AUCTION_WINNER_APPROVED,
        resource_type="auction",
        resource_id=str(auction_id),
        new_state={"status": "winner_approved", "winner_id": str(auction["current_winner_id"])},
    )

    # Notify winner
    if auction["current_winner_id"]:
        winner_row = await db.fetchrow(
            "SELECT u.email, p.full_name, p.phone FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=$1",
            auction["current_winner_id"],
        )
        if winner_row:
            asyncio.create_task(notification_service.notify_auction_winner_approved(
                winner_email=winner_row["email"],
                winner_name=winner_row["full_name"] or "",
                winner_phone=winner_row["phone"] or "",
                auction_title=auction["title"],
                winning_bid=str(auction["current_highest_bid"]),
                currency=auction["currency"],
            ))

    return await admin_get_auction(db, auction_id)


async def admin_reject_winner(
    db: asyncpg.Connection,
    admin: dict,
    auction_id: UUID,
    reason: str,
) -> AdminAuctionDetail:
    auction = await db.fetchrow(
        "SELECT * FROM marketplace.auctions WHERE id = $1", auction_id
    )
    if not auction:
        raise HTTPException(status_code=404, detail="Auction not found.")
    if auction["status"] != "winner_pending_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject winner — status is '{auction['status']}'.",
        )

    await db.execute(
        """
        UPDATE marketplace.auctions
        SET status = 'winner_rejected',
            winner_rejection_reason = $2,
            updated_at = NOW()
        WHERE id = $1
        """,
        auction_id, reason,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.AUCTION_WINNER_REJECTED,
        resource_type="auction",
        resource_id=str(auction_id),
        new_state={"status": "winner_rejected", "reason": reason},
    )

    if auction["current_winner_id"]:
        winner_row = await db.fetchrow(
            "SELECT u.email, p.full_name FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=$1",
            auction["current_winner_id"],
        )
        if winner_row:
            asyncio.create_task(notification_service.notify_auction_winner_rejected(
                winner_email=winner_row["email"],
                winner_name=winner_row["full_name"] or "",
                auction_title=auction["title"],
                reason=reason,
            ))

    return await admin_get_auction(db, auction_id)


async def admin_convert_to_deal(
    db: asyncpg.Connection,
    admin: dict,
    auction_id: UUID,
    deal_type: str,
    admin_notes: Optional[str],
) -> AuctionConvertResponse:
    auction = await db.fetchrow(
        "SELECT * FROM marketplace.auctions WHERE id = $1", auction_id
    )
    if not auction:
        raise HTTPException(status_code=404, detail="Auction not found.")
    if auction["status"] != "winner_approved":
        raise HTTPException(
            status_code=400,
            detail=f"Only 'winner_approved' auctions can be converted. Current: '{auction['status']}'.",
        )
    if not auction["current_winner_id"] or not auction["current_highest_bid"]:
        raise HTTPException(status_code=400, detail="No valid winner found on auction.")

    product = await db.fetchrow(
        "SELECT seller_id FROM marketplace.products WHERE id = $1", auction["product_id"]
    )
    if not product:
        raise HTTPException(status_code=400, detail="Product not found.")

    deal_ref = await generate_deal_ref(db)

    deal_row = await db.fetchrow(
        """
        INSERT INTO finance.deals
            (deal_ref, product_id, buyer_id, seller_id,
             deal_type, total_price, currency, status, admin_notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9)
        RETURNING id, deal_ref, status
        """,
        deal_ref,
        auction["product_id"],
        auction["current_winner_id"],
        product["seller_id"],
        deal_type,
        auction["current_highest_bid"],
        auction["currency"],
        admin_notes,
        admin["id"],
    )

    await db.execute(
        """
        UPDATE marketplace.auctions
        SET status = 'converted', converted_deal_id = $2, updated_at = NOW()
        WHERE id = $1
        """,
        auction_id, deal_row["id"],
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.AUCTION_CONVERTED,
        resource_type="auction",
        resource_id=str(auction_id),
        new_state={"status": "converted", "deal_id": str(deal_row["id"]), "deal_ref": deal_ref},
    )

    return AuctionConvertResponse(
        deal_id=deal_row["id"],
        deal_ref=deal_row["deal_ref"],
        deal_status=deal_row["status"],
        auction_id=auction_id,
        message=f"Auction converted to DRAFT deal {deal_ref}. Configure terms in the Deals module.",
    )


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC / BUYER OPERATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def public_list_auctions(
    db: asyncpg.Connection,
    status_filter: Optional[str] = None,
) -> PublicAuctionList:
    statuses = [status_filter] if status_filter else ["live", "closing_soon", "scheduled"]
    rows = await db.fetch(
        """
        SELECT a.*, mp.title AS product_title,
               (SELECT COUNT(*) FROM marketplace.auction_bids ab WHERE ab.auction_id = a.id) AS bid_count
        FROM marketplace.auctions a
        LEFT JOIN marketplace.products mp ON mp.id = a.product_id
        WHERE a.status = ANY($1::text[])
        ORDER BY a.end_time ASC
        """,
        statuses,
    )

    items = [_to_public_list_item(r, r["bid_count"]) for r in rows]
    return PublicAuctionList(items=items, total=len(items))


async def public_get_auction(
    db: asyncpg.Connection,
    auction_id: UUID,
) -> PublicAuctionDetail:
    row = await db.fetchrow(
        """
        SELECT a.*, mp.title AS product_title
        FROM marketplace.auctions a
        LEFT JOIN marketplace.products mp ON mp.id = a.product_id
        WHERE a.id = $1
        """,
        auction_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Auction not found.")

    bid_rows = await _load_bids(db, auction_id, limit=5)
    recent_bids = [
        PublicBidItem(
            id=b["id"],
            bidder_company=b["bidder_company"],
            amount=b["amount"],
            currency=b["currency"],
            is_winning_bid=b["is_winning_bid"],
            bid_time=b["bid_time"],
        )
        for b in bid_rows
    ]

    total_bids = await db.fetchval(
        "SELECT COUNT(*) FROM marketplace.auction_bids WHERE auction_id = $1", auction_id
    )

    return PublicAuctionDetail(
        id=row["id"],
        product_id=row["product_id"],
        product_title=row.get("product_title"),
        title=row["title"],
        description=row.get("description"),
        currency=row["currency"],
        starting_bid=row["starting_bid"],
        min_bid_increment_usd=row["min_bid_increment_usd"],
        min_bid_increment_pct=_increment_pct(row),
        min_next_bid=_min_next_bid(row),
        current_highest_bid=row.get("current_highest_bid"),
        reserve_status=_reserve_status(row),
        status=row["status"],
        start_time=row["start_time"],
        end_time=row["end_time"],
        original_end_time=row["original_end_time"],
        auto_extend_minutes=row["auto_extend_minutes"],
        max_extensions=row["max_extensions"],
        extensions_count=row["extensions_count"],
        time_remaining_seconds=_time_remaining(row),
        bid_count=total_bids or 0,
        recent_bids=recent_bids,
        created_at=row["created_at"],
    )


async def place_bid(
    db: asyncpg.Connection,
    bidder: dict,
    auction_id: UUID,
    amount: Decimal,
) -> PlaceBidResponse:
    bidder_id = bidder["id"]

    # Serialise concurrent bids with a PostgreSQL advisory lock on the auction id
    lock_key = hash(str(auction_id)) % (2 ** 31)
    await db.execute("SELECT pg_advisory_xact_lock($1)", lock_key)

    auction = await db.fetchrow(
        "SELECT * FROM marketplace.auctions WHERE id = $1 FOR UPDATE", auction_id
    )
    if not auction:
        raise HTTPException(status_code=404, detail="Auction not found.")
    if auction["status"] not in ("live", "closing_soon"):
        raise HTTPException(
            status_code=400,
            detail=f"Auction is not accepting bids (status: {auction['status']}).",
        )

    now = datetime.now(timezone.utc)
    end = auction["end_time"]
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if now >= end:
        raise HTTPException(status_code=400, detail="Auction has already closed.")

    # Validate minimum bid
    min_bid = _min_next_bid(auction)
    if amount < min_bid:
        raise HTTPException(
            status_code=400,
            detail=f"Bid must be at least {auction['currency']} {min_bid:,.2f}.",
        )

    # Prevent bidding against yourself
    if str(auction["current_winner_id"]) == str(bidder_id):
        raise HTTPException(status_code=400, detail="You are already the highest bidder.")

    previous_winner_id = auction["current_winner_id"]

    # Unmark previous winning bid
    if previous_winner_id:
        await db.execute(
            """
            UPDATE marketplace.auction_bids
            SET is_winning_bid = FALSE
            WHERE auction_id = $1 AND is_winning_bid = TRUE
            """,
            auction_id,
        )

    # Insert new bid
    bid_row = await db.fetchrow(
        """
        INSERT INTO marketplace.auction_bids
            (auction_id, bidder_id, amount, currency, is_winning_bid, ip_address)
        VALUES ($1, $2, $3, $4, TRUE, $5)
        RETURNING *
        """,
        auction_id, bidder_id, amount, auction["currency"],
        bidder.get("_client_ip"),
    )

    # Auto-extend logic
    new_end_time = end
    extended = False
    new_extensions = auction["extensions_count"]
    new_status = auction["status"]

    time_to_close = (end - now).total_seconds()
    extend_window = auction["auto_extend_minutes"] * 60

    if time_to_close <= extend_window and new_extensions < auction["max_extensions"]:
        from datetime import timedelta
        new_end_time = now + timedelta(minutes=auction["auto_extend_minutes"])
        new_extensions += 1
        new_status = "closing_soon"
        extended = True

    # Update auction denormalised state
    await db.execute(
        """
        UPDATE marketplace.auctions
        SET current_highest_bid = $2,
            current_winner_id   = $3,
            end_time            = $4,
            extensions_count    = $5,
            status              = $6,
            updated_at          = NOW()
        WHERE id = $1
        """,
        auction_id, amount, bidder_id, new_end_time, new_extensions, new_status,
    )

    await write_audit_log(
        db,
        actor_id=bidder_id,
        actor_roles=bidder.get("roles", []),
        action=AuditAction.AUCTION_BID_PLACED,
        resource_type="auction",
        resource_id=str(auction_id),
        new_state={"amount": str(amount), "extended": extended, "new_end_time": str(new_end_time)},
    )

    if extended:
        await write_audit_log(
            db,
            actor_id=None,
            actor_roles=["system"],
            action=AuditAction.AUCTION_EXTENDED,
            resource_type="auction",
            resource_id=str(auction_id),
            new_state={"new_end_time": str(new_end_time), "extensions_count": new_extensions},
        )

    # Notify outbid bidder
    if previous_winner_id and str(previous_winner_id) != str(bidder_id):
        outbid_row = await db.fetchrow(
            "SELECT u.email, p.full_name, p.phone FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=$1",
            previous_winner_id,
        )
        if outbid_row:
            asyncio.create_task(notification_service.notify_outbid(
                buyer_email=outbid_row["email"],
                buyer_name=outbid_row["full_name"] or "",
                buyer_phone=outbid_row["phone"] or "",
                auction_title=auction["title"],
                new_bid=str(amount),
                currency=auction["currency"],
                min_next_bid=str(amount + Decimal(str(auction["min_bid_increment_usd"]))),
                end_time=new_end_time.strftime("%d %b %Y %H:%M UTC"),
            ))

    # Determine updated reserve_status for response
    updated_auction = await db.fetchrow(
        "SELECT * FROM marketplace.auctions WHERE id = $1", auction_id
    )

    return PlaceBidResponse(
        bid_id=bid_row["id"],
        auction_id=auction_id,
        amount=bid_row["amount"],
        currency=bid_row["currency"],
        is_winning_bid=True,
        bid_time=bid_row["bid_time"],
        new_end_time=new_end_time,
        extended=extended,
        extensions_count=new_extensions,
        min_next_bid=_min_next_bid(updated_auction),
        reserve_status=_reserve_status(updated_auction),
    )


async def get_auction_bids(
    db: asyncpg.Connection,
    auction_id: UUID,
) -> list[PublicBidItem]:
    # Verify auction exists
    exists = await db.fetchval(
        "SELECT 1 FROM marketplace.auctions WHERE id = $1", auction_id
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Auction not found.")

    bid_rows = await _load_bids(db, auction_id)
    return [
        PublicBidItem(
            id=b["id"],
            bidder_company=b["bidder_company"],
            amount=b["amount"],
            currency=b["currency"],
            is_winning_bid=b["is_winning_bid"],
            bid_time=b["bid_time"],
        )
        for b in bid_rows
    ]


async def get_my_bids(
    db: asyncpg.Connection,
    bidder_id: UUID,
    auction_id: Optional[UUID] = None,
) -> MyBidList:
    where = "WHERE ab.bidder_id = $1"
    params: list = [bidder_id]
    if auction_id:
        params.append(auction_id)
        where += f" AND ab.auction_id = ${len(params)}"

    rows = await db.fetch(
        f"""
        SELECT ab.*, a.title AS auction_title
        FROM marketplace.auction_bids ab
        LEFT JOIN marketplace.auctions a ON a.id = ab.auction_id
        {where}
        ORDER BY ab.bid_time DESC
        """,
        *params,
    )

    items = [
        MyBidItem(
            id=r["id"],
            auction_id=r["auction_id"],
            auction_title=r.get("auction_title"),
            amount=r["amount"],
            currency=r["currency"],
            is_winning_bid=r["is_winning_bid"],
            bid_time=r["bid_time"],
        )
        for r in rows
    ]
    return MyBidList(items=items, total=len(items))
