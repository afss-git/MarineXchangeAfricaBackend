"""
Phase 10 — ReportLab PDF Invoice Generator.

Generates branded PDF invoices for MarineXchange Africa deals.
Returns raw bytes — caller uploads to Supabase Storage.

Security:
  - All user-supplied strings are passed through _safe_str() to strip
    control characters before rendering to PDF.
  - No shell execution, no file system writes — purely in-memory.
  - PDF bytes are returned to caller; no temp files created.
"""
from __future__ import annotations

import io
import logging
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

# ── Brand colours ─────────────────────────────────────────────────────────────
NAVY        = colors.HexColor("#0A2647")
NAVY_LIGHT  = colors.HexColor("#144272")
GOLD        = colors.HexColor("#C8972A")
GREY_LIGHT  = colors.HexColor("#F5F7FA")
GREY_MID    = colors.HexColor("#D1D5DB")
WHITE       = colors.white
BLACK       = colors.HexColor("#111827")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm


# ── Security: sanitise user-supplied strings ──────────────────────────────────

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_XML_SPECIAL   = str.maketrans({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})


def _safe_str(value: Any, max_len: int = 200) -> str:
    """
    Sanitise a value for safe inclusion in ReportLab Paragraph markup:
      1. Convert to str
      2. Strip null bytes and other control characters
      3. Escape XML special characters (&, <, >, ")
      4. Truncate to max_len
    """
    s = str(value) if value is not None else ""
    s = _CONTROL_CHARS.sub("", s)
    s = s.translate(_XML_SPECIAL)
    return s[:max_len]


def _fmt_amount(amount: Decimal | float | str, currency: str = "USD") -> str:
    """Format a monetary amount: USD 1,333,333.00"""
    try:
        val = Decimal(str(amount))
        formatted = f"{val:,.2f}"
        return f"{_safe_str(currency, 5)} {formatted}"
    except Exception:
        return str(amount)


# ── Style factory ──────────────────────────────────────────────────────────────

def _make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            fontName="Helvetica-Bold",
            fontSize=22,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=2,
        ),
        "tagline": ParagraphStyle(
            "tagline",
            fontName="Helvetica",
            fontSize=10,
            textColor=colors.HexColor("#A8C7E8"),
            alignment=TA_LEFT,
        ),
        "invoice_ref": ParagraphStyle(
            "invoice_ref",
            fontName="Helvetica-Bold",
            fontSize=14,
            textColor=GOLD,
            alignment=TA_RIGHT,
        ),
        "invoice_label": ParagraphStyle(
            "invoice_label",
            fontName="Helvetica",
            fontSize=9,
            textColor=colors.HexColor("#A8C7E8"),
            alignment=TA_RIGHT,
        ),
        "section_header": ParagraphStyle(
            "section_header",
            fontName="Helvetica-Bold",
            fontSize=8,
            textColor=WHITE,
            alignment=TA_LEFT,
        ),
        "body": ParagraphStyle(
            "body",
            fontName="Helvetica",
            fontSize=9,
            textColor=BLACK,
            alignment=TA_LEFT,
            leading=14,
        ),
        "body_bold": ParagraphStyle(
            "body_bold",
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=BLACK,
            alignment=TA_LEFT,
        ),
        "body_right": ParagraphStyle(
            "body_right",
            fontName="Helvetica",
            fontSize=9,
            textColor=BLACK,
            alignment=TA_RIGHT,
        ),
        "total_label": ParagraphStyle(
            "total_label",
            fontName="Helvetica-Bold",
            fontSize=11,
            textColor=NAVY,
            alignment=TA_RIGHT,
        ),
        "total_value": ParagraphStyle(
            "total_value",
            fontName="Helvetica-Bold",
            fontSize=13,
            textColor=NAVY,
            alignment=TA_RIGHT,
        ),
        "footer": ParagraphStyle(
            "footer",
            fontName="Helvetica",
            fontSize=8,
            textColor=colors.HexColor("#9CA3AF"),
            alignment=TA_CENTER,
        ),
        "confidential": ParagraphStyle(
            "confidential",
            fontName="Helvetica-Bold",
            fontSize=8,
            textColor=colors.HexColor("#EF4444"),
            alignment=TA_RIGHT,
        ),
    }


# ── Main generator ─────────────────────────────────────────────────────────────

def generate_invoice_pdf(invoice_data: dict) -> bytes:
    """
    Generate a branded MarineXchange Africa invoice PDF.

    invoice_data keys (all strings unless noted):
      invoice_ref        — e.g. "MXI-2026-00001"
      invoice_type       — "proforma" | "installment" | "final"
      issued_at          — ISO datetime string or None
      due_date           — ISO date string or None
      deal_ref           — e.g. "MXD-2026-00011"
      deal_type          — "full_payment" | "financing"
      buyer_name         — company or full name
      buyer_email        — email
      seller_name        — company or full name
      amount             — Decimal or numeric
      currency           — e.g. "USD"
      line_items         — list of {"label": str, "amount": Decimal, "due_date": str|None}
      payment_bank       — bank name or None
      payment_account    — account number or None
      payment_swift      — SWIFT code or None
      payment_iban       — IBAN or None
      notes              — extra notes or None
      status             — "draft" | "issued" | "paid" | "void"

    Returns raw PDF bytes.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=f"Invoice {_safe_str(invoice_data.get('invoice_ref', ''))}",
        author="MarineXchange Africa",
        subject="Deal Invoice",
    )

    styles = _make_styles()
    story = []

    # ── Header banner ──────────────────────────────────────────────────────────
    invoice_ref  = _safe_str(invoice_data.get("invoice_ref", ""))
    invoice_type = _safe_str(invoice_data.get("invoice_type", "")).upper()
    issued_at    = invoice_data.get("issued_at") or datetime.now(timezone.utc).isoformat()
    try:
        issued_str = issued_at[:10] if isinstance(issued_at, str) else str(issued_at)[:10]
    except Exception:
        issued_str = ""

    header_data = [[
        # Left: brand
        [
            Paragraph("MARINEXCHANGE AFRICA", styles["title"]),
            Paragraph("Global Maritime Marketplace", styles["tagline"]),
        ],
        # Right: invoice details
        [
            Paragraph(invoice_ref, styles["invoice_ref"]),
            Paragraph(f"{invoice_type} INVOICE", styles["invoice_label"]),
            Paragraph(f"Issued: {issued_str}", styles["invoice_label"]),
        ],
    ]]

    header_table = Table(header_data, colWidths=[PAGE_W * 0.55 - MARGIN, PAGE_W * 0.45 - MARGIN])
    header_table.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, -1), NAVY),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",(0, 0), (-1, -1), 14),
        ("TOPPADDING",  (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 16),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [NAVY]),
    ]))
    story.append(header_table)

    # Status watermark for void/draft invoices
    status = invoice_data.get("status", "issued")
    if status in ("void", "draft"):
        story.append(Spacer(1, 4 * mm))
        colour = "#EF4444" if status == "void" else "#6B7280"
        story.append(Paragraph(
            f'<font color="{colour}"><b>[ {status.upper()} ]</b></font>',
            ParagraphStyle("status_stamp", fontName="Helvetica-Bold",
                           fontSize=16, alignment=TA_CENTER, textColor=colors.HexColor(colour))
        ))

    story.append(Spacer(1, 6 * mm))

    # ── Bill To / From ─────────────────────────────────────────────────────────
    buyer_name  = _safe_str(invoice_data.get("buyer_name",  "—"))
    buyer_email = _safe_str(invoice_data.get("buyer_email", ""))
    seller_name = _safe_str(invoice_data.get("seller_name", "—"))
    deal_ref    = _safe_str(invoice_data.get("deal_ref",    "—"))
    deal_type   = _safe_str(invoice_data.get("deal_type",   "—")).replace("_", " ").title()
    due_date    = _safe_str(invoice_data.get("due_date", "")) or "—"

    party_header_style = TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), NAVY_LIGHT),
        ("TEXTCOLOR",    (0, 0), (-1, 0), WHITE),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 8),
        ("TOPPADDING",   (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING",(0, 0), (-1, 0), 6),
        ("LEFTPADDING",  (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING",   (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 1), (-1, -1), 5),
        ("GRID",         (0, 0), (-1, -1), 0.5, GREY_MID),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
    ])

    half = (PAGE_W - 2 * MARGIN) / 2 - 3 * mm

    bill_to = Table([
        ["BILL TO"],
        [Paragraph(f"<b>{buyer_name}</b>", styles["body"])],
        [Paragraph(buyer_email, styles["body"])],
    ], colWidths=[half])
    bill_to.setStyle(party_header_style)

    from_table = Table([
        ["FROM"],
        [Paragraph("<b>MarineXchange Africa</b>", styles["body"])],
        [Paragraph(_safe_str(seller_name), styles["body"])],
    ], colWidths=[half])
    from_table.setStyle(party_header_style)

    parties = Table([[bill_to, from_table]], colWidths=[half + 3 * mm, half + 3 * mm])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
    ]))
    story.append(parties)
    story.append(Spacer(1, 5 * mm))

    # ── Deal reference bar ─────────────────────────────────────────────────────
    deal_bar = Table([[
        Paragraph(f"<b>Deal Reference:</b> {deal_ref}", styles["body"]),
        Paragraph(f"<b>Type:</b> {deal_type}", styles["body"]),
        Paragraph(f"<b>Due Date:</b> {due_date}", styles["body"]),
    ]], colWidths=[(PAGE_W - 2 * MARGIN) / 3] * 3)
    deal_bar.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), GREY_LIGHT),
        ("LEFTPADDING",  (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
        ("BOX",          (0, 0), (-1, -1), 0.5, GREY_MID),
    ]))
    story.append(deal_bar)
    story.append(Spacer(1, 6 * mm))

    # ── Line items table ───────────────────────────────────────────────────────
    line_items = invoice_data.get("line_items") or []
    currency   = _safe_str(invoice_data.get("currency", "USD"), 5)

    col_w = PAGE_W - 2 * MARGIN
    tbl_data = [["#", "Description", "Due Date", "Amount"]]

    for idx, item in enumerate(line_items, start=1):
        label    = _safe_str(item.get("label", f"Item {idx}"))
        amt      = _fmt_amount(item.get("amount", 0), currency)
        due      = _safe_str(item.get("due_date") or "—")
        tbl_data.append([str(idx), label, due, amt])

    # Totals row
    total_amount = invoice_data.get("amount", 0)
    tbl_data.append(["", "", Paragraph("<b>TOTAL</b>", styles["body_right"]),
                     Paragraph(f"<b>{_fmt_amount(total_amount, currency)}</b>", styles["body_bold"])])

    items_table = Table(
        tbl_data,
        colWidths=[8 * mm, col_w - 8 * mm - 35 * mm - 40 * mm, 35 * mm, 40 * mm],
    )
    items_table.setStyle(TableStyle([
        # Header row
        ("BACKGROUND",    (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), WHITE),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("ALIGN",         (0, 0), (-1, 0), "CENTER"),
        # Data rows
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 9),
        ("TEXTCOLOR",     (0, 1), (-1, -1), BLACK),
        ("ALIGN",         (0, 1), (0, -1), "CENTER"),   # # column
        ("ALIGN",         (3, 1), (3, -1), "RIGHT"),    # Amount column
        ("ALIGN",         (2, 1), (2, -1), "CENTER"),   # Due date
        # Alternating row backgrounds
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [WHITE, GREY_LIGHT]),
        # Total row
        ("BACKGROUND",    (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
        ("LINEABOVE",     (0, -1), (-1, -1), 1.5, NAVY),
        # Grid
        ("GRID",          (0, 0), (-1, -2), 0.5, GREY_MID),
        ("BOX",           (0, 0), (-1, -1), 1, NAVY),
        # Padding
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 8 * mm))

    # ── Payment instructions ───────────────────────────────────────────────────
    bank    = _safe_str(invoice_data.get("payment_bank",    ""))
    account = _safe_str(invoice_data.get("payment_account", ""))
    swift   = _safe_str(invoice_data.get("payment_swift",   ""))
    iban    = _safe_str(invoice_data.get("payment_iban",    ""))

    if any([bank, account, swift, iban]):
        pi_rows = [["PAYMENT INSTRUCTIONS"]]
        if bank:    pi_rows.append([f"Bank Name:       {bank}"])
        if account: pi_rows.append([f"Account Number:  {account}"])
        if swift:   pi_rows.append([f"SWIFT / BIC:     {swift}"])
        if iban:    pi_rows.append([f"IBAN:            {iban}"])
        pi_rows.append([f"Reference:       {deal_ref} / {invoice_ref}"])

        pi_table = Table(pi_rows, colWidths=[col_w])
        pi_style = TableStyle([
            ("BACKGROUND",   (0, 0), (-1, 0), NAVY_LIGHT),
            ("TEXTCOLOR",    (0, 0), (-1, 0), WHITE),
            ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",     (0, 0), (-1, 0), 8),
            ("FONTNAME",     (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE",     (0, 1), (-1, -1), 9),
            ("TEXTCOLOR",    (0, 1), (-1, -1), BLACK),
            ("BACKGROUND",   (0, 1), (-1, -1), GREY_LIGHT),
            ("LEFTPADDING",  (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING",   (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
            ("BOX",          (0, 0), (-1, -1), 0.5, GREY_MID),
        ])
        pi_table.setStyle(pi_style)
        story.append(pi_table)
        story.append(Spacer(1, 6 * mm))

    # ── Notes ─────────────────────────────────────────────────────────────────
    notes = invoice_data.get("notes")
    if notes:
        story.append(Paragraph(f"<b>Notes:</b> {_safe_str(notes, 500)}", styles["body"]))
        story.append(Spacer(1, 4 * mm))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=GREY_MID))
    story.append(Spacer(1, 3 * mm))

    footer_data = [[
        Paragraph("MarineXchange Africa — Global Maritime Marketplace", styles["footer"]),
        Paragraph("CONFIDENTIAL", styles["confidential"]),
    ]]
    footer_table = Table(footer_data, colWidths=[col_w * 0.7, col_w * 0.3])
    footer_table.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
    ]))
    story.append(footer_table)

    # ── Build ─────────────────────────────────────────────────────────────────
    doc.build(story)
    return buf.getvalue()
