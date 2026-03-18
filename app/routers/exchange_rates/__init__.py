from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Query

from app.deps import AnyAdmin, CurrentUser, DbConn
from app.schemas.exchange_rates import (
    ConversionResult,
    ExchangeRateCreate,
    ExchangeRateListResponse,
    ExchangeRateOut,
)
from app.services import exchange_rate_service

exchange_rates_router = APIRouter(prefix="/exchange-rates", tags=["Exchange Rates"])


@exchange_rates_router.get(
    "",
    response_model=ExchangeRateListResponse,
    summary="List latest exchange rates (one per currency pair)",
)
async def list_rates(
    db: DbConn,
    current_user: CurrentUser,
):
    return await exchange_rate_service.list_rates(db)


@exchange_rates_router.get(
    "/convert",
    response_model=ConversionResult,
    summary="Convert an amount between two currencies using the latest rate",
)
async def convert_amount(
    db: DbConn,
    current_user: CurrentUser,
    from_currency: str = Query(..., min_length=2, max_length=10),
    to_currency: str = Query(..., min_length=2, max_length=10),
    amount: Decimal = Query(..., gt=0),
):
    return await exchange_rate_service.convert(db, from_currency, to_currency, amount)


@exchange_rates_router.get(
    "/{from_currency}/{to_currency}",
    response_model=ExchangeRateOut,
    summary="Get the latest rate for a specific currency pair",
)
async def get_rate(
    from_currency: str,
    to_currency: str,
    db: DbConn,
    current_user: CurrentUser,
):
    return await exchange_rate_service.get_rate(db, from_currency, to_currency)


@exchange_rates_router.post(
    "",
    response_model=ExchangeRateOut,
    status_code=201,
    summary="Create or update an exchange rate (finance_admin / admin only)",
)
async def upsert_rate(
    body: ExchangeRateCreate,
    db: DbConn,
    current_user: AnyAdmin,
):
    return await exchange_rate_service.upsert_rate(db, current_user, body)


__all__ = ["exchange_rates_router"]
