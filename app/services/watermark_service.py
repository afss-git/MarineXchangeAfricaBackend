"""
Watermarking utilities for KYC documents.

Agents see watermarked versions (tiled diagonal text with their name + timestamp).
Admins see originals.
Falls back to the original bytes if watermarking fails.
"""
from __future__ import annotations

import io
import logging
import math

logger = logging.getLogger(__name__)

# Font paths to try on Debian/Ubuntu (Render runtime)
_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
]


def watermark_image(data: bytes, text: str, mime_type: str) -> bytes:
    """Add a tiled diagonal watermark to a JPEG/PNG/WebP image."""
    try:
        from PIL import Image, ImageDraw, ImageFont  # type: ignore

        img = Image.open(io.BytesIO(data)).convert("RGBA")
        w, h = img.size

        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        font_size = max(18, min(w, h) // 14)
        font = None
        for path in _FONT_PATHS:
            try:
                font = ImageFont.truetype(path, font_size)
                break
            except (OSError, IOError):
                pass
        if font is None:
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]

        step_x = tw + 80
        step_y = th + 60
        # Offset every other row for a staggered diagonal pattern
        for row, y in enumerate(range(-h, h * 2, step_y)):
            offset = (tw // 2) if row % 2 else 0
            for x in range(-w + offset, w * 2, step_x):
                draw.text((x, y), text, fill=(180, 20, 20, 55), font=font)

        result = Image.alpha_composite(img, overlay).convert("RGB")
        out = io.BytesIO()
        if "png" in mime_type:
            result.save(out, format="PNG", optimize=True)
        elif "webp" in mime_type:
            result.save(out, format="WEBP", quality=85)
        else:
            result.save(out, format="JPEG", quality=85)
        return out.getvalue()

    except Exception as exc:
        logger.warning("Image watermark failed, returning original: %s", exc)
        return data


def watermark_pdf(data: bytes, text: str) -> bytes:
    """Overlay a tiled diagonal watermark on every page of a PDF."""
    try:
        from pypdf import PdfReader, PdfWriter  # type: ignore
        from reportlab.pdfgen import canvas as rl_canvas  # type: ignore
        from reportlab.lib.colors import Color  # type: ignore

        reader = PdfReader(io.BytesIO(data))
        writer = PdfWriter()

        for page in reader.pages:
            pw = float(page.mediabox.width)
            ph = float(page.mediabox.height)
            diag = math.sqrt(pw ** 2 + ph ** 2)

            wm_buf = io.BytesIO()
            c = rl_canvas.Canvas(wm_buf, pagesize=(pw, ph))
            c.setFont("Helvetica-Bold", 11)
            c.setFillColor(Color(0.75, 0.1, 0.1, alpha=0.20))
            c.saveState()
            c.translate(pw / 2, ph / 2)
            c.rotate(40)

            step = 110
            for y in range(-int(diag), int(diag), step):
                for x in range(-int(diag), int(diag), step):
                    c.drawString(x, y, text)

            c.restoreState()
            c.save()

            wm_buf.seek(0)
            wm_page = PdfReader(wm_buf).pages[0]
            page.merge_page(wm_page)
            writer.add_page(page)

        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()

    except Exception as exc:
        logger.warning("PDF watermark failed, returning original: %s", exc)
        return data
