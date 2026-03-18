"""
Phase 12 — Exchange Rate Schemas.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ExchangeRateOut(BaseModel):
    id: int
    from_currency: str
    to_currency: str
    rate: Decimal
    rate_date: date
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ExchangeRateCreate(BaseModel):
    from_currency: str = Field(..., min_length=2, max_length=10)
    to_currency: str = Field(..., min_length=2, max_length=10)
    rate: Decimal = Field(..., gt=0)
    rate_date: date = Field(default_factory=date.today)
    source: Literal["manual", "api"] = "manual"

    @field_validator("from_currency", "to_currency", mode="before")
    @classmethod
    def uppercase(cls, v: str) -> str:
        return v.strip().upper()


class ExchangeRateListResponse(BaseModel):
    items: list[ExchangeRateOut]
    total: int


class ConversionResult(BaseModel):
    from_currency: str
    to_currency: str
    amount: Decimal
    converted_amount: Decimal
    rate: Decimal
    rate_date: date
