"""
Phase 7 — Purchase Request router.

Mounted at: /api/v1/purchase-requests
"""
from fastapi import APIRouter

from .admin import router as admin_router
from .agent import router as agent_router
from .buyer import router as buyer_router, submit_purchase_request

purchase_requests_router = APIRouter(prefix="/purchase-requests")

# Order matters: /admin and /agent must be registered before /{request_id}
# so FastAPI matches the literal paths first.
purchase_requests_router.include_router(admin_router)
purchase_requests_router.include_router(agent_router)
purchase_requests_router.include_router(buyer_router)

# Vercel/Next.js strips trailing slashes before forwarding requests.  With
# redirect_slashes=False on the app, POST /purchase-requests (no slash) would
# 404 because the route is registered as /purchase-requests/.  We register the
# same handler at path="" (→ /purchase-requests) on this router whose prefix is
# non-empty, which avoids FastAPI's "both prefix and path empty" restriction.
purchase_requests_router.add_api_route(
    "",
    submit_purchase_request,
    methods=["POST"],
    response_model=None,  # avoid double schema registration
    status_code=201,
    include_in_schema=False,
)

__all__ = ["purchase_requests_router"]
