from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query

from app.deps import AdminUser, AnyAdmin, DbConn
from app.schemas.deals import DealCreate, DealListResponse, DealResponse
from app.services import deal_service

from .admin import router as admin_router
from .buyer import router as buyer_router
from .config import router as config_router
from .finance import router as finance_router

deals_router = APIRouter(prefix="/deals")


# ── Root-level routes live here to avoid FastAPI empty-path error ─────────────

@deals_router.get(
    "",
    response_model=list[DealListResponse],
    tags=["Deals — Admin"],
    summary="List all deals",
)
async def list_deals(
    db: DbConn,
    current_user: AnyAdmin,
    deal_status: str | None = Query(default=None, alias="status"),
    buyer_id: UUID | None = Query(default=None),
    deal_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    filters = {
        "status": deal_status,
        "buyer_id": buyer_id,
        "deal_type": deal_type,
        "page": page,
        "page_size": page_size,
    }
    return await deal_service.list_deals(db, filters, current_user)


@deals_router.post(
    "",
    response_model=DealResponse,
    status_code=201,
    tags=["Deals — Admin"],
    summary="Create a deal",
)
async def create_deal(
    db: DbConn,
    current_user: AdminUser,
    payload: DealCreate,
):
    return await deal_service.create_deal(db, payload, current_user)


# ── Sub-routers (specific paths first, parametric /{deal_id} last) ───────────
deals_router.include_router(config_router)   # /payment-accounts, /rate-schedules, /buyers/...
deals_router.include_router(buyer_router)    # /my, /portal/{token}
deals_router.include_router(finance_router)  # /payments, /{deal_id}/payments/...
deals_router.include_router(admin_router)    # /{deal_id}, /{deal_id}/... (must be last)

__all__ = ["deals_router"]
