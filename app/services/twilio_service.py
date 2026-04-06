"""
Twilio integration service.

Handles:
- SMS OTP verification (buyer phone verification at signup)
- Agent-to-buyer voice calls (routed through platform Twilio number)
- Call status webhook processing

All calls are routed through the platform number so buyer never sees
agent's personal phone. Calls are recorded with consent announcement.
"""
from __future__ import annotations

import logging
from uuid import UUID

import asyncpg
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)


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


# ═══════════════════════════════════════════════════════════════════════════════
# SMS OTP — Phone Verification
# ═══════════════════════════════════════════════════════════════════════════════


async def send_phone_otp(phone: str) -> bool:
    """
    Send an SMS OTP to the given phone number via Twilio Verify.

    Args:
        phone: E.164 format phone number (e.g. +2348012345678)

    Returns:
        True if OTP was sent successfully, False otherwise.
    """
    if not settings.TWILIO_VERIFY_SERVICE_SID:
        logger.warning("TWILIO_VERIFY_SERVICE_SID not set — cannot send OTP")
        return False

    try:
        client = _get_client()
        verification = client.verify.v2.services(
            settings.TWILIO_VERIFY_SERVICE_SID
        ).verifications.create(
            to=phone,
            channel="sms",
        )
        logger.info("OTP sent to %s — status=%s sid=%s", phone, verification.status, verification.sid)
        return verification.status == "pending"
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to send OTP to %s: %s", phone, exc)
        return False


async def verify_phone_otp(phone: str, code: str) -> bool:
    """
    Verify an SMS OTP code.

    Args:
        phone: E.164 format phone number
        code: The 6-digit OTP code entered by the user

    Returns:
        True if code is valid, False otherwise.
    """
    if not settings.TWILIO_VERIFY_SERVICE_SID:
        logger.warning("TWILIO_VERIFY_SERVICE_SID not set — cannot verify OTP")
        return False

    try:
        client = _get_client()
        check = client.verify.v2.services(
            settings.TWILIO_VERIFY_SERVICE_SID
        ).verification_checks.create(
            to=phone,
            code=code,
        )
        logger.info("OTP check for %s — status=%s", phone, check.status)
        return check.status == "approved"
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("OTP verification failed for %s: %s", phone, exc)
        return False


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

    Returns:
        Dict with call_id (our DB id) and twilio_call_sid.
    """
    from twilio.base.exceptions import TwilioRestException

    if not settings.TWILIO_PHONE_NUMBER:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice calling is not configured.",
        )

    # Create call record in DB first
    call_record = await db.fetchrow(
        """
        INSERT INTO kyc.verification_calls
            (submission_id, agent_id, buyer_id, from_number, to_number, status)
        VALUES ($1, $2, $3, $4, $5, 'initiated')
        RETURNING id
        """,
        submission_id,
        agent_id,
        buyer_id,
        settings.TWILIO_PHONE_NUMBER,
        buyer_phone,
    )
    call_id = call_record["id"]

    # Build TwiML for the call flow:
    # 1. Play consent announcement
    # 2. Bridge to buyer
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
            record=False,  # We handle recording in TwiML for consent
        )

        # Update DB with Twilio SID
        await db.execute(
            "UPDATE kyc.verification_calls SET twilio_call_sid = $1 WHERE id = $2",
            call.sid,
            call_id,
        )

        logger.info(
            "Verification call initiated: call_id=%s twilio_sid=%s agent→buyer %s→%s",
            call_id, call.sid, agent_phone, buyer_phone,
        )

        return {"call_id": str(call_id), "twilio_call_sid": call.sid, "status": "initiated"}

    except TwilioRestException as exc:
        # Mark call as failed
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
    """
    Process Twilio voice status callback.
    Maps Twilio statuses to our schema statuses.
    """
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
        update_parts.append(f"started_at = NOW()")
    elif our_status in ("completed", "no_answer", "busy", "failed", "cancelled"):
        update_parts.append(f"ended_at = NOW()")

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
        call_outcome,
        call_notes,
        call_id,
        agent_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Call record not found or not yours.",
        )
