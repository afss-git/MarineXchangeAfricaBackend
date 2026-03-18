"""
Marketplace router — aggregates all sub-routers under /marketplace.

Sub-routers:
  public.py       — catalog browsing (no auth)
  products.py     — seller listing CRUD + image upload
  verification.py — agent verification workflow + attribute management
  admin.py        — admin oversight, agent assignment, approvals
"""
from fastapi import APIRouter

from .admin import router as admin_router
from .products import router as products_router
from .public import router as public_router
from .verification import router as verification_router

marketplace_router = APIRouter(prefix="/marketplace")

marketplace_router.include_router(public_router)
marketplace_router.include_router(products_router)
marketplace_router.include_router(verification_router)
marketplace_router.include_router(admin_router)

__all__ = ["marketplace_router"]
