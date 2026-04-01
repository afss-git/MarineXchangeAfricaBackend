"""
Admin marketplace management endpoints.

GET  /marketplace/admin/products                        — all products (any status, filterable)
GET  /marketplace/admin/products/{id}                   — product detail with contact info
PUT  /marketplace/admin/products/{id}                   — edit any product field
POST /marketplace/admin/products/{id}/assign-agent      — assign verification agent
POST /marketplace/admin/products/{id}/decide            — approve/reject/request corrections
POST /marketplace/admin/products/{id}/delist            — delist an active listing
GET  /marketplace/admin/products/pending-approval       — products awaiting admin decision
GET  /marketplace/admin/products/pending-verification   — products awaiting agent assignment
GET  /marketplace/admin/products/pending-reverification — products awaiting seller resubmission
GET  /marketplace/admin/products/{id}/activity          — audit trail for a product
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, Query, UploadFile, status

from app.deps import DbConn, require_roles
from app.schemas.auth import MessageResponse
from app.schemas.marketplace import (
    AdminProductDecisionRequest,
    AdminProductUpdateRequest,
    AssignVerificationAgentRequest,
    PaginatedProductsResponse,
    ProductDetailResponse,
    ProductImageResponse,
    ProductSubmitResponse,
)
from app.services.marketplace_service import (
    admin_delist_product,
    admin_product_decision,
    admin_toggle_product_visibility,
    delete_product_image,
    get_product_snapshot,
    upload_product_image,
    admin_update_product,
    assign_verification_agent,
    get_product_detail,
    get_product_timeline,
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
    "/admin/products/pending-reverification",
    response_model=PaginatedProductsResponse,
    summary="Products awaiting seller resubmission",
    description="Shortcut: returns all listings in 'pending_reverification' status.",
)
async def admin_pending_reverification(
    db: DbConn,
    current_user: dict = AdminOnly,
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await list_admin_products(db, page=page, page_size=page_size, status_filter="pending_reverification")


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


@router.get(
    "/admin/products/{product_id}/activity",
    summary="Product audit trail",
    description="All audit log entries where resource_id = product_id. Returns up to 50 entries newest first.",
)
async def product_activity(
    product_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
) -> list[dict]:
    rows = await db.fetch(
        """
        SELECT
            al.action,
            al.resource_type,
            al.resource_id,
            al.old_state,
            al.new_state,
            al.created_at,
            COALESCE(p.full_name, au.email, al.actor_id) AS actor_name
        FROM audit.logs al
        LEFT JOIN public.profiles p  ON al.actor_id IS NOT NULL AND p.id  = al.actor_id::uuid
        LEFT JOIN auth.users     au  ON al.actor_id IS NOT NULL AND au.id = al.actor_id::uuid
        WHERE al.resource_id = $1
        ORDER BY al.created_at DESC
        LIMIT 50
        """,
        str(product_id),
    )
    return [
        {
            "action":        r["action"],
            "actor_name":    r["actor_name"],
            "resource_type": r["resource_type"],
            "old_state":     r["old_state"] if isinstance(r["old_state"], dict) else None,
            "new_state":     r["new_state"] if isinstance(r["new_state"], dict) else None,
            "created_at":    r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


@router.get(
    "/admin/products/{product_id}/timeline",
    summary="Full verification timeline (admin view)",
    description=(
        "Returns a unified chronological timeline of all events for a product. "
        "Admin view shows real actor names — no anonymisation."
    ),
)
async def admin_product_timeline(
    product_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
) -> list[dict]:
    return await get_product_timeline(db, product_id, viewer_role="admin")


@router.patch(
    "/admin/products/{product_id}/visibility",
    summary="Show or hide a listing from the public catalog",
    description=(
        "Toggles is_visible without changing the product status. "
        "Hidden products remain accessible to the seller and admin "
        "but are excluded from the public catalog and search results."
    ),
)
async def toggle_visibility(
    product_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
    is_visible: bool = Body(..., embed=True),
):
    return await admin_toggle_product_visibility(db, product_id, is_visible, current_user)


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


@router.get(
    "/admin/products/{product_id}/snapshot",
    summary="Original seller submission snapshot",
    description=(
        "Returns the immutable snapshot of the product as the seller originally submitted it. "
        "This is never modified by admin edits. "
        "Pass ?cycle=N to retrieve a specific submission cycle."
    ),
)
async def admin_get_snapshot(
    product_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
    cycle: int | None = Query(default=None, description="Submission cycle number (omit for latest)"),
) -> dict:
    snap = await get_product_snapshot(db, product_id, cycle=cycle)
    if not snap:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No snapshot found for this product.")
    return snap


@router.post(
    "/admin/products/{product_id}/images",
    response_model=ProductImageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload image to any listing (admin)",
    description="Admin can upload images to any listing regardless of status.",
)
async def admin_upload_image(
    product_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
    file: UploadFile = File(...),
):
    return await upload_product_image(db, product_id, file, current_user)


@router.delete(
    "/admin/products/{product_id}/images/{image_id}",
    response_model=MessageResponse,
    summary="Delete image from any listing (admin)",
    description="Admin can delete images from any listing regardless of status.",
)
async def admin_delete_image(
    product_id: UUID,
    image_id: UUID,
    db: DbConn,
    current_user: dict = AdminOnly,
):
    await delete_product_image(db, product_id, image_id, current_user)
    return MessageResponse(message="Image deleted.")
