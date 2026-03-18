"""
Phase 11 — Notification Center Schemas.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


NotificationCategory = Literal[
    "deal", "payment", "kyc", "document", "invoice",
    "auction", "purchase", "account", "system"
]


class NotificationOut(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    body: str
    category: str
    resource_type: str | None
    resource_id: str | None
    is_read: bool
    read_at: datetime | None
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationOut]
    total: int
    unread_count: int
    page: int
    page_size: int


class UnreadCountResponse(BaseModel):
    unread_count: int
