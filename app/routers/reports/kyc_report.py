"""
Phase 6 — KYC Compliance Report.

GET /reports/kyc?from_date=&to_date=
  All KYC submissions in the period with buyer details, status, PEP/sanctions flags,
  expiry info, and days-until-expiry for approved submissions.

GET /reports/kyc/export?from_date=&to_date=
  CSV download.

Access: Admin only.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.deps import AdminUser, DbConn
from app.schemas.reports import KycComplianceReport
from app.services import report_service

router = APIRouter(tags=["Reports — KYC Compliance"])


@router.get(
    "/kyc",
    response_model=KycComplianceReport,
    summary="KYC compliance report — submissions, expiry alerts, PEP/sanctions flags",
)
async def get_kyc_compliance(
    db: DbConn,
    current_user: AdminUser,
    from_date: date = Query(..., description="Period start (submission date, inclusive)"),
    to_date: date = Query(..., description="Period end (submission date, inclusive)"),
):
    """
    KYC compliance overview for the period:
    - All submissions with buyer identity and current status
    - PEP and sanctions flags from the latest review
    - Days until expiry for approved KYC (alerts for ≤ 30 days)
    - Total count breakdown by status
    """
    return await report_service.get_kyc_compliance_report(db, from_date, to_date)


@router.get(
    "/kyc/export",
    summary="Export KYC compliance report as CSV",
    response_class=StreamingResponse,
)
async def export_kyc_compliance(
    db: DbConn,
    current_user: AdminUser,
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    report = await report_service.get_kyc_compliance_report(db, from_date, to_date)
    rows = [
        {
            "buyer_name": s.buyer_name,
            "buyer_email": s.buyer_email,
            "status": s.status,
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else "",
            "decided_at": s.decided_at.isoformat() if s.decided_at else "",
            "expires_at": s.expires_at.isoformat() if s.expires_at else "",
            "days_until_expiry": s.days_until_expiry if s.days_until_expiry is not None else "",
            "rejection_reason": s.rejection_reason or "",
            "is_pep": s.is_pep,
            "sanctions_match": s.sanctions_match,
        }
        for s in report.submissions
    ]
    csv_bytes = report_service.to_csv_bytes(rows)
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=kyc_compliance_{from_date}_{to_date}.csv"},
    )
