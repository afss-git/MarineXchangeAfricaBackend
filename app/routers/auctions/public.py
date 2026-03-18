"""
Phase 8B — Public / Buyer auction endpoints.

GET  /auctions                    — catalog (live + scheduled)
GET  /auctions/{id}               — live view: bid, reserve status, time remaining
GET  /auctions/{id}/bids          — full bid history (company names only)
GET  /auctions/{id}/bids/my       — my bids on this auction (KYC buyer)
GET  /auctions/bids/my            — all my bids across all auctions (KYC buyer)
POST /auctions/{id}/bids          — place a bid (KYC required)
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query

from app.deps import BuyerUser, DbConn, KycBuyer
from app.schemas.auctions import (
    MyBidList,
    PlaceBidRequest,
    PlaceBidResponse,
    PublicAuctionDetail,
    PublicAuctionList,
    PublicBidItem,
)
from app.services import auction_service

router = APIRouter(tags=["Auctions — Public"])


@router.get(
    "/bids/my",
    response_model=MyBidList,
    summary="All my bids across all auctions",
)
async def my_all_bids(
    db: DbConn,
    current_user: BuyerUser,
):
    """View your full bid history across every auction you have participated in."""
    return await auction_service.get_my_bids(db, current_user["id"])


@router.get(
    "/",
    response_model=PublicAuctionList,
    summary="Browse live and upcoming auctions",
)
async def list_auctions(
    db: DbConn,
    status: Optional[str] = Query(
        default=None,
        description="Filter by status: live, closing_soon, scheduled. Defaults to all three.",
    ),
):
    """
    Returns all live, closing_soon, and scheduled auctions.
    Reserve prices are never included — buyers see only `reserve_status`.
    """
    return await auction_service.public_list_auctions(db, status)


@router.get(
    "/{auction_id}",
    response_model=PublicAuctionDetail,
    summary="View auction details — real-time bid state, time remaining, reserve status",
)
async def get_auction(
    auction_id: UUID,
    db: DbConn,
):
    return await auction_service.public_get_auction(db, auction_id)


@router.post(
    "/{auction_id}/bids",
    response_model=PlaceBidResponse,
    status_code=201,
    summary="Place a bid (KYC required)",
)
async def place_bid(
    auction_id: UUID,
    body: PlaceBidRequest,
    db: DbConn,
    current_user: KycBuyer,
):
    """
    Place a bid on a live auction.

    - KYC must be approved and non-expired.
    - Bid must be ≥ `min_next_bid` (current highest + min_bid_increment_usd).
    - You cannot bid if you are already the highest bidder.
    - If placed within the last `auto_extend_minutes`, the auction is extended automatically.

    Response includes the new `end_time`, whether the auction was extended, and the updated
    `reserve_status` so your UI can react immediately.
    """
    return await auction_service.place_bid(db, current_user, auction_id, body.amount)


@router.get(
    "/{auction_id}/bids",
    response_model=list[PublicBidItem],
    summary="Full bid history for an auction (company names only — no personal data)",
)
async def get_bids(
    auction_id: UUID,
    db: DbConn,
):
    return await auction_service.get_auction_bids(db, auction_id)


@router.get(
    "/{auction_id}/bids/my",
    response_model=MyBidList,
    summary="My bids on a specific auction",
)
async def my_bids_on_auction(
    auction_id: UUID,
    db: DbConn,
    current_user: BuyerUser,
):
    return await auction_service.get_my_bids(db, current_user["id"], auction_id)
