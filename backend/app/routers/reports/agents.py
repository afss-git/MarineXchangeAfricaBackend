"""
Phase 6 — Agent Workload & Performance Report.

GET /reports/agents?from_date=&to_date=
  Admin: all verification agents — KYC reviews, listing verifications, avg review times.
  Agent: own stats only.

GET /reports/agents/export?from_date=&to_date=
  Admin only — CSV export of all agents.

Access:
  - Admin: sees all agents.
  - Verification Agent: sees own stats only.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.deps import AdminUser, DbConn, VerAgentOrAdmin
from app.schemas.reports import AgentWorkloadReport
from app.services import report_service

router = APIRouter(tags=["Reports — Agent Workload"])


@router.get(
    "/agents",
    response_model=AgentWorkloadReport,
    summary="Agent workload & performance — KYC reviews, listing verifications, avg times",
)
async def get_agent_workload(
    db: DbConn,
    current_user: VerAgentOrAdmin,
    from_date: date = Query(..., description="Period start (inclusive)"),
    to_date: date = Query(..., description="Period end (inclusive)"),
):
    """
    Agent performance for the period.

    - **Admin**: sees all active verification agents and their stats.
    - **Verification Agent**: sees only their own stats.

    Metrics per agent:
    - KYC submissions assigned and reviewed
    - KYC outcomes (approved / rejected)
    - Marketplace listings assigned, verified, rejected
    - Average review time in hours (KYC and listings)
    """
    # Agents only see their own data; admins see all agents
    agent_id = None
    roles = current_user["roles"] or []
    if "verification_agent" in roles:
        agent_id = current_user["id"]

    return await report_service.get_agent_workload_report(db, from_date, to_date, agent_id)


@router.get(
    "/agents/export",
    summary="Export agent performance report as CSV (Admin only)",
    response_class=StreamingResponse,
)
async def export_agent_workload(
    db: DbConn,
    current_user: AdminUser,
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    """Admin-only CSV export of all agent performance data."""
    report = await report_service.get_agent_workload_report(db, from_date, to_date)
    rows = [
        {
            "agent_name": a.agent_name,
            "agent_email": a.agent_email,
            "kyc_assigned": a.kyc_assigned,
            "kyc_reviewed": a.kyc_reviewed,
            "kyc_approved": a.kyc_approved,
            "kyc_rejected": a.kyc_rejected,
            "listings_assigned": a.listings_assigned,
            "listings_verified": a.listings_verified,
            "listings_rejected": a.listings_rejected,
            "avg_kyc_review_hours": round(a.avg_kyc_review_hours, 2) if a.avg_kyc_review_hours else "",
            "avg_listing_review_hours": round(a.avg_listing_review_hours, 2) if a.avg_listing_review_hours else "",
        }
        for a in report.agents
    ]
    csv_bytes = report_service.to_csv_bytes(rows)
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=agent_performance_{from_date}_{to_date}.csv"},
    )
