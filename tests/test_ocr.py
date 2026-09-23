"""EXIF-rotation OCR test (2026-09-23, live regression report) — no
gateway key needed, pure Pillow + local Tesseract. Reproduces the exact
synthetic case used to confirm the bug and the fix before shipping:
a portrait invoice photo stored as landscape pixels + an EXIF Orientation
tag, the same shape phone cameras commonly produce. Skips (not fails) if
Tesseract isn't installed on the machine running the suite, same
tradeoff the rest of this repo's OCR code already accepts implicitly.
"""

import tempfile
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from app.extract.ocr import extract_text

pytesseract = pytest.importorskip("pytesseract")

try:
    pytesseract.get_tesseract_version()
except Exception:  # pragma: no cover - environment-dependent
    pytest.skip("tesseract binary not installed", allow_module_level=True)


def _sideways_invoice_jpeg(path: Path) -> None:
    upright = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(upright)
    lines = [
        "INVOICE",
        "Vendor: Lay Meng Engineering Pte Ltd",
        "Invoice No: INV-2026-0042",
        "Date: 2026-09-20",
        "",
        "Subtotal: 500.00",
        "GST: 45.00",
        "Total: 545.00",
    ]
    y = 50
    for line in lines:
        draw.text((50, y), line, fill="black")
        y += 60

    # Physically rotate 90 (simulating landscape-stored sensor pixels),
    # tag Orientation=6 (the EXIF value that means "rotate 90 to
    # display correctly") — this exact angle/orientation pairing was
    # verified to round-trip back to the original size via
    # ImageOps.exif_transpose() before writing this test.
    rotated = upright.rotate(90, expand=True)
    exif = rotated.getexif()
    exif[274] = 6  # Orientation
    rotated.save(path, quality=95, exif=exif)


def test_exif_rotated_photo_is_corrected_before_ocr():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "sideways_invoice.jpg"
        _sideways_invoice_jpeg(path)

        text = extract_text(str(path))

        # Confirmed live before this fix: an unrotated read of this exact
        # image produces ~40-50 chars of unusable OCR noise, nothing
        # recognizable. With the fix, the real invoice fields are legible
        # (checked on the fields Tesseract reads reliably off rendered —
        # not scanned — text; the dollar figures pick up occasional
        # digit-level noise on synthetic text, e.g. "545.00" -> "645000",
        # not a rotation problem, so not asserted on here).
        assert "INVOICE" in text.upper()
        assert "Lay Meng" in text
        assert "2026-0042" in text
        assert len(text) > 80
