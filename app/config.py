from __future__ import annotations

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────────────────
    APP_NAME: str = "MarineXchange Africa API"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False

    # ── Supabase ──────────────────────────────────────────────────────────────
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWT_SECRET: str

    # ── Database ──────────────────────────────────────────────────────────────
    DATABASE_URL: str

    # ── CORS ──────────────────────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    # ── Email ─────────────────────────────────────────────────────────────────
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@marinexchange.africa"
    EMAIL_FROM_NAME: str = "MarineXchange Africa"

    # ── Finance rules (fixed — DB also enforces these) ────────────────────────
    DUAL_CONTROL_THRESHOLD_USD: float = 100_000.0
    MIN_FACILITATION_RATE: float = 0.02
    MAX_FACILITATION_RATE: float = 0.15
    DOWNPAYMENT_PERCENT: float = 80.0
    FINANCING_REQUEST_TIMEOUT_DAYS: int = 7
    INSTALLMENT_GRACE_PERIOD_DAYS: int = 5

    # ── Storage ───────────────────────────────────────────────────────────────
    SUPABASE_STORAGE_BUCKET: str = "product-images"
    MAX_PRODUCT_IMAGES: int = 20
    MIN_PRODUCT_IMAGES: int = 10
    MAX_IMAGE_SIZE_MB: int = 2
    SIGNED_URL_EXPIRY_SECONDS: int = 900

    # ── Rate limiting ─────────────────────────────────────────────────────────
    RATE_LIMIT_DEFAULT: int = 60
    RATE_LIMIT_AUTH: int = 10
    RATE_LIMIT_UPLOAD: int = 20

    # ── Security ──────────────────────────────────────────────────────────────
    CLOUDFLARE_TUNNEL_SECRET: str = ""

    # ── SMS (Twilio) ──────────────────────────────────────────────────────────
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""    # E.164 format: +12345678901

    # ── Deals ─────────────────────────────────────────────────────────────────
    DEAL_PORTAL_TOKEN_EXPIRY_HOURS: int = 48
    DEAL_OTP_EXPIRY_MINUTES: int = 10
    DEAL_MAX_ACTIVE_PER_BUYER: int = 3
    DEAL_HIGH_VALUE_THRESHOLD_USD: float = 100_000.0

    # ── Admin ─────────────────────────────────────────────────────────────────
    ADMIN_EMAIL: str = ""       # Notification recipient for admin alerts (purchase requests, etc.)

    # ── Bootstrap ─────────────────────────────────────────────────────────────
    # One-time secret for POST /api/v1/auth/internal/bootstrap.
    # Set a long random value in .env, call the endpoint once, then DELETE it.
    # The endpoint permanently self-locks once any admin profile exists in the DB.
    ADMIN_BOOTSTRAP_SECRET: str = ""

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"


settings = Settings()
