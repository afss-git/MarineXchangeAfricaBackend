"""
Phase 8B — Admin auction endpoints.

POST   /auctions/admin                           — create auction (draft)
GET    /auctions/admin                           — list all auctions
GET    /auctions/admin/{id}                      — full detail + all bids + winner
PUT    /auctions/admin/{id}                      — edit (draft only)
POST   /auctions/admin/{id}/schedule             — draft → scheduled
POST   /auctions/admin/{id}/cancel               — cancel (draft/scheduled only)
POST   /auctions/admin/{id}/approve-winner       — winner_pending_approval → winner_approved
POST   /auctions/admin/{id}/reject-winner        — winner_pending_approval → winner_rejected
POST   /auctions/admin/{id}/convert              — winner_approved → DRAFT deal
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query

from app.deps import AdminUser, DbConn
from app.schemas.auctions import (
    AdminAuctionDetail,
    AdminAuctionList,
    ApproveWinnerBody,
    AuctionConvertBody,
    AuctionConvertResponse,
    AuctionCreate,
    AuctionUpdate,
    RejectWinnerBody,
)
from app.services import auction_service

router = APIRouter(prefix="/admin", tags=["Auctions — Admin"])


@router.post(
    "",
    response_model=AdminAuctionDetail,
    status_code=201,
    summary="Create a new auction (draft)",
)
async def create_auction(
    body: AuctionCreate,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Creates an auction in **draft** status.
    Configure all settings, then call `/schedule` to go live.
    `reserve_price` is stored securely and never exposed to buyers.
    """
    return await auction_service.admin_create_auction(db, current_user, body)


@router.get(
    "",
    response_model=AdminAuctionList,
    summary="List all auctions",
)
async def list_auctions(
    db: DbConn,
    current_user: AdminUser,
    status: Optional[str]  = Query(default=None),
    product_id: Optional[UUID] = Query(default=None),
):
    return await auction_service.admin_list_auctions(db, status, product_id)


@router.get(
    "/{auction_id}",
    response_model=AdminAuctionDetail,
    summary="Get full auction detail including reserve price and all bids",
)
async def get_auction(
    auction_id: UUID,
    db: DbConn,
    current_user: AdminUser,
):
    return await auction_service.admin_get_auction(db, auction_id)


@router.put(
    "/{auction_id}",
    response_model=AdminAuctionDetail,
    summary="Edit auction configuration (draft only)",
)
async def update_auction(
    auction_id: UUID,
    body: AuctionUpdate,
    db: DbConn,
    current_user: AdminUser,
):
    return await auction_service.admin_update_auction(db, current_user, auction_id, body)


@router.post(
    "/{auction_id}/schedule",
    response_model=AdminAuctionDetail,
    summary="Schedule a draft auction (draft → scheduled)",
)
async def schedule_auction(
    auction_id: UUID,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Transitions auction from `draft` to `scheduled`.
    The scheduler will automatically open it at `start_time`.
    `start_time` must be in the future.
    """
    return await auction_service.admin_schedule_auction(db, current_user, auction_id)


@router.post(
    "/{auction_id}/cancel",
    response_model=AdminAuctionDetail,
    summary="Cancel an auction (draft or scheduled only)",
)
async def cancel_auction(
    auction_id: UUID,
    db: DbConn,
    current_user: AdminUser,
    reason: Optional[str] = Query(default=None, max_length=500),
):
    return await auction_service.admin_cancel_auction(db, current_user, auction_id, reason)


@router.post(
    "/{auction_id}/approve-winner",
    response_model=AdminAuctionDetail,
    summary="Approve the winning bidder (winner_pending_approval → winner_approved)",
)
async def approve_winner(
    auction_id: UUID,
    body: ApproveWinnerBody,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Admin reviews the winner's profile, bid amount, and KYC status, then approves.
    Winner is notified. Auction is then ready for conversion to a deal.
    """
    return await auction_service.admin_approve_winner(
        db, current_user, auction_id, body.admin_notes
    )


@router.post(
    "/{auction_id}/reject-winner",
    response_model=AdminAuctionDetail,
    summary="Reject the winning bidder — with reason",
)
async def reject_winner(
    auction_id: UUID,
    body: RejectWinnerBody,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Reject the highest bidder (e.g. failed KYC review post-auction, sanctions hit).
    Winner is notified with the reason.
    Auction status becomes `winner_rejected` — admin can then re-open or close.
    """
    return await auction_service.admin_reject_winner(
        db, current_user, auction_id, body.reason
    )


@router.post(
    "/{auction_id}/convert",
    response_model=AuctionConvertResponse,
    status_code=201,
    summary="Convert winner_approved auction to a DRAFT deal",
)
async def convert_to_deal(
    auction_id: UUID,
    body: AuctionConvertBody,
    db: DbConn,
    current_user: AdminUser,
):
    """
    Creates a `draft` deal in `finance.deals` for the auction winner.
    Price is taken from the winning bid — no renegotiation.
    Go to the Deals module to configure payment terms and send the offer.
    """
    return await auction_service.admin_convert_to_deal(
        db, current_user, auction_id, body.deal_type, body.admin_notes
    )
