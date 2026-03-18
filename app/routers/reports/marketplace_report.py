"""
Phase 6 — Marketplace Health Report.

GET /reports/marketplace?from_date=&to_date=
  Listings created in the period, grouped by status and category.
  Highlights stuck listings (pending > 7 days).

GET /reports/marketplace/stuck/export?from_date=&to_date=
  CSV download of stuck listings only (most actionable for admins).

Access: Admin only.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.deps import AdminUser, DbConn
from app.schemas.reports import MarketplaceHealthReport
from app.services import report_service

router = APIRouter(tags=["Reports — Marketplace Health"])


@router.get(
    "/marketplace",
    response_model=MarketplaceHealthReport,
    summary="Marketplace health — listings by status, category breakdown, stuck listings",
)
async def get_marketplace_health(
    db: DbConn,
    current_user: AdminUser,
    from_date: date = Query(..., description="Period start (listing created date, inclusive)"),
    to_date: date = Query(..., description="Period end (listing created date, inclusive)"),
):
    """
    Marketplace health for the period:
    - Total listings and breakdown by status
    - Listings grouped by category with active/pending counts
    - Stuck listings: pending_verification or pending_approval for > 7 days
    """
    return await report_service.get_marketplace_health_report(db, from_date, to_date)


@router.get(
    "/marketplace/stuck/export",
    summary="Export stuck listings (pending > 7 days) as CSV",
    response_class=StreamingResponse,
)
async def export_stuck_listings(
    db: DbConn,
    current_user: AdminUser,
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    """Exports only the stuck listings — most actionable dataset for admin follow-up."""
    report = await report_service.get_marketplace_health_report(db, from_date, to_date)
    rows = [
        {
            "title": listing.title,
            "category": listing.category,
            "seller_name": listing.seller_name,
            "status": listing.status,
            "price": str(listing.price),
            "currency": listing.currency,
            "days_in_status": listing.days_in_status,
            "assigned_agent": listing.assigned_agent or "",
            "created_at": listing.created_at.isoformat(),
        }
        for listing in report.stuck_listings
    ]
    csv_bytes = report_service.to_csv_bytes(rows)
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=stuck_listings_{from_date}_{to_date}.csv"},
    )
