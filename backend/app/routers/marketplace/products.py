"""
Seller product listing endpoints.

POST   /marketplace/listings              — create a draft listing
GET    /marketplace/listings              — seller's own listings
GET    /marketplace/listings/{id}         — own listing detail (with contact)
PUT    /marketplace/listings/{id}         — update draft
DELETE /marketplace/listings/{id}         — soft-delete draft
POST   /marketplace/listings/{id}/submit  — submit draft for verification
POST   /marketplace/listings/{id}/resubmit — resubmit after rejection/failure
POST   /marketplace/listings/{id}/images  — upload image (multipart)
DELETE /marketplace/listings/{id}/images/{img_id}  — delete image
PATCH  /marketplace/listings/{id}/images/{img_id}/primary — set as primary
"""
from __future__ import annotations

import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status

from app.deps import DbConn, require_roles
from app.schemas.marketplace import (
    PaginatedProductsResponse,
    ProductCreateRequest,
    ProductDetailResponse,
    ProductImageResponse,
    ProductSubmitResponse,
    ProductUpdateRequest,
)
from app.schemas.auth import MessageResponse
from app.services.marketplace_service import (
    create_product_draft,
    delete_product_draft,
    delete_product_image,
    delete_product_document,
    get_product_detail,
    get_product_timeline,
    get_product_verification_status,
    list_seller_products,
    resubmit_product,
    set_primary_image,
    submit_product_for_verification,
    update_product_draft,
    upload_product_image,
    upload_product_document,
)

router = APIRouter(tags=["Marketplace — Seller Listings"])

# Dependency alias: any user with seller role
SellerUser = Depends(require_roles("seller"))


@router.post(
    "/listings",
    response_model=ProductDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a draft listing",
    description=(
        "Seller creates a new product listing in 'draft' status. "
        "Images must be uploaded separately. "
        "Minimum 10 images required before submission."
    ),
)
async def create_listing(
    payload: ProductCreateRequest,
    db: DbConn,
    current_user: dict = SellerUser,
):
    return await create_product_draft(db, payload, current_user)


@router.get(
    "/listings",
    response_model=PaginatedProductsResponse,
    summary="List own listings",
    description="Returns all of the authenticated seller's listings across all statuses.",
)
async def list_my_listings(
    db: DbConn,
    current_user: dict = SellerUser,
    page:       int        = Query(default=1, ge=1),
    page_size:  int        = Query(default=20, ge=1, le=100),
    status:     str | None = Query(default=None),
):
    from uuid import UUID as _UUID
    return await list_seller_products(
        db,
        seller_id=_UUID(str(current_user["id"])),
        page=page,
        page_size=page_size,
        status_filter=status,
    )


@router.get(
    "/listings/{product_id}",
    response_model=ProductDetailResponse,
    summary="Get own listing detail",
    description="Returns full detail for one of the seller's listings, including contact info.",
)
async def get_my_listing(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    return await get_product_detail(db, product_id, current_user, include_contact=True)


@router.put(
    "/listings/{product_id}",
    response_model=ProductDetailResponse,
    summary="Update a draft listing",
    description=(
        "Updates a listing in 'draft' or 'pending_reverification' status. "
        "Only provided fields are changed."
    ),
)
async def update_listing(
    product_id: UUID,
    payload: ProductUpdateRequest,
    db: DbConn,
    current_user: dict = SellerUser,
):
    return await update_product_draft(db, product_id, payload, current_user)


@router.delete(
    "/listings/{product_id}",
    response_model=MessageResponse,
    summary="Delete a draft listing",
    description="Soft-deletes a listing. Only draft listings can be deleted.",
)
async def delete_listing(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    await delete_product_draft(db, product_id, current_user)
    return MessageResponse(message="Listing deleted.")


@router.post(
    "/listings/{product_id}/submit",
    response_model=ProductSubmitResponse,
    summary="Submit listing for verification",
    description=(
        "Transitions a draft listing to 'pending_verification'. "
        "Requires a minimum of 10 images uploaded before submission."
    ),
)
async def submit_listing(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    return await submit_product_for_verification(db, product_id, current_user)


@router.post(
    "/listings/{product_id}/resubmit",
    response_model=ProductSubmitResponse,
    summary="Resubmit after rejection",
    description=(
        "Resubmits a 'rejected' or 'verification_failed' listing for re-verification. "
        "Increments the verification cycle counter."
    ),
)
async def resubmit_listing(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    return await resubmit_product(db, product_id, current_user)


@router.post(
    "/listings/{product_id}/images",
    response_model=ProductImageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a product image",
    description=(
        "Uploads a single product image to Supabase Storage. "
        "Allowed formats: JPEG, PNG, WebP. "
        "Maximum file size: configurable (default 2 MB). "
        "Maximum images per listing: 20. "
        "The first uploaded image is automatically set as the primary image."
    ),
)
async def upload_image(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
    file: UploadFile = File(..., description="Image file (JPEG, PNG, or WebP)"),
):
    return await upload_product_image(db, product_id, file, current_user)


@router.delete(
    "/listings/{product_id}/images/{image_id}",
    response_model=MessageResponse,
    summary="Delete a product image",
)
async def delete_image(
    product_id: UUID,
    image_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    await delete_product_image(db, product_id, image_id, current_user)
    return MessageResponse(message="Image deleted.")


@router.get(
    "/listings/{product_id}/verification",
    summary="Get verification status for seller's own listing",
    description="Returns the current verification assignment details for a listing owned by the authenticated seller.",
)
async def get_listing_verification_status(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    from uuid import UUID as _UUID
    return await get_product_verification_status(
        db, product_id, _UUID(str(current_user["id"]))
    )


@router.get(
    "/listings/{product_id}/timeline",
    summary="Verification timeline for seller's own listing",
    description=(
        "Returns a chronological list of all events for the listing: "
        "status changes, agent assignments, and inspection reports. "
        "Admin names are anonymised — sellers see 'Harbours360 Team'."
    ),
)
async def get_listing_timeline(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
) -> list[dict]:
    # Verify ownership
    seller_id = uuid.UUID(str(current_user["id"]))
    product = await db.fetchrow(
        "SELECT id FROM marketplace.products WHERE id = $1 AND seller_id = $2 AND deleted_at IS NULL",
        product_id, seller_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Listing not found.")
    return await get_product_timeline(db, product_id, viewer_role="seller")


@router.patch(
    "/listings/{product_id}/images/{image_id}/primary",
    response_model=MessageResponse,
    summary="Set primary image",
    description="Designates the specified image as the primary display image for the listing.",
)
async def set_image_primary(
    product_id: UUID,
    image_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    await set_primary_image(db, product_id, image_id, current_user)
    return MessageResponse(message="Primary image updated.")


@router.post(
    "/listings/{product_id}/documents",
    summary="Upload a listing document",
    description="Seller uploads a PDF, Word doc, or image as a supporting document. Only allowed for draft or pending_reverification listings.",
)
async def upload_listing_document(
    product_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
    file: UploadFile = File(...),
):
    return await upload_product_document(db, product_id, file, current_user)


@router.delete(
    "/listings/{product_id}/documents/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a listing document",
)
async def delete_listing_document(
    product_id: UUID,
    doc_id: UUID,
    db: DbConn,
    current_user: dict = SellerUser,
):
    await delete_product_document(db, product_id, doc_id, current_user)
