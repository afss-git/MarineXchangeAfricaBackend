"""
Phase 8B — Auction Engine schemas (Pydantic v2).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN — CREATE / EDIT
# ══════════════════════════════════════════════════════════════════════════════

class AuctionCreate(BaseModel):
    product_id:             UUID
    title:                  str             = Field(..., min_length=3, max_length=300)
    description:            Optional[str]   = Field(default=None, max_length=5000)
    starting_bid:           Decimal         = Field(..., gt=0)
    reserve_price:          Optional[Decimal] = Field(default=None, gt=0)
    currency:               str             = Field(default="USD", max_length=10)
    min_bid_increment_usd:  Decimal         = Field(default=Decimal("5000"), gt=0)
    start_time:             datetime
    end_time:               datetime
    auto_extend_minutes:    int             = Field(default=5, ge=1, le=60)
    max_extensions:         int             = Field(default=3, ge=0, le=10)
    admin_notes:            Optional[str]   = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def end_after_start(self) -> "AuctionCreate":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class AuctionUpdate(BaseModel):
    title:                  Optional[str]     = Field(default=None, min_length=3, max_length=300)
    description:            Optional[str]     = None
    starting_bid:           Optional[Decimal] = Field(default=None, gt=0)
    reserve_price:          Optional[Decimal] = Field(default=None, gt=0)
    min_bid_increment_usd:  Optional[Decimal] = Field(default=None, gt=0)
    start_time:             Optional[datetime] = None
    end_time:               Optional[datetime] = None
    auto_extend_minutes:    Optional[int]      = Field(default=None, ge=1, le=60)
    max_extensions:         Optional[int]      = Field(default=None, ge=0, le=10)
    admin_notes:            Optional[str]      = None


class ApproveWinnerBody(BaseModel):
    admin_notes: Optional[str] = Field(default=None, max_length=2000)


class RejectWinnerBody(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


class AuctionConvertBody(BaseModel):
    deal_type:   Literal["full_payment", "financing"]
    admin_notes: Optional[str] = Field(default=None, max_length=2000)


# ══════════════════════════════════════════════════════════════════════════════
# BID PLACEMENT
# ══════════════════════════════════════════════════════════════════════════════

class PlaceBidRequest(BaseModel):
    amount: Decimal = Field(..., gt=0, description="Bid amount in auction currency")


# ══════════════════════════════════════════════════════════════════════════════
# RESPONSES — ADMIN (full detail, includes reserve_price)
# ══════════════════════════════════════════════════════════════════════════════

class BidItem(BaseModel):
    id:             UUID
    bidder_id:      UUID
    bidder_company: Optional[str] = None     # company name only — no personal name in public list
    amount:         Decimal
    currency:       str
    is_winning_bid: bool
    bid_time:       datetime


class AdminAuctionDetail(BaseModel):
    id:                     UUID
    product_id:             UUID
    product_title:          Optional[str]    = None
    created_by:             UUID
    title:                  str
    description:            Optional[str]
    starting_bid:           Decimal
    reserve_price:          Optional[Decimal]   # exposed to admin only
    currency:               str
    min_bid_increment_usd:  Decimal
    start_time:             datetime
    end_time:               datetime
    original_end_time:      datetime
    auto_extend_minutes:    int
    max_extensions:         int
    extensions_count:       int
    current_highest_bid:    Optional[Decimal]
    current_winner_id:      Optional[UUID]
    winner_company:         Optional[str]    = None
    winner_approved_by:     Optional[UUID]
    winner_approved_at:     Optional[datetime]
    winner_rejection_reason: Optional[str]
    converted_deal_id:      Optional[UUID]
    status:                 str
    admin_notes:            Optional[str]
    bid_count:              int              = 0
    bids:                   list[BidItem]    = []
    created_at:             datetime
    updated_at:             datetime

    model_config = {"from_attributes": True}


class AdminAuctionListItem(BaseModel):
    id:                  UUID
    product_id:          UUID
    product_title:       Optional[str] = None
    title:               str
    status:              str
    currency:            str
    starting_bid:        Decimal
    current_highest_bid: Optional[Decimal]
    bid_count:           int
    start_time:          datetime
    end_time:            datetime
    extensions_count:    int
    created_at:          datetime

    model_config = {"from_attributes": True}


class AdminAuctionList(BaseModel):
    items: list[AdminAuctionListItem]
    total: int


# ══════════════════════════════════════════════════════════════════════════════
# RESPONSES — PUBLIC (reserve_price NEVER included)
# ══════════════════════════════════════════════════════════════════════════════

class PublicBidItem(BaseModel):
    id:             UUID
    bidder_company: Optional[str] = None   # company only, no personal name
    amount:         Decimal
    currency:       str
    is_winning_bid: bool
    bid_time:       datetime


class PublicAuctionDetail(BaseModel):
    id:                     UUID
    product_id:             UUID
    product_title:          Optional[str]   = None
    title:                  str
    description:            Optional[str]
    currency:               str
    starting_bid:           Decimal
    min_bid_increment_usd:  Decimal
    min_bid_increment_pct:  str             # e.g. "2.1%" — calculated
    min_next_bid:           Decimal         # starting_bid or current + increment
    current_highest_bid:    Optional[Decimal]
    reserve_status:         str             # "no_reserve" | "reserve_not_met" | "reserve_met"
    status:                 str
    start_time:             datetime
    end_time:               datetime
    original_end_time:      datetime
    auto_extend_minutes:    int
    max_extensions:         int
    extensions_count:       int
    time_remaining_seconds: int             # 0 if closed
    bid_count:              int             = 0
    recent_bids:            list[PublicBidItem] = []   # last 5 bids
    created_at:             datetime

    model_config = {"from_attributes": True}


class PublicAuctionListItem(BaseModel):
    id:                  UUID
    product_id:          UUID
    product_title:       Optional[str] = None
    title:               str
    status:              str
    currency:            str
    starting_bid:        Decimal
    current_highest_bid: Optional[Decimal]
    reserve_status:      str
    min_next_bid:        Decimal
    bid_count:           int
    end_time:            datetime
    time_remaining_seconds: int
    extensions_count:    int

    model_config = {"from_attributes": True}


class PublicAuctionList(BaseModel):
    items: list[PublicAuctionListItem]
    total: int


class MyBidItem(BaseModel):
    id:             UUID
    auction_id:     UUID
    auction_title:  Optional[str] = None
    amount:         Decimal
    currency:       str
    is_winning_bid: bool
    bid_time:       datetime


class MyBidList(BaseModel):
    items: list[MyBidItem]
    total: int


class PlaceBidResponse(BaseModel):
    bid_id:                 UUID
    auction_id:             UUID
    amount:                 Decimal
    currency:               str
    is_winning_bid:         bool
    bid_time:               datetime
    new_end_time:           datetime
    extended:               bool
    extensions_count:       int
    min_next_bid:           Decimal
    reserve_status:         str


class AuctionConvertResponse(BaseModel):
    deal_id:     UUID
    deal_ref:    str
    deal_status: str
    auction_id:  UUID
    message:     str
