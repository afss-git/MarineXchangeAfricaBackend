"""
PDF Invoice Generator for Harbours360.

Generates branded PDF invoices for maritime & industrial asset deals.
Returns raw bytes — caller uploads to Supabase Storage.

Invoice types:
  proforma    — Initial quotation invoice for the full deal value
  installment — Single payment milestone invoice
  final       — Summary invoice covering all completed milestones

Security:
  - All user-supplied strings sanitised via _safe_str()
  - No shell execution, no file system writes — purely in-memory
"""
from __future__ import annotations

import io
import logging
import os
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
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

# ── Brand colours ─────────────────────────────────────────────────────────────
NAVY        = colors.HexColor("#0F2A44")
NAVY_LIGHT  = colors.HexColor("#1A3A58")
OCEAN       = colors.HexColor("#0EA5E9")
OCEAN_LIGHT = colors.HexColor("#E0F4FD")
GREY_LIGHT  = colors.HexColor("#F5F7FA")
GREY_MID    = colors.HexColor("#D1D5DB")
WHITE       = colors.white
BLACK       = colors.HexColor("#111827")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

# ── Logo path ─────────────────────────────────────────────────────────────────
_LOGO_PATH = os.path.join(os.path.dirname(__file__), "logo.jpeg")

# ── Invoice type metadata ─────────────────────────────────────────────────────
_TYPE_META = {
    "proforma": {
        "label": "PROFORMA INVOICE",
        "note": "This is a proforma invoice. It serves as a quotation and is not a request for immediate payment.",
        "badge_color": "#0EA5E9",
    },
    "installment": {
        "label": "INSTALLMENT INVOICE",
        "note": "This invoice covers a single payment milestone as defined in the agreed payment schedule.",
        "badge_color": "#0F2A44",
    },
    "final": {
        "label": "FINAL INVOICE",
        "note": "This is the final invoice summarising all completed and verified payment milestones for this deal.",
        "badge_color": "#059669",
    },
}


# ── Security: sanitise user-supplied strings ──────────────────────────────────
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_XML_SPECIAL   = str.maketrans({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})


def _safe_str(value: Any, max_len: int = 200) -> str:
    s = str(value) if value is not None else ""
    s = _CONTROL_CHARS.sub("", s)
    s = s.translate(_XML_SPECIAL)
    return s[:max_len]


def _fmt_amount(amount: Decimal | float | str, currency: str = "USD") -> str:
    try:
        val = Decimal(str(amount))
        return f"{_safe_str(currency, 5)} {val:,.2f}"
    except Exception:
        return str(amount)


# ── Style factory ──────────────────────────────────────────────────────────────
def _make_styles() -> dict[str, ParagraphStyle]:
    getSampleStyleSheet()
    return {
        "brand_name": ParagraphStyle(
            "brand_name",
            fontName="Helvetica-Bold",
            fontSize=20,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=1,
        ),
        "brand_tagline": ParagraphStyle(
            "brand_tagline",
            fontName="Helvetica",
            fontSize=9,
            textColor=colors.HexColor("#A8C7E8"),
            alignment=TA_LEFT,
        ),
        "invoice_ref": ParagraphStyle(
            "invoice_ref",
            fontName="Helvetica-Bold",
            fontSize=13,
            textColor=OCEAN,
            alignment=TA_RIGHT,
        ),
        "invoice_label": ParagraphStyle(
            "invoice_label",
            fontName="Helvetica",
            fontSize=9,
            textColor=colors.HexColor("#A8C7E8"),
            alignment=TA_RIGHT,
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
        "type_note": ParagraphStyle(
            "type_note",
            fontName="Helvetica",
            fontSize=8,
            textColor=colors.HexColor("#374151"),
            alignment=TA_LEFT,
            leading=12,
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
    Generate a branded Harbours360 invoice PDF.

    invoice_data keys:
      invoice_ref    — e.g. "MXI-2026-00001"
      invoice_type   — "proforma" | "installment" | "final"
      issued_at      — ISO datetime string or None
      due_date       — ISO date string or None
      deal_ref       — e.g. "MXD-2026-00011"
      deal_type      — "full_payment" | "financing"
      buyer_name     — company or full name
      buyer_email    — email
      seller_name    — company or full name
      amount         — Decimal or numeric
      currency       — e.g. "USD"
      line_items     — list of {"label": str, "amount": Decimal, "due_date": str|None}
      payment_bank   — bank name or None
      payment_account — account number or None
      payment_swift  — SWIFT code or None
      payment_iban   — IBAN or None
      notes          — extra notes or None
      status         — "draft" | "issued" | "paid" | "void"
    """
    buf = io.BytesIO()
    invoice_ref  = _safe_str(invoice_data.get("invoice_ref", ""))
    invoice_type = invoice_data.get("invoice_type", "proforma").lower()
    type_meta    = _TYPE_META.get(invoice_type, _TYPE_META["proforma"])

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title=f"Invoice {invoice_ref}",
        author="Harbours360",
        subject=f"{type_meta['label']} — {invoice_ref}",
    )

    styles = _make_styles()
    story  = []
    col_w  = PAGE_W - 2 * MARGIN

    # ── Header banner ──────────────────────────────────────────────────────────
    issued_at = invoice_data.get("issued_at") or datetime.now(timezone.utc).isoformat()
    try:
        issued_str = issued_at[:10] if isinstance(issued_at, str) else str(issued_at)[:10]
    except Exception:
        issued_str = ""

    # Logo cell — use image if available, else text fallback
    if os.path.exists(_LOGO_PATH):
        logo_img = Image(_LOGO_PATH, width=28 * mm, height=28 * mm)
        logo_img.hAlign = "LEFT"
        logo_cell = [logo_img, Spacer(1, 2 * mm), Paragraph("Africa's Maritime &amp; Industrial Marketplace", styles["brand_tagline"])]
    else:
        logo_cell = [
            Paragraph("HARBOURS360", styles["brand_name"]),
            Paragraph("Africa's Maritime &amp; Industrial Marketplace", styles["brand_tagline"]),
        ]

    header_data = [[
        logo_cell,
        [
            Paragraph(invoice_ref, styles["invoice_ref"]),
            Paragraph(type_meta["label"], styles["invoice_label"]),
            Paragraph(f"Issued: {issued_str}", styles["invoice_label"]),
        ],
    ]]

    header_table = Table(header_data, colWidths=[col_w * 0.55, col_w * 0.45])
    header_table.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), NAVY),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING",   (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 14),
    ]))
    story.append(header_table)

    # ── Invoice type note strip ────────────────────────────────────────────────
    badge_color = colors.HexColor(type_meta["badge_color"])
    type_bar = Table(
        [[Paragraph(type_meta["note"], styles["type_note"])]],
        colWidths=[col_w],
    )
    type_bar.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), OCEAN_LIGHT),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING",   (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 7),
        ("LINEBELOW",    (0, 0), (-1, -1), 2, badge_color),
    ]))
    story.append(type_bar)

    # ── Status watermark for void/draft ───────────────────────────────────────
    status = invoice_data.get("status", "issued")
    if status in ("void", "draft"):
        colour = "#EF4444" if status == "void" else "#6B7280"
        story.append(Spacer(1, 4 * mm))
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

    party_style = TableStyle([
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

    half = (col_w - 6 * mm) / 2

    bill_to = Table([
        ["BILL TO"],
        [Paragraph(f"<b>{buyer_name}</b>", styles["body"])],
        [Paragraph(buyer_email, styles["body"])],
    ], colWidths=[half])
    bill_to.setStyle(party_style)

    from_table = Table([
        ["FROM"],
        [Paragraph("<b>Harbours360</b>", styles["body"])],
        [Paragraph(f"On behalf of: {seller_name}", styles["body"])],
        [Paragraph("africa@harbours360.com", styles["body"])],
    ], colWidths=[half])
    from_table.setStyle(party_style)

    parties = Table([[bill_to, from_table]], colWidths=[half + 3 * mm, half + 3 * mm])
    parties.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
    ]))
    story.append(parties)
    story.append(Spacer(1, 5 * mm))

    # ── Deal reference bar ─────────────────────────────────────────────────────
    deal_bar = Table([[
        Paragraph(f"<b>Deal Ref:</b> {deal_ref}", styles["body"]),
        Paragraph(f"<b>Type:</b> {deal_type}", styles["body"]),
        Paragraph(f"<b>Due Date:</b> {due_date}", styles["body"]),
    ]], colWidths=[col_w / 3] * 3)
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

    tbl_data = [["#", "Description", "Due Date", "Amount"]]
    for idx, item in enumerate(line_items, start=1):
        label = _safe_str(item.get("label", f"Item {idx}"))
        amt   = _fmt_amount(item.get("amount", 0), currency)
        due   = _safe_str(item.get("due_date") or "—")
        tbl_data.append([str(idx), label, due, amt])

    total_amount = invoice_data.get("amount", 0)
    tbl_data.append([
        "", "",
        Paragraph("<b>TOTAL</b>", styles["body_right"]),
        Paragraph(f"<b>{_fmt_amount(total_amount, currency)}</b>", styles["body_bold"]),
    ])

    items_table = Table(
        tbl_data,
        colWidths=[8 * mm, col_w - 8 * mm - 35 * mm - 42 * mm, 35 * mm, 42 * mm],
    )
    items_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), WHITE),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("ALIGN",         (0, 0), (-1, 0), "CENTER"),
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 9),
        ("TEXTCOLOR",     (0, 1), (-1, -1), BLACK),
        ("ALIGN",         (0, 1), (0, -1), "CENTER"),
        ("ALIGN",         (3, 1), (3, -1), "RIGHT"),
        ("ALIGN",         (2, 1), (2, -1), "CENTER"),
        ("ROWBACKGROUNDS",(0, 1), (-1, -2), [WHITE, GREY_LIGHT]),
        ("BACKGROUND",    (0, -1), (-1, -1), OCEAN_LIGHT),
        ("LINEABOVE",     (0, -1), (-1, -1), 1.5, OCEAN),
        ("GRID",          (0, 0), (-1, -2), 0.5, GREY_MID),
        ("BOX",           (0, 0), (-1, -1), 1, NAVY),
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
        if bank:    pi_rows.append([f"Bank Name:      {bank}"])
        if account: pi_rows.append([f"Account Number: {account}"])
        if swift:   pi_rows.append([f"SWIFT / BIC:    {swift}"])
        if iban:    pi_rows.append([f"IBAN:           {iban}"])
        pi_rows.append([f"Reference:      {deal_ref} / {invoice_ref}"])

        pi_table = Table(pi_rows, colWidths=[col_w])
        pi_table.setStyle(TableStyle([
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
        ]))
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
        Paragraph("Harbours360 — Africa's Maritime &amp; Industrial Marketplace", styles["footer"]),
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

    doc.build(story)
    return buf.getvalue()
