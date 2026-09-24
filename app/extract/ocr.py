"""Tesseract OCR for scans and photos of printed documents. GAPS.md §8."""

import pdfplumber
import pytesseract
from PIL import Image, ImageOps

# 2026-09-24: an image-only ("scanned") PDF has no text layer, so
# app/extract/pdf.py finds nothing and app/graph/ingest.py routes it here —
# but this file could only open a raw image, so it raised on the PDF
# (HTTP 500, confirmed live). Pages are rasterized with pdfplumber (its
# pypdfium2 dependency is already installed — no new package) and OCR'd one
# at a time. 200 dpi: measured on a synthetic ~9pt blurred A4 scan, 100 dpi
# missed 4 of 30 lines, 150/200/300 read all 30; 200 keeps margin for a
# worse real scan at ~0.8s/page locally. The page cap keeps a huge scan from
# tying up the (synchronous) upload handler — it is a guard, not a
# multi-page feature (that is parked, DECISIONS #75).
PDF_OCR_DPI = 200
MAX_PDF_OCR_PAGES = 10

# --psm 6 ("assume a single uniform block of text") — see extract_text().
OCR_CONFIG = "--psm 6"


def extract_text(path: str) -> str:
    image = Image.open(path)
    # EXIF-rotation correction (2026-09-23, live regression report) —
    # PIL does NOT auto-rotate on EXIF Orientation the way a browser's
    # <img>/createImageBitmap() does; a portrait phone photo commonly
    # stores landscape pixels plus a rotation flag, and feeding that
    # straight to Tesseract produces near-unusable OCR. Confirmed live
    # with a synthetic EXIF-rotated invoice image before shipping this:
    # unfixed, 44 chars of garbage ('gz\n&\n2 2 $ 8g...'); with
    # exif_transpose(), 126 chars of genuinely readable text (vendor,
    # invoice no, date, amounts). `or image` covers the (documented but
    # essentially never hit for a real photo) case where the function
    # returns None.
    #
    # This mainly protects upload paths that bypass the frontend's own
    # normalization (direct API calls, a future Telegram/email source
    # channel — see `document.source_channel`) — `web/src/lib/
    # imageNormalize.ts`'s docstring states `createImageBitmap()` already
    # applies EXIF-orientation correction by default in every shipping
    # browser, so a real upload through the actual web UI should already
    # arrive with upright pixels and nothing for this to correct. If a
    # live regression persists after this fix for a *web-uploaded* photo,
    # the more likely explanation is the separate, already-known, already-
    # deferred gap this file's own history flags — no deskew/crop/quality
    # preprocessing at all (`docs/KANBAN.md` Backlog) — not EXIF rotation.
    image = ImageOps.exif_transpose(image) or image
    # --psm 6 ("assume a single uniform block of text") — the default PSM 3
    # ("fully automatic" page segmentation) was confirmed live to silently
    # drop a right-aligned numeric table column on a real invoice (labels
    # like "Sub Total" came through, their values did not). Verified
    # against the actual stored image, no regression on the rest of that
    # document's OCR output (2026-09-22).
    return pytesseract.image_to_string(image, config=OCR_CONFIG).strip()


def extract_pdf_text(path: str) -> str:
    """OCR of an image-only PDF: rasterize each page (up to
    MAX_PDF_OCR_PAGES), OCR it, join with a blank line between pages — the
    same shape app/extract/pdf.py produces for a born-digital PDF."""
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:MAX_PDF_OCR_PAGES]:
            image = page.to_image(resolution=PDF_OCR_DPI).original.convert("RGB")
            parts.append(pytesseract.image_to_string(image, config=OCR_CONFIG).strip())
    return "\n\n".join(parts).strip()
