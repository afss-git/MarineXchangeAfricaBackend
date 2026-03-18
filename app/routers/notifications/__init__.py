from __future__ import annotations

from fastapi import APIRouter

from .user import router as user_router

notifications_router = APIRouter(prefix="/notifications")
notifications_router.include_router(user_router)

__all__ = ["notifications_router"]
