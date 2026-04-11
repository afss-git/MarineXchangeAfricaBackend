"""
Phone verification & voice call service.

OTP flow:
1. Generate a 6-digit code, store in DB with 10-minute expiry
2. Attempt to deliver via Twilio SMS
3. If Twilio fails (trial account, misconfigured, etc.) the code is still
   stored — in non-production environments it's returned in the API response
   so the flow is fully testable without a paid Twilio account.

Voice calls:
- Agent-to-buyer verification calls routed through the platform Twilio number
- Buyer never sees agent's personal phone
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import asyncpg
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)

OTP_LENGTH = 6
OTP_TTL_MINUTES = 10


# ── Lazy Twilio client ────────────────────────────────────────────────────────

_twilio_client = None


def _get_client():
    """Lazy-init Twilio client. Avoids import cost on startup if not configured."""
    global _twilio_client
    if _twilio_client is None:
        if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="SMS/voice service is not configured.",
            )
        from twilio.rest import Client
        _twilio_client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    return _twilio_client


def _generate_otp() -> str:
    """Generate a cryptographically random 6-digit OTP."""
    return "".join(str(secrets.randbelow(10)) for _ in range(OTP_LENGTH))


# ═══════════════════════════════════════════════════════════════════════════════
# SMS OTP — Phone Verification (DB-backed)
# ═══════════════════════════════════════════════════════════════════════════════


async def send_phone_otp(db: asyncpg.Connection, phone: str) -> dict:
    """
    Generate an OTP, store it in DB, and attempt to send via Twilio SMS.

    Returns:
        dict with "sent" (bool) and optionally "code" (in non-prod when SMS fails).
    """
    code = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)

    # Invalidate any previous OTPs for this phone
    await db.execute(
        "UPDATE public.phone_otps SET used = TRUE WHERE phone = $1 AND used = FALSE",
        phone,
    )

    # Store new OTP
    await db.execute(
        """
        INSERT INTO public.phone_otps (phone, code, expires_at)
        VALUES ($1, $2, $3)
        """,
        phone, code, expires_at,
    )

    # Try to send via Twilio SMS
    sms_sent = False
    try:
        if settings.TWILIO_PHONE_NUMBER:
            client = _get_client()
            message = client.messages.create(
                to=phone,
                from_=settings.TWILIO_PHONE_NUMBER,
                body=f"Your Harbours360 verification code is: {code}. It expires in {OTP_TTL_MINUTES} minutes.",
            )
            logger.info("OTP SMS sent to %s — sid=%s", phone, message.sid)
            sms_sent = True
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("SMS delivery failed for %s: %s", phone, exc)

    result: dict = {"sent": True, "sms_delivered": sms_sent}

    # In non-production, return the code so the flow is testable
    if not settings.is_production:
        result["code"] = code
        result["note"] = "Code included in response because ENVIRONMENT != production"

    if not sms_sent and settings.is_production:
        logger.error("OTP SMS failed in production for %s", phone)
        return {"sent": False, "sms_delivered": False}

    return result


async def verify_phone_otp(db: asyncpg.Connection, phone: str, code: str) -> bool:
    """
    Verify an OTP code against the DB.

    Returns True if the code is valid and not expired.
    """
    row = await db.fetchrow(
        """
        SELECT id FROM public.phone_otps
        WHERE phone = $1
          AND code = $2
          AND used = FALSE
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        """,
        phone, code,
    )

    if not row:
        return False

    # Mark as used
    await db.execute(
        "UPDATE public.phone_otps SET used = TRUE WHERE id = $1",
        row["id"],
    )
    return True


async def mark_phone_verified(db: asyncpg.Connection, user_id: UUID) -> None:
    """Mark user's phone as verified in the profiles table."""
    await db.execute(
        "UPDATE public.profiles SET phone_verified = TRUE, phone_verified_at = NOW() WHERE id = $1",
        user_id,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Voice Calls — Agent-to-Buyer Verification Calls
# ═══════════════════════════════════════════════════════════════════════════════


async def initiate_verification_call(
    *,
    db: asyncpg.Connection,
    submission_id: UUID,
    agent_id: UUID,
    buyer_id: UUID,
    agent_phone: str,
    buyer_phone: str,
) -> dict:
    """
    Initiate a Twilio voice call from agent to buyer.

    Flow:
    1. Twilio calls the agent's personal phone first
    2. When agent picks up, Twilio bridges to buyer's phone
    3. Buyer sees the platform's Twilio number (not agent's personal)
    4. Consent announcement plays before recording starts
    5. Call events are sent to our webhook
    """
    from twilio.base.exceptions import TwilioRestException

    if not settings.TWILIO_PHONE_NUMBER:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice calling is not configured.",
        )

    call_record = await db.fetchrow(
        """
        INSERT INTO kyc.verification_calls
            (submission_id, agent_id, buyer_id, from_number, to_number, status)
        VALUES ($1, $2, $3, $4, $5, 'initiated')
        RETURNING id
        """,
        submission_id, agent_id, buyer_id,
        settings.TWILIO_PHONE_NUMBER, buyer_phone,
    )
    call_id = call_record["id"]

    webhook_base = settings.TWILIO_WEBHOOK_URL.rstrip("/")
    twiml_url = f"{webhook_base}/voice-connect?call_id={call_id}&buyer_phone={buyer_phone}"
    status_url = f"{webhook_base}/voice-status?call_id={call_id}"

    try:
        client = _get_client()
        call = client.calls.create(
            to=agent_phone,
            from_=settings.TWILIO_PHONE_NUMBER,
            url=twiml_url,
            status_callback=status_url,
            status_callback_event=["initiated", "ringing", "answered", "completed"],
            status_callback_method="POST",
            record=False,
        )

        await db.execute(
            "UPDATE kyc.verification_calls SET twilio_call_sid = $1 WHERE id = $2",
            call.sid, call_id,
        )

        logger.info(
            "Verification call initiated: call_id=%s twilio_sid=%s agent→buyer %s→%s",
            call_id, call.sid, agent_phone, buyer_phone,
        )

        return {"call_id": str(call_id), "twilio_call_sid": call.sid, "status": "initiated"}

    except TwilioRestException as exc:
        await db.execute(
            "UPDATE kyc.verification_calls SET status = 'failed' WHERE id = $1",
            call_id,
        )
        logger.error("Twilio call failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to initiate call: {exc.msg}",
        )


async def process_call_status_webhook(
    db: asyncpg.Connection,
    call_id: UUID,
    twilio_status: str,
    duration: int | None = None,
    recording_url: str | None = None,
    recording_duration: int | None = None,
) -> None:
    """Process Twilio voice status callback."""
    STATUS_MAP = {
        "queued": "initiated",
        "initiated": "initiated",
        "ringing": "ringing",
        "in-progress": "in_progress",
        "completed": "completed",
        "no-answer": "no_answer",
        "busy": "busy",
        "failed": "failed",
        "canceled": "cancelled",
    }

    our_status = STATUS_MAP.get(twilio_status, "failed")

    update_parts = ["status = $2"]
    params: list = [call_id, our_status]
    idx = 3

    if duration is not None:
        update_parts.append(f"duration_seconds = ${idx}")
        params.append(duration)
        idx += 1

    if recording_url:
        update_parts.append(f"recording_url = ${idx}")
        params.append(recording_url)
        idx += 1

    if recording_duration is not None:
        update_parts.append(f"recording_duration = ${idx}")
        params.append(recording_duration)
        idx += 1

    if our_status == "in_progress":
        update_parts.append("started_at = NOW()")
    elif our_status in ("completed", "no_answer", "busy", "failed", "cancelled"):
        update_parts.append("ended_at = NOW()")

    query = f"UPDATE kyc.verification_calls SET {', '.join(update_parts)} WHERE id = $1"
    await db.execute(query, *params)

    logger.info("Call %s status updated: %s → %s", call_id, twilio_status, our_status)


async def save_call_notes(
    db: asyncpg.Connection,
    call_id: UUID,
    agent_id: UUID,
    call_outcome: str,
    call_notes: str | None = None,
) -> None:
    """Agent saves notes after completing a verification call."""
    result = await db.execute(
        """
        UPDATE kyc.verification_calls
        SET call_outcome = $1, call_notes = $2
        WHERE id = $3 AND agent_id = $4
        """,
        call_outcome, call_notes, call_id, agent_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call record not found or not yours.",
        )
