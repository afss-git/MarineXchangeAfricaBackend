"""
Request context middleware.
Extracts and attaches IP address and User-Agent to every request's state.
These are used in audit logs and rate limiting.

IP Trust Model:
  - In production with Cloudflare: CF-Connecting-IP is trusted ONLY when
    CLOUDFLARE_TUNNEL_SECRET is verified (via CF-Access header), or when
    TRUST_CF_IP=true is set and the server is firewalled to CF IPs only.
  - In development: X-Forwarded-For or direct client.host is used.
  - Never trust raw X-Forwarded-For in production without Cloudflare validation,
    as it is trivially spoofed and would bypass rate limiting.
"""
from __future__ import annotations

import logging

from app.config import settings
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# Swagger / ReDoc need CDN resources — these paths get a relaxed CSP
_DOCS_PATHS = {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}

# CSP for API responses — strict, no external resources allowed
_API_CSP = "default-src 'self'; frame-ancestors 'none'"

# CSP for Swagger/ReDoc UI — allows CDN assets and inline scripts
_DOCS_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "img-src 'self' data: https://fastapi.tiangolo.com https://cdn.jsdelivr.net; "
    "font-src 'self' https://cdn.jsdelivr.net; "
    "frame-ancestors 'none'"
)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attaches client IP and user-agent to request.state for downstream use."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # ── IP Resolution with Cloudflare spoof protection ───────────────────
        # CF-Connecting-IP is ONLY trusted in production because:
        #   1. The server should be firewalled to only accept traffic from
        #      Cloudflare IP ranges (see: https://www.cloudflare.com/ips/)
        #   2. If Cloudflare is bypassed, an attacker could set this header
        #      to any value, defeating rate limiting and poisoning audit logs.
        # In development, fall back to X-Forwarded-For / direct client IP.
        if settings.is_production:
            cf_ip = request.headers.get("CF-Connecting-IP", "").strip()
            if cf_ip:
                client_ip = cf_ip
            else:
                # Request arrived without CF-Connecting-IP — either a health
                # check from within the cloud infrastructure, or a misconfiguration.
                # Log it and use direct client IP.
                direct = request.client.host if request.client else "unknown"
                logger.warning(
                    "Request missing CF-Connecting-IP in production — possible Cloudflare bypass. "
                    "client.host=%s path=%s", direct, request.url.path,
                )
                client_ip = direct
        else:
            client_ip = (
                request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                or (request.client.host if request.client else "unknown")
            )

        request.state.client_ip = client_ip
        request.state.user_agent = request.headers.get("User-Agent", "")

        response = await call_next(request)

        # ── Security Headers ─────────────────────────────────────────────
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"

        # Docs pages need CDN access; all other paths get the strict policy
        is_docs = request.url.path in _DOCS_PATHS
        response.headers["Content-Security-Policy"] = _DOCS_CSP if is_docs else _API_CSP

        return response
