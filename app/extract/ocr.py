"""Tesseract OCR for scans and photos of printed documents. GAPS.md §8."""

import pytesseract
from PIL import Image


def extract_text(path: str) -> str:
    image = Image.open(path)
    # --psm 6 ("assume a single uniform block of text") — the default PSM 3
    # ("fully automatic" page segmentation) was confirmed live to silently
    # drop a right-aligned numeric table column on a real invoice (labels
    # like "Sub Total" came through, their values did not). Verified
    # against the actual stored image, no regression on the rest of that
    # document's OCR output (2026-09-22).
    return pytesseract.image_to_string(image, config="--psm 6").strip()
