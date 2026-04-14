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
import pathlib as _pathlib
from contextlib import asynccontextmanager

# ── Windows .env UTF-8 fix ────────────────────────────────────────────────────
# Starlette's Config._read_file opens .env using the system locale codec
# (cp1252 on Windows), which crashes if .env contains any non-cp1252 byte.
# Must patch BEFORE `from slowapi import ...` so SlowAPI's Limiter picks it up.
from starlette import config as _starlette_config

def _utf8_read_file(self, path, encoding=None):  # type: ignore[override]
    if path is None:
        return {}
    p = _pathlib.Path(path)
    if not p.is_file():
        return {}
    result: dict[str, str] = {}
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
            v = v[1:-1]
        result[k.strip()] = v
    return result

_starlette_config.Config._read_file = _utf8_read_file  # type: ignore[method-assign]
# ── End UTF-8 fix ─────────────────────────────────────────────────────────────

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.responses import HTMLResponse, JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.core.rate_limit import limiter
from app.db.client import check_db_connection, close_pool, create_pool
from app.middleware.request_context import RequestContextMiddleware
from app.routers import admin_router, auth_router, auctions_router, deals_router, documents_router, exchange_rates_router, kyc_router, marketplace_router, notifications_router, payments_router, purchase_requests_router, reports_router, seller_router
from app.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


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

    start_scheduler()

    yield

    stop_scheduler()
    logger.info("Shutting down — closing database pool.")
    await close_pool()


# ── FastAPI App ───────────────────────────────────────────────────────────────

_DOCS_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "img-src 'self' data: https://fastapi.tiangolo.com https://cdn.jsdelivr.net; "
    "font-src 'self' https://cdn.jsdelivr.net; "
    "frame-ancestors 'none'"
)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "MarineXchange Africa — B2B Marketplace API for high-value maritime and "
        "industrial asset transactions across Africa."
    ),
    docs_url=None,       # Served manually below with correct CSP
    redoc_url=None,
    openapi_url="/openapi.json" if not settings.is_production else None,
    lifespan=lifespan,
)

# ── Custom Docs endpoints (only in development) ───────────────────────────────
# Served manually so we can set a permissive CSP just for these paths,
# while keeping the strict API CSP enforced by RequestContextMiddleware.

if not settings.is_production:
    @app.get("/docs", include_in_schema=False)
    async def swagger_ui():
        html = get_swagger_ui_html(openapi_url="/openapi.json", title=settings.APP_NAME)
        return HTMLResponse(content=html.body, headers={"Content-Security-Policy": _DOCS_CSP})

    @app.get("/redoc", include_in_schema=False)
    async def redoc_ui():
        html = get_redoc_html(openapi_url="/openapi.json", title=settings.APP_NAME)
        return HTMLResponse(content=html.body, headers={"Content-Security-Policy": _DOCS_CSP})


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

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Log full validation error details so we can diagnose 422s in production."""
    logger.error(
        "422 RequestValidationError %s %s — errors: %s",
        request.method,
        request.url.path,
        exc.errors(),
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


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
app.include_router(marketplace_router, prefix="/api/v1")
app.include_router(kyc_router, prefix="/api/v1")
app.include_router(deals_router, prefix="/api/v1")
app.include_router(purchase_requests_router, prefix="/api/v1")
app.include_router(auctions_router, prefix="/api/v1")
app.include_router(payments_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(reports_router, prefix="/api/v1")
app.include_router(seller_router, prefix="/api/v1")
app.include_router(exchange_rates_router, prefix="/api/v1")

# Placeholder routers — will be added in subsequent phases
# (auctions_router and purchase_requests_router are now live above)


# ── Health Check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"], include_in_schema=False)
async def health_check():
    """
    Used by Render health checks and Cloudflare monitoring.
    In production: returns only status to avoid information disclosure.
    In development: includes diagnostics to catch misconfigurations early.
    """
    db_ok = await check_db_connection()

    if settings.is_production:
        return {"status": "healthy" if db_ok else "degraded"}

    # Development only — detailed diagnostics
    registered = [r.path for r in app.routes]
    return {
        "status": "healthy" if db_ok else "degraded",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "database": "connected" if db_ok else "unreachable — check DATABASE_URL in .env",
        "admin_buyers_sellers": any("/admin/buyers" in p for p in registered),
        "route_count": len(registered),
    }


_PUBLIC_PATHS = {
    "/api/v1/marketplace/catalog",
    "/api/v1/marketplace/categories",
    "/api/v1/marketplace/attributes",
}

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    # Register HTTPBearer security scheme
    schema.setdefault("components", {}).setdefault("securitySchemes", {})["HTTPBearer"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    # Apply security to every operation except fully public paths.
    # This makes Swagger show the lock icon and auto-send the Authorization header.
    bearer = [{"HTTPBearer": []}]
    for path, path_item in schema.get("paths", {}).items():
        # catalog/{product_id} and categories/{id} are also public
        is_public = path in _PUBLIC_PATHS or (
            path.startswith("/api/v1/marketplace/catalog/")
            or path.startswith("/api/v1/marketplace/categories/")
        )
        if is_public:
            continue
        for operation in path_item.values():
            if isinstance(operation, dict) and "security" not in operation:
                operation["security"] = bearer
    app.openapi_schema = schema
    return schema

app.openapi = custom_openapi


@app.get("/", include_in_schema=False)
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs" if settings.is_development else "Not available in production.",
    }
