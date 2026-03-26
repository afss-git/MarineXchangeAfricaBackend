"""
Phase 6 — Admin Overview Dashboard.

GET /reports/overview
  Returns a real-time snapshot of listings, deals, KYC, and payment alerts.
  No date range — always reflects current state.
  Access: Admin only.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.deps import AdminUser, DbConn
from app.schemas.reports import OverviewDashboard
from app.services import report_service

router = APIRouter(tags=["Reports — Overview"])


@router.get(
    "/overview",
    response_model=OverviewDashboard,
    summary="Admin overview dashboard — real-time business snapshot",
)
async def get_overview(
    db: DbConn,
    current_user: AdminUser,
):
    """
    Single endpoint giving a full operational snapshot:
    - Listings by status
    - Deals by stage (including awaiting second approval)
    - KYC buyer summary (active, expired, expiring soon)
    - Payment alerts (pending verification, disputed)
    """
    return await report_service.get_overview_dashboard(db)
