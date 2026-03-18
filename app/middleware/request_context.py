"""
Request context middleware.
Extracts and attaches IP address and User-Agent to every request's state.
These are used in audit logs and rate limiting.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attaches client IP and user-agent to request.state for downstream use."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # Respect Cloudflare's real IP header
        client_ip = (
            request.headers.get("CF-Connecting-IP")          # Cloudflare
            or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
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
        response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"

        return response
