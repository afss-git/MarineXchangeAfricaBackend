"""
Phase 6 — Reports router aggregation.

All report endpoints are mounted under /api/v1/reports/
Sub-routers are included in dependency order (no path conflicts).
"""
from __future__ import annotations

from fastapi import APIRouter

from .agents import router as agents_router
from .financial import router as financial_router
from .kyc_report import router as kyc_router
from .marketplace_report import router as marketplace_router
from .overview import router as overview_router
from .pipeline import router as pipeline_router

reports_router = APIRouter(prefix="/reports")

reports_router.include_router(overview_router)
reports_router.include_router(financial_router)
reports_router.include_router(pipeline_router)
reports_router.include_router(kyc_router)
reports_router.include_router(marketplace_router)
reports_router.include_router(agents_router)

__all__ = ["reports_router"]
