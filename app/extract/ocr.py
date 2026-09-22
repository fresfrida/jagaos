"""Tesseract OCR for scans and photos of printed documents. GAPS.md §8."""

import pytesseract
from PIL import Image


def extract_text(path: str) -> str:
    image = Image.open(path)
    return pytesseract.image_to_string(image).strip()
