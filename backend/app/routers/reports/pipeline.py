"""
Phase 6 — Deal Pipeline Report.

GET /reports/pipeline?from_date=&to_date=
  Deals created in the period, grouped by stage, with days-in-status flag.

GET /reports/pipeline/export?from_date=&to_date=
  CSV download of the full deal list.

Access: Admin + Finance Admin.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.deps import AnyAdmin, DbConn
from app.schemas.reports import DealPipelineReport
from app.services import report_service

router = APIRouter(tags=["Reports — Deal Pipeline"])


@router.get(
    "/pipeline",
    response_model=DealPipelineReport,
    summary="Deal pipeline — all deals by stage with days-in-status",
)
async def get_deal_pipeline(
    db: DbConn,
    current_user: AnyAdmin,
    from_date: date = Query(..., description="Period start (inclusive)"),
    to_date: date = Query(..., description="Period end (inclusive)"),
):
    """
    Full deal pipeline for the period:
    - Total count and breakdown by status
    - Each deal with days_in_status (approximate — based on last updated_at)
    - Flags for high-value deals awaiting second approval
    """
    return await report_service.get_deal_pipeline_report(db, from_date, to_date)


@router.get(
    "/pipeline/export",
    summary="Export deal pipeline as CSV",
    response_class=StreamingResponse,
)
async def export_deal_pipeline(
    db: DbConn,
    current_user: AnyAdmin,
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    report = await report_service.get_deal_pipeline_report(db, from_date, to_date)
    rows = [
        {
            "deal_ref": d.deal_ref,
            "product_title": d.product_title,
            "buyer_name": d.buyer_name,
            "seller_name": d.seller_name,
            "deal_type": d.deal_type,
            "total_price": str(d.total_price),
            "currency": d.currency,
            "status": d.status,
            "days_in_status": d.days_in_status,
            "requires_second_approval": d.requires_second_approval,
            "second_approved": d.second_approved,
            "created_at": d.created_at.isoformat(),
        }
        for d in report.deals
    ]
    csv_bytes = report_service.to_csv_bytes(rows)
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=deal_pipeline_{from_date}_{to_date}.csv"},
    )
