"""
MarineXchange Africa — FastAPI Application Entry Point

Security layers applied in order:
1. Cloudflare (WAF, DDoS, rate limiting) — infrastructure level
2. CORS middleware — controls allowed origins
3. RequestContextMiddleware — attaches IP/UA to request state
4. SlowAPI rate limiting — per-endpoint request throttling
5. JWT authentication (in deps.py) — per-route
6. Role-based permission checks (in deps.py / permissions.py) — per-route
7. RLS in Supabase PostgreSQL — database level backstop
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.config import settings
from app.db.client import check_db_connection, close_pool, create_pool
from app.middleware.request_context import RequestContextMiddleware
from app.routers import auth_router

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ── Rate Limiter ──────────────────────────────────────────────────────────────
# Uses client IP for rate limiting. Cloudflare's CF-Connecting-IP is picked up
# by RequestContextMiddleware and exposed via request.state.client_ip

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])


# ── App Lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting MarineXchange Africa API (env=%s)", settings.ENVIRONMENT)

    if settings.is_production:
        # Production: fail fast — do not start if DB is unreachable.
        await create_pool()
        logger.info("Database connection pool established.")
    else:
        # Development: pool is lazily created on first request.
        # App starts successfully even if DATABASE_URL is not yet configured.
        logger.info(
            "Development mode: database pool will be created on first request. "
            "Set DATABASE_URL in .env — get it from Supabase Dashboard → "
            "Project Settings → Database → Connection string (URI)."
        )

    yield

    logger.info("Shutting down — closing database pool.")
    await close_pool()


# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "MarineXchange Africa — B2B Marketplace API for high-value maritime and "
        "industrial asset transactions across Africa."
    ),
    docs_url="/docs" if not settings.is_production else None,   # Disable Swagger in prod
    redoc_url="/redoc" if not settings.is_production else None,
    openapi_url="/openapi.json" if not settings.is_production else None,
    lifespan=lifespan,
)

# ── Middleware (order matters — outermost first) ───────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(SlowAPIMiddleware)

# Rate limit exceeded handler
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Attach limiter to app state (required by SlowAPI)
app.state.limiter = limiter


# ── Global Exception Handlers ─────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Catch-all handler — prevents raw tracebacks from leaking to clients.
    In development, the detail is shown. In production, only a generic message.
    """
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": str(exc) if settings.is_development else "An internal error occurred.",
        },
    )


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth_router, prefix="/api/v1")

# Placeholder routers — will be added in subsequent phases
# app.include_router(marketplace_router, prefix="/api/v1")
# app.include_router(verification_router, prefix="/api/v1")
# app.include_router(kyc_router, prefix="/api/v1")
# app.include_router(purchase_router, prefix="/api/v1")
# app.include_router(auction_router, prefix="/api/v1")
# app.include_router(finance_router, prefix="/api/v1")
# app.include_router(admin_router, prefix="/api/v1")


# ── Health Check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"], include_in_schema=False)
async def health_check():
    """
    Used by Render health checks and Cloudflare monitoring.
    Returns DB connectivity status so you can catch DATABASE_URL
    misconfigurations without reading server logs.
    """
    db_ok = await check_db_connection()
    return {
        "status": "healthy" if db_ok else "degraded",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "database": "connected" if db_ok else "unreachable — check DATABASE_URL in .env",
    }


@app.get("/", include_in_schema=False)
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs" if settings.is_development else "Not available in production.",
    }
