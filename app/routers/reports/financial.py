"""
Phase 6 — Financial Report.

GET /reports/financial?from_date=&to_date=
  - Payment summary (verified, pending, disputed amounts)
  - Breakdown by deal type (full_payment vs financing)
  - Late installments (overdue financing)
  - Defaulted deals

GET /reports/financial/late-installments?export=csv
GET /reports/financial/defaulted-deals?export=csv

Access: Admin + Finance Admin.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.deps import AnyAdmin, DbConn
from app.schemas.reports import FinancialReport
from app.services import report_service

router = APIRouter(tags=["Reports — Financial"])


@router.get(
    "/financial",
    response_model=FinancialReport,
    summary="Financial report — payments, deal types, late installments, defaults",
)
async def get_financial_report(
    db: DbConn,
    current_user: AnyAdmin,
    from_date: date = Query(..., description="Period start (inclusive), e.g. 2025-01-01"),
    to_date: date = Query(..., description="Period end (inclusive), e.g. 2025-03-31"),
):
    """
    Full financial breakdown for a custom date range.
    - Payment summary with amounts by status
    - Per deal-type totals (full_payment vs financing)
    - All currently overdue installments (regardless of date range)
    - Defaulted financing deals in the period
    """
    return await report_service.get_financial_report(db, from_date, to_date)


@router.get(
    "/financial/late-installments/export",
    summary="Export late installments as CSV",
    response_class=StreamingResponse,
)
async def export_late_installments(
    db: DbConn,
    current_user: AnyAdmin,
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    report = await report_service.get_financial_report(db, from_date, to_date)
    rows = [
        {
            "deal_ref": item.deal_ref,
            "buyer_name": item.buyer_name,
            "installment_number": item.installment_number,
            "due_date": str(item.due_date),
            "total_due": str(item.total_due),
            "days_overdue": item.days_overdue,
        }
        for item in report.late_installments
    ]
    csv_bytes = report_service.to_csv_bytes(rows)
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=late_installments_{from_date}_{to_date}.csv"},
    )


@router.get(
    "/financial/defaulted-deals/export",
    summary="Export defaulted deals as CSV",
    response_class=StreamingResponse,
)
async def export_defaulted_deals(
    db: DbConn,
    current_user: AnyAdmin,
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    report = await report_service.get_financial_report(db, from_date, to_date)
    rows = [
        {
            "deal_ref": item.deal_ref,
            "buyer_name": item.buyer_name,
            "total_price": str(item.total_price),
            "amount_collected": str(item.amount_collected),
            "outstanding": str(item.outstanding),
        }
        for item in report.defaulted_deals
    ]
    csv_bytes = report_service.to_csv_bytes(rows)
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=defaulted_deals_{from_date}_{to_date}.csv"},
    )
