from __future__ import annotations

"""
Core authentication service.
Handles all interactions with Supabase Auth + profile management.

Security principles:
- Supabase stores and verifies passwords — we never handle raw credentials
- Profile creation is atomic — orphan auth users are cleaned up on failure
- All logins are audited
- Role checks happen before any data is returned
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import HTTPException, Request, status
from gotrue.errors import AuthApiError
from supabase import AClient, acreate_client

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.schemas.auth import AuthTokenResponse, UserProfileResponse

logger = logging.getLogger(__name__)


# ── Supabase client factory ───────────────────────────────────────────────────

async def get_supabase_client() -> AClient:
    """Returns an async Supabase client using the anon key (for auth operations)."""
    return await acreate_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


async def get_supabase_admin_client() -> AClient:
    """
    Returns an async Supabase client using the service role key.
    Use ONLY for administrative operations (creating users, bypassing email confirmation).
    NEVER expose this client or its key to the frontend.
    """
    return await acreate_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


# ── Signup ────────────────────────────────────────────────────────────────────

async def create_user_with_profile(
    *,
    db: asyncpg.Connection,
    email: str,
    password: str,
    full_name: str,
    company_name: str | None,
    company_reg_no: str | None,
    phone: str,
    country: str,
    roles: list[str],
    request: Request,
) -> dict:
    """
    Creates a Supabase auth user then immediately inserts the profile.
    If profile creation fails, the auth user is deleted to prevent orphans.

    Returns the created profile record.
    """
    supabase = await get_supabase_client()
    auth_user_id: str | None = None

    try:
        # Step 1: Create auth user in Supabase
        auth_response = await supabase.auth.sign_up({
            "email": email.lower().strip(),
            "password": password,
            "options": {
                "data": {
                    "full_name": full_name,
                    "roles": roles,
                }
            },
        })

        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account creation failed. Please try again.",
            )

        auth_user_id = str(auth_response.user.id)

        # Step 2: Insert profile (using DB connection which uses service role)
        profile = await db.fetchrow(
            """
            INSERT INTO public.profiles
                (id, full_name, company_name, company_reg_no, phone, country,
                 roles, kyc_status, is_active)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7,
                 CASE WHEN 'buyer' = ANY($7) THEN 'pending' ELSE 'not_applicable' END,
                 true)
            RETURNING *
            """,
            UUID(auth_user_id),
            full_name.strip(),
            company_name.strip() if company_name else None,
            company_reg_no.strip() if company_reg_no else None,
            phone,
            country.strip(),
            roles,
        )

        # Step 3: Audit log
        await write_audit_log(
            db,
            actor_id=auth_user_id,
            actor_roles=roles,
            action=AuditAction.AUTH_SIGNUP,
            resource_type="profile",
            resource_id=auth_user_id,
            new_state={"email": email, "roles": roles, "country": country},
            metadata={
                "ip": getattr(request.state, "client_ip", "unknown"),
                "user_agent": getattr(request.state, "user_agent", ""),
            },
        )

        return dict(profile)

    except HTTPException:
        raise

    except asyncpg.UniqueViolationError:
        # Profile already exists — email is already registered
        await _cleanup_orphan_auth_user(auth_user_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists.",
        )

    except Exception as exc:
        logger.error("Signup failed for %s: %s", email, exc)
        error_msg = str(exc).lower()
        if "rate limit" in error_msg or "over_email_send_rate_limit" in error_msg:
            await _cleanup_orphan_auth_user(auth_user_id)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many signup attempts. Please wait a few minutes and try again.",
            )
        await _cleanup_orphan_auth_user(auth_user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account creation failed. Please try again.",
        )


async def create_internal_user(
    *,
    db: asyncpg.Connection,
    email: str,
    full_name: str,
    company_name: str | None,
    company_reg_no: str | None,
    phone: str,
    country: str,
    roles: list[str],
    created_by: UUID,
    invited_by_name: str,
    request: Request,
    custom_password: str | None = None,
) -> tuple[dict, str, str | None, bool]:
    """
    Creates an internal user (agent, admin, finance_admin).

    Returns: (profile_dict, password, invite_link_or_None, email_sent)
    - password: the temp password (auto-generated or admin-supplied)
    - invite_link: a Supabase one-time link for password setup, or None if generation failed
    - email_sent: whether the invite email was dispatched via Resend
    """
    import secrets
    import string
    import httpx
    from app.services.notification_service import send_staff_welcome

    admin_client = await get_supabase_admin_client()
    auth_user_id: str | None = None

    ROLE_LABELS = {
        "verification_agent": "Verification Agent",
        "buyer_agent": "KYC Agent",
        "admin": "Administrator",
        "finance_admin": "Finance Administrator",
    }
    role_label = ROLE_LABELS.get(roles[0], roles[0].replace("_", " ").title())
    login_url = f"{settings.FRONTEND_URL.rstrip('/')}/login"
    set_password_url = f"{settings.FRONTEND_URL.rstrip('/')}/auth/set-password"

    # Use admin-supplied password or generate a secure random one
    if custom_password:
        password = custom_password
    else:
        alphabet = string.ascii_letters + string.digits + "!@#$%"
        while True:
            password = "".join(secrets.choice(alphabet) for _ in range(16))
            if (any(c.isupper() for c in password)
                    and any(c.islower() for c in password)
                    and any(c.isdigit() for c in password)
                    and any(c in "!@#$%" for c in password)):
                break

    try:
        # Create the auth user with the password
        auth_response = await admin_client.auth.admin.create_user({
            "email": email.lower().strip(),
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": full_name,
                "roles": roles,
                "created_by": str(created_by),
                "requires_password_change": True,
            },
        })

        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Internal user creation failed.",
            )

        auth_user_id = str(auth_response.user.id)

        # Try to generate a one-time password-reset link via direct HTTP to Supabase REST API.
        # The gotrue Python SDK routes generate_link() to the wrong endpoint, so we call directly.
        invite_link: str | None = None
        try:
            async with httpx.AsyncClient(timeout=10.0) as http:
                gen_resp = await http.post(
                    f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/admin/generate_link",
                    headers={
                        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "type": "recovery",
                        "email": email.lower().strip(),
                        "redirect_to": set_password_url,
                    },
                )
            if gen_resp.status_code in (200, 201):
                invite_link = gen_resp.json().get("action_link")
                if invite_link:
                    logger.info("Generated invite link for %s", email)
                else:
                    logger.warning("generate_link returned no action_link for %s: %s", email, gen_resp.text)
            else:
                logger.warning("generate_link HTTP %s for %s: %s", gen_resp.status_code, email, gen_resp.text[:200])
        except Exception as link_exc:
            logger.warning("generate_link failed for %s (non-fatal): %s", email, link_exc)

        profile = await db.fetchrow(
            """
            INSERT INTO public.profiles
                (id, full_name, company_name, company_reg_no, phone, country,
                 roles, kyc_status, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7::text[], 'not_applicable', true)
            RETURNING *
            """,
            UUID(auth_user_id),
            full_name.strip(),
            company_name,
            company_reg_no,
            phone,
            country.strip(),
            roles,
        )

        # Send invite email — failure does NOT block account creation
        email_sent = await send_staff_welcome(
            staff_email=email.lower().strip(),
            staff_name=full_name,
            role_label=role_label,
            password=password,
            invite_link=invite_link,
            login_url=login_url,
            invited_by_name=invited_by_name,
        )

        return dict(profile), password, invite_link, email_sent

    except HTTPException:
        raise

    except AuthApiError as exc:
        logger.error("Supabase auth error creating user %s: %s", email, exc)
        await _cleanup_orphan_auth_user(auth_user_id, use_admin=True)
        # Supabase returns "User already registered" when email exists in auth
        if "already registered" in str(exc).lower() or "already exists" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email address already exists.",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Auth provider error: {exc}",
        )

    except asyncpg.UniqueViolationError:
        await _cleanup_orphan_auth_user(auth_user_id, use_admin=True)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists.",
        )

    except Exception as exc:
        logger.error("Internal user creation failed for %s: %r", email, exc, exc_info=True)
        await _cleanup_orphan_auth_user(auth_user_id, use_admin=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"User creation failed: {type(exc).__name__}: {exc}",
        )


# ── Bootstrap First Admin ─────────────────────────────────────────────────────

async def create_first_admin(
    *,
    db: asyncpg.Connection,
    email: str,
    password: str,
    full_name: str,
    phone: str,
    country: str,
    request: Request,
) -> dict:
    """
    Creates the very first admin account.

    Key differences from create_internal_user:
    - Operator supplies their own chosen password (not a temp one).
    - Does NOT set requires_password_change metadata.
    - Guarded at the endpoint layer: only callable when zero admin profiles exist.
    """
    admin_client = await get_supabase_admin_client()
    auth_user_id: str | None = None

    try:
        auth_response = await admin_client.auth.admin.create_user({
            "email": email.lower().strip(),
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": full_name,
                "roles": ["admin"],
            },
        })

        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Admin account creation failed. Please try again.",
            )

        auth_user_id = str(auth_response.user.id)

        profile = await db.fetchrow(
            """
            INSERT INTO public.profiles
                (id, full_name, phone, country, roles, kyc_status, is_active)
            VALUES ($1, $2, $3, $4, '{admin}', 'not_applicable', true)
            RETURNING *
            """,
            UUID(auth_user_id),
            full_name.strip(),
            phone,
            country.strip(),
        )

        await write_audit_log(
            db,
            actor_id=auth_user_id,
            actor_roles=["admin"],
            action=AuditAction.AUTH_SIGNUP,
            resource_type="profile",
            resource_id=auth_user_id,
            new_state={"email": email, "roles": ["admin"], "bootstrap": True},
            metadata={
                "ip": getattr(request.state, "client_ip", "unknown"),
                "user_agent": getattr(request.state, "user_agent", ""),
                "note": "First admin bootstrapped via /auth/internal/bootstrap",
            },
        )

        return dict(profile)

    except HTTPException:
        raise

    except asyncpg.UniqueViolationError:
        await _cleanup_orphan_auth_user(auth_user_id, use_admin=True)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists.",
        )

    except Exception as exc:
        logger.error("Bootstrap admin creation failed for %s: %s", email, exc)
        await _cleanup_orphan_auth_user(auth_user_id, use_admin=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin account creation failed. Please try again.",
        )


# ── Login ─────────────────────────────────────────────────────────────────────

async def login_user(
    *,
    db: asyncpg.Connection,
    email: str,
    password: str,
    required_role: str | None,
    request: Request,
    required_role_any: list[str] | None = None,
) -> AuthTokenResponse:
    """
    Authenticates a user via Supabase, then validates their role.

    Args:
        required_role: Single role that must be present (e.g. "buyer").
        required_role_any: List of roles — user must have at least one (e.g. agents).
    """
    supabase = await get_supabase_client()

    try:
        auth_response = await supabase.auth.sign_in_with_password({
            "email": email.lower().strip(),
            "password": password,
        })
    except Exception as exc:
        error_msg = str(exc).lower()

        if "email not confirmed" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email address before logging in.",
            )

        if "invalid login credentials" in error_msg or "invalid" in error_msg:
            # Generic message — never hint at whether email or password is wrong
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        logger.error("Login error for %s: %s", email, exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login failed. Please try again.",
        )

    if not auth_response.user or not auth_response.session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    user_id = UUID(str(auth_response.user.id))

    # Load profile
    profile = await db.fetchrow(
        """
        SELECT p.*, u.email
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE p.id = $1
        """,
        user_id,
    )

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account profile not found. Please contact support.",
        )

    if not profile["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated. Please contact support.",
        )

    # Role validation
    user_roles: list[str] = profile["roles"]

    if required_role and required_role not in user_roles:
        await _audit_failed_login(db, user_id, user_roles, required_role, request)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This login portal is for {required_role} accounts only.",
        )

    if required_role_any:
        if not any(r in user_roles for r in required_role_any):
            await _audit_failed_login(db, user_id, user_roles, str(required_role_any), request)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have the required role to access this portal.",
            )

    # Audit successful login
    await write_audit_log(
        db,
        actor_id=user_id,
        actor_roles=user_roles,
        action=AuditAction.AUTH_LOGIN,
        resource_type="session",
        resource_id=str(user_id),
        metadata={
            "ip": getattr(request.state, "client_ip", "unknown"),
            "user_agent": getattr(request.state, "user_agent", ""),
            "portal": required_role or "agent",
        },
    )

    session = auth_response.session

    return AuthTokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in or 3600,
        user=build_profile_response({**dict(profile), "email": auth_response.user.email}),
    )


# ── Logout ────────────────────────────────────────────────────────────────────

async def logout_user(
    *,
    db: asyncpg.Connection,
    token: str,
    user: dict,
    request: Request,
) -> None:
    """
    Signs the user out of Supabase (invalidates the session token).
    """
    try:
        supabase = await get_supabase_client()
        # Set the session so we sign out the correct user
        await supabase.auth.set_session(token, "")
        await supabase.auth.sign_out()
    except Exception as exc:
        logger.warning("Logout supabase call failed (token may already be expired): %s", exc)
        # Still audit the logout attempt and return success to the client
        # The token will expire naturally

    await write_audit_log(
        db,
        actor_id=user["id"],
        actor_roles=user["roles"],
        action=AuditAction.AUTH_LOGOUT,
        resource_type="session",
        resource_id=str(user["id"]),
        metadata={
            "ip": user.get("_client_ip", "unknown"),
            "user_agent": user.get("_user_agent", ""),
        },
    )


# ── Response builder ──────────────────────────────────────────────────────────

def build_profile_response(profile: dict | asyncpg.Record) -> UserProfileResponse:
    """Converts a raw DB profile row to a safe API response."""
    p = dict(profile)
    return UserProfileResponse(
        id=p["id"],
        email=p.get("email", ""),
        full_name=p["full_name"],
        company_name=p.get("company_name"),
        company_reg_no=p.get("company_reg_no"),
        phone=p.get("phone"),
        country=p.get("country"),
        roles=p["roles"],
        kyc_status=p["kyc_status"],
        is_active=p["is_active"],
        created_at=str(p["created_at"]),
    )


# ── Private helpers ───────────────────────────────────────────────────────────

async def _cleanup_orphan_auth_user(
    auth_user_id: str | None,
    use_admin: bool = False,
) -> None:
    """
    Deletes an orphaned Supabase auth user when profile creation fails.
    Called in the except block of create_user_with_profile.
    """
    if not auth_user_id:
        return
    try:
        client = (
            await get_supabase_admin_client()
            if use_admin
            else await get_supabase_admin_client()  # always need admin to delete
        )
        await client.auth.admin.delete_user(auth_user_id)
    except Exception as exc:
        logger.error(
            "CRITICAL: Failed to cleanup orphan auth user %s: %s",
            auth_user_id, exc
        )


async def _audit_failed_login(
    db: asyncpg.Connection,
    user_id: UUID,
    user_roles: list[str],
    attempted_role: str,
    request: Request,
) -> None:
    """Logs a failed login attempt due to role mismatch."""
    await write_audit_log(
        db,
        actor_id=user_id,
        actor_roles=user_roles,
        action=AuditAction.AUTH_FAILED_PERMISSION,
        resource_type="session",
        resource_id=str(user_id),
        metadata={
            "reason": "role_mismatch",
            "attempted_role": attempted_role,
            "actual_roles": user_roles,
            "ip": getattr(request.state, "client_ip", "unknown"),
        },
    )
