"""
Test configuration and fixtures.
Uses a real test Supabase project (set TEST_* env vars) or mocks.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    """Async test client for the FastAPI app."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


@pytest.fixture
def buyer_signup_payload():
    return {
        "email": "testbuyer@example.com",
        "password": "TestPass123!@#$",
        "full_name": "Test Buyer",
        "company_name": "Test Marine Ltd",
        "phone": "+2348012345678",
        "country": "Nigeria",
    }


@pytest.fixture
def seller_signup_payload():
    return {
        "email": "testseller@example.com",
        "password": "TestPass123!@#$",
        "full_name": "Test Seller",
        "company_name": "West Africa Shipping Co",
        "company_reg_no": "RC-123456",
        "phone": "+2348012345679",
        "country": "Nigeria",
    }
