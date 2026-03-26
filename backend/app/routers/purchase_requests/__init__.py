"""
Phase 7 — Purchase Request router.

Mounted at: /api/v1/purchase-requests
"""
from fastapi import APIRouter

from .admin import router as admin_router
from .agent import router as agent_router
from .buyer import router as buyer_router

purchase_requests_router = APIRouter(prefix="/purchase-requests")

# Order matters: /admin and /agent must be registered before /{request_id}
# so FastAPI matches the literal paths first.
purchase_requests_router.include_router(admin_router)
purchase_requests_router.include_router(agent_router)
purchase_requests_router.include_router(buyer_router)

__all__ = ["purchase_requests_router"]
