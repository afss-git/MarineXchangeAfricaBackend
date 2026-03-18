"""
Authentication endpoint tests.
Tests cover: signup validation, login role checks, password policy.
Integration tests require a live Supabase test project.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


# ── Password Validation Tests ─────────────────────────────────────────────────

class TestPasswordPolicy:
    """Unit tests for password strength validation."""

    def test_valid_password(self):
        from app.core.security import validate_password_strength
        # Should not raise
        validate_password_strength("SecurePass123!")

    def test_too_short(self):
        from app.core.security import validate_password_strength, PasswordValidationError
        with pytest.raises(PasswordValidationError, match="at least 12"):
            validate_password_strength("Short1!")

    def test_no_uppercase(self):
        from app.core.security import validate_password_strength, PasswordValidationError
        with pytest.raises(PasswordValidationError, match="uppercase"):
            validate_password_strength("alllowercase123!")

    def test_no_digit(self):
        from app.core.security import validate_password_strength, PasswordValidationError
        with pytest.raises(PasswordValidationError, match="digit"):
            validate_password_strength("NoDigitsHere!!")

    def test_no_special_char(self):
        from app.core.security import validate_password_strength, PasswordValidationError
        with pytest.raises(PasswordValidationError, match="special character"):
            validate_password_strength("NoSpecialChar123")

    def test_exceeds_max_length(self):
        from app.core.security import validate_password_strength, PasswordValidationError
        with pytest.raises(PasswordValidationError, match="72"):
            validate_password_strength("A" * 73 + "1!")


# ── Schema Validation Tests ───────────────────────────────────────────────────

class TestBuyerSignupSchema:
    """Pydantic schema validation for buyer signup."""

    def test_valid_buyer_signup(self, buyer_signup_payload):
        from app.schemas.auth import BuyerSignupRequest
        req = BuyerSignupRequest(**buyer_signup_payload)
        assert req.email == "testbuyer@example.com"
        assert "buyer" not in dir(req)  # no role field on request

    def test_rejects_extra_fields(self, buyer_signup_payload):
        from app.schemas.auth import BuyerSignupRequest
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            BuyerSignupRequest(**buyer_signup_payload, role="admin")

    def test_requires_email(self, buyer_signup_payload):
        from app.schemas.auth import BuyerSignupRequest
        from pydantic import ValidationError
        payload = {k: v for k, v in buyer_signup_payload.items() if k != "email"}
        with pytest.raises(ValidationError):
            BuyerSignupRequest(**payload)

    def test_requires_valid_email(self, buyer_signup_payload):
        from app.schemas.auth import BuyerSignupRequest
        from pydantic import ValidationError
        buyer_signup_payload["email"] = "not-an-email"
        with pytest.raises(ValidationError):
            BuyerSignupRequest(**buyer_signup_payload)

    def test_phone_normalization(self, buyer_signup_payload):
        from app.schemas.auth import BuyerSignupRequest
        buyer_signup_payload["phone"] = "+234 (801) 234-5678"
        req = BuyerSignupRequest(**buyer_signup_payload)
        assert req.phone == "+2348012345678"


class TestSellerSignupSchema:
    """Seller signup requires company details."""

    def test_requires_company_reg_no(self, seller_signup_payload):
        from app.schemas.auth import SellerSignupRequest
        from pydantic import ValidationError
        payload = {k: v for k, v in seller_signup_payload.items() if k != "company_reg_no"}
        with pytest.raises(ValidationError):
            SellerSignupRequest(**payload)

    def test_requires_company_name(self, seller_signup_payload):
        from app.schemas.auth import SellerSignupRequest
        from pydantic import ValidationError
        payload = {k: v for k, v in seller_signup_payload.items() if k != "company_name"}
        with pytest.raises(ValidationError):
            SellerSignupRequest(**payload)


# ── API Endpoint Tests (require live Supabase) ────────────────────────────────
# These tests are marked integration — skip in CI unless TEST env is configured

@pytest.mark.integration
class TestBuyerSignupEndpoint:
    async def test_signup_returns_201(self, client: AsyncClient, buyer_signup_payload):
        response = await client.post("/api/v1/auth/buyer/signup", json=buyer_signup_payload)
        assert response.status_code == 201
        data = response.json()
        assert "message" in data

    async def test_duplicate_email_returns_409(self, client: AsyncClient, buyer_signup_payload):
        await client.post("/api/v1/auth/buyer/signup", json=buyer_signup_payload)
        response = await client.post("/api/v1/auth/buyer/signup", json=buyer_signup_payload)
        assert response.status_code == 409

    async def test_weak_password_returns_422(self, client: AsyncClient, buyer_signup_payload):
        buyer_signup_payload["password"] = "weak"
        response = await client.post("/api/v1/auth/buyer/signup", json=buyer_signup_payload)
        assert response.status_code == 422


@pytest.mark.integration
class TestRolePortalSeparation:
    """Verify that role-specific login portals enforce role checks."""

    async def test_buyer_cannot_login_via_seller_portal(self, client: AsyncClient):
        # Assumes a buyer account exists
        response = await client.post("/api/v1/auth/seller/login", json={
            "email": "buyer@example.com",
            "password": "ValidPass123!",
        })
        assert response.status_code == 403
        assert "seller" in response.json()["detail"].lower()

    async def test_seller_cannot_login_via_admin_portal(self, client: AsyncClient):
        response = await client.post("/api/v1/auth/admin/login", json={
            "email": "seller@example.com",
            "password": "ValidPass123!",
        })
        assert response.status_code == 403

    async def test_unauthenticated_me_returns_401(self, client: AsyncClient):
        response = await client.get("/api/v1/auth/me")
        assert response.status_code == 401


@pytest.mark.integration
class TestGetMe:
    async def test_me_returns_profile(self, client: AsyncClient):
        # Login first
        login_resp = await client.post("/api/v1/auth/buyer/login", json={
            "email": "buyer@example.com",
            "password": "ValidPass123!",
        })
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]

        me_resp = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me_resp.status_code == 200
        data = me_resp.json()
        assert "buyer" in data["roles"]
        assert "id" in data
        assert "password" not in data   # never exposed
