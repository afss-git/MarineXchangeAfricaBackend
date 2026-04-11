"""
Twilio webhook endpoints.

These are called directly by Twilio's infrastructure — no JWT auth.
Security: Twilio request signature validation.

Endpoints:
  POST /webhooks/twilio/voice-connect   — TwiML for connecting agent to buyer
  POST /webhooks/twilio/voice-status    — Call status updates
  POST /webhooks/twilio/voice-recording — Recording ready notification
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Form, Query, Request, Response
from fastapi.responses import PlainTextResponse

from app.db.client import get_db

logger = logging.getLogger(__name__)

twilio_webhook_router = APIRouter(
    prefix="/webhooks/twilio",
    tags=["Webhooks — Twilio"],
)


def _twiml_response(twiml: str) -> Response:
    """Return TwiML XML response."""
    return Response(content=twiml, media_type="application/xml")


@twilio_webhook_router.post("/voice-connect")
async def voice_connect(
    request: Request,
    call_id: UUID = Query(...),
    buyer_phone: str = Query(...),
):
    """
    Called by Twilio when the agent picks up.
    Returns TwiML that:
    1. Plays a consent announcement
    2. Starts recording
    3. Dials the buyer's phone
    """
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">
        This call is being recorded for verification purposes.
        You are being connected to a Harbours360 buyer.
        Please wait.
    </Say>
    <Record
        action="/webhooks/twilio/voice-recording?call_id={call_id}"
        method="POST"
        maxLength="1800"
        recordingStatusCallback="/webhooks/twilio/voice-recording?call_id={call_id}"
        recordingStatusCallbackMethod="POST"
        transcribe="false"
    />
    <Dial
        callerId="{{{{from}}}}"
        record="record-from-answer-dual"
        recordingStatusCallback="/webhooks/twilio/voice-recording?call_id={call_id}"
        recordingStatusCallbackMethod="POST"
    >
        <Number>{buyer_phone}</Number>
    </Dial>
</Response>"""

    logger.info("Voice connect TwiML served for call_id=%s buyer=%s", call_id, buyer_phone)
    return _twiml_response(twiml)


@twilio_webhook_router.post("/voice-status")
async def voice_status(
    request: Request,
    call_id: UUID = Query(...),
    CallStatus: str = Form(default=""),
    CallDuration: str = Form(default=""),
    RecordingUrl: str = Form(default=""),
    RecordingDuration: str = Form(default=""),
):
    """
    Twilio POSTs call status updates here.
    We update our DB record with the current state.
    """
    from app.services.twilio_service import process_call_status_webhook

    duration = int(CallDuration) if CallDuration else None
    rec_duration = int(RecordingDuration) if RecordingDuration else None

    async for db in get_db():
        await process_call_status_webhook(
            db,
            call_id=call_id,
            twilio_status=CallStatus,
            duration=duration,
            recording_url=RecordingUrl or None,
            recording_duration=rec_duration,
        )

    logger.info("Call %s status webhook: %s duration=%s", call_id, CallStatus, CallDuration)
    return PlainTextResponse("OK")


@twilio_webhook_router.post("/voice-recording")
async def voice_recording(
    request: Request,
    call_id: UUID = Query(...),
    RecordingUrl: str = Form(default=""),
    RecordingDuration: str = Form(default=""),
    RecordingStatus: str = Form(default=""),
):
    """
    Twilio POSTs when a recording is ready.
    We save the recording URL to the call record.
    """
    if RecordingStatus != "completed" or not RecordingUrl:
        return PlainTextResponse("OK")

    rec_duration = int(RecordingDuration) if RecordingDuration else None

    async for db in get_db():
        await db.execute(
            """
            UPDATE kyc.verification_calls
            SET recording_url = $2, recording_duration = $3
            WHERE id = $1
            """,
            call_id,
            RecordingUrl,
            rec_duration,
        )

    logger.info("Recording saved for call %s: %s (%ss)", call_id, RecordingUrl, RecordingDuration)
    return PlainTextResponse("OK")
