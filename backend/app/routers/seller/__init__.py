from __future__ import annotations

from fastapi import APIRouter

from app.deps import DbConn, SellerUser
from app.services import seller_dashboard_service

seller_router = APIRouter(prefix="/seller", tags=["Seller — Dashboard"])


@seller_router.get(
    "/dashboard",
    summary="Seller dashboard — listings, deals, purchase requests, auctions",
)
async def get_seller_dashboard(
    db: DbConn,
    current_user: SellerUser,
) -> dict:
    return await seller_dashboard_service.get_seller_dashboard(db, current_user)


__all__ = ["seller_router"]
