"""
Immutable audit logging system.
Every significant action writes to audit.logs via the service role connection.
The audit.logs table has a DB-level trigger preventing UPDATE/DELETE.
"""
from __future__ import annotations

import json
from enum import StrEnum
from typing import Any
from uuid import UUID

import asyncpg


class AuditAction(StrEnum):
    # ── Auth ──────────────────────────────────────────────────────────────────
    AUTH_SIGNUP             = "auth.signup"
    AUTH_LOGIN              = "auth.login"
    AUTH_LOGOUT             = "auth.logout"
    AUTH_ROLE_ADDED         = "auth.role_added"
    AUTH_ROLE_CHANGED       = "auth.role_changed"
    AUTH_ACCOUNT_DEACTIVATED= "auth.account_deactivated"
    AUTH_FAILED_PERMISSION  = "auth.failed_permission_check"
    AUTH_UNAUTHORIZED_ACCESS= "auth.unauthorized_access"
    AUTH_PASSWORD_CHANGE    = "auth.password_change"

    # ── Products ──────────────────────────────────────────────────────────────
    PRODUCT_CREATED         = "product.created"
    PRODUCT_UPDATED         = "product.updated"
    PRODUCT_SUBMITTED       = "product.submitted_for_verification"
    PRODUCT_RESUBMITTED     = "product.resubmitted"
    PRODUCT_APPROVED        = "product.approved"
    PRODUCT_REJECTED        = "product.rejected"
    PRODUCT_PERMANENTLY_REJECTED = "product.permanently_rejected"
    PRODUCT_DELISTED        = "product.delisted"

    # ── Verification ──────────────────────────────────────────────────────────
    VERIFICATION_AGENT_ASSIGNED = "verification.agent_assigned"
    VERIFICATION_STATUS_UPDATED = "verification.status_updated"
    VERIFICATION_REPORT_SUBMITTED = "verification.report_submitted"
    VERIFICATION_EVIDENCE_UPLOADED = "verification.evidence_uploaded"

    # ── KYC ───────────────────────────────────────────────────────────────────
    KYC_DOCUMENTS_SUBMITTED = "kyc.documents_submitted"
    KYC_AGENT_ASSIGNED      = "kyc.agent_assigned"
    KYC_REPORT_SUBMITTED    = "kyc.report_submitted"
    KYC_VERIFIED            = "kyc.verified"
    KYC_REJECTED            = "kyc.rejected"

    # ── Purchase ──────────────────────────────────────────────────────────────
    PURCHASE_REQUEST_CREATED  = "purchase.request_created"
    PURCHASE_AGENT_ASSIGNED   = "purchase.agent_assigned"
    PURCHASE_STATUS_UPDATED   = "purchase.status_updated"
    PURCHASE_CANCELLED        = "purchase.cancelled"

    # ── Auctions ──────────────────────────────────────────────────────────────
    AUCTION_CREATED         = "auction.created"
    AUCTION_BID_PLACED      = "auction.bid_placed"
    AUCTION_WINNER_DECLARED = "auction.winner_declared"
    AUCTION_CANCELLED       = "auction.cancelled"
    AUCTION_FAILED_NO_BIDS  = "auction.failed_no_bids"
    AUCTION_FAILED_RESERVE  = "auction.failed_reserve_not_met"

    # ── Finance ───────────────────────────────────────────────────────────────
    FINANCE_REQUEST_CREATED       = "finance.request_created"
    FINANCE_DOCUMENTS_UPLOADED    = "finance.documents_uploaded"
    FINANCE_ADMIN_APPROVED        = "finance.admin_approved"
    FINANCE_ADMIN_REJECTED        = "finance.admin_rejected"
    FINANCE_TERMS_CONFIGURED      = "finance.terms_configured"
    FINANCE_FINANCE_ADMIN_APPROVED= "finance.finance_admin_approved"
    FINANCE_FINANCE_ADMIN_REJECTED= "finance.finance_admin_rejected"
    FINANCE_AGREEMENT_CREATED     = "finance.agreement_created"
    FINANCE_PORTAL_PROVISIONED    = "finance.portal_provisioned"
    FINANCE_PORTAL_ACCESSED       = "finance.portal_accessed"
    FINANCE_PORTAL_UNAUTHORIZED   = "finance.portal_unauthorized_access"
    FINANCE_REQUEST_EXPIRED       = "finance.request_expired"

    # ── Transactions ──────────────────────────────────────────────────────────
    TRANSACTION_RECORDED    = "transaction.recorded"
    TRANSACTION_VERIFIED    = "transaction.verified"
    PAYMENT_RECORDED        = "payment.recorded"
    PAYMENT_VERIFIED        = "payment.verified"
    PAYMENT_DISPUTED        = "payment.disputed"

    # ── Exchange Rates ────────────────────────────────────────────────────────
    EXCHANGE_RATE_UPDATED   = "exchange_rate.updated"

    # ── Audit ─────────────────────────────────────────────────────────────────
    HASH_CHAIN_VERIFIED     = "audit.hash_chain_verified"
    HASH_CHAIN_INTEGRITY_FAILURE = "audit.hash_chain_integrity_failure"

    # ── KYC Document Retention ────────────────────────────────────────────────
    KYC_DOCUMENTS_DELETED   = "kyc.documents_deleted_retention_expired"


async def write_audit_log(
    db: asyncpg.Connection,
    *,
    actor_id: UUID | str | None,
    actor_roles: list[str],
    action: AuditAction | str,
    resource_type: str,
    resource_id: str | None = None,
    old_state: dict[str, Any] | None = None,
    new_state: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Writes a single audit log entry.
    This function is intentionally fire-and-forget in most cases —
    audit failure should not block the primary operation.
    The DB trigger prevents any UPDATE or DELETE on audit.logs.
    """
    try:
        await db.execute(
            """
            INSERT INTO audit.logs
                (actor_id, actor_roles, action, resource_type, resource_id,
                 old_state, new_state, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            str(actor_id) if actor_id else None,
            actor_roles,
            str(action),
            resource_type,
            resource_id,
            json.dumps(old_state, default=str) if old_state else None,
            json.dumps(new_state, default=str) if new_state else None,
            json.dumps(metadata, default=str) if metadata else None,
        )
    except Exception as exc:
        # Audit failure must never crash the application.
        # In production, this should also alert the on-call engineer.
        import logging
        logging.getLogger("audit").error(
            "AUDIT LOG WRITE FAILED: action=%s resource=%s/%s error=%s",
            action, resource_type, resource_id, exc
        )
