"""
Request context middleware.
Extracts and attaches IP address and User-Agent to every request's state.
These are used in audit logs and rate limiting.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

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

        # Docs pages need CDN access; all other paths get the strict policy
        is_docs = request.url.path in _DOCS_PATHS
        response.headers["Content-Security-Policy"] = _DOCS_CSP if is_docs else _API_CSP

        return response
