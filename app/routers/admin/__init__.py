from __future__ import annotations

from fastapi import APIRouter

from .dashboard import router as dashboard_router
from .users import router as users_router

admin_router = APIRouter(prefix="/admin")

admin_router.include_router(dashboard_router, prefix="/dashboard")
admin_router.include_router(users_router, prefix="/users")

__all__ = ["admin_router"]
