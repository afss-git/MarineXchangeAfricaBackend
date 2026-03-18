"""
Phase 8B — Auction router.

Mounted at: /api/v1/auctions
"""
from fastapi import APIRouter

from .admin import router as admin_router
from .public import router as public_router

auctions_router = APIRouter(prefix="/auctions")

# Admin sub-router must be registered before the public /{auction_id} wildcard
auctions_router.include_router(admin_router)
auctions_router.include_router(public_router)

__all__ = ["auctions_router"]
