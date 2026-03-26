"""
KYC router — Phase 4.

Aggregates:
  - buyer.py   → /kyc/me/...
  - agent.py   → /kyc/agent/...
  - admin.py   → /kyc/admin/...

Also exposes a public endpoint for listing active document types
(buyers need to see document types before they log in / during signup).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.deps import DbConn
from app.schemas.kyc import DocumentTypeResponse
from app.services.kyc_service import list_document_types

from .buyer import router as buyer_router
from .agent import router as agent_router
from .admin import router as admin_router

kyc_router = APIRouter(prefix="/kyc")

# ── Public: list active document types (no auth required) ────────────────────
@kyc_router.get(
    "/document-types",
    response_model=list[DocumentTypeResponse],
    tags=["KYC — Public"],
    summary="List required and optional KYC document types",
    description="Returns all active document types. Use to build the document upload UI.",
)
async def public_document_types(db: DbConn):
    return await list_document_types(db, include_inactive=False)


# ── Sub-routers ───────────────────────────────────────────────────────────────
kyc_router.include_router(buyer_router)
kyc_router.include_router(agent_router)
kyc_router.include_router(admin_router)

__all__ = ["kyc_router"]
