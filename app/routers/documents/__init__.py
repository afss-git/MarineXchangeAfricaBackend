from __future__ import annotations

from fastapi import APIRouter

from .admin import router as admin_router
from .shared import router as shared_router

documents_router = APIRouter(prefix="/documents")

documents_router.include_router(admin_router, prefix="/admin")
documents_router.include_router(shared_router)

__all__ = ["documents_router"]
