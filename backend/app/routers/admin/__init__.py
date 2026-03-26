from __future__ import annotations

from fastapi import APIRouter

from .dashboard import router as dashboard_router
from .users import router as users_router
from .buyers import router as buyers_router
from .sellers import router as sellers_router

admin_router = APIRouter(prefix="/admin")

admin_router.include_router(dashboard_router, prefix="/dashboard")
admin_router.include_router(users_router, prefix="/users")
admin_router.include_router(buyers_router, prefix="/buyers")
admin_router.include_router(sellers_router, prefix="/sellers")

__all__ = ["admin_router"]
