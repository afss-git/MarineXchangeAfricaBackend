"""
Phase 11 — Notification Center Router.

Prefix: /notifications  (mounted under /api/v1)

Endpoints:
  GET   /notifications                — paginated notification feed
  GET   /notifications/unread-count   — bell icon count
  PATCH /notifications/{id}/read      — mark one as read
  POST  /notifications/read-all       — mark all as read
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Query

from app.deps import CurrentUser, DbConn
from app.schemas.notifications import (
    NotificationListResponse,
    NotificationOut,
    UnreadCountResponse,
)
from app.services import notifications_service

router = APIRouter(tags=["Notifications"])


@router.get(
    "/",
    response_model=NotificationListResponse,
    summary="Get your notification feed (newest first)",
)
async def list_notifications(
    db: DbConn,
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await notifications_service.list_notifications(db, current_user, page, page_size)


@router.get(
    "/unread-count",
    response_model=UnreadCountResponse,
    summary="Get unread notification count (for the bell icon)",
)
async def get_unread_count(
    db: DbConn,
    current_user: CurrentUser,
):
    return await notifications_service.get_unread_count(db, current_user)


@router.patch(
    "/{notification_id}/read",
    response_model=NotificationOut,
    summary="Mark a single notification as read",
)
async def mark_read(
    notification_id: UUID,
    db: DbConn,
    current_user: CurrentUser,
):
    return await notifications_service.mark_read(db, notification_id, current_user)


@router.post(
    "/read-all",
    summary="Mark all notifications as read",
)
async def mark_all_read(
    db: DbConn,
    current_user: CurrentUser,
) -> dict:
    return await notifications_service.mark_all_read(db, current_user)
