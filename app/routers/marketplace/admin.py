"""
Admin marketplace management endpoints.

GET  /marketplace/admin/products           — all products (any status, filterable)
GET  /marketplace/admin/products/{id}      — product detail with contact info
PUT  /marketplace/admin/products/{id}      — edit any product field
POST /marketplace/admin/products/{id}/assign-agent  — assign verification agent
POST /marketplace/admin/products/{id}/decide        — approve/reject/request corrections
POST /marketplace/admin/products/{id}/delist        — delist an active listing
GET  /marketplace/admin/products/pending-approval   — products awaiting admin decision
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, status

from app.deps import DbConn, require_roles
from app.schemas.auth import MessageResponse
from app.schemas.marketplace import (
    AdminProductDecisionRequest,
    AdminProductUpdateRequest,
    AssignVerificationAgentRequest,
    PaginatedProductsResponse,
    ProductDetailResponse,
    ProductSubmitResponse,
)
from app.services.marketplace_service import (
    admin_delist_product,
    admin_product_decision,
    admin_update_product,
    assign_verification_agent,
    get_product_detail,
    list_admin_products,
)

router = APIRouter(tags=["Marketplace — Admin"])

AdminOnly = Depends(require_roles("admin"))


@router.get(
    "/admin/products",
    response_model=PaginatedProductsResponse,
    summary="List all products (admin)",
    description=(
        "Admin view: all listings regardless of status. "
        "Filter by status or seller_id. "
        "Useful for monitoring the verification pipeline."
    ),
)
async def admin_list_products(
    db: DbConn,
    current_user: dict = AdminOnly,
    page:       int         = Query(default=1,  ge=1),
    page_size:  int         = Query(default=20, ge=1, le=100),
    status:     str | None  = Query(default=None, description="Filter by product status"),
    seller_id:  UUID | None = Query(default=None, description="Filter by seller"),
):
    return await list_admin_products(
        db,
        page=page,
        page_size=page_size,
        status_filter=status,
        seller_id_filter=seller_id,
    )


@router.get(
    "/admin/products/pending-approval",
    response_model=PaginatedProductsResponse,
    summary="Products awaiting admin decision",
    description="Shortcut: returns all listings in 'pending_approval' status.",
)
async def admin_pending_approval(
    db: DbConn,
    current_user: dict = AdminOnly,
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await list_admin_products(db, page=page, page_size=page_size, status_filter="pending_approval")


@router.get(
    "/admin/products/pending-verification",
    response_model=PaginatedProductsResponse,
    summary="Products awaiting agent assignment",
    description="Shortcut: returns all listings in 'pending_verification' status.",
)
async def admin_pending_verification(
    db: DbConn,
    current_user: dict = AdminOnly,
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await list_admin_products(db, page=page, page_size=page_size, status_filter="pending_verification")


@router.get(
    "/admin/products/{product_id}",
    response_model=ProductDetailResponse,
    summary="Get product detail (admin view)",
    description="Full detail including seller contact information.",
)
async def admin_get_product(
    product_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
):
    return await get_product_detail(db, product_id, current_user, include_contact=True)


@router.put(
    "/admin/products/{product_id}",
    response_model=ProductDetailResponse,
    summary="Edit product details",
    description=(
        "Admin can edit any listing's core fields (title, price, location, etc.). "
        "To update technical specifications, use the specs endpoint."
    ),
)
async def admin_edit_product(
    product_id: UUID,
    payload: AdminProductUpdateRequest,
    db: DbConn,
    current_user: dict = AdminOnly,
):
    return await admin_update_product(db, product_id, payload, current_user)


@router.post(
    "/admin/products/{product_id}/assign-agent",
    summary="Assign verification agent",
    description=(
        "Admin assigns a verification agent to a 'pending_verification' or "
        "'pending_reverification' product. "
        "Transitions the product to 'under_verification'."
    ),
)
async def assign_agent(
    product_id: UUID,
    payload: AssignVerificationAgentRequest,
    db: DbConn,
    current_user: dict = AdminOnly,
):
    return await assign_verification_agent(db, product_id, payload, current_user)


@router.post(
    "/admin/products/{product_id}/decide",
    response_model=ProductSubmitResponse,
    summary="Approve, reject, or request corrections",
    description=(
        "Admin reviews a 'pending_approval' listing and makes a decision:\n\n"
        "- **approve** → listing becomes 'active' (publicly visible)\n"
        "- **reject** → listing becomes 'rejected' (seller can resubmit)\n"
        "- **request_corrections** → listing returns to 'pending_reverification' "
        "  (seller makes changes, re-enters the verification cycle)"
    ),
)
async def decide_product(
    product_id: UUID,
    payload: AdminProductDecisionRequest,
    db: DbConn,
    current_user: dict = AdminOnly,
):
    return await admin_product_decision(db, product_id, payload, current_user)


@router.post(
    "/admin/products/{product_id}/delist",
    response_model=ProductSubmitResponse,
    summary="Delist an active listing",
    description=(
        "Admin removes an 'active' or 'under_offer' listing from the public marketplace. "
        "A reason may be provided for audit purposes."
    ),
)
async def delist_product(
    product_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
    reason: str | None = Body(default=None, embed=True),
):
    return await admin_delist_product(db, product_id, reason, current_user)
