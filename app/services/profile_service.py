"""
Phase 11 — User Profile Service.

Handles self-service profile updates, password changes, and avatar uploads.
Security:
  - Users can only update their own profile.
  - Password change requires the current password (re-authenticated via Supabase).
  - Avatar uploads are size + MIME validated server-side.
  - All field updates are explicit — no mass-assignment.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from uuid import UUID

import asyncpg
from fastapi import HTTPException, UploadFile

from app.config import settings
from app.core.file_validation import validate_magic_bytes
from app.schemas.auth import ChangePasswordBody, UpdateProfileBody, UserProfileResponse
from app.services.auth_service import (
    build_profile_response,
    get_supabase_admin_client,
    get_supabase_client,
)

logger = logging.getLogger(__name__)

AVATAR_BUCKET = "profile-avatars"
AVATAR_MAX_BYTES = 5 * 1024 * 1024   # 5 MB
AVATAR_ALLOWED_MIME = frozenset({"image/jpeg", "image/png", "image/webp"})
AVATAR_MIME_TO_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


# ══════════════════════════════════════════════════════════════════════════════
# UPDATE PROFILE
# ══════════════════════════════════════════════════════════════════════════════

async def update_profile(
    db: asyncpg.Connection,
    user: dict,
    body: UpdateProfileBody,
) -> UserProfileResponse:
    """
    Update mutable profile fields for the current user.
    Only provided (non-None) fields are updated.
    """
    updates: dict = {}

    if body.full_name is not None:
        updates["full_name"] = body.full_name
    if body.phone is not None:
        updates["phone"] = body.phone
    if body.country is not None:
        updates["country"] = body.country
    if body.company_name is not None:
        updates["company_name"] = body.company_name
    if body.company_reg_no is not None:
        updates["company_reg_no"] = body.company_reg_no

    if not updates:
        # Nothing to update — return current profile
        return build_profile_response(user)

    _ALLOWED_PROFILE_COLS = frozenset({"full_name", "phone", "country", "company_name", "company_reg_no"})
    if not updates.keys() <= _ALLOWED_PROFILE_COLS:
        raise ValueError(f"Invalid column(s): {updates.keys() - _ALLOWED_PROFILE_COLS}")

    now = datetime.now(timezone.utc)
    set_clauses = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(updates))
    values = list(updates.values())

    await db.execute(
        f"UPDATE public.profiles SET {set_clauses}, updated_at = ${len(values) + 2} WHERE id = $1",
        UUID(str(user["id"])), *values, now,
    )

    # Re-fetch updated profile to return accurate data
    updated = await db.fetchrow(
        """
        SELECT p.*, u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1
        """,
        UUID(str(user["id"])),
    )

    merged = {**dict(updated), "_client_ip": user.get("_client_ip", ""), "_user_agent": user.get("_user_agent", ""), "_raw_token": user.get("_raw_token", "")}
    return build_profile_response(merged)


# ══════════════════════════════════════════════════════════════════════════════
# CHANGE PASSWORD
# ══════════════════════════════════════════════════════════════════════════════

async def change_password(
    db: asyncpg.Connection,
    user: dict,
    body: ChangePasswordBody,
) -> dict:
    """
    Change the authenticated user's password.
    Step 1: Re-authenticate with current password to verify it's correct.
    Step 2: Update via Supabase Admin API.
    """
    email = user.get("email", "")

    # Step 1 — verify current password by attempting a fresh sign-in
    try:
        supabase = await get_supabase_client()
        await supabase.auth.sign_in_with_password({"email": email, "password": body.current_password})
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Current password is incorrect.",
        )

    # Step 2 — update via admin API (bypasses email confirmation flow)
    try:
        supabase_admin = await get_supabase_admin_client()
        await supabase_admin.auth.admin.update_user_by_id(
            str(user["id"]),
            {"password": body.new_password},
        )
    except Exception as exc:
        logger.error("Password change failed for user %s: %s", user["id"], exc)
        raise HTTPException(status_code=500, detail="Password change failed. Please try again.")

    return {"message": "Password updated successfully."}


# ══════════════════════════════════════════════════════════════════════════════
# AVATAR UPLOAD
# ══════════════════════════════════════════════════════════════════════════════

async def upload_avatar(
    db: asyncpg.Connection,
    user: dict,
    file: UploadFile,
) -> UserProfileResponse:
    """
    Upload a profile avatar image.
    Validates MIME type and file size server-side.
    Stores in profile-avatars/{user_id}/{uuid}.ext
    Updates profiles.avatar_url with the public URL.
    """
    content = await file.read()

    if len(content) == 0:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")
    if len(content) > AVATAR_MAX_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"Avatar exceeds maximum size of {AVATAR_MAX_BYTES // (1024 * 1024)} MB.",
        )

    mime = file.content_type or "application/octet-stream"
    if mime not in AVATAR_ALLOWED_MIME:
        raise HTTPException(
            status_code=422,
            detail="Avatar must be a JPEG, PNG, or WebP image.",
        )
    if not validate_magic_bytes(content, mime):
        raise HTTPException(
            status_code=422,
            detail="File content does not match the declared image type.",
        )

    ext = AVATAR_MIME_TO_EXT[mime]
    user_id = str(user["id"])
    file_uuid = uuid.uuid4()
    storage_path = f"{user_id}/{file_uuid}.{ext}"

    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(AVATAR_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": mime, "upsert": "true"},
        )
        # Get public URL (avatars are public so users can see their own photo)
        url_result = await supabase.storage.from_(AVATAR_BUCKET).get_public_url(storage_path)
        avatar_url = url_result if isinstance(url_result, str) else url_result.get("publicUrl", "")
    except Exception as exc:
        logger.error("Avatar upload failed for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Avatar upload failed. Please try again.")

    # Delete old avatar from Storage if one exists
    old_avatar = user.get("avatar_url")
    if old_avatar:
        try:
            old_path = old_avatar.split(f"/{AVATAR_BUCKET}/")[-1]
            await supabase.storage.from_(AVATAR_BUCKET).remove([old_path])
        except Exception:
            pass  # Non-fatal — old file cleanup failure doesn't block the update

    now = datetime.now(timezone.utc)
    await db.execute(
        "UPDATE public.profiles SET avatar_url = $1, updated_at = $2 WHERE id = $3",
        avatar_url, now, UUID(user_id),
    )

    updated = await db.fetchrow(
        "SELECT p.*, u.email FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE p.id = $1",
        UUID(user_id),
    )
    merged = {**dict(updated), "_client_ip": user.get("_client_ip", ""), "_user_agent": user.get("_user_agent", ""), "_raw_token": user.get("_raw_token", "")}
    return build_profile_response(merged)
