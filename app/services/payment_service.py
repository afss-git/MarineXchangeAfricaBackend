"""
Phase 9 — Payment Lifecycle Service.

Business logic for:
  - Payment schedule creation: auto-generated (equal installments) and manual
  - Schedule deletion (admin reset)
  - Payment record submission by buyer (with file evidence)
  - Admin verify / reject payment records
  - Admin waive schedule items
  - Auto-completion: marks deal 'completed' when all items are verified/waived
  - Deal payment summary helper
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import HTTPException, UploadFile, status

from app.config import settings
from app.core.audit import AuditAction, write_audit_log
from app.db.client import get_pool
from app.schemas.payments import (
    CreateScheduleAuto,
    CreateScheduleManual,
    DealPaymentSummary,
    EvidenceOut,
    PaymentRecordOut,
    PaymentScheduleOut,
    RejectPaymentBody,
    ScheduleItemOut,
    SubmitPaymentRecord,
    VerifyPaymentBody,
    WaiveItemBody,
)
from app.services import notification_service
from app.services.auth_service import get_supabase_admin_client

logger = logging.getLogger(__name__)

EVIDENCE_BUCKET = "payment-evidence"


def _record_to_dict(row: asyncpg.Record) -> dict:
    """
    Convert asyncpg Record to a plain dict with Python-native types.
    Specifically converts pgproto.UUID → uuid.UUID so Pydantic v2 can validate them.
    """
    import datetime as _dt
    result = {}
    for k, v in dict(row).items():
        # asyncpg returns its own UUID type (pgproto.UUID) — convert to stdlib UUID
        if v is not None and type(v).__module__ == "asyncpg.pgproto.pgproto":
            result[k] = UUID(str(v))
        else:
            result[k] = v
    return result
ALLOWED_EVIDENCE_MIME = frozenset({
    "image/jpeg", "image/png", "image/webp",
    "application/pdf",
})
MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}
MAX_EVIDENCE_SIZE_BYTES = 10 * 1024 * 1024   # 10 MB per file
MAX_EVIDENCE_FILES = 5                         # per payment_record


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _row_to_item(row: asyncpg.Record) -> ScheduleItemOut:
    return ScheduleItemOut(**_record_to_dict(row))


def _row_to_record(row: asyncpg.Record, evidence: list[EvidenceOut] | None = None) -> PaymentRecordOut:
    d = _record_to_dict(row)
    d["evidence"] = evidence or []
    return PaymentRecordOut(**d)


async def _assert_deal_exists(db: asyncpg.Connection, deal_id: UUID) -> asyncpg.Record:
    deal = await db.fetchrow(
        "SELECT id, status, total_price, currency, buyer_id FROM finance.deals WHERE id = $1",
        deal_id,
    )
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found.")
    return deal


async def _assert_schedule_exists(db: asyncpg.Connection, deal_id: UUID) -> asyncpg.Record:
    sched = await db.fetchrow(
        "SELECT * FROM finance.payment_schedules WHERE deal_id = $1",
        deal_id,
    )
    if not sched:
        raise HTTPException(status_code=404, detail="No payment schedule found for this deal.")
    return sched


async def _fetch_schedule_with_items(db: asyncpg.Connection, deal_id: UUID) -> PaymentScheduleOut:
    sched = await _assert_schedule_exists(db, deal_id)
    items = await db.fetch(
        """
        SELECT * FROM finance.payment_schedule_items
        WHERE schedule_id = $1
        ORDER BY installment_number ASC
        """,
        sched["id"],
    )
    return PaymentScheduleOut(
        **_record_to_dict(sched),
        items=[_row_to_item(r) for r in items],
    )


async def _check_and_auto_complete(db: asyncpg.Connection, deal_id: UUID) -> bool:
    """
    Check if all schedule items are verified or waived.
    If so, mark the schedule complete and the deal 'completed'.
    Returns True if auto-completed.
    """
    counts = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('verified', 'waived')) AS remaining,
            COUNT(*) AS total
        FROM finance.payment_schedule_items
        WHERE deal_id = $1
        """,
        deal_id,
    )
    if counts["total"] == 0 or counts["remaining"] > 0:
        return False

    now = datetime.now(timezone.utc)

    # Mark schedule complete
    await db.execute(
        """
        UPDATE finance.payment_schedules
        SET is_complete = TRUE, completed_at = $1, updated_at = $1
        WHERE deal_id = $2
        """,
        now, deal_id,
    )

    # Mark deal completed — any non-terminal status is eligible
    await db.execute(
        """
        UPDATE finance.deals
        SET status = 'completed', updated_at = $1
        WHERE id = $2
          AND status NOT IN ('completed', 'cancelled', 'disputed', 'defaulted')
        """,
        now, deal_id,
    )

    return True


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN — SCHEDULE MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

async def admin_create_schedule(
    db: asyncpg.Connection,
    deal_id: UUID,
    body: CreateScheduleAuto | CreateScheduleManual,
    admin: dict,
) -> PaymentScheduleOut:
    deal = await _assert_deal_exists(db, deal_id)

    # Prevent duplicate schedule
    existing = await db.fetchval(
        "SELECT id FROM finance.payment_schedules WHERE deal_id = $1", deal_id
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A payment schedule already exists for this deal. "
                   "Delete it first before creating a new one.",
        )

    total_price = Decimal(str(deal["total_price"]))
    currency = body.currency

    async with db.transaction():
        # Insert schedule header
        schedule_id: UUID = await db.fetchval(
            """
            INSERT INTO finance.payment_schedules
                (deal_id, mode, total_items, currency, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
            """,
            deal_id,
            body.mode,
            body.installments if body.mode == "auto" else len(body.installments),
            currency,
            UUID(str(admin["id"])),
        )

        if body.mode == "auto":
            # Equal installments, 30 days apart from today
            n = body.installments
            base_amount = (total_price / n).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            # Distribute rounding remainder into last installment
            remainder = total_price - (base_amount * n)
            items_to_insert = []
            today = date.today()
            for i in range(1, n + 1):
                amount = base_amount + (remainder if i == n else Decimal("0"))
                due = date(today.year, today.month, today.day)
                # Add 30 days per installment
                from datetime import timedelta
                due = today + timedelta(days=30 * i)
                items_to_insert.append((
                    schedule_id, deal_id, i,
                    f"Installment {i}", amount, currency, due,
                ))

        else:  # manual
            items_to_insert = [
                (
                    schedule_id, deal_id, idx + 1,
                    item.label, item.amount, currency, item.due_date,
                )
                for idx, item in enumerate(body.installments)
            ]

            # Validate total matches deal price (±1 USD tolerance)
            submitted_total = sum(item.amount for item in body.installments)
            diff = abs(submitted_total - total_price)
            if diff > Decimal("1.00"):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Manual installment total ({submitted_total}) does not match "
                        f"deal total price ({total_price}). Difference: {diff}. "
                        "Tolerance is ±1.00 USD."
                    ),
                )

        await db.executemany(
            """
            INSERT INTO finance.payment_schedule_items
                (schedule_id, deal_id, installment_number, label, amount, currency, due_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            items_to_insert,
        )

        await write_audit_log(
            db,
            actor_id=admin["id"],
            actor_roles=admin.get("roles", []),
            action=AuditAction.PAYMENT_SCHEDULE_CREATED,
            resource_type="payment_schedule",
            resource_id=str(schedule_id),
            new_state={"deal_id": str(deal_id), "mode": body.mode},
        )

    return await _fetch_schedule_with_items(db, deal_id)


async def admin_delete_schedule(
    db: asyncpg.Connection,
    deal_id: UUID,
    admin: dict,
) -> dict:
    sched = await _assert_schedule_exists(db, deal_id)

    # Prevent deletion if any item has a verified payment
    verified = await db.fetchval(
        """
        SELECT COUNT(*) FROM finance.payment_schedule_items
        WHERE schedule_id = $1 AND status = 'verified'
        """,
        sched["id"],
    )
    if verified > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a schedule that has verified payments. "
                   "Contact finance admin.",
        )

    await db.execute(
        "DELETE FROM finance.payment_schedules WHERE id = $1", sched["id"]
    )

    await write_audit_log(
        db,
        actor_id=admin["id"],
        actor_roles=admin.get("roles", []),
        action=AuditAction.PAYMENT_SCHEDULE_DELETED,
        resource_type="payment_schedule",
        resource_id=str(sched["id"]),
        old_state={"deal_id": str(deal_id)},
    )

    return {"message": "Payment schedule deleted."}


async def admin_get_schedule(db: asyncpg.Connection, deal_id: UUID) -> PaymentScheduleOut:
    return await _fetch_schedule_with_items(db, deal_id)


async def admin_list_payment_records(
    db: asyncpg.Connection,
    deal_id: UUID,
    item_id: UUID | None = None,
) -> list[PaymentRecordOut]:
    await _assert_deal_exists(db, deal_id)
    if item_id:
        records = await db.fetch(
            """
            SELECT * FROM finance.schedule_payment_records
            WHERE deal_id = $1 AND schedule_item_id = $2
            ORDER BY submitted_at DESC
            """,
            deal_id, item_id,
        )
    else:
        records = await db.fetch(
            """
            SELECT * FROM finance.schedule_payment_records
            WHERE deal_id = $1
            ORDER BY submitted_at DESC
            """,
            deal_id,
        )
    result = []
    for rec in records:
        evidence = await _fetch_evidence(db, rec["id"])
        result.append(_row_to_record(rec, evidence))
    return result


async def admin_verify_payment(
    db: asyncpg.Connection,
    record_id: UUID,
    body: VerifyPaymentBody,
    admin: dict,
) -> PaymentRecordOut:
    record = await db.fetchrow(
        "SELECT * FROM finance.schedule_payment_records WHERE id = $1", record_id
    )
    if not record:
        raise HTTPException(status_code=404, detail="Payment record not found.")
    if record["status"] != "pending_verification":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot verify a record in '{record['status']}' status.",
        )

    now = datetime.now(timezone.utc)
    async with db.transaction():
        await db.execute(
            """
            UPDATE finance.schedule_payment_records
            SET status = 'verified', reviewed_by = $1, reviewed_at = $2, updated_at = $2
            WHERE id = $3
            """,
            UUID(str(admin["id"])), now, record_id,
        )

        # Mark the schedule item as verified
        await db.execute(
            """
            UPDATE finance.payment_schedule_items
            SET status = 'verified', verified_by = $1, verified_at = $2, updated_at = $2
            WHERE id = $3
            """,
            UUID(str(admin["id"])), now, record["schedule_item_id"],
        )

        # Check auto-complete
        auto_completed = await _check_and_auto_complete(db, record["deal_id"])

        await write_audit_log(
            db,
            actor_id=admin["id"],
            actor_roles=admin.get("roles", []),
            action=AuditAction.PAYMENT_RECORD_VERIFIED,
            resource_type="payment_record",
            resource_id=str(record_id),
            new_state={"deal_id": str(record["deal_id"]), "auto_completed": auto_completed},
        )

    if auto_completed:
        asyncio.create_task(
            notification_service.notify_deal_completed(record["deal_id"])
        )

    updated = await db.fetchrow(
        "SELECT * FROM finance.schedule_payment_records WHERE id = $1", record_id
    )
    evidence = await _fetch_evidence(db, record_id)
    return _row_to_record(updated, evidence)


async def admin_reject_payment(
    db: asyncpg.Connection,
    record_id: UUID,
    body: RejectPaymentBody,
    admin: dict,
) -> PaymentRecordOut:
    record = await db.fetchrow(
        "SELECT * FROM finance.schedule_payment_records WHERE id = $1", record_id
    )
    if not record:
        raise HTTPException(status_code=404, detail="Payment record not found.")
    if record["status"] != "pending_verification":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot reject a record in '{record['status']}' status.",
        )

    now = datetime.now(timezone.utc)
    async with db.transaction():
        await db.execute(
            """
            UPDATE finance.schedule_payment_records
            SET status = 'rejected',
                reviewed_by = $1,
                reviewed_at = $2,
                rejection_reason = $3,
                updated_at = $2
            WHERE id = $4
            """,
            UUID(str(admin["id"])), now, body.rejection_reason, record_id,
        )

        # Revert item to pending so buyer can resubmit
        await db.execute(
            """
            UPDATE finance.payment_schedule_items
            SET status = 'pending', updated_at = $1
            WHERE id = $2
            """,
            now, record["schedule_item_id"],
        )

        await write_audit_log(
            db,
            actor_id=admin["id"],
            actor_roles=admin.get("roles", []),
            action=AuditAction.PAYMENT_RECORD_REJECTED,
            resource_type="payment_record",
            resource_id=str(record_id),
            new_state={"reason": body.rejection_reason},
        )

    asyncio.create_task(
        notification_service.notify_payment_rejected(
            record["deal_id"], record["submitted_by"], body.rejection_reason
        )
    )

    updated = await db.fetchrow(
        "SELECT * FROM finance.schedule_payment_records WHERE id = $1", record_id
    )
    evidence = await _fetch_evidence(db, record_id)
    return _row_to_record(updated, evidence)


async def admin_waive_item(
    db: asyncpg.Connection,
    item_id: UUID,
    body: WaiveItemBody,
    admin: dict,
) -> ScheduleItemOut:
    item = await db.fetchrow(
        "SELECT * FROM finance.payment_schedule_items WHERE id = $1", item_id
    )
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found.")
    if item["status"] in ("verified", "waived"):
        raise HTTPException(
            status_code=409,
            detail=f"Item is already '{item['status']}' and cannot be waived.",
        )

    now = datetime.now(timezone.utc)
    async with db.transaction():
        await db.execute(
            """
            UPDATE finance.payment_schedule_items
            SET status = 'waived',
                waived_by = $1,
                waived_at = $2,
                waiver_reason = $3,
                updated_at = $2
            WHERE id = $4
            """,
            UUID(str(admin["id"])), now, body.waiver_reason, item_id,
        )

        auto_completed = await _check_and_auto_complete(db, item["deal_id"])

        await write_audit_log(
            db,
            actor_id=admin["id"],
            actor_roles=admin.get("roles", []),
            action=AuditAction.PAYMENT_ITEM_WAIVED,
            resource_type="payment_schedule_item",
            resource_id=str(item_id),
            new_state={"reason": body.waiver_reason, "auto_completed": auto_completed},
        )

    if auto_completed:
        asyncio.create_task(
            notification_service.notify_deal_completed(item["deal_id"])
        )

    updated = await db.fetchrow(
        "SELECT * FROM finance.payment_schedule_items WHERE id = $1", item_id
    )
    return _row_to_item(updated)


# ══════════════════════════════════════════════════════════════════════════════
# BUYER — VIEW SCHEDULE & SUBMIT PAYMENTS
# ══════════════════════════════════════════════════════════════════════════════

async def buyer_get_schedule(
    db: asyncpg.Connection,
    deal_id: UUID,
    buyer_id: UUID,
) -> PaymentScheduleOut:
    deal = await _assert_deal_exists(db, deal_id)
    if str(deal["buyer_id"]) != str(buyer_id):
        raise HTTPException(status_code=403, detail="Access denied.")
    return await _fetch_schedule_with_items(db, deal_id)


async def buyer_submit_payment(
    db: asyncpg.Connection,
    deal_id: UUID,
    item_id: UUID,
    body: SubmitPaymentRecord,
    buyer: dict,
) -> PaymentRecordOut:
    deal = await _assert_deal_exists(db, deal_id)
    if str(deal["buyer_id"]) != str(buyer["id"]):
        raise HTTPException(status_code=403, detail="Access denied.")

    item = await db.fetchrow(
        "SELECT * FROM finance.payment_schedule_items WHERE id = $1 AND deal_id = $2",
        item_id, deal_id,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found.")
    if item["status"] in ("verified", "waived"):
        raise HTTPException(
            status_code=409,
            detail=f"This installment is already '{item['status']}'.",
        )
    if item["status"] == "payment_submitted":
        raise HTTPException(
            status_code=409,
            detail="A payment record is already pending verification for this installment. "
                   "Wait for admin review or contact support.",
        )

    now = datetime.now(timezone.utc)
    async with db.transaction():
        record_id: UUID = await db.fetchval(
            """
            INSERT INTO finance.schedule_payment_records
                (schedule_item_id, deal_id, submitted_by,
                 amount_paid, currency, payment_method, payment_date,
                 bank_name, bank_reference, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
            """,
            item_id, deal_id, UUID(str(buyer["id"])),
            body.amount_paid, body.currency, body.payment_method, body.payment_date,
            body.bank_name, body.bank_reference, body.notes,
        )

        # Update item status to payment_submitted
        await db.execute(
            """
            UPDATE finance.payment_schedule_items
            SET status = 'payment_submitted', updated_at = $1
            WHERE id = $2
            """,
            now, item_id,
        )

        await write_audit_log(
            db,
            actor_id=buyer["id"],
            actor_roles=buyer.get("roles", []),
            action=AuditAction.PAYMENT_EVIDENCE_SUBMITTED,
            resource_type="payment_record",
            resource_id=str(record_id),
            new_state={"deal_id": str(deal_id), "item_id": str(item_id)},
        )

    asyncio.create_task(
        notification_service.notify_admin_payment_submitted(
            deal_id, str(record_id)
        )
    )

    record = await db.fetchrow(
        "SELECT * FROM finance.schedule_payment_records WHERE id = $1", record_id
    )
    return _row_to_record(record)


async def buyer_upload_evidence(
    db: asyncpg.Connection,
    deal_id: UUID,
    record_id: UUID,
    file: UploadFile,
    buyer: dict,
) -> EvidenceOut:
    deal = await _assert_deal_exists(db, deal_id)
    if str(deal["buyer_id"]) != str(buyer["id"]):
        raise HTTPException(status_code=403, detail="Access denied.")

    record = await db.fetchrow(
        "SELECT * FROM finance.schedule_payment_records WHERE id = $1 AND deal_id = $2",
        record_id, deal_id,
    )
    if not record:
        raise HTTPException(status_code=404, detail="Payment record not found.")
    if record["status"] != "pending_verification":
        raise HTTPException(
            status_code=409,
            detail="Evidence can only be uploaded to a record that is pending verification.",
        )

    # Check file count limit
    existing_count = await db.fetchval(
        "SELECT COUNT(*) FROM finance.schedule_payment_files WHERE payment_record_id = $1",
        record_id,
    )
    if existing_count >= MAX_EVIDENCE_FILES:
        raise HTTPException(
            status_code=422,
            detail=f"Maximum {MAX_EVIDENCE_FILES} evidence files per payment record.",
        )

    # Validate MIME type
    content = await file.read()
    if len(content) > MAX_EVIDENCE_SIZE_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"File exceeds maximum size of {MAX_EVIDENCE_SIZE_BYTES // (1024*1024)} MB.",
        )

    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_EVIDENCE_MIME:
        raise HTTPException(
            status_code=422,
            detail=f"File type '{mime}' not allowed. Accepted: JPEG, PNG, WebP, PDF.",
        )
    from app.core.file_validation import validate_magic_bytes
    if not validate_magic_bytes(content, mime):
        raise HTTPException(
            status_code=422,
            detail="File content does not match the declared file type.",
        )

    ext = MIME_TO_EXT[mime]
    file_uuid = uuid.uuid4()
    storage_path = f"evidence/{deal_id}/{record_id}/{file_uuid}.{ext}"

    # Upload to Supabase Storage
    try:
        supabase = await get_supabase_admin_client()
        await supabase.storage.from_(EVIDENCE_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content_type": mime, "upsert": "false"},
        )
    except Exception as exc:
        logger.error("Evidence upload failed: %s", exc)
        raise HTTPException(status_code=500, detail="File upload failed. Please try again.")

    original_name = file.filename or f"{file_uuid}.{ext}"

    evidence_id: UUID = await db.fetchval(
        """
        INSERT INTO finance.schedule_payment_files
            (payment_record_id, deal_id, uploaded_by, file_name, file_path, file_size_bytes, mime_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        """,
        record_id, deal_id, UUID(str(buyer["id"])),
        original_name, storage_path, len(content), mime,
    )

    await write_audit_log(
        db,
        actor_id=buyer["id"],
        actor_roles=buyer.get("roles", []),
        action=AuditAction.PAYMENT_EVIDENCE_SUBMITTED,
        resource_type="payment_evidence",
        resource_id=str(evidence_id),
        new_state={"deal_id": str(deal_id), "record_id": str(record_id), "file": original_name},
    )

    row = await db.fetchrow(
        "SELECT * FROM finance.schedule_payment_files WHERE id = $1", evidence_id
    )
    return EvidenceOut(**dict(row))


async def get_evidence_signed_url(
    db: asyncpg.Connection,
    evidence_id: UUID,
    actor: dict,
) -> str:
    """
    Generate a short-lived signed URL for a payment evidence file.
    Accessible by admin/finance_admin, or the buyer who uploaded it.
    """
    row = await db.fetchrow(
        """
        SELECT spf.*, spr.deal_id AS deal_id2, d.buyer_id
        FROM finance.schedule_payment_files spf
        JOIN finance.schedule_payment_records spr ON spr.id = spf.payment_record_id
        JOIN finance.deals d ON d.id = spr.deal_id
        WHERE spf.id = $1
        """,
        evidence_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evidence file not found.")

    roles = actor.get("roles", [])
    is_admin = "admin" in roles or "finance_admin" in roles
    is_owner = str(row["buyer_id"]) == str(actor["id"])

    if not is_admin and not is_owner:
        raise HTTPException(status_code=403, detail="Access denied.")

    try:
        supabase = await get_supabase_admin_client()
        result = await supabase.storage.from_(EVIDENCE_BUCKET).create_signed_url(
            row["file_path"], expires_in=3600
        )
        signed_url = result.get("signedURL") or result.get("signed_url") or result.get("signedUrl", "")
        if not signed_url:
            raise ValueError("Empty signed URL returned.")
        return signed_url
    except Exception as exc:
        logger.error("Evidence signed URL failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not generate download URL.")


async def buyer_list_records(
    db: asyncpg.Connection,
    deal_id: UUID,
    buyer_id: UUID,
) -> list[PaymentRecordOut]:
    deal = await _assert_deal_exists(db, deal_id)
    if str(deal["buyer_id"]) != str(buyer_id):
        raise HTTPException(status_code=403, detail="Access denied.")

    records = await db.fetch(
        """
        SELECT * FROM finance.schedule_payment_records
        WHERE deal_id = $1 AND submitted_by = $2
        ORDER BY submitted_at DESC
        """,
        deal_id, buyer_id,
    )
    result = []
    for rec in records:
        evidence = await _fetch_evidence(db, rec["id"])
        result.append(_row_to_record(rec, evidence))
    return result


# ══════════════════════════════════════════════════════════════════════════════
# DEAL PAYMENT SUMMARY
# ══════════════════════════════════════════════════════════════════════════════

async def get_deal_payment_summary(
    db: asyncpg.Connection,
    deal_id: UUID,
) -> DealPaymentSummary:
    sched = await db.fetchrow(
        "SELECT * FROM finance.payment_schedules WHERE deal_id = $1", deal_id
    )
    if not sched:
        return DealPaymentSummary(
            schedule_id=None,
            total_items=0,
            verified_count=0,
            pending_count=0,
            overdue_count=0,
            waived_count=0,
            is_complete=False,
            total_amount=Decimal("0"),
            verified_amount=Decimal("0"),
            outstanding_amount=Decimal("0"),
        )

    stats = await db.fetchrow(
        """
        SELECT
            COUNT(*) AS total_items,
            COUNT(*) FILTER (WHERE status = 'verified') AS verified_count,
            COUNT(*) FILTER (WHERE status IN ('pending', 'payment_submitted')) AS pending_count,
            COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count,
            COUNT(*) FILTER (WHERE status = 'waived') AS waived_count,
            COALESCE(SUM(amount), 0) AS total_amount,
            COALESCE(SUM(amount) FILTER (WHERE status = 'verified'), 0) AS verified_amount
        FROM finance.payment_schedule_items
        WHERE schedule_id = $1
        """,
        sched["id"],
    )

    total = Decimal(str(stats["total_amount"]))
    verified = Decimal(str(stats["verified_amount"]))

    return DealPaymentSummary(
        schedule_id=sched["id"],
        total_items=stats["total_items"],
        verified_count=stats["verified_count"],
        pending_count=stats["pending_count"],
        overdue_count=stats["overdue_count"],
        waived_count=stats["waived_count"],
        is_complete=sched["is_complete"],
        total_amount=total,
        verified_amount=verified,
        outstanding_amount=total - verified,
    )


# ══════════════════════════════════════════════════════════════════════════════
# PRIVATE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

async def _fetch_evidence(
    db: asyncpg.Connection,
    record_id: UUID,
) -> list[EvidenceOut]:
    rows = await db.fetch(
        "SELECT * FROM finance.schedule_payment_files WHERE payment_record_id = $1 ORDER BY uploaded_at ASC",
        record_id,
    )
    return [EvidenceOut(**_record_to_dict(r)) for r in rows]
