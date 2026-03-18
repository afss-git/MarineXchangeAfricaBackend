"""
Phase 11 — In-App Notification Service.

write_notification() is the core helper — call it (fire-and-forget via
asyncio.create_task) anywhere an event occurs that the user should see
in their notification feed.

Never raises — notification failure must never block the primary operation.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import HTTPException

from app.schemas.notifications import NotificationListResponse, NotificationOut, UnreadCountResponse

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# WRITE
# ══════════════════════════════════════════════════════════════════════════════

async def write_notification(
    db: asyncpg.Connection,
    *,
    user_id: UUID | str,
    title: str,
    body: str,
    category: str = "system",
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> None:
    """
    Persist a notification for a single user.
    Fire-and-forget safe — swallows all exceptions.
    """
    try:
        await db.execute(
            """
            INSERT INTO notifications.messages
                (user_id, title, body, category, resource_type, resource_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            UUID(str(user_id)),
            title[:200],
            body[:1000],
            category,
            resource_type,
            str(resource_id) if resource_id else None,
        )
    except Exception as exc:
        logger.error("write_notification failed user=%s: %s", user_id, exc)


async def write_notification_multi(
    db: asyncpg.Connection,
    *,
    user_ids: list[UUID | str],
    title: str,
    body: str,
    category: str = "system",
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> None:
    """Write the same notification to multiple users in one batch."""
    if not user_ids:
        return
    try:
        await db.executemany(
            """
            INSERT INTO notifications.messages
                (user_id, title, body, category, resource_type, resource_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            [
                (
                    UUID(str(uid)),
                    title[:200],
                    body[:1000],
                    category,
                    resource_type,
                    str(resource_id) if resource_id else None,
                )
                for uid in user_ids
            ],
        )
    except Exception as exc:
        logger.error("write_notification_multi failed: %s", exc)


# ══════════════════════════════════════════════════════════════════════════════
# READ
# ══════════════════════════════════════════════════════════════════════════════

def _row_to_notification(row: asyncpg.Record) -> NotificationOut:
    from app.services.document_service import _record_to_dict
    return NotificationOut(**_record_to_dict(row))


async def list_notifications(
    db: asyncpg.Connection,
    user: dict,
    page: int = 1,
    page_size: int = 20,
) -> NotificationListResponse:
    user_id = UUID(str(user["id"]))
    offset = (page - 1) * page_size

    total: int = await db.fetchval(
        "SELECT COUNT(*) FROM notifications.messages WHERE user_id = $1",
        user_id,
    )
    unread: int = await db.fetchval(
        "SELECT COUNT(*) FROM notifications.messages WHERE user_id = $1 AND is_read = FALSE",
        user_id,
    )
    rows = await db.fetch(
        """
        SELECT * FROM notifications.messages
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        """,
        user_id, page_size, offset,
    )

    return NotificationListResponse(
        items=[_row_to_notification(r) for r in rows],
        total=total,
        unread_count=unread,
        page=page,
        page_size=page_size,
    )


async def get_unread_count(
    db: asyncpg.Connection,
    user: dict,
) -> UnreadCountResponse:
    user_id = UUID(str(user["id"]))
    count: int = await db.fetchval(
        "SELECT COUNT(*) FROM notifications.messages WHERE user_id = $1 AND is_read = FALSE",
        user_id,
    )
    return UnreadCountResponse(unread_count=count)


async def mark_read(
    db: asyncpg.Connection,
    notification_id: UUID,
    user: dict,
) -> NotificationOut:
    from datetime import datetime, timezone
    user_id = UUID(str(user["id"]))

    row = await db.fetchrow(
        "SELECT * FROM notifications.messages WHERE id = $1 AND user_id = $2",
        notification_id, user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found.")

    if not row["is_read"]:
        now = datetime.now(timezone.utc)
        await db.execute(
            "UPDATE notifications.messages SET is_read = TRUE, read_at = $1 WHERE id = $2",
            now, notification_id,
        )
        row = await db.fetchrow(
            "SELECT * FROM notifications.messages WHERE id = $1", notification_id
        )

    return _row_to_notification(row)


async def mark_all_read(
    db: asyncpg.Connection,
    user: dict,
) -> dict:
    from datetime import datetime, timezone
    user_id = UUID(str(user["id"]))
    now = datetime.now(timezone.utc)

    updated = await db.fetchval(
        """
        WITH updated AS (
            UPDATE notifications.messages
            SET is_read = TRUE, read_at = $1
            WHERE user_id = $2 AND is_read = FALSE
            RETURNING id
        )
        SELECT COUNT(*) FROM updated
        """,
        now, user_id,
    )
    return {"message": f"{updated} notification(s) marked as read."}
