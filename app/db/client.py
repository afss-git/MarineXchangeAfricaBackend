"""
Async PostgreSQL connection pool via asyncpg.
All queries use parameterized statements — no raw string interpolation.

Pool is lazily initialized on the first request — this prevents startup crashes
when the database URL is unreachable (e.g. during local dev without a live DB).
In production the health check endpoint will surface connection failures early.
"""
from __future__ import annotations

import asyncio
import logging

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


def _build_dsn() -> str:
    """
    Strips the SQLAlchemy-style '+asyncpg' driver prefix so asyncpg
    receives a plain postgresql:// URI.

    Supabase direct connection format (get from Dashboard → Settings → Database):
      postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

    Set this (without the +asyncpg prefix) as DATABASE_URL in your .env.
    The code adds the prefix back only for SQLAlchemy compatibility if needed elsewhere.
    """
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


async def create_pool() -> asyncpg.Pool:
    """
    Creates the asyncpg connection pool.
    min_size=0 means no connections are opened immediately — they are
    established on demand. This avoids DNS/TCP failures at import time.
    """
    global _pool

    dsn = _build_dsn()

    _pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=0,          # Do NOT open connections immediately
        max_size=10,
        command_timeout=30,
        ssl="require" if settings.is_production else "prefer",
    )
    return _pool


async def close_pool() -> None:
    """Gracefully closes all connections. Called on app shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_pool() -> asyncpg.Pool:
    """
    Returns the active pool, creating it lazily on first call.
    Thread-safe via asyncio.Lock — concurrent first-calls will queue correctly.
    """
    global _pool

    if _pool is None:
        async with _pool_lock:
            if _pool is None:   # re-check inside the lock (double-checked locking)
                await create_pool()

    return _pool  # type: ignore[return-value]


async def get_db() -> asyncpg.Connection:
    """
    FastAPI dependency — yields a single connection from the pool.

    Usage:
        db: asyncpg.Connection = Depends(get_db)
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn


async def check_db_connection() -> bool:
    """
    Pings the database. Used by the /health endpoint.
    Returns True if reachable, False otherwise.
    """
    try:
        pool = await get_pool()
        await pool.fetchval("SELECT 1")
        return True
    except Exception as exc:
        logger.warning("DB health check failed: %s", exc)
        return False
