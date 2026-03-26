"""
Shared rate limiter instance.

Separated from main.py to avoid circular imports.

Rate limiting strategy:
  - Production: 60 requests/minute globally, auth endpoints in a stricter
    separate bucket (shared across all auth paths per IP).
  - Development: 600 requests/minute to avoid blocking test suites.
  - Auth login/signup paths use a custom key function that puts them
    into their own rate-limit namespace for stricter enforcement.
"""
from __future__ import annotations

import os

from starlette.requests import Request

from slowapi import Limiter
from slowapi.util import get_remote_address

_AUTH_PATHS = frozenset({
    "/api/v1/auth/buyer/login",
    "/api/v1/auth/buyer/signup",
    "/api/v1/auth/seller/login",
    "/api/v1/auth/seller/signup",
    "/api/v1/auth/seller-buyer/signup",
    "/api/v1/auth/admin/login",
    "/api/v1/auth/finance-admin/login",
    "/api/v1/auth/agent/login",
    "/api/v1/auth/internal/bootstrap",
})


def _key_func(request: Request) -> str:
    """
    Custom key function: auth endpoints share a separate rate-limit bucket.
    This gives auth endpoints stricter limits without needing per-route decorators
    (which conflict with FastAPI's body parameter injection).
    """
    ip = get_remote_address(request)
    path = request.url.path.rstrip("/")
    if path in _AUTH_PATHS:
        return f"auth:{ip}"
    return ip


_env = os.getenv("ENVIRONMENT", "development").lower()
_default_limit = "60/minute" if _env == "production" else "600/minute"

limiter = Limiter(key_func=_key_func, default_limits=[_default_limit])
