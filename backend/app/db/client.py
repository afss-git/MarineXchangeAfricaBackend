"""
Async PostgreSQL connection pool via asyncpg.
All queries use parameterized statements — no raw string interpolation.
"""
from __future__ import annotations

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None


async def create_pool() -> asyncpg.Pool:
    """Create the connection pool. Called once on app startup."""
    global _pool

    # Strip SQLAlchemy-style prefix if present
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

    _pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=2,
        max_size=10,
        command_timeout=30,
        # Enforce SSL in production
        ssl="require" if settings.is_production else "prefer",
    )
    return _pool


async def close_pool() -> None:
    """Gracefully close all connections. Called on app shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_pool() -> asyncpg.Pool:
    """Return the active pool. Raises if pool not initialized."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call create_pool() first.")
    return _pool


async def get_db() -> asyncpg.Connection:
    """
    FastAPI dependency — yields a single connection from the pool.
    Use in route handlers via: db: asyncpg.Connection = Depends(get_db)
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn
