from __future__ import annotations

from fastapi import APIRouter

from .admin import router as admin_router
from .buyer import router as buyer_router

payments_router = APIRouter(prefix="/payments")

# Admin sub-router first (specific prefix prevents conflicts)
payments_router.include_router(admin_router, prefix="/admin")
payments_router.include_router(buyer_router, prefix="/buyer")

__all__ = ["payments_router"]
