"""
Pydantic v2 schemas for authentication endpoints.
All inputs use strict validation — extra fields are forbidden.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.security import validate_password_strength, normalize_phone, PasswordValidationError


# ── Shared validators ─────────────────────────────────────────────────────────

PasswordField = Annotated[
    str,
    Field(min_length=12, max_length=72, description="Minimum 12 characters"),
]

PhoneField = Annotated[
    str,
    Field(min_length=7, max_length=20, description="International format recommended"),
]

NameField = Annotated[
    str,
    Field(min_length=2, max_length=100),
]

CompanyField = Annotated[
    str,
    Field(min_length=2, max_length=200),
]


# ── Signup Schemas ────────────────────────────────────────────────────────────

class BuyerSignupRequest(BaseModel):
    """
    Public signup for buyers.
    Creates account with roles=['buyer'], kyc_status='pending'.
    Buyers cannot transact until KYC is verified.
    """
    model_config = {"extra": "forbid"}

    email: EmailStr
    password: PasswordField
    full_name: NameField
    company_name: str | None = Field(default=None, max_length=200)
    phone: PhoneField
    country: str = Field(min_length=2, max_length=100)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        try:
            validate_password_strength(v)
        except PasswordValidationError as e:
            raise ValueError(str(e))
        return v

    @field_validator("phone")
    @classmethod
    def normalize_phone_number(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("full_name", "country")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class SellerSignupRequest(BaseModel):
    """
    Public signup for sellers.
    Sellers must provide company details — they are listing industrial assets.
    Creates account with roles=['seller'].
    """
    model_config = {"extra": "forbid"}

    email: EmailStr
    password: PasswordField
    full_name: NameField
    company_name: CompanyField
    company_reg_no: str = Field(min_length=2, max_length=100, description="Company registration number")
    phone: PhoneField
    country: str = Field(min_length=2, max_length=100)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        try:
            validate_password_strength(v)
        except PasswordValidationError as e:
            raise ValueError(str(e))
        return v

    @field_validator("phone")
    @classmethod
    def normalize_phone_number(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("full_name", "company_name", "company_reg_no", "country")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class BuyerSellerSignupRequest(SellerSignupRequest):
    """
    Signup for maritime companies that operate as both buyers and sellers.
    Inherits seller validation (company details required).
    Creates account with roles=['buyer', 'seller'].
    """
    pass


# ── Login Schemas ─────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    """Universal login payload — role validation happens server-side."""
    model_config = {"extra": "forbid"}

    email: EmailStr
    password: str = Field(min_length=1, max_length=72)

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str) -> str:
        return v.lower().strip()


# ── Add Role Schema ───────────────────────────────────────────────────────────

class AddSellerRoleRequest(BaseModel):
    """
    Allows an existing buyer to add the seller role to their account.
    Requires company details (mandatory for sellers).
    """
    model_config = {"extra": "forbid"}

    company_name: CompanyField
    company_reg_no: str = Field(min_length=2, max_length=100)

    @field_validator("company_name", "company_reg_no")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


# ── Internal User Creation (Admin Only) ───────────────────────────────────────

class CreateAgentRequest(BaseModel):
    """Admin-only endpoint to create a verification_agent or buyer_agent."""
    model_config = {"extra": "forbid"}

    email: EmailStr
    full_name: NameField
    agent_type: str = Field(description="verification_agent or buyer_agent")
    phone: PhoneField
    country: str = Field(min_length=2, max_length=100)

    @field_validator("agent_type")
    @classmethod
    def validate_agent_type(cls, v: str) -> str:
        if v not in ("verification_agent", "buyer_agent"):
            raise ValueError("agent_type must be 'verification_agent' or 'buyer_agent'")
        return v

    @field_validator("phone")
    @classmethod
    def normalize_phone_number(cls, v: str) -> str:
        return normalize_phone(v)


class CreateAdminRequest(BaseModel):
    """Admin-only endpoint to create admin or finance_admin users."""
    model_config = {"extra": "forbid"}

    email: EmailStr
    full_name: NameField
    role: str = Field(description="admin or finance_admin")
    phone: PhoneField
    country: str = Field(min_length=2, max_length=100)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("admin", "finance_admin"):
            raise ValueError("role must be 'admin' or 'finance_admin'")
        return v

    @field_validator("phone")
    @classmethod
    def normalize_phone_number(cls, v: str) -> str:
        return normalize_phone(v)


# ── Bootstrap Schema ──────────────────────────────────────────────────────────

class BootstrapAdminRequest(BaseModel):
    """
    One-time payload for POST /auth/internal/bootstrap.
    Creates the very first admin account when no admin exists in the system.
    The caller must also supply the X-Bootstrap-Secret header.
    """
    model_config = {"extra": "forbid"}

    email:      EmailStr
    password:   PasswordField           # Operator chooses their own strong password
    full_name:  NameField
    phone:      PhoneField
    country:    str = Field(min_length=2, max_length=100)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        try:
            validate_password_strength(v)
        except PasswordValidationError as e:
            raise ValueError(str(e))
        return v

    @field_validator("phone")
    @classmethod
    def normalize_phone_number(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("full_name", "country")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


# ── Response Schemas ──────────────────────────────────────────────────────────

class UserProfileResponse(BaseModel):
    """Safe user profile — never includes password or sensitive internal fields."""
    id: UUID
    email: str
    full_name: str
    company_name: str | None
    company_reg_no: str | None
    phone: str | None
    country: str | None
    avatar_url: str | None = None
    roles: list[str]
    kyc_status: str
    is_active: bool
    created_at: str


class UpdateProfileBody(BaseModel):
    """Fields a user can update on their own profile."""
    model_config = {"extra": "forbid"}

    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    phone: str | None = Field(default=None, min_length=7, max_length=20)
    country: str | None = Field(default=None, min_length=2, max_length=100)
    company_name: str | None = Field(default=None, min_length=2, max_length=200)
    company_reg_no: str | None = Field(default=None, min_length=2, max_length=100)

    @field_validator("phone")
    @classmethod
    def normalize_phone_number(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return normalize_phone(v)

    @field_validator("full_name", "country", "company_name", "company_reg_no")
    @classmethod
    def strip_whitespace(cls, v: str | None) -> str | None:
        return v.strip() if v else v


class ChangePasswordBody(BaseModel):
    """Change own password — requires current password for verification."""
    model_config = {"extra": "forbid"}

    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=12, max_length=72)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        try:
            validate_password_strength(v)
        except PasswordValidationError as e:
            raise ValueError(str(e))
        return v


class CreateStaffResponse(BaseModel):
    """Returned when an admin creates a staff account. Includes the one-time invite link."""
    profile: "UserProfileResponse"
    invite_link: str


class SetPasswordBody(BaseModel):
    """Set password for first-time login via invite link — no current password required."""
    model_config = {"extra": "forbid"}

    new_password: str = Field(min_length=12, max_length=72)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        try:
            validate_password_strength(v)
        except PasswordValidationError as e:
            raise ValueError(str(e))
        return v


class AuthTokenResponse(BaseModel):
    """Returned on successful login or signup-with-auto-login."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserProfileResponse


class MessageResponse(BaseModel):
    """Generic success message response."""
    message: str
    detail: str | None = None
