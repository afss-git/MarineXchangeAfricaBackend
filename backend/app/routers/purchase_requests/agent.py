"""
Phase 7 — Buyer Agent purchase-request endpoints.

GET    /purchase-requests/agent/assigned                         — list requests assigned to me
GET    /purchase-requests/agent/{id}                             — view one assigned request
POST   /purchase-requests/agent/{id}/report                      — submit due-diligence report
POST   /purchase-requests/agent/{id}/document-requests           — request docs from buyer
GET    /purchase-requests/agent/{id}/document-requests           — list doc requests
POST   /purchase-requests/agent/document-requests/{doc_req_id}/waive — waive a doc request
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from app.deps import BuyerAgent, DbConn
from app.schemas.purchase_requests import (
    AgentAssignedList,
    AgentAssignedRequest,
    AgentReportInfo,
    PRDocRequestCreate,
    PRDocRequestResponse,
    PRDocRequestWaiveBody,
    SubmitAgentReport,
)
from app.services import purchase_request_service

router = APIRouter(prefix="/agent", tags=["Purchase Requests — Buyer Agent"])


@router.get(
    "/assigned",
    response_model=AgentAssignedList,
    summary="List purchase requests assigned to me",
)
async def list_assigned(
    db: DbConn,
    current_user: BuyerAgent,
):
    return await purchase_request_service.agent_list_assigned(db, current_user["id"])


@router.get(
    "/{request_id}",
    response_model=AgentAssignedRequest,
    summary="View an assigned purchase request",
)
async def get_assigned_request(
    request_id: UUID,
    db: DbConn,
    current_user: BuyerAgent,
):
    return await purchase_request_service.agent_get_request(db, current_user["id"], request_id)


@router.post(
    "/{request_id}/report",
    response_model=AgentReportInfo,
    status_code=201,
    summary="Submit due-diligence report for a purchase request",
)
async def submit_report(
    request_id: UUID,
    body: SubmitAgentReport,
    db: DbConn,
    current_user: BuyerAgent,
):
    """
    Submit a structured due-diligence report.

    - One report per agent per request.
    - Advances request status to `under_review`.
    - Advances your assignment status to `report_submitted`.

    Fields:
    - **financial_capacity_usd**: Estimated buyer financial capacity.
    - **risk_rating**: `low` | `medium` | `high`
    - **recommendation**: `recommend_approve` | `recommend_reject`
    - **verification_notes**: Narrative summary (min 10 characters).
    """
    return await purchase_request_service.agent_submit_report(
        db,
        current_user,
        request_id,
        body.financial_capacity_usd,
        body.risk_rating,
        body.recommendation,
        body.verification_notes,
    )


@router.post(
    "/{request_id}/document-requests",
    response_model=list[PRDocRequestResponse],
    status_code=201,
    summary="Request documents from buyer for a purchase request",
)
async def create_doc_requests(
    request_id: UUID,
    body: list[PRDocRequestCreate],
    db: DbConn,
    current_user: BuyerAgent,
):
    return await purchase_request_service.agent_request_pr_documents(
        db, current_user["id"], request_id, body
    )


@router.get(
    "/{request_id}/document-requests",
    response_model=list[PRDocRequestResponse],
    summary="List document requests for a purchase request",
)
async def list_doc_requests(
    request_id: UUID,
    db: DbConn,
    current_user: BuyerAgent,
):
    return await purchase_request_service.agent_list_pr_doc_requests(
        db, current_user["id"], request_id
    )


@router.post(
    "/document-requests/{doc_req_id}/waive",
    response_model=PRDocRequestResponse,
    summary="Waive a pending document request",
)
async def waive_doc_request(
    doc_req_id: UUID,
    body: PRDocRequestWaiveBody,
    db: DbConn,
    current_user: BuyerAgent,
):
    return await purchase_request_service.agent_waive_pr_doc_request(
        db, current_user["id"], doc_req_id, body.reason
    )
