"""
Public marketplace endpoints — no authentication required.

GET /marketplace/catalog          — paginated active product listing
GET /marketplace/catalog/{id}     — single product detail (contact hidden)
GET /marketplace/categories       — full category tree
GET /marketplace/categories/{id}  — single category with subcategories
GET /marketplace/attributes       — active attribute definitions
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query

from app.deps import DbConn
from app.schemas.marketplace import (
    AttributeDefinitionResponse,
    CategoryResponse,
    PaginatedProductsResponse,
    PublicProductDetailResponse,
)
from app.services.marketplace_service import (
    get_category_by_id,
    get_category_tree,
    get_product_detail,
    list_attributes,
    list_public_products,
)

router = APIRouter(tags=["Marketplace — Public Catalog"])


@router.get(
    "/catalog",
    response_model=PaginatedProductsResponse,
    summary="Browse published listings",
    description=(
        "Returns all active product listings. "
        "Supports filtering by category, availability type, country, and keyword search."
    ),
)
async def browse_catalog(
    db: DbConn,
    page:              int         = Query(default=1,    ge=1),
    page_size:         int         = Query(default=20,   ge=1, le=50),
    category_id:       UUID | None = Query(default=None),
    availability_type: str | None  = Query(default=None),
    location_country:  str | None  = Query(default=None),
    search:            str | None  = Query(default=None, max_length=200),
):
    return await list_public_products(
        db,
        page=page,
        page_size=page_size,
        category_id=category_id,
        availability_type=availability_type,
        location_country=location_country,
        search=search,
    )


@router.get(
    "/catalog/{product_id}",
    response_model=PublicProductDetailResponse,
    summary="Get product detail (public)",
    description=(
        "Returns full product detail including images and specifications. "
        "Seller contact information is not included in the public view."
    ),
)
async def get_public_product(
    product_id: UUID,
    db: DbConn,
):
    return await get_product_detail(db, product_id, actor=None, include_contact=False)


@router.get(
    "/categories",
    response_model=list[CategoryResponse],
    summary="Get full category tree",
    description="Returns all active categories as a nested tree (root → subcategories).",
)
async def get_categories(db: DbConn):
    return await get_category_tree(db)


@router.get(
    "/categories/{category_id}",
    response_model=CategoryResponse,
    summary="Get category with subcategories",
)
async def get_category(category_id: UUID, db: DbConn):
    return await get_category_by_id(db, category_id)


@router.get(
    "/attributes",
    response_model=list[AttributeDefinitionResponse],
    summary="Get attribute definitions",
    description=(
        "Returns active attribute definitions. "
        "Filter by category_id to include both global and category-specific attributes."
    ),
)
async def get_attributes(
    db: DbConn,
    category_id: UUID | None = Query(default=None),
):
    return await list_attributes(db, category_id=category_id)
