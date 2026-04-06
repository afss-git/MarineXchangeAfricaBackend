"""
Phase 11 — Admin User Management Router.

Prefix: /admin/users  (mounted under /api/v1)

Endpoints:
  GET    /admin/users              — list all users (filters: role, kyc_status, active, search)
  GET    /admin/users/{id}         — get full profile of a specific user
  PATCH  /admin/users/{id}/roles   — set user's roles
  POST   /admin/users/{id}/deactivate   — deactivate account
  POST   /admin/users/{id}/reactivate   — reactivate account
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.audit import AuditAction, write_audit_log
from app.deps import AdminUser, DbConn

router = APIRouter(tags=["Admin — Users"])

VALID_ROLES = {"buyer", "seller", "verification_agent", "buyer_agent", "admin", "finance_admin"}


class UpdateRolesBody(BaseModel):
    roles: list[str] = Field(..., min_length=1)

    def validated_roles(self) -> list[str]:
        invalid = set(self.roles) - VALID_ROLES
        if invalid:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail=f"Invalid roles: {sorted(invalid)}. Valid: {sorted(VALID_ROLES)}",
            )
        return self.roles


class DeactivateBody(BaseModel):
    reason: str = Field(..., min_length=5, max_length=500)


# ── List users ────────────────────────────────────────────────────────────────

@router.get(
    "",
    summary="List all users with optional filters",
)
async def list_users(
    db: DbConn,
    current_user: AdminUser,
    role: str | None = Query(default=None, description="Filter by role"),
    kyc_status: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    search: str | None = Query(default=None, description="Search by name or email"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> dict:
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if role:
        conditions.append("$" + str(idx) + " = ANY(p.roles)")
        params.append(role)
        idx += 1
    if kyc_status:
        conditions.append(f"p.kyc_status = ${idx}")
        params.append(kyc_status)
        idx += 1
    if is_active is not None:
        conditions.append(f"p.is_active = ${idx}")
        params.append(is_active)
        idx += 1
    if search:
        conditions.append(f"(p.full_name ILIKE ${idx} OR u.email ILIKE ${idx})")
        params.append(f"%{search}%")
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * page_size

    total = await db.fetchval(
        f"""
        SELECT COUNT(*) FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE {where}
        """,
        *params,
    )

    rows = await db.fetch(
        f"""
        SELECT
            p.id, p.full_name, p.company_name, p.company_reg_no,
            p.phone, p.phone_verified, p.country, p.roles, p.kyc_status, p.avatar_url,
            p.is_active, p.created_at, p.updated_at,
            u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE {where}
        ORDER BY p.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, page_size, offset,
    )

    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ── Get single user ───────────────────────────────────────────────────────────

@router.get(
    "/{user_id}",
    summary="Get full profile of a specific user",
)
async def get_user(
    user_id: UUID,
    db: DbConn,
    current_user: AdminUser,
) -> dict:
    row = await db.fetchrow(
        """
        SELECT
            p.id, p.full_name, p.company_name, p.company_reg_no,
            p.phone, p.phone_verified, p.country, p.roles, p.kyc_status, p.avatar_url,
            p.is_active, p.created_at, p.updated_at,
            u.email,
            (SELECT COUNT(*) FROM finance.deals WHERE buyer_id = p.id) AS deals_as_buyer,
            (SELECT COUNT(*) FROM finance.deals WHERE seller_id = p.id) AS deals_as_seller,
            (SELECT COUNT(*) FROM marketplace.purchase_requests WHERE buyer_id = p.id) AS purchase_requests
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1
        """,
        user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")
    return dict(row)


# ── Update roles ──────────────────────────────────────────────────────────────

@router.patch(
    "/{user_id}/roles",
    summary="Set a user's roles (replaces existing roles)",
)
async def update_roles(
    user_id: UUID,
    body: UpdateRolesBody,
    db: DbConn,
    current_user: AdminUser,
) -> dict:
    new_roles = body.validated_roles()

    row = await db.fetchrow("SELECT roles FROM public.profiles WHERE id = $1", user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")

    old_roles = list(row["roles"])
    now = datetime.now(timezone.utc)

    await db.execute(
        "UPDATE public.profiles SET roles = $1, updated_at = $2 WHERE id = $3",
        new_roles, now, user_id,
    )

    await write_audit_log(
        db,
        actor_id=current_user["id"],
        actor_roles=current_user.get("roles", []),
        action=AuditAction.AUTH_ROLE_CHANGED,
        resource_type="profile",
        resource_id=str(user_id),
        old_state={"roles": old_roles},
        new_state={"roles": new_roles},
    )

    return {"user_id": str(user_id), "roles": new_roles, "message": "Roles updated."}


# ── Deactivate / Reactivate ───────────────────────────────────────────────────

@router.post(
    "/{user_id}/deactivate",
    summary="Deactivate a user account",
)
async def deactivate_user(
    user_id: UUID,
    body: DeactivateBody,
    db: DbConn,
    current_user: AdminUser,
) -> dict:
    row = await db.fetchrow("SELECT is_active FROM public.profiles WHERE id = $1", user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")
    if not row["is_active"]:
        raise HTTPException(status_code=409, detail="Account is already deactivated.")

    # Prevent self-deactivation
    if str(user_id) == str(current_user["id"]):
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")

    now = datetime.now(timezone.utc)
    await db.execute(
        "UPDATE public.profiles SET is_active = FALSE, updated_at = $1 WHERE id = $2",
        now, user_id,
    )

    await write_audit_log(
        db,
        actor_id=current_user["id"],
        actor_roles=current_user.get("roles", []),
        action=AuditAction.AUTH_ACCOUNT_DEACTIVATED,
        resource_type="profile",
        resource_id=str(user_id),
        new_state={"reason": body.reason},
    )

    return {"user_id": str(user_id), "is_active": False, "message": "Account deactivated."}


@router.post(
    "/{user_id}/reactivate",
    summary="Reactivate a user account",
)
async def reactivate_user(
    user_id: UUID,
    db: DbConn,
    current_user: AdminUser,
) -> dict:
    row = await db.fetchrow("SELECT is_active FROM public.profiles WHERE id = $1", user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")
    if row["is_active"]:
        raise HTTPException(status_code=409, detail="Account is already active.")

    now = datetime.now(timezone.utc)
    await db.execute(
        "UPDATE public.profiles SET is_active = TRUE, updated_at = $1 WHERE id = $2",
        now, user_id,
    )

    await write_audit_log(
        db,
        actor_id=current_user["id"],
        actor_roles=current_user.get("roles", []),
        action=AuditAction.AUTH_USER_REACTIVATED,
        resource_type="profile",
        resource_id=str(user_id),
        new_state={"is_active": True},
        metadata={"action": "reactivated"},
    )

    return {"user_id": str(user_id), "is_active": True, "message": "Account reactivated."}
