"""
Role-based permission system.
Permissions are checked in the application layer BEFORE any database operation.
RLS in Supabase acts as a hard backstop — both layers must pass.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

# Full permission registry
# Format: "resource.action" -> [roles_allowed]
# "*" means all authenticated users
PERMISSIONS: dict[str, list[str]] = {
    # ── Products ──────────────────────────────────────────────────────────────
    "product.create":                       ["seller"],
    "product.edit_draft":                   ["seller"],
    "product.submit_for_verification":      ["seller"],
    "product.resubmit_after_failure":       ["seller"],
    "product.view_public":                  ["*"],
    "product.view_own":                     ["seller"],
    "product.view_all":                     ["admin", "finance_admin"],
    "product.approve":                      ["admin"],
    "product.reject":                       ["admin"],
    "product.permanently_reject":           ["admin"],
    "product.delist":                       ["admin", "seller"],
    "product.assign_verification_agent":    ["admin"],

    # ── Verification ──────────────────────────────────────────────────────────
    "verification.view_assigned":           ["verification_agent"],
    "verification.update_status":           ["verification_agent"],
    "verification.submit_report":           ["verification_agent"],
    "verification.upload_evidence":         ["verification_agent"],
    "verification.view_all":               ["admin"],

    # ── KYC ───────────────────────────────────────────────────────────────────
    "kyc.submit_documents":                 ["buyer"],
    "kyc.view_own":                         ["buyer"],
    "kyc.assign_agent":                     ["admin"],
    "kyc.view_assigned":                    ["verification_agent"],
    "kyc.submit_report":                    ["verification_agent"],
    "kyc.mark_verified":                    ["admin"],
    "kyc.mark_rejected":                    ["admin"],
    "kyc.view_all":                         ["admin"],

    # ── Purchase Requests ─────────────────────────────────────────────────────
    "purchase.create":                      ["buyer"],       # + KYC required
    "purchase.view_own":                    ["buyer"],
    "purchase.view_all":                    ["admin", "buyer_agent"],
    "purchase.assign_buyer_agent":          ["admin"],
    "purchase.cancel":                      ["buyer", "admin"],

    # ── Buyer Agent ───────────────────────────────────────────────────────────
    "buyer_agent.view_assigned":            ["buyer_agent"],
    "buyer_agent.update_status":            ["buyer_agent"],

    # ── Auctions ──────────────────────────────────────────────────────────────
    "auction.view_public":                  ["*"],
    "auction.bid":                          ["buyer"],       # + KYC required
    "auction.create":                       ["admin"],
    "auction.declare_winner":               ["admin"],
    "auction.view_reserve_price":           ["admin", "finance_admin"],

    # ── Financing Requests ────────────────────────────────────────────────────
    "finance_request.create":               ["buyer"],       # + KYC required
    "finance_request.view_own":             ["buyer"],
    "finance_request.upload_documents":     ["buyer"],
    "finance_request.view_all_admin":       ["admin"],
    "finance_request.approve_admin":        ["admin"],
    "finance_request.reject_admin":         ["admin"],
    "finance_request.view_all_finance":     ["finance_admin"],
    "finance_request.configure_terms":      ["finance_admin"],
    "finance_request.approve_finance":      ["finance_admin"],
    "finance_request.reject_finance":       ["finance_admin"],

    # ── Transactions & Payments ───────────────────────────────────────────────
    "transaction.view_own":                 ["buyer"],
    "transaction.view_all":                 ["admin", "finance_admin"],
    "transaction.record":                   ["finance_admin"],
    "transaction.verify_payment":           ["finance_admin"],
    "transaction.high_value_approve":       ["finance_admin"],

    # ── Finance Portal ────────────────────────────────────────────────────────
    "finance_portal.access":                ["buyer"],
    "finance_portal.provision":             ["finance_admin"],

    # ── Exchange Rates ────────────────────────────────────────────────────────
    "exchange_rate.update":                 ["finance_admin"],
    "exchange_rate.view":                   ["admin", "finance_admin"],

    # ── Audit ─────────────────────────────────────────────────────────────────
    "audit.view":                           ["admin", "finance_admin"],
    "audit.verify_hash_chain":              ["finance_admin"],

    # ── User Management (Admin) ───────────────────────────────────────────────
    "user.create_agent":                    ["admin"],
    "user.create_admin":                    ["admin"],
    "user.deactivate":                      ["admin"],
    "user.change_role":                     ["admin"],
    "user.view_all":                        ["admin", "finance_admin"],

    # ── Notifications ─────────────────────────────────────────────────────────
    "notification.view_own":                ["*"],
}


def has_permission(user_roles: list[str], permission: str) -> bool:
    """
    Returns True if any of the user's roles grants the given permission.
    Users with multiple roles benefit from the union of permissions.
    """
    allowed = PERMISSIONS.get(permission, [])

    if "*" in allowed:
        return True

    return any(role in allowed for role in user_roles)


def require_permission(permission: str):
    """
    FastAPI dependency factory — raises HTTP 403 if the user lacks permission.

    Usage:
        @router.get("/", dependencies=[Depends(require_permission("product.view_all"))])
        async def list_products(): ...
    """
    from app.deps import get_current_user  # local import to avoid circular

    async def _check(user: dict = Depends(get_current_user)):
        if not has_permission(user["roles"], permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You do not have permission to perform this action.",
            )
        return user

    return _check


def require_kyc_verified(user: dict) -> None:
    """
    Raises HTTP 403 if the buyer has not completed KYC verification.
    Call this explicitly in endpoints that require verified buyers.
    """
    if "buyer" in user["roles"] and user.get("kyc_status") != "verified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This action requires KYC verification. "
                "Please complete your identity verification first."
            ),
        )
