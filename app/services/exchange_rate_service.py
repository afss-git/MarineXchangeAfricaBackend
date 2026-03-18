"""
Phase 12 — Exchange Rate Service.

Manages the public.exchange_rates table:
  - list_rates       — latest rate per currency pair
  - get_rate         — specific pair (latest by rate_date)
  - upsert_rate      — finance_admin creates/updates a rate
  - convert          — convenience: amount × latest rate
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException

from app.schemas.exchange_rates import (
    ConversionResult,
    ExchangeRateCreate,
    ExchangeRateListResponse,
    ExchangeRateOut,
)


def _row_to_rate(row) -> ExchangeRateOut:
    return ExchangeRateOut(
        id=row["id"],
        from_currency=row["from_currency"],
        to_currency=row["to_currency"],
        rate=row["rate"],
        rate_date=row["rate_date"],
        source=row["source"],
        created_at=row["created_at"],
    )


async def list_rates(db) -> ExchangeRateListResponse:
    """Return the latest rate for every known currency pair."""
    rows = await db.fetch(
        """
        SELECT DISTINCT ON (from_currency, to_currency)
            id, from_currency, to_currency, rate, rate_date, source, created_at
        FROM public.exchange_rates
        ORDER BY from_currency, to_currency, rate_date DESC, created_at DESC
        """
    )
    items = [_row_to_rate(r) for r in rows]
    return ExchangeRateListResponse(items=items, total=len(items))


async def get_rate(db, from_currency: str, to_currency: str) -> ExchangeRateOut:
    """Return the most recent rate for a specific currency pair."""
    row = await db.fetchrow(
        """
        SELECT id, from_currency, to_currency, rate, rate_date, source, created_at
        FROM public.exchange_rates
        WHERE from_currency = $1 AND to_currency = $2
        ORDER BY rate_date DESC, created_at DESC
        LIMIT 1
        """,
        from_currency.upper(),
        to_currency.upper(),
    )
    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"No exchange rate found for {from_currency.upper()}/{to_currency.upper()}.",
        )
    return _row_to_rate(row)


async def upsert_rate(db, user: dict, body: ExchangeRateCreate) -> ExchangeRateOut:
    """
    Insert or update an exchange rate for a given date.
    ON CONFLICT updates the rate + source in place.
    """
    row = await db.fetchrow(
        """
        INSERT INTO public.exchange_rates
            (from_currency, to_currency, rate, rate_date, source, set_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (from_currency, to_currency, rate_date)
        DO UPDATE SET
            rate   = EXCLUDED.rate,
            source = EXCLUDED.source,
            set_by = EXCLUDED.set_by
        RETURNING id, from_currency, to_currency, rate, rate_date, source, created_at
        """,
        body.from_currency,
        body.to_currency,
        body.rate,
        body.rate_date,
        body.source,
        user["id"],
    )
    return _row_to_rate(row)


async def convert(
    db, from_currency: str, to_currency: str, amount: Decimal
) -> ConversionResult:
    """Convert an amount using the latest available rate."""
    rate_obj = await get_rate(db, from_currency, to_currency)
    converted = amount * rate_obj.rate
    return ConversionResult(
        from_currency=from_currency.upper(),
        to_currency=to_currency.upper(),
        amount=amount,
        converted_amount=converted,
        rate=rate_obj.rate,
        rate_date=rate_obj.rate_date,
    )
