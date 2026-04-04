"""
Email notification service via Resend.

All KYC status-change emails are sent from here.
Functions are async-safe and never raise — failures are logged but
do NOT block the primary operation.
"""

import logging
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


async def _send(*, to: str, subject: str, html: str, tags: list[dict] | None = None) -> bool:
    """
    Low-level Resend send. Returns True on success, False on any failure.
    Never raises — email failure must not crash the application.
    """
    if not settings.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured — skipping email to %s", to)
        return False

    payload: dict[str, Any] = {
        "from":    f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>",
        "to":      [to],
        "subject": subject,
        "html":    html,
    }
    if tags:
        payload["tags"] = tags

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                RESEND_API_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Content-Type":  "application/json",
                },
            )
            if resp.status_code not in (200, 201):
                logger.error(
                    "Resend API error %s sending to %s: %s",
                    resp.status_code, to, resp.text,
                )
                return False
        return True
    except Exception as exc:
        logger.error("Email send failed to %s: %s", to, exc)
        return False


async def _send_sms(*, to: str, body: str) -> bool:
    """
    Sends SMS via Twilio REST API. Returns True on success.
    Skips silently if Twilio not configured or phone number is empty/None.
    """
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN or not settings.TWILIO_FROM_NUMBER:
        logger.warning("Twilio not configured — skipping SMS to %s", to)
        return False
    if not to or not to.strip():
        return False

    import base64
    credentials = base64.b64encode(
        f"{settings.TWILIO_ACCOUNT_SID}:{settings.TWILIO_AUTH_TOKEN}".encode()
    ).decode()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json",
                data={"To": to, "From": settings.TWILIO_FROM_NUMBER, "Body": body},
                headers={"Authorization": f"Basic {credentials}"},
            )
            if resp.status_code not in (200, 201):
                logger.error("Twilio error %s sending to %s: %s", resp.status_code, to, resp.text[:200])
                return False
        return True
    except Exception as exc:
        logger.error("SMS send failed to %s: %s", to, exc)
        return False


# ── Deal notification functions ────────────────────────────────────────────────

async def send_deal_otp(buyer_email: str, buyer_phone: str | None, buyer_name: str, otp: str, deal_ref: str) -> None:
    """OTP for buyer deal acceptance."""
    # Email
    await _send(
        to=buyer_email,
        subject=f"Your Deal Acceptance Code — {deal_ref}",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Your one-time code to confirm deal <strong>{deal_ref}</strong> is:</p>
        <h2 style="font-size:36px;letter-spacing:8px;text-align:center;">{otp}</h2>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request this, please contact support immediately.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
        """,
        tags=[{"name": "category", "value": "deal_otp"}],
    )
    # SMS
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Your deal confirmation code for {deal_ref} is {otp}. Expires in 10 mins. Do not share.",
        )


async def send_deal_offer_notification(
    buyer_email: str,
    buyer_phone: str | None,
    buyer_name: str,
    deal_ref: str,
    deal_type: str,
    product_title: str,
    total_price: str,
    currency: str,
    portal_link: str,
    portal_expires_hours: int = 48,
) -> None:
    """Sent to buyer when admin sends the deal offer."""
    deal_type_label = "Full Payment" if deal_type == "full_payment" else "Finance Facility"
    await _send(
        to=buyer_email,
        subject=f"Deal Offer Ready — {deal_ref} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>A deal offer has been prepared for your review.</p>
        <table style="border-collapse:collapse;width:100%;max-width:500px;">
            <tr><td style="padding:8px;font-weight:bold;">Deal Reference</td><td style="padding:8px;">{deal_ref}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:8px;font-weight:bold;">Product</td><td style="padding:8px;">{product_title}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Total Price</td><td style="padding:8px;">{currency} {total_price}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:8px;font-weight:bold;">Payment Type</td><td style="padding:8px;">{deal_type_label}</td></tr>
        </table>
        <br/>
        <p>Please review the full terms and confirm your acceptance via the link below:</p>
        <p><a href="{portal_link}" style="background:#1a56db;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;">Review Deal Offer</a></p>
        <p style="color:#888;font-size:12px;">This link expires in {portal_expires_hours} hours. If expired, contact your account manager.</p>
        <p>All payments are made directly to MarineXchange Africa. Do not make any payment to the seller.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Deals Team</strong></p>
        """,
        tags=[{"name": "category", "value": "deal_offer"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Deal offer {deal_ref} for {product_title} ({currency} {total_price}) is ready. Check your email to review and confirm.",
        )


async def send_deal_accepted_admin_notification(
    admin_emails: list[str],
    buyer_name: str,
    deal_ref: str,
    deal_type: str,
    total_price: str,
    currency: str,
) -> None:
    """Notify admin(s) that buyer has accepted the deal."""
    for email in admin_emails:
        await _send(
            to=email,
            subject=f"Deal Accepted — {deal_ref} | Action Required",
            html=f"""
            <p>Deal <strong>{deal_ref}</strong> has been accepted by <strong>{buyer_name}</strong>.</p>
            <p><strong>Type:</strong> {"Full Payment" if deal_type == "full_payment" else "Finance Facility"}<br/>
            <strong>Amount:</strong> {currency} {total_price}</p>
            <p>The buyer has been sent payment instructions. Please monitor for payment confirmation.</p>
            <br/>
            <p><strong>MarineXchange Africa — Deals System</strong></p>
            """,
            tags=[{"name": "category", "value": "deal_accepted_admin"}],
        )


async def send_payment_instructions_notification(
    buyer_email: str,
    buyer_phone: str | None,
    buyer_name: str,
    deal_ref: str,
    deal_type: str,
    amount_due: str,
    currency: str,
    bank_name: str,
    account_name: str,
    account_number: str,
    swift_code: str | None,
    payment_reference: str,
    deadline: str | None,
    additional_instructions: str | None,
) -> None:
    """Sent to buyer after they accept — contains payment details."""
    deadline_line = f"<p><strong>Payment Deadline:</strong> {deadline}</p>" if deadline else ""
    swift_line = f"<p><strong>SWIFT/BIC:</strong> {swift_code}</p>" if swift_code else ""
    instructions_line = f"<p><strong>Special Instructions:</strong> {additional_instructions}</p>" if additional_instructions else ""
    amount_label = "Initial Payment Due" if deal_type == "financing" else "Total Amount Due"

    await _send(
        to=buyer_email,
        subject=f"Payment Instructions — {deal_ref} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Thank you for confirming deal <strong>{deal_ref}</strong>. Please make your payment using the details below.</p>
        <div style="background:#f0f7ff;border-left:4px solid #1a56db;padding:16px;margin:16px 0;">
            <h3 style="margin:0 0 12px 0;">Payment Details</h3>
            <p><strong>Bank Name:</strong> {bank_name}</p>
            <p><strong>Account Name:</strong> {account_name}</p>
            <p><strong>Account Number:</strong> {account_number}</p>
            {swift_line}
            <p><strong>Payment Reference:</strong> <span style="font-family:monospace;font-size:16px;font-weight:bold;">{payment_reference}</span></p>
            <p><strong>{amount_label}:</strong> {currency} {amount_due}</p>
            {deadline_line}
        </div>
        {instructions_line}
        <p style="color:#c00;font-weight:bold;">&#9888; Important: Always use the reference code <strong>{payment_reference}</strong> when making your payment. Payments without the reference code may be delayed.</p>
        <p>Once payment is made, our team will confirm receipt within 1&#8211;2 business days.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
        """,
        tags=[{"name": "category", "value": "payment_instructions"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Payment instructions for deal {deal_ref} sent to your email. Amount: {currency} {amount_due}. Reference: {payment_reference}. Pay to {bank_name}.",
        )


async def send_payment_recorded_notification(
    buyer_email: str,
    buyer_phone: str | None,
    buyer_name: str,
    deal_ref: str,
    amount: str,
    currency: str,
    payment_type: str,
    installment_number: int | None = None,
) -> None:
    """Sent to buyer when admin records their payment."""
    if installment_number:
        desc = f"Installment #{installment_number}"
    elif payment_type == "initial_payment":
        desc = "Initial Payment"
    else:
        desc = "Full Payment"

    await _send(
        to=buyer_email,
        subject=f"Payment Received — {deal_ref} | Under Verification",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>We have recorded your <strong>{desc}</strong> of <strong>{currency} {amount}</strong> for deal <strong>{deal_ref}</strong>.</p>
        <p>Our finance team is verifying the payment. You will be notified once confirmed.</p>
        <p>Typical verification time is <strong>1 business day</strong>.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
        """,
        tags=[{"name": "category", "value": "payment_recorded"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Your {desc} of {currency} {amount} for deal {deal_ref} has been received and is under verification.",
        )


async def send_deal_completed_notification(
    buyer_email: str,
    buyer_phone: str | None,
    buyer_name: str,
    deal_ref: str,
    product_title: str,
    currency: str,
    total_price: str,
) -> None:
    """Sent to buyer when full payment deal is completed."""
    await _send(
        to=buyer_email,
        subject=f"Deal Completed — {deal_ref} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Congratulations! Deal <strong>{deal_ref}</strong> for <strong>{product_title}</strong> has been successfully completed.</p>
        <p><strong>Total Amount:</strong> {currency} {total_price}</p>
        <p>Our team will coordinate with the seller for the next steps regarding asset handover.</p>
        <br/>
        <p>Thank you for transacting with MarineXchange Africa.</p>
        <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
        """,
        tags=[{"name": "category", "value": "deal_completed"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Deal {deal_ref} for {product_title} is COMPLETED. Payment verified. Handover arrangements will follow.",
        )


async def send_financing_activated_notification(
    buyer_email: str,
    buyer_phone: str | None,
    buyer_name: str,
    deal_ref: str,
    product_title: str,
    financed_amount: str,
    currency: str,
    duration_months: int,
    monthly_payment: str,
    first_due_date: str,
) -> None:
    """Sent when initial payment verified and financing goes active."""
    await _send(
        to=buyer_email,
        subject=f"Finance Facility Activated — {deal_ref} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Your Finance Facility for deal <strong>{deal_ref}</strong> is now <strong>active</strong>.</p>
        <div style="background:#f0fff4;border-left:4px solid #16a34a;padding:16px;margin:16px 0;">
            <h3 style="margin:0 0 12px 0;">Finance Facility Summary</h3>
            <p><strong>Product:</strong> {product_title}</p>
            <p><strong>Financed Amount:</strong> {currency} {financed_amount}</p>
            <p><strong>Duration:</strong> {duration_months} months</p>
            <p><strong>Monthly Payment:</strong> {currency} {monthly_payment}</p>
            <p><strong>First Payment Due:</strong> {first_due_date}</p>
        </div>
        <p>Your repayment schedule is available in your account dashboard.</p>
        <p>Monthly payment reminders will be sent 5 days before each due date.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
        """,
        tags=[{"name": "category", "value": "financing_activated"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Finance Facility {deal_ref} is ACTIVE. Monthly payment: {currency} {monthly_payment}. First due: {first_due_date}. Check your email for details.",
        )


async def send_installment_reminder_notification(
    buyer_email: str,
    buyer_phone: str | None,
    buyer_name: str,
    deal_ref: str,
    installment_number: int,
    amount_due: str,
    currency: str,
    due_date: str,
    bank_name: str,
    account_number: str,
    payment_reference: str,
    days_until_due: int,
) -> None:
    """Sent 5 days before installment due date."""
    await _send(
        to=buyer_email,
        subject=f"Payment Due in {days_until_due} Days — {deal_ref} Installment #{installment_number}",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>This is a reminder that Installment <strong>#{installment_number}</strong> for deal <strong>{deal_ref}</strong> is due in <strong>{days_until_due} days</strong>.</p>
        <div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:16px;margin:16px 0;">
            <p><strong>Amount Due:</strong> {currency} {amount_due}</p>
            <p><strong>Due Date:</strong> {due_date}</p>
            <p><strong>Pay To:</strong> {bank_name} &#8212; {account_number}</p>
            <p><strong>Reference:</strong> {payment_reference}</p>
        </div>
        <p>Please ensure your payment includes the reference code.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
        """,
        tags=[{"name": "category", "value": "installment_reminder"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Reminder — Installment #{installment_number} for {deal_ref} of {currency} {amount_due} is due on {due_date}. Ref: {payment_reference}.",
        )


async def send_installment_overdue_notification(
    buyer_email: str,
    buyer_phone: str | None,
    buyer_name: str,
    deal_ref: str,
    installment_number: int,
    amount_due: str,
    currency: str,
    due_date: str,
    days_overdue: int,
) -> None:
    """Sent when installment is past grace period."""
    await _send(
        to=buyer_email,
        subject=f"OVERDUE: Installment #{installment_number} — {deal_ref} | Immediate Action Required",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p style="color:#c00;font-weight:bold;">Your Installment #{installment_number} for deal <strong>{deal_ref}</strong> is <strong>{days_overdue} day(s) overdue</strong>.</p>
        <div style="background:#fff0f0;border-left:4px solid #dc2626;padding:16px;margin:16px 0;">
            <p><strong>Amount Due:</strong> {currency} {amount_due}</p>
            <p><strong>Original Due Date:</strong> {due_date}</p>
        </div>
        <p>Please make payment immediately to avoid further action. Contact our finance team if you are experiencing difficulties.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
        """,
        tags=[{"name": "category", "value": "installment_overdue"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"URGENT — MarineXchange: Installment #{installment_number} for {deal_ref} ({currency} {amount_due}) is {days_overdue} day(s) overdue. Please pay immediately.",
        )


# ── KYC email templates ───────────────────────────────────────────────────────

async def send_kyc_submitted(buyer_email: str, buyer_name: str) -> None:
    """Sent to buyer when they submit their KYC documents for review."""
    await _send(
        to=buyer_email,
        subject="KYC Documents Received — MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>We have successfully received your KYC documents. Our verification team will
        review them and you will be notified of the next steps.</p>
        <p>Typical review time is <strong>2–3 business days</strong>.</p>
        <p>If you have any questions, please contact our support team.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Verification Team</strong></p>
        """,
        tags=[{"name": "category", "value": "kyc_submitted"}],
    )


async def send_kyc_under_review(buyer_email: str, buyer_name: str) -> None:
    """Sent to buyer when a verification agent is assigned to their submission."""
    await _send(
        to=buyer_email,
        subject="KYC Review Started — MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>A verification agent has been assigned to your KYC application and has begun
        their review. You will be notified once a decision has been made.</p>
        <p>Please do not resubmit documents at this time.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Verification Team</strong></p>
        """,
        tags=[{"name": "category", "value": "kyc_under_review"}],
    )


async def send_kyc_approved(buyer_email: str, buyer_name: str, expires_at: str) -> None:
    """Sent to buyer when admin approves their KYC."""
    await _send(
        to=buyer_email,
        subject="KYC Approved — You Can Now Transact on MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Congratulations! Your identity verification (KYC) has been <strong>approved</strong>.
        You can now submit purchase requests and participate in transactions on
        MarineXchange Africa.</p>
        <p><strong>Your KYC approval is valid until: {expires_at}</strong></p>
        <p>You will receive a reminder 30 days before expiry.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Verification Team</strong></p>
        """,
        tags=[{"name": "category", "value": "kyc_approved"}],
    )


async def send_kyc_rejected(buyer_email: str, buyer_name: str, reason: str | None) -> None:
    """Sent to buyer when admin rejects their KYC."""
    reason_text = (
        f"<p><strong>Reason:</strong> {reason}</p>"
        if reason else
        "<p>Please contact support for more details.</p>"
    )
    await _send(
        to=buyer_email,
        subject="KYC Verification Unsuccessful — MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>We were unable to complete your KYC verification.</p>
        {reason_text}
        <p>If you believe this is in error, please contact our support team.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Verification Team</strong></p>
        """,
        tags=[{"name": "category", "value": "kyc_rejected"}],
    )


async def send_kyc_requires_resubmission(
    buyer_email: str,
    buyer_name: str,
    reason: str | None,
) -> None:
    """Sent to buyer when admin requests a new submission cycle."""
    reason_text = (
        f"<p><strong>What to address:</strong> {reason}</p>"
        if reason else ""
    )
    await _send(
        to=buyer_email,
        subject="KYC Resubmission Required — MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>After reviewing your KYC submission, our team requires you to provide
        updated or additional documents before we can proceed.</p>
        {reason_text}
        <p>Please log in to your MarineXchange Africa account and submit a new
        KYC application with the requested documents.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Verification Team</strong></p>
        """,
        tags=[{"name": "category", "value": "kyc_resubmission"}],
    )


async def send_kyc_expiry_warning(
    buyer_email: str,
    buyer_name: str,
    days_remaining: int,
    expires_at: str,
) -> None:
    """Sent by a scheduled job 30 days and 7 days before KYC expires."""
    await _send(
        to=buyer_email,
        subject=f"KYC Expiring in {days_remaining} Days — MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Your KYC approval will expire on <strong>{expires_at}</strong>
        ({days_remaining} days from now).</p>
        <p>To continue transacting on MarineXchange Africa without interruption,
        please submit a new KYC application before the expiry date.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Verification Team</strong></p>
        """,
        tags=[{"name": "category", "value": "kyc_expiry_warning"}],
    )


# ── Staff Invite ──────────────────────────────────────────────────────────────

async def send_staff_welcome(
    staff_email: str,
    staff_name: str,
    role_label: str,
    password: str,
    login_url: str,
    invited_by_name: str,
    invite_link: Optional[str] = None,
) -> bool:
    """
    Sent to a newly created staff account (agent or admin).
    Contains their temporary password and optionally a one-time setup link.
    Returns True if Resend accepted the email, False otherwise.
    """
    # Build the primary CTA — prefer one-time link, fall back to login page
    if invite_link:
        cta_button = f"""
        <p style="margin:8px 0 4px;color:#374151;font-size:14px;">
            Or click the button below to set your own password (link expires in 24 hours):
        </p>
        <p style="margin:16px 0 32px;">
            <a href="{invite_link}"
               style="background:#0057A8;color:#ffffff;padding:12px 28px;border-radius:6px;
                      text-decoration:none;font-weight:600;display:inline-block;">
                Set My Password
            </a>
        </p>"""
    else:
        cta_button = f"""
        <p style="margin:16px 0 32px;">
            <a href="{login_url}"
               style="background:#0057A8;color:#ffffff;padding:12px 28px;border-radius:6px;
                      text-decoration:none;font-weight:600;display:inline-block;">
                Log In Now
            </a>
        </p>"""

    return await _send(
        to=staff_email,
        subject="You've been invited to MarineXchange Africa",
        html=f"""
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
        <p>Dear {staff_name},</p>
        <p>You have been invited to join <strong>MarineXchange Africa</strong> as a
        <strong>{role_label}</strong> by {invited_by_name}.</p>
        <p>Your login credentials are below. Please log in and
        <strong>change your password</strong> after your first login.</p>
        <table style="width:100%;border:1px solid #e5e7eb;border-radius:8px;
                      background:#f9fafb;border-spacing:0;margin:24px 0;">
            <tr>
                <td style="padding:10px 14px;font-weight:600;color:#374151;white-space:nowrap;">Email</td>
                <td style="padding:10px 14px;font-family:monospace;color:#111827;">{staff_email}</td>
            </tr>
            <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:10px 14px;font-weight:600;color:#374151;white-space:nowrap;">Password</td>
                <td style="padding:10px 14px;font-family:monospace;font-size:16px;
                           font-weight:700;color:#0057A8;letter-spacing:1px;">{password}</td>
            </tr>
        </table>
        {cta_button}
        <p style="color:#6b7280;font-size:13px;">
            If you did not expect this invitation, please ignore this email or contact our support team.
        </p>
        <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
        </div>
        """,
        tags=[{"name": "category", "value": "staff_invite"}],
    )


# ── Purchase Request notification functions ───────────────────────────────────

async def notify_admin_new_purchase_request(
    buyer_name: str,
    product_title: str,
    request_id: str,
    purchase_type: str,
) -> None:
    """Notify admin when a new purchase request is submitted."""
    if not settings.ADMIN_EMAIL:
        logger.warning("ADMIN_EMAIL not configured — skipping admin purchase request notification")
        return
    purchase_type_label = "Direct Purchase" if purchase_type == "direct_purchase" else "Financed Purchase"
    await _send(
        to=settings.ADMIN_EMAIL,
        subject=f"New Purchase Request — {product_title} | MarineXchange Africa",
        html=f"""
        <p>A new purchase request has been submitted and requires your attention.</p>
        <table style="border-collapse:collapse;width:100%;max-width:500px;">
            <tr><td style="padding:8px;font-weight:bold;">Buyer</td><td style="padding:8px;">{buyer_name}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:8px;font-weight:bold;">Product</td><td style="padding:8px;">{product_title}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;">Purchase Type</td><td style="padding:8px;">{purchase_type_label}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:8px;font-weight:bold;">Request ID</td><td style="padding:8px;font-family:monospace;">{request_id}</td></tr>
        </table>
        <br/>
        <p>Please log in to the admin dashboard to review and assign a buyer agent.</p>
        <p><strong>MarineXchange Africa — Admin System</strong></p>
        """,
        tags=[{"name": "category", "value": "purchase_request_new"}],
    )


async def notify_agent_assigned_request(
    agent_email: str,
    agent_name: str,
    request_id: str,
) -> None:
    """Notify a buyer agent when a purchase request is assigned to them."""
    await _send(
        to=agent_email,
        subject="New Purchase Request Assigned — MarineXchange Africa",
        html=f"""
        <p>Dear {agent_name},</p>
        <p>A new purchase request has been assigned to you for due diligence review.</p>
        <p><strong>Request ID:</strong> <span style="font-family:monospace;">{request_id}</span></p>
        <p>Please log in to your dashboard to view the full details and begin your review.</p>
        <p>Once your assessment is complete, submit your structured report via the portal.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
        """,
        tags=[{"name": "category", "value": "purchase_request_agent_assigned"}],
    )


async def notify_buyer_request_approved(
    buyer_email: str,
    buyer_name: str,
    buyer_phone: str,
    request_id: str,
) -> None:
    """Notify buyer when their purchase request has been approved."""
    await _send(
        to=buyer_email,
        subject="Purchase Request Approved — MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Great news! Your purchase request has been <strong>approved</strong> by our team.</p>
        <p><strong>Request ID:</strong> <span style="font-family:monospace;">{request_id}</span></p>
        <p>Our team is now preparing a formal deal offer for you. You will receive a separate
        notification with the full deal terms and a secure link to review and confirm.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
        """,
        tags=[{"name": "category", "value": "purchase_request_approved"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Your purchase request has been APPROVED. We are preparing your deal offer. Check your email for details.",
        )


async def notify_buyer_request_rejected(
    buyer_email: str,
    buyer_name: str,
    buyer_phone: str,
    request_id: str,
    reason: str,
) -> None:
    """Notify buyer when their purchase request has been rejected."""
    await _send(
        to=buyer_email,
        subject="Purchase Request Unsuccessful — MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Unfortunately, your purchase request has not been approved at this time.</p>
        <p><strong>Request ID:</strong> <span style="font-family:monospace;">{request_id}</span></p>
        <p><strong>Reason:</strong> {reason}</p>
        <p>If you have questions or believe this decision should be reviewed,
        please contact our support team.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
        """,
        tags=[{"name": "category", "value": "purchase_request_rejected"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Your purchase request was not approved at this time. Please check your email for details.",
        )


async def notify_buyer_request_converted(
    buyer_email: str,
    buyer_name: str,
    buyer_phone: str,
    deal_ref: str,
) -> None:
    """Notify buyer when their approved request has been converted to a deal."""
    await _send(
        to=buyer_email,
        subject=f"Deal Being Prepared — {deal_ref} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Your purchase request has progressed to a <strong>formal deal</strong>.</p>
        <p><strong>Deal Reference:</strong> <span style="font-family:monospace;">{deal_ref}</span></p>
        <p>Our team is configuring the final deal terms. You will receive a formal deal offer
        with a secure portal link to review, accept, and proceed with payment once ready.</p>
        <p>No action is required from you at this stage.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Deals Team</strong></p>
        """,
        tags=[{"name": "category", "value": "purchase_request_converted"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: Your purchase request has progressed to Deal {deal_ref}. Watch for your formal deal offer via email.",
        )


# ── Deal expiry notification ──────────────────────────────────────────────────

async def notify_buyer_deal_expired(
    buyer_email: str,
    buyer_name: str,
    deal_ref: str,
) -> None:
    """Sent by scheduler when a deal offer expires without buyer response."""
    await _send(
        to=buyer_email,
        subject=f"Deal Offer Expired — {deal_ref} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>The deal offer for <strong>{deal_ref}</strong> has expired because it was not
        accepted within the required deadline.</p>
        <p>If you are still interested in this asset, please contact your account manager
        to discuss next steps.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Deals Team</strong></p>
        """,
        tags=[{"name": "category", "value": "deal_expired"}],
    )


# ── Auction notification functions ────────────────────────────────────────────

async def notify_outbid(
    buyer_email: str,
    buyer_name: str,
    buyer_phone: str,
    auction_title: str,
    new_bid: str,
    currency: str,
    min_next_bid: str,
    end_time: str,
) -> None:
    """Sent to the previous highest bidder when they are outbid."""
    await _send(
        to=buyer_email,
        subject=f"You've Been Outbid — {auction_title} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>You have been outbid on <strong>{auction_title}</strong>.</p>
        <div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:16px;margin:16px 0;">
            <p><strong>New Highest Bid:</strong> {currency} {new_bid}</p>
            <p><strong>Your Next Bid Must Be At Least:</strong> {currency} {min_next_bid}</p>
            <p><strong>Auction Closes:</strong> {end_time}</p>
        </div>
        <p>Log in to place a higher bid before the auction closes.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Auctions</strong></p>
        """,
        tags=[{"name": "category", "value": "auction_outbid"}],
    )
    if buyer_phone:
        await _send_sms(
            to=buyer_phone,
            body=f"MarineXchange: You've been outbid on '{auction_title}'. New highest bid: {currency} {new_bid}. Closes: {end_time}. Log in to bid again.",
        )


async def notify_auction_ending_soon(
    buyer_email: str,
    buyer_name: str,
    auction_title: str,
    end_time: str,
    current_bid: str,
    currency: str,
) -> None:
    """Sent to all active bidders ~1 hour before auction closes."""
    await _send(
        to=buyer_email,
        subject=f"Ending in 1 Hour — {auction_title} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>The auction for <strong>{auction_title}</strong> closes in approximately
        <strong>1 hour</strong>.</p>
        <div style="background:#f0f7ff;border-left:4px solid #1a56db;padding:16px;margin:16px 0;">
            <p><strong>Current Highest Bid:</strong> {currency} {current_bid}</p>
            <p><strong>Closes At:</strong> {end_time}</p>
        </div>
        <p>Log in now to place your final bid.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Auctions</strong></p>
        """,
        tags=[{"name": "category", "value": "auction_ending_soon"}],
    )


async def notify_auction_winner_pending(
    winner_email: str,
    winner_name: str,
    winner_phone: str,
    auction_title: str,
    winning_bid: str,
    currency: str,
) -> None:
    """Sent to winner when auction closes and they have the highest bid — awaiting admin approval."""
    await _send(
        to=winner_email,
        subject=f"You Have the Highest Bid — {auction_title} | Pending Approval",
        html=f"""
        <p>Dear {winner_name},</p>
        <p>Congratulations! You placed the highest bid on <strong>{auction_title}</strong>.</p>
        <div style="background:#f0fff4;border-left:4px solid #16a34a;padding:16px;margin:16px 0;">
            <p><strong>Your Bid:</strong> {currency} {winning_bid}</p>
        </div>
        <p>Your bid is currently under review by our team. You will be notified within
        <strong>1–2 business days</strong> once the result is confirmed.</p>
        <p>No action is required from you at this stage.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Auctions</strong></p>
        """,
        tags=[{"name": "category", "value": "auction_winner_pending"}],
    )
    if winner_phone:
        await _send_sms(
            to=winner_phone,
            body=f"MarineXchange: You have the highest bid ({currency} {winning_bid}) on '{auction_title}'. Your bid is under admin review. We'll notify you of the outcome.",
        )


async def notify_auction_winner_approved(
    winner_email: str,
    winner_name: str,
    winner_phone: str,
    auction_title: str,
    winning_bid: str,
    currency: str,
) -> None:
    """Sent to winner when admin approves the auction result."""
    await _send(
        to=winner_email,
        subject=f"Auction Won — Deal Being Prepared | {auction_title}",
        html=f"""
        <p>Dear {winner_name},</p>
        <p>Your winning bid for <strong>{auction_title}</strong> has been
        <strong>approved</strong>.</p>
        <div style="background:#f0fff4;border-left:4px solid #16a34a;padding:16px;margin:16px 0;">
            <p><strong>Winning Bid:</strong> {currency} {winning_bid}</p>
        </div>
        <p>Our team is now preparing your formal deal offer. You will receive a secure
        deal portal link to review and confirm the final terms.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Auctions</strong></p>
        """,
        tags=[{"name": "category", "value": "auction_winner_approved"}],
    )
    if winner_phone:
        await _send_sms(
            to=winner_phone,
            body=f"MarineXchange: Your bid of {currency} {winning_bid} on '{auction_title}' has been APPROVED. Deal offer coming soon — check your email.",
        )


async def notify_auction_winner_rejected(
    winner_email: str,
    winner_name: str,
    auction_title: str,
    reason: str,
) -> None:
    """Sent to winner when admin rejects the auction result."""
    await _send(
        to=winner_email,
        subject=f"Auction Result Unsuccessful — {auction_title} | MarineXchange Africa",
        html=f"""
        <p>Dear {winner_name},</p>
        <p>Unfortunately, your winning bid for <strong>{auction_title}</strong> could not
        be processed at this time.</p>
        <p><strong>Reason:</strong> {reason}</p>
        <p>If you believe this is an error or would like to discuss further,
        please contact our support team.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Auctions</strong></p>
        """,
        tags=[{"name": "category", "value": "auction_winner_rejected"}],
    )


async def notify_auction_bid_lost(
    buyer_email: str,
    buyer_name: str,
    auction_title: str,
    outcome: str,
) -> None:
    """Sent to losing bidders when auction closes."""
    if outcome == "failed_reserve_not_met":
        body_text = "The auction closed without meeting the reserve price. No sale was made."
    elif outcome == "failed_no_bids":
        body_text = "The auction closed without any bids."
    else:
        body_text = "The auction has closed. Thank you for participating."

    await _send(
        to=buyer_email,
        subject=f"Auction Closed — {auction_title} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>The auction for <strong>{auction_title}</strong> has now closed.</p>
        <p>{body_text}</p>
        <p>Browse our marketplace for other available assets.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Auctions</strong></p>
        """,
        tags=[{"name": "category", "value": "auction_bid_lost"}],
    )


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 9 — PAYMENT LIFECYCLE NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def notify_admin_payment_submitted(deal_id: Any, record_id: str) -> None:
    """
    Alert admins/finance team when a buyer submits a payment record.
    Fetches deal + buyer info from DB to build the notification.
    """
    from app.db.client import get_pool

    try:
        pool = await get_pool()
        async with pool.acquire() as db:
            row = await db.fetchrow(
                """
                SELECT
                    d.deal_ref,
                    p.full_name  AS buyer_name,
                    u.email      AS buyer_email
                FROM finance.deals d
                JOIN public.profiles p ON p.id = d.buyer_id
                JOIN auth.users      u ON u.id = d.buyer_id
                WHERE d.id = $1
                """,
                deal_id,
            )
        if not row:
            return

        admin_email = settings.ADMIN_EMAIL
        if not admin_email:
            return

        await _send(
            to=admin_email,
            subject=f"Payment Evidence Submitted — Deal {row['deal_ref']} | MarineXchange",
            html=f"""
            <p>A buyer has submitted a payment record for your review.</p>
            <p><strong>Deal:</strong> {row['deal_ref']}</p>
            <p><strong>Buyer:</strong> {row['buyer_name']} ({row['buyer_email']})</p>
            <p><strong>Payment Record ID:</strong> {record_id}</p>
            <p>Please log in to the admin portal to verify or reject this payment.</p>
            <br/>
            <p><strong>MarineXchange Africa Finance Team</strong></p>
            """,
            tags=[{"name": "category", "value": "payment_submitted"}],
        )
    except Exception as exc:
        logger.error("notify_admin_payment_submitted failed: %s", exc)


async def notify_payment_rejected(deal_id: Any, buyer_id: Any, reason: str) -> None:
    """Sent to buyer when admin rejects their payment record."""
    from app.db.client import get_pool

    try:
        pool = await get_pool()
        async with pool.acquire() as db:
            row = await db.fetchrow(
                """
                SELECT
                    d.deal_ref,
                    p.full_name AS buyer_name,
                    u.email     AS buyer_email
                FROM finance.deals d
                JOIN public.profiles p ON p.id = $2
                JOIN auth.users      u ON u.id = $2
                WHERE d.id = $1
                """,
                deal_id, buyer_id,
            )
        if not row:
            return

        await _send(
            to=row["buyer_email"],
            subject=f"Payment Record Rejected — Deal {row['deal_ref']} | MarineXchange Africa",
            html=f"""
            <p>Dear {row['buyer_name']},</p>
            <p>Your payment record for deal <strong>{row['deal_ref']}</strong>
            could not be verified.</p>
            <p><strong>Reason:</strong> {reason}</p>
            <p>Please log in to your portal and resubmit a corrected payment record
            with valid evidence.</p>
            <p>If you believe this is an error, please contact our support team.</p>
            <br/>
            <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
            """,
            tags=[{"name": "category", "value": "payment_rejected"}],
        )
    except Exception as exc:
        logger.error("notify_payment_rejected failed: %s", exc)


async def notify_deal_completed(deal_id: Any) -> None:
    """
    Sent to buyer and seller when all installments are verified/waived
    and the deal is auto-marked as completed.
    """
    from app.db.client import get_pool

    try:
        pool = await get_pool()
        async with pool.acquire() as db:
            row = await db.fetchrow(
                """
                SELECT
                    d.deal_ref,
                    d.total_price,
                    d.currency,
                    bp.full_name  AS buyer_name,
                    bu.email      AS buyer_email,
                    sp.full_name  AS seller_name,
                    su.email      AS seller_email
                FROM finance.deals d
                JOIN public.profiles bp ON bp.id = d.buyer_id
                JOIN auth.users      bu ON bu.id = d.buyer_id
                JOIN public.profiles sp ON sp.id = d.seller_id
                JOIN auth.users      su ON su.id = d.seller_id
                WHERE d.id = $1
                """,
                deal_id,
            )
        if not row:
            return

        # Notify buyer
        await _send(
            to=row["buyer_email"],
            subject=f"Deal Completed — {row['deal_ref']} | MarineXchange Africa",
            html=f"""
            <p>Dear {row['buyer_name']},</p>
            <p>Congratulations! All payments for deal <strong>{row['deal_ref']}</strong>
            have been verified. Your deal is now <strong>completed</strong>.</p>
            <p><strong>Total paid:</strong> {row['currency']} {row['total_price']}</p>
            <p>Thank you for transacting on MarineXchange Africa.</p>
            <br/>
            <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
            """,
            tags=[{"name": "category", "value": "deal_completed"}],
        )

        # Notify seller
        await _send(
            to=row["seller_email"],
            subject=f"Deal Completed — {row['deal_ref']} | MarineXchange Africa",
            html=f"""
            <p>Dear {row['seller_name']},</p>
            <p>All payments for deal <strong>{row['deal_ref']}</strong> have been verified.
            The deal is now <strong>completed</strong>.</p>
            <p><strong>Total received:</strong> {row['currency']} {row['total_price']}</p>
            <p>Thank you for listing on MarineXchange Africa.</p>
            <br/>
            <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
            """,
            tags=[{"name": "category", "value": "deal_completed"}],
        )
    except Exception as exc:
        logger.error("notify_deal_completed failed: %s", exc)


async def notify_installment_overdue(
    buyer_email: str,
    buyer_name: str,
    deal_ref: str,
    installment_label: str,
    due_date: str,
) -> None:
    """Sent by scheduler when a schedule item becomes overdue."""
    await _send(
        to=buyer_email,
        subject=f"Payment Overdue — {deal_ref} | MarineXchange Africa",
        html=f"""
        <p>Dear {buyer_name},</p>
        <p>Your payment for <strong>{installment_label}</strong> on deal
        <strong>{deal_ref}</strong> was due on <strong>{due_date}</strong>
        and has not yet been verified.</p>
        <p>Please submit your payment evidence as soon as possible to avoid
        deal default.</p>
        <p>If you have already paid, please ensure you have uploaded valid
        evidence through your buyer portal.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
        """,
        tags=[{"name": "category", "value": "installment_overdue"}],
    )


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 10 — DOCUMENT MANAGEMENT NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def notify_document_shared(deal_id: Any, document_id: str, document_type: str) -> None:
    """
    Sent to buyer and/or seller when a document is made visible to them.
    Fetches deal parties from DB to determine recipients.
    """
    from app.db.client import get_pool

    try:
        pool = await get_pool()
        async with pool.acquire() as db:
            row = await db.fetchrow(
                """
                SELECT
                    d.deal_ref,
                    d.id         AS deal_id,
                    dd.is_visible_to_buyer,
                    dd.is_visible_to_seller,
                    bp.full_name AS buyer_name,
                    bu.email     AS buyer_email,
                    sp.full_name AS seller_name,
                    su.email     AS seller_email
                FROM finance.deal_documents dd
                JOIN finance.deals          d  ON d.id = dd.deal_id
                JOIN public.profiles        bp ON bp.id = d.buyer_id
                JOIN auth.users             bu ON bu.id = d.buyer_id
                JOIN public.profiles        sp ON sp.id = d.seller_id
                JOIN auth.users             su ON su.id = d.seller_id
                WHERE dd.id = $1
                """,
                document_id,
            )
        if not row:
            return

        doc_label = document_type.replace("_", " ").title()
        deal_ref = row["deal_ref"]

        html_template = lambda name: f"""
        <p>Dear {name},</p>
        <p>A new document (<strong>{doc_label}</strong>) has been shared with you
        for deal <strong>{deal_ref}</strong>.</p>
        <p>Please log in to your deal portal to view and acknowledge the document.</p>
        <br/>
        <p>Best regards,<br/><strong>MarineXchange Africa</strong></p>
        """

        if row["is_visible_to_buyer"]:
            await _send(
                to=row["buyer_email"],
                subject=f"New Document Available — {deal_ref} | MarineXchange Africa",
                html=html_template(row["buyer_name"]),
                tags=[{"name": "category", "value": "document_shared"}],
            )

        if row["is_visible_to_seller"]:
            await _send(
                to=row["seller_email"],
                subject=f"New Document Available — {deal_ref} | MarineXchange Africa",
                html=html_template(row["seller_name"]),
                tags=[{"name": "category", "value": "document_shared"}],
            )
    except Exception as exc:
        logger.error("notify_document_shared failed: %s", exc)


async def notify_invoice_issued(deal_id: Any, invoice_id: str, invoice_ref: str) -> None:
    """
    Sent to the buyer when an admin issues (formally sends) an invoice.
    """
    from app.db.client import get_pool

    try:
        pool = await get_pool()
        async with pool.acquire() as db:
            row = await db.fetchrow(
                """
                SELECT
                    d.deal_ref,
                    bp.full_name AS buyer_name,
                    bu.email     AS buyer_email
                FROM finance.deals   d
                JOIN public.profiles bp ON bp.id = d.buyer_id
                JOIN auth.users      bu ON bu.id = d.buyer_id
                WHERE d.id = $1
                """,
                deal_id,
            )
        if not row:
            return

        await _send(
            to=row["buyer_email"],
            subject=f"Invoice Issued — {invoice_ref} | {row['deal_ref']} | MarineXchange Africa",
            html=f"""
            <p>Dear {row['buyer_name']},</p>
            <p>An invoice (<strong>{invoice_ref}</strong>) has been issued for
            deal <strong>{row['deal_ref']}</strong>.</p>
            <p>Please log in to your deal portal to download the invoice PDF.</p>
            <p>If you have any questions about this invoice, please contact our
            finance team.</p>
            <br/>
            <p>Best regards,<br/><strong>MarineXchange Africa Finance Team</strong></p>
            """,
            tags=[{"name": "category", "value": "invoice_issued"}],
        )
    except Exception as exc:
        logger.error("notify_invoice_issued failed: %s", exc)

