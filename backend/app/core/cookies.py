"""
HttpOnly cookie management for JWT tokens.

Security rationale:
  - HttpOnly cookies cannot be read by JavaScript — XSS attacks cannot steal them.
  - Secure flag ensures they are only sent over HTTPS.
  - SameSite=lax protects against CSRF for navigation requests while
    allowing normal cross-site API calls (the backend validates JWT anyway).
  - The access_token cookie expires with the JWT (short-lived: ~1 hour).
  - The refresh_token cookie has a longer Max-Age matching Supabase's refresh TTL.

Usage:
  - Call set_auth_cookies(response, access_token, refresh_token, expires_in)
    at the end of any login / token-refresh handler.
  - Call clear_auth_cookies(response) on logout.
"""
from __future__ import annotations

from fastapi import Response

from app.config import settings

# Supabase refresh tokens are valid for 60 days by default
REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 24 * 60 * 60  # 60 days


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    expires_in: int,
) -> None:
    """
    Writes two HttpOnly Secure cookies:
      - access_token   — short-lived (matches JWT expiry)
      - refresh_token  — long-lived (60 days)

    Both cookies are:
      - HttpOnly: not readable by JavaScript
      - Secure: HTTPS only (in production)
      - SameSite: lax (CSRF protection for navigation, allows API calls)
      - Path=/api/v1: scoped to the API, not the entire domain
    """
    secure = settings.is_production
    domain = settings.COOKIE_DOMAIN or None
    same_site = settings.COOKIE_SAME_SITE

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=expires_in,
        httponly=True,
        secure=secure,
        samesite=same_site,
        domain=domain,
        path="/api/v1",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=REFRESH_TOKEN_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite=same_site,
        domain=domain,
        path="/api/v1/auth/refresh",  # scope refresh cookie to the refresh endpoint only
    )


def clear_auth_cookies(response: Response) -> None:
    """Clears both auth cookies — called on logout."""
    domain = settings.COOKIE_DOMAIN or None
    response.delete_cookie(
        key="access_token",
        path="/api/v1",
        domain=domain,
        httponly=True,
        secure=settings.is_production,
        samesite=settings.COOKIE_SAME_SITE,
    )
    response.delete_cookie(
        key="refresh_token",
        path="/api/v1/auth/refresh",
        domain=domain,
        httponly=True,
        secure=settings.is_production,
        samesite=settings.COOKIE_SAME_SITE,
    )
