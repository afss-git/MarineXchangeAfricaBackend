"""
Phase 5 — Deal Service Layer.

Business logic for:
  - Payment accounts and rate schedules (admin config)
  - Buyer credit profiles
  - Deal CRUD and lifecycle management
  - Offline payment recording and verification
  - Reducing-balance installment schedule generation
  - Manual notifications
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import UUID

import asyncpg
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.schemas.deals import (
    BuyerCreditProfileSet,
    DealCreate,
    DealUpdate,
    PaymentAccountCreate,
    PaymentAccountUpdate,
    RateScheduleCreate,
    RateScheduleUpdate,
    RecordPaymentRequest,
    VerifyPaymentRequest,
)
from app.services import notification_service
from app.services.auth_service import get_supabase_admin_client

logger = logging.getLogger(__name__)

PAYMENT_PROOF_BUCKET = "deal-payment-proofs"
ALLOWED_PROOF_MIME = frozenset({
    "image/jpeg", "image/png", "image/webp", "application/pdf",
})
MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}


# ══════════════════════════════════════════════════════════════════════════════
# PURE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

async def generate_deal_ref(db: asyncpg.Connection) -> str:
    """Generates MXD-{YEAR}-{seq:05d}"""
    seq = await db.fetchval("SELECT nextval('finance.deal_ref_seq')")
    year = datetime.now(timezone.utc).year
    return f"MXD-{year}-{seq:05d}"


def generate_portal_token() -> str:
    """64-char secure random hex token."""
    return secrets.token_hex(32)


def hash_otp(otp: str) -> str:
    """SHA-256 hex of OTP string."""
    return hashlib.sha256(otp.encode()).hexdigest()


def generate_otp() -> str:
    """6-digit string OTP."""
    import random
    return f"{random.SystemRandom().randint(0, 999999):06d}"


# ══════════════════════════════════════════════════════════════════════════════
# FINANCING ENGINE
# ══════════════════════════════════════════════════════════════════════════════

def calculate_financing_summary(
    financed_amount: Decimal,
    monthly_rate: Decimal,
    duration_months: int,
) -> dict:
    """
    Returns monthly_payment, total_finance_charge, total_amount_payable.
    Uses standard amortization: M = P * r * (1+r)^n / ((1+r)^n - 1)
    """
    P = Decimal(str(financed_amount))
    r = Decimal(str(monthly_rate))
    n = duration_months

    if r == 0:
        monthly_payment = (P / n).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_finance_charge = Decimal("0")
    else:
        monthly_payment = (
            P * r * (1 + r) ** n / ((1 + r) ** n - 1)
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_finance_charge = (monthly_payment * n - P).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

    total_amount_payable = (P + total_finance_charge).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )

    return {
        "monthly_payment": monthly_payment,
        "total_finance_charge": total_finance_charge,
        "total_amount_payable": total_amount_payable,
    }


def generate_installment_schedule(
    financed_amount: Decimal,
    monthly_rate: Decimal,
    duration_months: int,
    start_date: date,
) -> list[dict]:
    """
    Reducing balance schedule.
    start_date is the deal activation date; first installment due start_date + 1 month.
    Last installment adjusted for rounding.
    """
    P = Decimal(str(financed_amount))
    r = Decimal(str(monthly_rate))
    n = duration_months

    summary = calculate_financing_summary(P, r, n)
    monthly_payment = summary["monthly_payment"]

    schedule = []
    balance = P

    for i in range(1, n + 1):
        opening_balance = balance
        finance_charge = (balance * r).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        if i == n:
            # Last installment: pay exact remaining balance + its finance charge
            principal_amount = balance
            amount_due = (principal_amount + finance_charge).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        else:
            principal_amount = (monthly_payment - finance_charge).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            amount_due = monthly_payment

        closing_balance = max(balance - principal_amount, Decimal("0"))

        due_date = start_date + relativedelta(months=i)
        grace_period_end = due_date + relativedelta(days=5)

        schedule.append(
            {
                "installment_number": i,
                "due_date": due_date,
                "grace_period_end": grace_period_end,
                "opening_balance": opening_balance,
                "principal_amount": principal_amount,
                "finance_charge": finance_charge,
                "amount_due": amount_due,
                "closing_balance": closing_balance,
            }
        )

        balance = closing_balance

    return schedule


# ══════════════════════════════════════════════════════════════════════════════
# INTERNAL DB HELPERS
# ══════════════════════════════════════════════════════════════════════════════

async def _get_deal_or_404(db: asyncpg.Connection, deal_id: UUID) -> asyncpg.Record:
    row = await db.fetchrow("SELECT * FROM finance.deals WHERE id = $1", deal_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found.")
    return row


async def _get_enriched_deal(db: asyncpg.Connection, deal_id: UUID) -> dict:
    """Returns deal dict enriched with buyer/seller/product/payment_account info."""
    row = await db.fetchrow(
        """
        SELECT
            d.*,
            bp.full_name  AS buyer_name,
            bu.email      AS buyer_email,
            bp.phone      AS buyer_phone,
            sp.full_name  AS seller_name,
            pr.title      AS product_title,
            pa.bank_name,
            pa.account_name,
            pa.account_number,
            pa.sort_code,
            pa.swift_code,
            pa.iban,
            pa.routing_number,
            pa.currency   AS pa_currency,
            pa.country    AS pa_country,
            pa.additional_info,
            pa.is_active  AS pa_is_active,
            pa.created_by AS pa_created_by,
            pa.created_at AS pa_created_at
        FROM finance.deals d
        LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
        LEFT JOIN auth.users bu       ON bu.id = d.buyer_id
        LEFT JOIN public.profiles sp  ON sp.id = d.seller_id
        LEFT JOIN marketplace.products pr ON pr.id = d.product_id
        LEFT JOIN finance.payment_accounts pa ON pa.id = d.payment_account_id
        WHERE d.id = $1
        """,
        deal_id,
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deal not found.")

    d = dict(row)

    # Build nested payment_account if present
    if d.get("payment_account_id"):
        d["payment_account"] = {
            "id": d["payment_account_id"],
            "bank_name": d.pop("bank_name", None),
            "account_name": d.pop("account_name", None),
            "account_number": d.pop("account_number", None),
            "sort_code": d.pop("sort_code", None),
            "swift_code": d.pop("swift_code", None),
            "iban": d.pop("iban", None),
            "routing_number": d.pop("routing_number", None),
            "currency": d.pop("pa_currency", None),
            "country": d.pop("pa_country", None),
            "additional_info": d.pop("additional_info", None),
            "is_active": d.pop("pa_is_active", None),
            "created_by": d.pop("pa_created_by", None),
            "created_at": d.pop("pa_created_at", None),
        }
    else:
        # Drop the joined columns
        for k in ["bank_name", "account_name", "account_number", "sort_code", "swift_code",
                  "iban", "routing_number", "pa_currency", "pa_country", "additional_info",
                  "pa_is_active", "pa_created_by", "pa_created_at"]:
            d.pop(k, None)
        d["payment_account"] = None

    # Compute initial_payment_due
    if d.get("deal_type") == "financing" and d.get("initial_payment_amount") is not None:
        d["initial_payment_due"] = (
            Decimal(str(d["initial_payment_amount"])) + Decimal(str(d["arrangement_fee"] or 0))
        )
    elif d.get("deal_type") == "full_payment":
        d["initial_payment_due"] = (
            Decimal(str(d["total_price"])) + Decimal(str(d["arrangement_fee"] or 0))
        )
    else:
        d["initial_payment_due"] = None

    return d


async def _get_admin_emails(db: asyncpg.Connection) -> list[str]:
    """Returns email addresses of all active admin users."""
    rows = await db.fetch(
        """
        SELECT u.email FROM auth.users u
        JOIN public.profiles p ON p.id = u.id
        WHERE 'admin' = ANY(p.roles) AND p.is_active = TRUE
        """
    )
    return [r["email"] for r in rows if r["email"]]


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT ACCOUNTS
# ══════════════════════════════════════════════════════════════════════════════

async def create_payment_account(
    db: asyncpg.Connection, payload: PaymentAccountCreate, admin: dict
) -> dict:
    row = await db.fetchrow(
        """
        INSERT INTO finance.payment_accounts
            (bank_name, account_name, account_number, sort_code, swift_code, iban,
             routing_number, currency, country, additional_info, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
        """,
        payload.bank_name,
        payload.account_name,
        payload.account_number,
        payload.sort_code,
        payload.swift_code,
        payload.iban,
        payload.routing_number,
        payload.currency,
        payload.country,
        payload.additional_info,
        admin["id"],
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.payment_account_created",
        resource_type="payment_account",
        resource_id=str(row["id"]),
        new_state={"bank_name": payload.bank_name, "account_number": payload.account_number},
    )
    return dict(row)


async def list_payment_accounts(
    db: asyncpg.Connection, include_inactive: bool = False
) -> list[dict]:
    if include_inactive:
        rows = await db.fetch("SELECT * FROM finance.payment_accounts ORDER BY created_at DESC")
    else:
        rows = await db.fetch(
            "SELECT * FROM finance.payment_accounts WHERE is_active = TRUE ORDER BY created_at DESC"
        )
    return [dict(r) for r in rows]


async def update_payment_account(
    db: asyncpg.Connection, account_id: UUID, payload: PaymentAccountUpdate, admin: dict
) -> dict:
    existing = await db.fetchrow(
        "SELECT * FROM finance.payment_accounts WHERE id = $1", account_id
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment account not found.")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return dict(existing)

    set_clauses = []
    values: list[Any] = []
    idx = 1
    for k, v in updates.items():
        set_clauses.append(f"{k} = ${idx}")
        values.append(v)
        idx += 1
    values.append(account_id)

    row = await db.fetchrow(
        f"UPDATE finance.payment_accounts SET {', '.join(set_clauses)} WHERE id = ${idx} RETURNING *",
        *values,
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.payment_account_updated",
        resource_type="payment_account",
        resource_id=str(account_id),
        old_state={"bank_name": existing["bank_name"]},
        new_state=updates,
    )
    return dict(row)


async def deactivate_payment_account(
    db: asyncpg.Connection, account_id: UUID, admin: dict
) -> dict:
    existing = await db.fetchrow(
        "SELECT * FROM finance.payment_accounts WHERE id = $1", account_id
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment account not found.")

    row = await db.fetchrow(
        "UPDATE finance.payment_accounts SET is_active = FALSE WHERE id = $1 RETURNING *",
        account_id,
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.payment_account_deactivated",
        resource_type="payment_account",
        resource_id=str(account_id),
    )
    return dict(row)


# ══════════════════════════════════════════════════════════════════════════════
# RATE SCHEDULES
# ══════════════════════════════════════════════════════════════════════════════

async def create_rate_schedule(
    db: asyncpg.Connection, payload: RateScheduleCreate, admin: dict
) -> dict:
    row = await db.fetchrow(
        """
        INSERT INTO finance.rate_schedules
            (name, description, asset_class, monthly_rates, arrangement_fee,
             min_down_payment_percent, max_down_payment_percent, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        """,
        payload.name,
        payload.description,
        payload.asset_class,
        json.dumps(payload.monthly_rates),
        payload.arrangement_fee,
        payload.min_down_payment_percent,
        payload.max_down_payment_percent,
        admin["id"],
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.rate_schedule_created",
        resource_type="rate_schedule",
        resource_id=str(row["id"]),
        new_state={"name": payload.name},
    )
    return dict(row)


async def list_rate_schedules(
    db: asyncpg.Connection, include_inactive: bool = False
) -> list[dict]:
    if include_inactive:
        rows = await db.fetch("SELECT * FROM finance.rate_schedules ORDER BY created_at DESC")
    else:
        rows = await db.fetch(
            "SELECT * FROM finance.rate_schedules WHERE is_active = TRUE ORDER BY created_at DESC"
        )
    return [dict(r) for r in rows]


async def update_rate_schedule(
    db: asyncpg.Connection, schedule_id: UUID, payload: RateScheduleUpdate, admin: dict
) -> dict:
    existing = await db.fetchrow(
        "SELECT * FROM finance.rate_schedules WHERE id = $1", schedule_id
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rate schedule not found.")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return dict(existing)

    set_clauses = []
    values: list[Any] = []
    idx = 1
    for k, v in updates.items():
        if k == "monthly_rates" and v is not None:
            v = json.dumps(v)
        set_clauses.append(f"{k} = ${idx}")
        values.append(v)
        idx += 1
    values.append(schedule_id)

    row = await db.fetchrow(
        f"UPDATE finance.rate_schedules SET {', '.join(set_clauses)} WHERE id = ${idx} RETURNING *",
        *values,
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.rate_schedule_updated",
        resource_type="rate_schedule",
        resource_id=str(schedule_id),
        new_state=updates,
    )
    return dict(row)


# ══════════════════════════════════════════════════════════════════════════════
# BUYER CREDIT PROFILE
# ══════════════════════════════════════════════════════════════════════════════

async def set_buyer_credit_profile(
    db: asyncpg.Connection, buyer_id: UUID, payload: BuyerCreditProfileSet, admin: dict
) -> dict:
    # Verify buyer exists
    buyer = await db.fetchrow("SELECT id FROM public.profiles WHERE id = $1", buyer_id)
    if not buyer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Buyer not found.")

    row = await db.fetchrow(
        """
        INSERT INTO finance.buyer_credit_profile
            (buyer_id, is_financing_eligible, credit_limit_usd, max_single_deal_usd,
             collateral_notes, risk_rating, notes, set_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (buyer_id) DO UPDATE SET
            is_financing_eligible = EXCLUDED.is_financing_eligible,
            credit_limit_usd      = EXCLUDED.credit_limit_usd,
            max_single_deal_usd   = EXCLUDED.max_single_deal_usd,
            collateral_notes      = EXCLUDED.collateral_notes,
            risk_rating           = EXCLUDED.risk_rating,
            notes                 = EXCLUDED.notes,
            set_by                = EXCLUDED.set_by,
            updated_at            = NOW()
        RETURNING *
        """,
        buyer_id,
        payload.is_financing_eligible,
        payload.credit_limit_usd,
        payload.max_single_deal_usd,
        payload.collateral_notes,
        payload.risk_rating,
        payload.notes,
        admin["id"],
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.buyer_credit_profile_set",
        resource_type="buyer_credit_profile",
        resource_id=str(buyer_id),
        new_state={
            "is_financing_eligible": payload.is_financing_eligible,
            "risk_rating": payload.risk_rating,
        },
    )
    return dict(row)


async def get_buyer_credit_profile(
    db: asyncpg.Connection, buyer_id: UUID
) -> dict | None:
    row = await db.fetchrow(
        "SELECT * FROM finance.buyer_credit_profile WHERE buyer_id = $1", buyer_id
    )
    return dict(row) if row else None


# ══════════════════════════════════════════════════════════════════════════════
# DEAL CRUD
# ══════════════════════════════════════════════════════════════════════════════

async def create_deal(
    db: asyncpg.Connection, payload: DealCreate, admin: dict
) -> dict:
    """
    Validates business rules and creates a deal in 'draft' status.
    """
    # 1. Product must exist and be active
    product = await db.fetchrow(
        "SELECT id, seller_id, title, status FROM marketplace.products WHERE id = $1",
        payload.product_id,
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    if product["status"] != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Product is not active (status: {product['status']}).",
        )

    # 2. Buyer must exist with approved KYC
    buyer = await db.fetchrow(
        "SELECT id, kyc_status, kyc_expires_at, roles FROM public.profiles WHERE id = $1",
        payload.buyer_id,
    )
    if not buyer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Buyer not found.")
    if buyer["kyc_status"] != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Buyer does not have approved KYC.",
        )
    if buyer["kyc_expires_at"] is not None:
        now = datetime.now(timezone.utc)
        expires_at = buyer["kyc_expires_at"]
        if isinstance(expires_at, datetime) and expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Buyer's KYC has expired.",
            )

    # 3. Check buyer active deal count
    active_count = await db.fetchval(
        """
        SELECT COUNT(*) FROM finance.deals
        WHERE buyer_id = $1 AND status NOT IN ('completed', 'cancelled', 'defaulted')
        """,
        payload.buyer_id,
    )
    if active_count >= settings.DEAL_MAX_ACTIVE_PER_BUYER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Buyer already has {active_count} active deals (max {settings.DEAL_MAX_ACTIVE_PER_BUYER}).",
        )

    # 4. Financing-specific validations
    initial_payment_amount = None
    financed_amount = None
    total_finance_charge = None
    total_amount_payable = None
    first_monthly_payment = None

    if payload.deal_type == "financing":
        credit_profile = await get_buyer_credit_profile(db, payload.buyer_id)
        if not credit_profile or not credit_profile["is_financing_eligible"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Buyer is not eligible for financing.",
            )

        initial_payment_amount = (
            Decimal(str(payload.total_price)) * payload.initial_payment_percent / 100
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        financed_amount = (
            Decimal(str(payload.total_price)) - initial_payment_amount
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        # Check against credit limits
        if credit_profile.get("credit_limit_usd") and financed_amount > Decimal(
            str(credit_profile["credit_limit_usd"])
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Financed amount exceeds buyer's credit limit.",
            )
        if credit_profile.get("max_single_deal_usd") and Decimal(
            str(payload.total_price)
        ) > Decimal(str(credit_profile["max_single_deal_usd"])):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Total price exceeds buyer's maximum single deal limit.",
            )

        summary = calculate_financing_summary(
            financed_amount,
            payload.monthly_finance_rate,
            payload.duration_months,
        )
        total_finance_charge = summary["total_finance_charge"]
        total_amount_payable = summary["total_amount_payable"]
        first_monthly_payment = summary["monthly_payment"]

    # 5. Deal reference and portal token
    deal_ref = await generate_deal_ref(db)
    portal_token = generate_portal_token()
    portal_token_expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.DEAL_PORTAL_TOKEN_EXPIRY_HOURS
    )

    # 6. Requires second approval if high-value
    requires_second_approval = float(payload.total_price) >= settings.DEAL_HIGH_VALUE_THRESHOLD_USD

    # Initial status: pending_approval if requires second approval, else draft
    initial_status = "pending_approval" if requires_second_approval else "draft"

    row = await db.fetchrow(
        """
        INSERT INTO finance.deals (
            deal_ref, product_id, buyer_id, seller_id, purchase_request_id,
            deal_type, total_price, currency,
            payment_account_id, payment_deadline, payment_instructions,
            initial_payment_percent, initial_payment_amount, financed_amount,
            monthly_finance_rate, duration_months, arrangement_fee, rate_schedule_id,
            total_finance_charge, total_amount_payable, first_monthly_payment,
            portal_token, portal_token_expires_at,
            requires_second_approval, admin_notes, status, created_by
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10, $11,
            $12, $13, $14,
            $15, $16, $17, $18,
            $19, $20, $21,
            $22, $23,
            $24, $25, $26, $27
        )
        RETURNING *
        """,
        deal_ref,
        payload.product_id,
        payload.buyer_id,
        product["seller_id"],
        payload.purchase_request_id,
        payload.deal_type,
        payload.total_price,
        payload.currency,
        payload.payment_account_id,
        payload.payment_deadline,
        payload.payment_instructions,
        payload.initial_payment_percent,
        initial_payment_amount,
        financed_amount,
        payload.monthly_finance_rate,
        payload.duration_months,
        payload.arrangement_fee,
        payload.rate_schedule_id,
        total_finance_charge,
        total_amount_payable,
        first_monthly_payment,
        portal_token,
        portal_token_expires_at,
        requires_second_approval,
        payload.admin_notes,
        initial_status,
        admin["id"],
    )

    deal_id = row["id"]
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.created",
        resource_type="deal",
        resource_id=str(deal_id),
        new_state={
            "deal_ref": deal_ref,
            "deal_type": payload.deal_type,
            "total_price": str(payload.total_price),
            "status": initial_status,
        },
    )

    return await _get_enriched_deal(db, deal_id)


async def update_deal_terms(
    db: asyncpg.Connection, deal_id: UUID, payload: DealUpdate, admin: dict
) -> dict:
    """Only allowed when status = 'draft'. Recomputes financing summary if params changed."""
    deal = await _get_deal_or_404(db, deal_id)

    if deal["status"] != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deal terms can only be updated in 'draft' status (current: {deal['status']}).",
        )

    updates = payload.model_dump(exclude_unset=True)

    # Recompute financing summary if relevant fields changed
    deal_type = deal["deal_type"]
    if deal_type == "financing":
        total_price = Decimal(str(updates.get("total_price", deal["total_price"])))
        initial_pct = Decimal(str(updates.get("initial_payment_percent", deal["initial_payment_percent"])))
        monthly_rate = Decimal(str(updates.get("monthly_finance_rate", deal["monthly_finance_rate"])))
        duration = int(updates.get("duration_months", deal["duration_months"]))

        initial_payment_amount = (total_price * initial_pct / 100).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        financed_amount = (total_price - initial_payment_amount).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        summary = calculate_financing_summary(financed_amount, monthly_rate, duration)

        updates["initial_payment_amount"] = initial_payment_amount
        updates["financed_amount"] = financed_amount
        updates["total_finance_charge"] = summary["total_finance_charge"]
        updates["total_amount_payable"] = summary["total_amount_payable"]
        updates["first_monthly_payment"] = summary["monthly_payment"]

    if not updates:
        return await _get_enriched_deal(db, deal_id)

    set_clauses = []
    values: list[Any] = []
    idx = 1
    for k, v in updates.items():
        set_clauses.append(f"{k} = ${idx}")
        values.append(v)
        idx += 1
    values.append(deal_id)

    await db.execute(
        f"UPDATE finance.deals SET {', '.join(set_clauses)} WHERE id = ${idx}",
        *values,
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.terms_updated",
        resource_type="deal",
        resource_id=str(deal_id),
        old_state={"status": deal["status"]},
        new_state={k: str(v) for k, v in updates.items()},
    )

    return await _get_enriched_deal(db, deal_id)


async def get_deal(db: asyncpg.Connection, deal_id: UUID, actor: dict) -> dict:
    """Enriched deal. Buyers can only see their own deals."""
    deal = await _get_enriched_deal(db, deal_id)
    roles = actor.get("roles", [])
    if "admin" not in roles and "finance_admin" not in roles:
        if str(deal["buyer_id"]) != str(actor["id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view this deal.",
            )
    return deal


async def list_deals(
    db: asyncpg.Connection, filters: dict, actor: dict
) -> list[dict]:
    """Admin: all deals. Finance admin: all deals. Buyer: their own."""
    roles = actor.get("roles", [])

    conditions = []
    values: list[Any] = []
    idx = 1

    if "admin" not in roles and "finance_admin" not in roles:
        conditions.append(f"d.buyer_id = ${idx}")
        values.append(actor["id"])
        idx += 1
    else:
        if filters.get("buyer_id"):
            conditions.append(f"d.buyer_id = ${idx}")
            values.append(filters["buyer_id"])
            idx += 1

    if filters.get("status"):
        conditions.append(f"d.status = ${idx}")
        values.append(filters["status"])
        idx += 1

    if filters.get("deal_type"):
        conditions.append(f"d.deal_type = ${idx}")
        values.append(filters["deal_type"])
        idx += 1

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    page = int(filters.get("page", 1))
    page_size = int(filters.get("page_size", 20))
    offset = (page - 1) * page_size

    # SECURITY: LIMIT and OFFSET are parameterized — never interpolated directly
    values.extend([page_size, offset])
    limit_idx = idx
    offset_idx = idx + 1

    rows = await db.fetch(
        f"""
        SELECT
            d.id, d.deal_ref, d.deal_type, d.status,
            d.total_price, d.currency,
            d.created_at, d.updated_at,
            bp.full_name  AS buyer_name,
            bu.email      AS buyer_email,
            sp.full_name  AS seller_name,
            pr.title      AS product_title
        FROM finance.deals d
        LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
        LEFT JOIN auth.users bu       ON bu.id = d.buyer_id
        LEFT JOIN public.profiles sp  ON sp.id = d.seller_id
        LEFT JOIN marketplace.products pr ON pr.id = d.product_id
        {where_clause}
        ORDER BY d.created_at DESC
        LIMIT ${limit_idx} OFFSET ${offset_idx}
        """,
        *values,
    )
    return [dict(r) for r in rows]


async def list_seller_deals(
    db: asyncpg.Connection, filters: dict, seller: dict
) -> list[dict]:
    """List deals where the current user is the seller."""
    conditions = [f"d.seller_id = $1"]
    values: list[Any] = [seller["id"]]
    idx = 2

    if filters.get("status"):
        conditions.append(f"d.status = ${idx}")
        values.append(filters["status"])
        idx += 1

    where_clause = f"WHERE {' AND '.join(conditions)}"

    page = int(filters.get("page", 1))
    page_size = int(filters.get("page_size", 20))
    offset = (page - 1) * page_size

    # SECURITY: LIMIT and OFFSET are parameterized — never interpolated directly
    values.extend([page_size, offset])
    limit_idx = idx
    offset_idx = idx + 1

    rows = await db.fetch(
        f"""
        SELECT
            d.id, d.deal_ref, d.deal_type, d.status,
            d.total_price, d.currency,
            d.created_at, d.updated_at,
            bp.full_name  AS buyer_name,
            bu.email      AS buyer_email,
            sp.full_name  AS seller_name,
            pr.title      AS product_title
        FROM finance.deals d
        LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
        LEFT JOIN auth.users bu       ON bu.id = d.buyer_id
        LEFT JOIN public.profiles sp  ON sp.id = d.seller_id
        LEFT JOIN marketplace.products pr ON pr.id = d.product_id
        {where_clause}
        ORDER BY d.created_at DESC
        LIMIT ${limit_idx} OFFSET ${offset_idx}
        """,
        *values,
    )
    return [dict(r) for r in rows]


async def cancel_deal(
    db: asyncpg.Connection, deal_id: UUID, reason: str, admin: dict
) -> dict:
    deal = await _get_deal_or_404(db, deal_id)

    non_cancellable = {"payment_verified", "completed", "cancelled"}
    if deal["status"] in non_cancellable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deal cannot be cancelled in status '{deal['status']}'.",
        )

    await db.execute(
        "UPDATE finance.deals SET status = 'cancelled', cancellation_reason = $1 WHERE id = $2",
        reason,
        deal_id,
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.cancelled",
        resource_type="deal",
        resource_id=str(deal_id),
        old_state={"status": deal["status"]},
        new_state={"status": "cancelled", "reason": reason},
    )
    return await _get_enriched_deal(db, deal_id)


# ══════════════════════════════════════════════════════════════════════════════
# DEAL WORKFLOW
# ══════════════════════════════════════════════════════════════════════════════

async def second_approve_deal(
    db: asyncpg.Connection, deal_id: UUID, notes: str | None, admin: dict
) -> dict:
    """Second admin approves high-value deal."""
    deal = await _get_deal_or_404(db, deal_id)

    if deal["status"] != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deal is not pending approval (status: {deal['status']}).",
        )
    if str(deal["created_by"]) == str(admin["id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The deal creator cannot provide second approval.",
        )

    await db.execute(
        """
        UPDATE finance.deals
        SET status = 'draft',
            second_approved_by = $1,
            second_approved_at = NOW(),
            second_approval_notes = $2
        WHERE id = $3
        """,
        admin["id"],
        notes,
        deal_id,
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.second_approved",
        resource_type="deal",
        resource_id=str(deal_id),
        old_state={"status": "pending_approval"},
        new_state={"status": "draft", "notes": notes},
    )
    return await _get_enriched_deal(db, deal_id)


async def send_deal_offer(
    db: asyncpg.Connection, deal_id: UUID, admin: dict
) -> dict:
    """Generates/refreshes portal token, transitions draft → offer_sent, fires notifications."""
    deal = await _get_deal_or_404(db, deal_id)

    if deal["status"] != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deal must be in 'draft' status to send offer (current: {deal['status']}).",
        )
    if deal["requires_second_approval"] and not deal["second_approved_by"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This deal requires second approval before the offer can be sent.",
        )

    # Refresh portal token
    portal_token = generate_portal_token()
    portal_token_expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.DEAL_PORTAL_TOKEN_EXPIRY_HOURS
    )

    await db.execute(
        """
        UPDATE finance.deals
        SET status = 'offer_sent',
            portal_token = $1,
            portal_token_expires_at = $2
        WHERE id = $3
        """,
        portal_token,
        portal_token_expires_at,
        deal_id,
    )

    enriched = await _get_enriched_deal(db, deal_id)
    portal_link = f"{settings.FRONTEND_URL}/deals/portal/{portal_token}"

    asyncio.create_task(
        notification_service.send_deal_offer_notification(
            buyer_email=enriched["buyer_email"] or "",
            buyer_phone=enriched.get("buyer_phone"),
            buyer_name=enriched.get("buyer_name") or "Valued Customer",
            deal_ref=enriched["deal_ref"],
            deal_type=enriched["deal_type"],
            product_title=enriched.get("product_title") or "Product",
            total_price=str(enriched["total_price"]),
            currency=enriched["currency"],
            portal_link=portal_link,
            portal_expires_hours=settings.DEAL_PORTAL_TOKEN_EXPIRY_HOURS,
        )
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.offer_sent",
        resource_type="deal",
        resource_id=str(deal_id),
        old_state={"status": "draft"},
        new_state={"status": "offer_sent"},
    )

    return enriched


async def request_deal_otp(db: asyncpg.Connection, portal_token: str) -> dict:
    """Buyer requests OTP to accept deal."""
    deal = await db.fetchrow(
        """
        SELECT d.*,
               bp.full_name AS buyer_name,
               bu.email     AS buyer_email,
               bp.phone     AS buyer_phone
        FROM finance.deals d
        LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
        LEFT JOIN auth.users bu       ON bu.id = d.buyer_id
        WHERE d.portal_token = $1
        """,
        portal_token,
    )

    if not deal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invalid deal portal link."
        )

    now = datetime.now(timezone.utc)
    if deal["portal_token_expires_at"] and deal["portal_token_expires_at"] < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This deal portal link has expired. Please contact your account manager.",
        )

    if deal["status"] != "offer_sent":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deal is not in 'offer_sent' status (current: {deal['status']}).",
        )

    otp = generate_otp()
    otp_hash = hash_otp(otp)
    otp_expires = now + timedelta(minutes=settings.DEAL_OTP_EXPIRY_MINUTES)

    # Reset attempt counter when new OTP is issued
    await db.execute(
        """
        UPDATE finance.deals
        SET acceptance_otp_hash    = $1,
            acceptance_otp_expires = $2,
            otp_attempt_count      = 0,
            otp_locked_at          = NULL
        WHERE id = $3
        """,
        otp_hash,
        otp_expires,
        deal["id"],
    )

    # Mark first access
    if not deal["portal_first_accessed"]:
        await db.execute(
            "UPDATE finance.deals SET portal_first_accessed = NOW() WHERE id = $1",
            deal["id"],
        )

    asyncio.create_task(
        notification_service.send_deal_otp(
            buyer_email=deal["buyer_email"] or "",
            buyer_phone=deal.get("buyer_phone"),
            buyer_name=deal.get("buyer_name") or "Valued Customer",
            otp=otp,
            deal_ref=deal["deal_ref"],
        )
    )

    return {
        "message": "OTP sent to your registered email and phone",
        "expires_in_minutes": settings.DEAL_OTP_EXPIRY_MINUTES,
    }


MAX_OTP_ATTEMPTS = 5  # lock after this many consecutive wrong guesses


async def accept_deal(
    db: asyncpg.Connection, portal_token: str, otp: str, client_ip: str
) -> dict:
    """Buyer confirms deal with OTP."""
    deal = await db.fetchrow(
        """
        SELECT d.*,
               bp.full_name AS buyer_name,
               bu.email     AS buyer_email,
               bp.phone     AS buyer_phone
        FROM finance.deals d
        LEFT JOIN public.profiles bp ON bp.id = d.buyer_id
        LEFT JOIN auth.users bu       ON bu.id = d.buyer_id
        WHERE d.portal_token = $1
        """,
        portal_token,
    )

    if not deal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invalid deal portal link."
        )

    now = datetime.now(timezone.utc)

    if deal["portal_token_expires_at"] and deal["portal_token_expires_at"] < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This deal portal link has expired.",
        )

    if deal["status"] != "offer_sent":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deal is not in 'offer_sent' status (current: {deal['status']}).",
        )

    if not deal["acceptance_otp_hash"] or not deal["acceptance_otp_expires"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OTP requested. Please request an OTP first.",
        )

    # Brute-force lockout: OTP is invalidated after MAX_OTP_ATTEMPTS wrong guesses
    attempt_count = deal.get("otp_attempt_count") or 0
    if attempt_count >= MAX_OTP_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many incorrect OTP attempts. This OTP has been invalidated. "
                "Please request a new OTP to continue."
            ),
        )

    if deal["acceptance_otp_expires"] < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP has expired. Please request a new one.",
        )

    if hash_otp(otp) != deal["acceptance_otp_hash"]:
        # Increment attempt counter — invalidate OTP when limit is reached
        new_count = attempt_count + 1
        if new_count >= MAX_OTP_ATTEMPTS:
            # Wipe the OTP entirely so attacker cannot reuse the remaining window
            await db.execute(
                """
                UPDATE finance.deals
                SET otp_attempt_count   = $1,
                    otp_locked_at       = $2,
                    acceptance_otp_hash    = NULL,
                    acceptance_otp_expires = NULL
                WHERE id = $3
                """,
                new_count, now, deal["id"],
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    "Too many incorrect OTP attempts. This OTP has been invalidated. "
                    "Please request a new OTP to continue."
                ),
            )
        else:
            await db.execute(
                "UPDATE finance.deals SET otp_attempt_count = $1 WHERE id = $2",
                new_count, deal["id"],
            )
            remaining = MAX_OTP_ATTEMPTS - new_count
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid OTP. {remaining} attempt(s) remaining before lockout.",
            )

    # Record acceptance and transition to accepted → payment_pending
    await db.execute(
        """
        UPDATE finance.deals
        SET status = 'payment_pending',
            accepted_at = NOW(),
            acceptance_ip = $1,
            acceptance_otp_hash = NULL,
            acceptance_otp_expires = NULL
        WHERE id = $2
        """,
        client_ip,
        deal["id"],
    )

    await write_audit_log(
        db,
        actor_id=str(deal["buyer_id"]),
        actor_roles=["buyer"],
        action="deal.accepted",
        resource_type="deal",
        resource_id=str(deal["id"]),
        old_state={"status": "offer_sent"},
        new_state={"status": "payment_pending", "acceptance_ip": client_ip},
    )

    enriched = await _get_enriched_deal(db, deal["id"])
    admin_emails = await _get_admin_emails(db)

    asyncio.create_task(
        notification_service.send_deal_accepted_admin_notification(
            admin_emails=admin_emails,
            buyer_name=deal.get("buyer_name") or "Buyer",
            deal_ref=deal["deal_ref"],
            deal_type=deal["deal_type"],
            total_price=str(deal["total_price"]),
            currency=deal["currency"],
        )
    )

    # Send payment instructions
    pa = enriched.get("payment_account")
    if pa:
        amount_due = enriched.get("initial_payment_due") or enriched["total_price"]
        deadline_str = (
            deal["payment_deadline"].strftime("%Y-%m-%d")
            if deal.get("payment_deadline")
            else None
        )
        asyncio.create_task(
            notification_service.send_payment_instructions_notification(
                buyer_email=deal["buyer_email"] or "",
                buyer_phone=deal.get("buyer_phone"),
                buyer_name=deal.get("buyer_name") or "Valued Customer",
                deal_ref=deal["deal_ref"],
                deal_type=deal["deal_type"],
                amount_due=str(amount_due),
                currency=deal["currency"],
                bank_name=pa["bank_name"],
                account_name=pa["account_name"],
                account_number=pa["account_number"],
                swift_code=pa.get("swift_code"),
                payment_reference=deal["deal_ref"],
                deadline=deadline_str,
                additional_instructions=deal.get("payment_instructions"),
            )
        )

    return enriched


async def get_deal_by_portal_token(db: asyncpg.Connection, portal_token: str) -> dict:
    """Returns buyer-facing deal portal view."""
    deal = await db.fetchrow(
        """
        SELECT d.*,
               pr.title       AS product_title,
               pr.description AS product_description,
               pa.bank_name,
               pa.account_name,
               pa.account_number,
               pa.sort_code,
               pa.swift_code,
               pa.iban,
               pa.routing_number,
               pa.currency   AS pa_currency,
               pa.country    AS pa_country,
               pa.additional_info,
               pa.is_active  AS pa_is_active,
               pa.created_by AS pa_created_by,
               pa.created_at AS pa_created_at
        FROM finance.deals d
        LEFT JOIN marketplace.products pr ON pr.id = d.product_id
        LEFT JOIN finance.payment_accounts pa ON pa.id = d.payment_account_id
        WHERE d.portal_token = $1
        """,
        portal_token,
    )

    if not deal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invalid deal portal link."
        )

    now = datetime.now(timezone.utc)
    if deal["portal_token_expires_at"] and deal["portal_token_expires_at"] < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This deal portal link has expired. Please contact your account manager.",
        )

    d = dict(deal)

    # Build nested payment_account
    if d.get("payment_account_id"):
        payment_account = {
            "id": d["payment_account_id"],
            "bank_name": d.pop("bank_name", None),
            "account_name": d.pop("account_name", None),
            "account_number": d.pop("account_number", None),
            "sort_code": d.pop("sort_code", None),
            "swift_code": d.pop("swift_code", None),
            "iban": d.pop("iban", None),
            "routing_number": d.pop("routing_number", None),
            "currency": d.pop("pa_currency", None),
            "country": d.pop("pa_country", None),
            "additional_info": d.pop("additional_info", None),
            "is_active": d.pop("pa_is_active", None),
            "created_by": d.pop("pa_created_by", None),
            "created_at": d.pop("pa_created_at", None),
        }
    else:
        for k in ["bank_name", "account_name", "account_number", "sort_code", "swift_code",
                  "iban", "routing_number", "pa_currency", "pa_country", "additional_info",
                  "pa_is_active", "pa_created_by", "pa_created_at"]:
            d.pop(k, None)
        payment_account = None

    # Build schedule_preview for financing (first 3 installments from DB if active, else computed)
    schedule_preview = None
    monthly_finance_rate_display = None

    if d.get("deal_type") == "financing":
        if d.get("monthly_finance_rate"):
            rate_pct = float(d["monthly_finance_rate"]) * 100
            monthly_finance_rate_display = f"{rate_pct:.1f}% per month"

        # Try to fetch first 3 installments if they exist
        installments = await db.fetch(
            """
            SELECT installment_number, due_date, amount_due,
                   opening_balance, finance_charge, principal_amount, closing_balance
            FROM finance.deal_installments
            WHERE deal_id = $1
            ORDER BY installment_number ASC
            LIMIT 3
            """,
            d["id"],
        )
        if installments:
            schedule_preview = [dict(i) for i in installments]
        elif d.get("financed_amount") and d.get("monthly_finance_rate") and d.get("duration_months"):
            # Compute preview
            preview_schedule = generate_installment_schedule(
                Decimal(str(d["financed_amount"])),
                Decimal(str(d["monthly_finance_rate"])),
                d["duration_months"],
                date.today(),
            )
            schedule_preview = preview_schedule[:3]

    # Build total_amount_payable for full_payment
    if d.get("deal_type") == "full_payment":
        d["total_amount_payable"] = (
            Decimal(str(d["total_price"])) + Decimal(str(d.get("arrangement_fee") or 0))
        )

    result = {
        "deal_ref": d["deal_ref"],
        "deal_type": d["deal_type"],
        "status": d["status"],
        "product_title": d.get("product_title"),
        "product_description": d.get("product_description"),
        "total_price": d["total_price"],
        "currency": d["currency"],
        "arrangement_fee": d.get("arrangement_fee", Decimal("0")),
        "payment_account": payment_account,
        "payment_deadline": d.get("payment_deadline"),
        "payment_instructions": d.get("payment_instructions"),
        "total_amount_payable": d.get("total_amount_payable"),
        "initial_payment_amount": d.get("initial_payment_amount"),
        "financed_amount": d.get("financed_amount"),
        "monthly_finance_rate_display": monthly_finance_rate_display,
        "duration_months": d.get("duration_months"),
        "total_finance_charge": d.get("total_finance_charge"),
        "first_monthly_payment": d.get("first_monthly_payment"),
        "schedule_preview": schedule_preview,
        "accepted_at": d.get("accepted_at"),
        "portal_token_expires_at": d.get("portal_token_expires_at"),
    }

    return result


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT RECORDING (OFFLINE)
# ══════════════════════════════════════════════════════════════════════════════

async def record_payment(
    db: asyncpg.Connection,
    deal_id: UUID,
    payload: RecordPaymentRequest,
    proof_file: UploadFile | None,
    admin: dict,
) -> dict:
    """Admin manually records an offline payment."""
    deal = await _get_deal_or_404(db, deal_id)

    # Validate deal status allows payment recording
    allowed_statuses = {"payment_pending", "active"}
    if deal["status"] not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot record payment for deal in status '{deal['status']}'.",
        )

    # Validate payment_type matches deal_type
    if deal["deal_type"] == "full_payment" and payload.payment_type not in ("full_payment",):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="For full_payment deals, payment_type must be 'full_payment'.",
        )
    if deal["deal_type"] == "financing":
        if deal["status"] == "payment_pending" and payload.payment_type != "initial_payment":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="First payment for financing deals must be 'initial_payment'.",
            )
        if deal["status"] == "active" and payload.payment_type != "installment":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Active financing deals only accept 'installment' payments.",
            )

    # For installment: verify installment exists
    if payload.payment_type == "installment":
        installment = await db.fetchrow(
            """
            SELECT * FROM finance.deal_installments
            WHERE deal_id = $1 AND installment_number = $2
            """,
            deal_id,
            payload.installment_number,
        )
        if not installment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Installment #{payload.installment_number} not found.",
            )
        if installment["status"] not in ("pending", "partial", "overdue"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Installment #{payload.installment_number} is already '{installment['status']}'.",
            )

    # Generate payment ID first (needed for storage path)
    payment_id = uuid.uuid4()

    # Upload proof file to Supabase Storage if provided
    proof_path: str | None = None
    if proof_file and proof_file.filename:
        content_type = proof_file.content_type or ""
        if content_type not in ALLOWED_PROOF_MIME:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unsupported file type '{content_type}'. Allowed: JPEG, PNG, WEBP, PDF.",
            )
        ext = MIME_TO_EXT.get(content_type, "bin")
        storage_path = f"{deal_id}/{payment_id}.{ext}"
        file_bytes = await proof_file.read()

        try:
            sb = await get_supabase_admin_client()
            await sb.storage.from_(PAYMENT_PROOF_BUCKET).upload(
                storage_path,
                file_bytes,
                {"content_type": content_type, "upsert": "true"},
            )
            proof_path = storage_path
        except Exception as exc:
            logger.error("Failed to upload payment proof: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to upload payment proof file.",
            )

    row = await db.fetchrow(
        """
        INSERT INTO finance.deal_payments (
            id, deal_id, payment_type, installment_number,
            amount, currency, payment_date,
            bank_name, bank_reference, payment_proof_path, notes,
            recorded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        """,
        payment_id,
        deal_id,
        payload.payment_type,
        payload.installment_number,
        payload.amount,
        payload.currency,
        payload.payment_date,
        payload.bank_name,
        payload.bank_reference,
        proof_path,
        payload.notes,
        admin["id"],
    )

    # Transition deal status
    new_status: str | None = None
    if payload.payment_type in ("full_payment", "initial_payment"):
        new_status = "payment_recorded"
        await db.execute(
            "UPDATE finance.deals SET status = 'payment_recorded' WHERE id = $1",
            deal_id,
        )
    elif payload.payment_type == "installment":
        # Update installment row
        await db.execute(
            """
            UPDATE finance.deal_installments
            SET status = 'paid', payment_id = $1, paid_amount = $2, paid_at = NOW()
            WHERE deal_id = $3 AND installment_number = $4
            """,
            payment_id,
            payload.amount,
            deal_id,
            payload.installment_number,
        )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.payment_recorded",
        resource_type="deal_payment",
        resource_id=str(payment_id),
        new_state={
            "deal_id": str(deal_id),
            "payment_type": payload.payment_type,
            "amount": str(payload.amount),
            "currency": payload.currency,
        },
    )

    # Fire notification to buyer
    enriched = await _get_enriched_deal(db, deal_id)
    asyncio.create_task(
        notification_service.send_payment_recorded_notification(
            buyer_email=enriched.get("buyer_email") or "",
            buyer_phone=enriched.get("buyer_phone"),
            buyer_name=enriched.get("buyer_name") or "Valued Customer",
            deal_ref=enriched["deal_ref"],
            amount=str(payload.amount),
            currency=payload.currency,
            payment_type=payload.payment_type,
            installment_number=payload.installment_number,
        )
    )

    return dict(row)


async def verify_payment(
    db: asyncpg.Connection,
    deal_id: UUID,
    payment_id: UUID,
    payload: VerifyPaymentRequest,
    finance_admin: dict,
) -> dict:
    """Finance admin verifies a recorded payment."""
    deal = await _get_deal_or_404(db, deal_id)
    payment = await db.fetchrow(
        "SELECT * FROM finance.deal_payments WHERE id = $1 AND deal_id = $2",
        payment_id,
        deal_id,
    )
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Payment record not found."
        )
    if payment["verification_status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payment is already '{payment['verification_status']}'.",
        )

    # Update payment verification
    await db.execute(
        """
        UPDATE finance.deal_payments
        SET verification_status = $1,
            verification_notes  = $2,
            verified_by         = $3,
            verified_at         = NOW()
        WHERE id = $4
        """,
        payload.verification_status,
        payload.verification_notes,
        finance_admin["id"],
        payment_id,
    )

    await write_audit_log(
        db,
        actor_id=finance_admin["id"],
        actor_roles=finance_admin.get("roles", []),
        action="deal.payment_verified" if payload.verification_status == "verified" else "deal.payment_disputed",
        resource_type="deal_payment",
        resource_id=str(payment_id),
        old_state={"verification_status": "pending"},
        new_state={"verification_status": payload.verification_status},
    )

    if payload.verification_status != "verified":
        # Disputed — update deal status
        await db.execute(
            "UPDATE finance.deals SET status = 'disputed' WHERE id = $1",
            deal_id,
        )
        return dict(await db.fetchrow("SELECT * FROM finance.deal_payments WHERE id = $1", payment_id))

    # Verified — drive deal lifecycle
    enriched = await _get_enriched_deal(db, deal_id)

    if payment["payment_type"] == "full_payment":
        await db.execute(
            "UPDATE finance.deals SET status = 'completed' WHERE id = $1", deal_id
        )
        asyncio.create_task(
            notification_service.send_deal_completed_notification(
                buyer_email=enriched.get("buyer_email") or "",
                buyer_phone=enriched.get("buyer_phone"),
                buyer_name=enriched.get("buyer_name") or "Valued Customer",
                deal_ref=enriched["deal_ref"],
                product_title=enriched.get("product_title") or "Product",
                currency=enriched["currency"],
                total_price=str(enriched["total_price"]),
            )
        )

    elif payment["payment_type"] == "initial_payment":
        # Activate financing and generate installment schedule
        await db.execute(
            "UPDATE finance.deals SET status = 'active' WHERE id = $1", deal_id
        )

        activation_date = date.today()
        schedule = generate_installment_schedule(
            Decimal(str(deal["financed_amount"])),
            Decimal(str(deal["monthly_finance_rate"])),
            int(deal["duration_months"]),
            activation_date,
        )

        # Bulk insert installments
        for inst in schedule:
            await db.execute(
                """
                INSERT INTO finance.deal_installments (
                    deal_id, installment_number, due_date, grace_period_end,
                    opening_balance, principal_amount, finance_charge,
                    amount_due, closing_balance
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                deal_id,
                inst["installment_number"],
                inst["due_date"],
                inst["grace_period_end"],
                inst["opening_balance"],
                inst["principal_amount"],
                inst["finance_charge"],
                inst["amount_due"],
                inst["closing_balance"],
            )

        first_due_date = schedule[0]["due_date"].strftime("%Y-%m-%d") if schedule else "N/A"
        monthly_payment = str(deal["first_monthly_payment"] or schedule[0]["amount_due"])

        asyncio.create_task(
            notification_service.send_financing_activated_notification(
                buyer_email=enriched.get("buyer_email") or "",
                buyer_phone=enriched.get("buyer_phone"),
                buyer_name=enriched.get("buyer_name") or "Valued Customer",
                deal_ref=enriched["deal_ref"],
                product_title=enriched.get("product_title") or "Product",
                financed_amount=str(deal["financed_amount"]),
                currency=enriched["currency"],
                duration_months=deal["duration_months"],
                monthly_payment=monthly_payment,
                first_due_date=first_due_date,
            )
        )

    elif payment["payment_type"] == "installment":
        # Check if all installments are paid
        unpaid_count = await db.fetchval(
            """
            SELECT COUNT(*) FROM finance.deal_installments
            WHERE deal_id = $1 AND status NOT IN ('paid', 'waived')
            """,
            deal_id,
        )
        if unpaid_count == 0:
            await db.execute(
                "UPDATE finance.deals SET status = 'completed' WHERE id = $1", deal_id
            )
            asyncio.create_task(
                notification_service.send_deal_completed_notification(
                    buyer_email=enriched.get("buyer_email") or "",
                    buyer_phone=enriched.get("buyer_phone"),
                    buyer_name=enriched.get("buyer_name") or "Valued Customer",
                    deal_ref=enriched["deal_ref"],
                    product_title=enriched.get("product_title") or "Product",
                    currency=enriched["currency"],
                    total_price=str(enriched["total_price"]),
                )
            )

    return dict(await db.fetchrow("SELECT * FROM finance.deal_payments WHERE id = $1", payment_id))


# ══════════════════════════════════════════════════════════════════════════════
# INSTALLMENT MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

async def get_installment_schedule(
    db: asyncpg.Connection, deal_id: UUID, actor: dict
) -> dict:
    """Returns deal summary + full installment schedule with payment status."""
    deal = await _get_deal_or_404(db, deal_id)

    roles = actor.get("roles", [])
    if "admin" not in roles and "finance_admin" not in roles:
        if str(deal["buyer_id"]) != str(actor["id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view this schedule.",
            )

    if deal["deal_type"] != "financing":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Installment schedule is only available for financing deals.",
        )

    enriched = await _get_enriched_deal(db, deal_id)

    installments = await db.fetch(
        """
        SELECT * FROM finance.deal_installments
        WHERE deal_id = $1
        ORDER BY installment_number ASC
        """,
        deal_id,
    )

    return {
        "deal_ref": deal["deal_ref"],
        "deal_type": deal["deal_type"],
        "status": deal["status"],
        "buyer_name": enriched.get("buyer_name"),
        "product_title": enriched.get("product_title"),
        "financed_amount": deal["financed_amount"],
        "monthly_finance_rate": deal["monthly_finance_rate"],
        "duration_months": deal["duration_months"],
        "total_finance_charge": deal["total_finance_charge"],
        "total_amount_payable": deal["total_amount_payable"],
        "installments": [dict(i) for i in installments],
    }


async def waive_installment(
    db: asyncpg.Connection,
    deal_id: UUID,
    installment_number: int,
    reason: str,
    finance_admin: dict,
) -> dict:
    """Waive an installment (finance admin only)."""
    deal = await _get_deal_or_404(db, deal_id)

    installment = await db.fetchrow(
        """
        SELECT * FROM finance.deal_installments
        WHERE deal_id = $1 AND installment_number = $2
        """,
        deal_id,
        installment_number,
    )
    if not installment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Installment #{installment_number} not found.",
        )
    if installment["status"] == "paid":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot waive an already paid installment.",
        )
    if installment["status"] == "waived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Installment is already waived.",
        )

    await db.execute(
        """
        UPDATE finance.deal_installments
        SET status = 'waived', waived_by = $1, waived_at = NOW(), waiver_reason = $2
        WHERE deal_id = $3 AND installment_number = $4
        """,
        finance_admin["id"],
        reason,
        deal_id,
        installment_number,
    )

    await write_audit_log(
        db,
        actor_id=finance_admin["id"],
        actor_roles=finance_admin.get("roles", []),
        action="deal.installment_waived",
        resource_type="deal_installment",
        resource_id=str(installment["id"]),
        new_state={"deal_id": str(deal_id), "installment_number": installment_number, "reason": reason},
    )

    return dict(await db.fetchrow(
        "SELECT * FROM finance.deal_installments WHERE deal_id = $1 AND installment_number = $2",
        deal_id,
        installment_number,
    ))


async def mark_deal_defaulted(
    db: asyncpg.Connection, deal_id: UUID, reason: str, admin: dict
) -> dict:
    """Mark financing deal as defaulted."""
    deal = await _get_deal_or_404(db, deal_id)

    if deal["deal_type"] != "financing":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only financing deals can be marked as defaulted.",
        )
    if deal["status"] not in ("active", "payment_pending"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot default deal in status '{deal['status']}'.",
        )

    await db.execute(
        "UPDATE finance.deals SET status = 'defaulted', cancellation_reason = $1 WHERE id = $2",
        reason,
        deal_id,
    )
    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.defaulted",
        resource_type="deal",
        resource_id=str(deal_id),
        old_state={"status": deal["status"]},
        new_state={"status": "defaulted", "reason": reason},
    )
    return await _get_enriched_deal(db, deal_id)


# ══════════════════════════════════════════════════════════════════════════════
# MANUAL NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def send_manual_reminder(
    db: asyncpg.Connection,
    deal_id: UUID,
    message_type: str,
    custom_message: str | None,
    admin: dict,
) -> dict:
    """Admin manually triggers a reminder/warning email+SMS to buyer."""
    deal = await _get_deal_or_404(db, deal_id)
    enriched = await _get_enriched_deal(db, deal_id)

    buyer_email = enriched.get("buyer_email") or ""
    buyer_phone = enriched.get("buyer_phone")
    buyer_name = enriched.get("buyer_name") or "Valued Customer"
    deal_ref = deal["deal_ref"]

    if message_type in ("payment_reminder", "overdue_warning"):
        # Generic reminder for full payment or initial payment
        pa = enriched.get("payment_account")
        subject = (
            f"Payment Reminder — {deal_ref}"
            if message_type == "payment_reminder"
            else f"Overdue Payment Warning — {deal_ref}"
        )
        body_intro = (
            "This is a friendly reminder that your payment is due."
            if message_type == "payment_reminder"
            else "Your payment is overdue. Please make payment immediately to avoid further action."
        )
        custom_line = f"<p><em>{custom_message}</em></p>" if custom_message else ""
        html = f"""
        <p>Dear {buyer_name},</p>
        <p>{body_intro}</p>
        <p><strong>Deal Reference:</strong> {deal_ref}</p>
        <p><strong>Amount Due:</strong> {deal['currency']} {enriched.get('initial_payment_due') or deal['total_price']}</p>
        {custom_line}
        <p>Please contact us if you have any questions.</p>
        <br/><p><strong>MarineXchange Africa Finance Team</strong></p>
        """
        sms_body = f"MarineXchange: {body_intro} Deal {deal_ref}. Amount: {deal['currency']} {enriched.get('initial_payment_due') or deal['total_price']}. Ref: {deal_ref}."
        if custom_message:
            sms_body += f" {custom_message}"

        asyncio.create_task(notification_service._send(to=buyer_email, subject=subject, html=html))
        if buyer_phone:
            asyncio.create_task(notification_service._send_sms(to=buyer_phone, body=sms_body))

    elif message_type in ("installment_due", "installment_overdue"):
        # Find the next pending installment
        installment = await db.fetchrow(
            """
            SELECT * FROM finance.deal_installments
            WHERE deal_id = $1 AND status IN ('pending', 'partial', 'overdue')
            ORDER BY installment_number ASC
            LIMIT 1
            """,
            deal_id,
        )
        if not installment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending installments found for this deal.",
            )

        pa = enriched.get("payment_account")
        bank_name = pa["bank_name"] if pa else "N/A"
        account_number = pa["account_number"] if pa else "N/A"
        due_date_str = installment["due_date"].strftime("%Y-%m-%d")
        today = date.today()

        if message_type == "installment_due":
            days_until = (installment["due_date"] - today).days
            asyncio.create_task(
                notification_service.send_installment_reminder_notification(
                    buyer_email=buyer_email,
                    buyer_phone=buyer_phone,
                    buyer_name=buyer_name,
                    deal_ref=deal_ref,
                    installment_number=installment["installment_number"],
                    amount_due=str(installment["amount_due"]),
                    currency=deal["currency"],
                    due_date=due_date_str,
                    bank_name=bank_name,
                    account_number=account_number,
                    payment_reference=deal_ref,
                    days_until_due=max(days_until, 0),
                )
            )
        else:
            days_overdue = (today - installment["due_date"]).days
            asyncio.create_task(
                notification_service.send_installment_overdue_notification(
                    buyer_email=buyer_email,
                    buyer_phone=buyer_phone,
                    buyer_name=buyer_name,
                    deal_ref=deal_ref,
                    installment_number=installment["installment_number"],
                    amount_due=str(installment["amount_due"]),
                    currency=deal["currency"],
                    due_date=due_date_str,
                    days_overdue=max(days_overdue, 1),
                )
            )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action="deal.manual_reminder_sent",
        resource_type="deal",
        resource_id=str(deal_id),
        metadata={"message_type": message_type, "custom_message": custom_message},
    )

    return {"message": f"Reminder '{message_type}' sent to buyer.", "deal_ref": deal_ref}


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT LIST (for finance admin)
# ══════════════════════════════════════════════════════════════════════════════

async def list_pending_payments(db: asyncpg.Connection) -> list[dict]:
    """List all payments pending verification."""
    rows = await db.fetch(
        """
        SELECT
            dp.*,
            rp.full_name AS recorded_by_name
        FROM finance.deal_payments dp
        LEFT JOIN public.profiles rp ON rp.id = dp.recorded_by
        WHERE dp.verification_status = 'pending'
        ORDER BY dp.recorded_at DESC
        """,
    )
    return [dict(r) for r in rows]
